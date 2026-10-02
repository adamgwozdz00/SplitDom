import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTwoUsers, type DbClient, type TwoUsers } from "@/db/__tests__/two-users.harness";
import { groupName } from "@/lib/groups/__tests__/groups.harness";
import { Group } from "@/lib/groups/group.aggregate";
import { createSupabaseGroupRepository } from "@/lib/groups/group.repository";
import type { GroupRepository } from "@/lib/groups/types";

const TABLES = ["groups", "group_members", "billing_periods"] as const;

function newGroup(hostId: string, name: string): Group {
  return Group.create({ id: randomUUID(), name: groupName(name), hostId, now: new Date(), periodId: randomUUID() });
}

function createGroupArgs(group: Group) {
  const snapshot = group.toSnapshot();
  return {
    p_group_id: snapshot.id,
    p_name: snapshot.name,
    p_host_id: snapshot.hostId,
    p_period_id: snapshot.openPeriod.id,
    p_period_month: snapshot.openPeriod.month,
    p_now: snapshot.createdAt,
  };
}

async function save(repository: GroupRepository, group: Group): Promise<Group> {
  expect(await repository.create(group)).toEqual({ data: undefined });
  return group;
}

describe("Supabase group repository (persistence and isolation)", () => {
  let users: TwoUsers;
  // Set only once createTwoUsers() succeeded, so afterAll never masks its error with a TypeError.
  let created: TwoUsers | undefined;
  let repositoryA: GroupRepository;
  let repositoryB: GroupRepository;
  let groupOfA: Group;

  beforeAll(async () => {
    users = await createTwoUsers();
    created = users;
    repositoryA = createSupabaseGroupRepository(users.userA.client);
    repositoryB = createSupabaseGroupRepository(users.userB.client);
    groupOfA = await save(repositoryA, newGroup(users.userA.id, "Mokotów"));
  });

  afterAll(async () => {
    if (created === undefined) {
      return;
    }
    // groups.host_id does not cascade, so the users' groups go before the users themselves.
    const { error } = await created.admin.from("groups").delete().in("host_id", [created.userA.id, created.userB.id]);
    if (error) {
      throw error;
    }
    await created.cleanup();
  });

  it("stores the aggregate as created, including its clock", async () => {
    const found = await repositoryA.findGroupOfCurrentUser(groupOfA.id);

    if (!("data" in found) || found.data === null) {
      throw new Error(`Expected A's group, got ${JSON.stringify(found)}`);
    }
    expect(found.data.toSnapshot()).toEqual(groupOfA.toSnapshot());
  });

  it("lists every group of the current user", async () => {
    const second = await save(repositoryA, newGroup(users.userA.id, "Wakacje 2026"));

    const listed = await repositoryA.listGroupsOfCurrentUser();

    if (!("data" in listed)) {
      throw new Error(`Expected A's groups, got ${JSON.stringify(listed)}`);
    }
    expect(listed.data.map((group) => group.id).sort()).toEqual([groupOfA.id, second.id].sort());
  });

  it("shows user B none of user A's groups", async () => {
    const listed = await repositoryB.listGroupsOfCurrentUser();

    if (!("data" in listed)) {
      throw new Error(`Expected B's groups, got ${JSON.stringify(listed)}`);
    }
    expect(listed.data.map((group) => group.id)).not.toContain(groupOfA.id);
    expect(await repositoryB.findGroupOfCurrentUser(groupOfA.id)).toEqual({ data: null });
  });

  it("refuses direct table access to A, B and anon", async () => {
    const clients: [string, DbClient][] = [
      ["A", users.userA.client],
      ["B", users.userB.client],
      ["anon", users.anon],
    ];
    for (const [who, client] of clients) {
      for (const table of TABLES) {
        const { data, error } = await client.from(table).select();
        expect({ who, table, code: error?.code, data }).toEqual({ who, table, code: "42501", data: null });
      }
    }
  });

  it("refuses a direct membership insert into A's group by B", async () => {
    const { error } = await users.userB.client
      .from("group_members")
      .insert({ group_id: groupOfA.id, user_id: users.userB.id, joined_at: new Date().toISOString() });

    expect(error?.code).toBe("42501");
    expect(await repositoryB.findGroupOfCurrentUser(groupOfA.id)).toEqual({ data: null });
  });

  it("refuses direct changes to A's group and period by B", async () => {
    const renamed = await users.userB.client.from("groups").update({ name: "Taken" }).eq("id", groupOfA.id);
    const groupDeleted = await users.userB.client.from("groups").delete().eq("id", groupOfA.id);
    const periodClosed = await users.userB.client
      .from("billing_periods")
      .update({ closed_at: new Date().toISOString() })
      .eq("group_id", groupOfA.id);
    const periodDeleted = await users.userB.client.from("billing_periods").delete().eq("group_id", groupOfA.id);

    expect([renamed, groupDeleted, periodClosed, periodDeleted].map(({ error }) => error?.code)).toEqual([
      "42501",
      "42501",
      "42501",
      "42501",
    ]);
    const found = await repositoryA.findGroupOfCurrentUser(groupOfA.id);
    expect("data" in found && found.data?.toSnapshot()).toEqual(groupOfA.toSnapshot());
  });

  it("does not let anon execute the persistence functions", async () => {
    const created = await users.anon.rpc("create_group", createGroupArgs(newGroup(users.userA.id, "Anon")));
    const listed = await users.anon.rpc("list_my_groups");
    const found = await users.anon.rpc("get_my_group", { p_group_id: groupOfA.id });

    expect([created.error?.code, listed.error?.code, found.error?.code]).toEqual(["42501", "42501", "42501"]);
  });

  it("refuses a caller without a user id with not_authenticated (28000)", async () => {
    // The service role may execute the functions but carries no auth.uid().
    const { error } = await users.admin.rpc("list_my_groups");

    expect(error?.code).toBe("28000");
  });

  it("maps a missing user id to not_authenticated in the repository", async () => {
    const result = await createSupabaseGroupRepository(users.admin).listGroupsOfCurrentUser();

    expect("error" in result && result.error.code).toBe("not_authenticated");
  });

  it("create_group records the caller as host and member", async () => {
    const group = newGroup(users.userB.id, "Żoliborz");

    const { error } = await users.userB.client.rpc("create_group", createGroupArgs(group));

    expect(error).toBeNull();
    const found = await repositoryB.findGroupOfCurrentUser(group.id);
    if (!("data" in found) || found.data === null) {
      throw new Error(`Expected B's group, got ${JSON.stringify(found)}`);
    }
    expect(found.data.hostId).toBe(users.userB.id);
    expect(found.data.members.map((member) => member.userId)).toEqual([users.userB.id]);
  });

  it("create_group refuses another user's id as host and writes nothing", async () => {
    const group = newGroup(users.userA.id, "Not mine");

    const { error } = await users.userB.client.rpc("create_group", createGroupArgs(group));

    expect(error?.code).toBe("42501");
    const { data, error: adminError } = await users.admin.from("groups").select("id").eq("id", group.id);
    expect(adminError).toBeNull();
    expect(data).toEqual([]);
    expect(await repositoryA.findGroupOfCurrentUser(group.id)).toEqual({ data: null });
  });

  it("create_group cannot take over A's group by reusing its id", async () => {
    const args = { ...createGroupArgs(newGroup(users.userB.id, "Hijack")), p_group_id: groupOfA.id };

    const { error } = await users.userB.client.rpc("create_group", args);

    expect(error).not.toBeNull();
    expect(await repositoryB.findGroupOfCurrentUser(groupOfA.id)).toEqual({ data: null });
    const found = await repositoryA.findGroupOfCurrentUser(groupOfA.id);
    expect("data" in found && found.data?.toSnapshot()).toEqual(groupOfA.toSnapshot());
  });

  it("create_group cannot reuse A's period id and leaves nothing behind", async () => {
    const group = newGroup(users.userB.id, "Borrowed period");
    const args = { ...createGroupArgs(group), p_period_id: groupOfA.openPeriod.id };

    const { error } = await users.userB.client.rpc("create_group", args);

    expect(error).not.toBeNull();
    const { data, error: adminError } = await users.admin.from("groups").select("id").eq("id", group.id);
    expect(adminError).toBeNull();
    expect(data).toEqual([]);
    const found = await repositoryA.findGroupOfCurrentUser(groupOfA.id);
    expect("data" in found && found.data?.toSnapshot()).toEqual(groupOfA.toSnapshot());
  });

  it("refuses a billing month that is not the first day of a month", async () => {
    const args = { ...createGroupArgs(newGroup(users.userB.id, "Mid-month")), p_period_month: "2026-10-15" };

    const { error } = await users.userB.client.rpc("create_group", args);

    expect(error?.code).toBe("23514");
  });

  it("still lists a group whose name was stored past the aggregate", async () => {
    // A direct call skips GroupName's creation rule; the stored name must not make the list unreadable.
    const group = newGroup(users.userB.id, "Placeholder");
    const args = { ...createGroupArgs(group), p_name: "\u200B" };
    expect((await users.userB.client.rpc("create_group", args)).error).toBeNull();

    const listed = await repositoryB.listGroupsOfCurrentUser();

    if (!("data" in listed)) {
      throw new Error(`Expected B's groups, got ${JSON.stringify(listed)}`);
    }
    expect(listed.data.find((found) => found.id === group.id)?.name.value).toBe("\u200B");
  });
});
