import { describe, expect, it } from "vitest";
import { aGroup, FakeGroupRepository } from "@/lib/groups/__tests__/groups.harness";
import { groupError } from "@/lib/groups/group-error.messages";
import { GroupService } from "@/lib/groups/group.service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-02T09:15:30.123Z");

function sequentialIds(...ids: string[]): () => string {
  const remaining = [...ids];
  return () => {
    const id = remaining.shift();
    if (id === undefined) {
      throw new Error("No more test ids");
    }
    return id;
  };
}

function serviceWith(repository: FakeGroupRepository, ids: string[] = []): GroupService {
  return new GroupService(repository, sequentialIds(...ids), () => NOW);
}

describe("GroupService.create", () => {
  it("saves one aggregate built from the injected ids and clock", async () => {
    const repository = new FakeGroupRepository();

    const result = await serviceWith(repository, ["group-1", "period-1"]).create({ name: "  Mokotów ", hostId: USER });

    expect(result).toEqual({ data: { groupId: "group-1" } });
    expect(repository.createCalls).toHaveLength(1);
    expect(repository.createCalls[0]?.toSnapshot()).toEqual({
      id: "group-1",
      name: "Mokotów",
      hostId: USER,
      createdAt: "2026-10-02T09:15:30.123Z",
      members: [{ userId: USER, joinedAt: "2026-10-02T09:15:30.123Z", email: null }],
      openPeriod: { id: "period-1", month: "2026-10-01", openedAt: "2026-10-02T09:15:30.123Z" },
    });
  });

  it("lets a user who already has a group create another", async () => {
    const repository = new FakeGroupRepository();
    const service = serviceWith(repository, ["group-1", "period-1", "group-2", "period-2"]);

    await service.create({ name: "Mokotów", hostId: USER });
    const second = await service.create({ name: "Wakacje 2026", hostId: USER });

    expect(second).toEqual({ data: { groupId: "group-2" } });
    expect(repository.createCalls.map((group) => group.id)).toEqual(["group-1", "group-2"]);
  });

  it("rejects an invalid name without touching the repository", async () => {
    const repository = new FakeGroupRepository();

    const result = await serviceWith(repository, ["group-1", "period-1"]).create({ name: "   ", hostId: USER });

    expect("error" in result && result.error.code).toBe("invalid_group_name");
    expect(repository.createCalls).toHaveLength(0);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeGroupRepository();
    const failure = groupError("not_authenticated", { dbCode: "28000" });
    repository.failure = failure;

    const result = await serviceWith(repository, ["group-1", "period-1"]).create({ name: "Mokotów", hostId: USER });

    expect(result).toBe(failure);
  });
});

describe("GroupService.listForMember", () => {
  it("lists the groups newest first", async () => {
    const oldest = aGroup({ id: "g-old", hostId: USER, now: new Date("2026-08-01T10:00:00.000Z") });
    const newest = aGroup({ id: "g-new", hostId: USER, now: new Date("2026-10-01T10:00:00.000Z") });
    const middle = aGroup({ id: "g-mid", hostId: USER, now: new Date("2026-09-01T10:00:00.000Z") });
    const repository = new FakeGroupRepository([oldest, newest, middle]);

    const result = await serviceWith(repository).listForMember(USER);

    expect("data" in result && result.data.map((group) => group.id)).toEqual(["g-new", "g-mid", "g-old"]);
  });

  it("leaves out a group the user is not a member of", async () => {
    const mine = aGroup({ id: "g-mine", hostId: USER });
    const theirs = aGroup({ id: "g-theirs", hostId: OTHER });
    const repository = new FakeGroupRepository([mine, theirs]);

    const result = await serviceWith(repository).listForMember(USER);

    expect("data" in result && result.data.map((group) => group.id)).toEqual(["g-mine"]);
  });

  it("returns an empty list when the user has no groups", async () => {
    const result = await serviceWith(new FakeGroupRepository()).listForMember(USER);

    expect(result).toEqual({ data: [] });
  });

  it("passes a repository error through", async () => {
    const repository = new FakeGroupRepository();
    const failure = groupError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).listForMember(USER)).toBe(failure);
  });
});

describe("GroupService.getForMember", () => {
  it("returns a group the user belongs to", async () => {
    const group = aGroup({ id: GROUP_ID, hostId: USER });
    const repository = new FakeGroupRepository([group]);

    const result = await serviceWith(repository).getForMember({ groupId: GROUP_ID, userId: USER });

    expect(result).toEqual({ data: group });
  });

  it("reports an unknown id as not found", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: USER })]);

    const result = await serviceWith(repository).getForMember({ groupId: UNKNOWN_ID, userId: USER });

    expect("error" in result && result.error).toMatchObject({
      code: "group_not_found",
      context: { groupId: UNKNOWN_ID },
    });
  });

  it("reports a group the user is not a member of as not found", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: OTHER })]);

    const result = await serviceWith(repository).getForMember({ groupId: GROUP_ID, userId: USER });

    expect("error" in result && result.error).toMatchObject({
      code: "group_not_found",
      context: { groupId: GROUP_ID },
    });
  });

  it.each(["not-a-uuid", "", "11111111-1111-4111-8111-11111111111"])(
    "reports the malformed id %j as not found without asking the repository",
    async (groupId) => {
      const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: USER })]);

      const result = await serviceWith(repository).getForMember({ groupId, userId: USER });

      expect("error" in result && result.error.code).toBe("group_not_found");
      expect(repository.findCalls).toEqual([]);
    },
  );

  it("passes a repository error through", async () => {
    const repository = new FakeGroupRepository();
    const failure = groupError("not_authenticated", { dbCode: "28000" });
    repository.failure = failure;

    expect(await serviceWith(repository).getForMember({ groupId: GROUP_ID, userId: USER })).toBe(failure);
  });
});
