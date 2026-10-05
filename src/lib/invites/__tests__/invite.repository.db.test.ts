import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDb } from "@/db/__tests__/pg.harness";
import { createTwoUsers, type DbClient, type TwoUsers } from "@/db/__tests__/two-users.harness";
import { createGroupService, type Group } from "@/lib/groups";
import { createInviteService, createSupabaseInviteRepository, InviteToken } from "@/lib/invites";
import type { InviteLookup, InviteRepository, InviteService } from "@/lib/invites";

const DAY_MS = 24 * 60 * 60 * 1000;

function unwrap<T>(result: { data: T } | { error: { code: string } }): T {
  if (!("data" in result)) {
    throw new Error(`Expected data, got ${JSON.stringify(result)}`);
  }
  return result.data;
}

function createArgs(groupId: string, token: string, createdBy: string) {
  const now = new Date();
  return {
    p_invite_id: randomUUID(),
    p_group_id: groupId,
    p_token: token,
    p_created_by: createdBy,
    p_created_at: now.toISOString(),
    p_expires_at: new Date(now.getTime() + 7 * DAY_MS).toISOString(),
  };
}

describe("Supabase invite repository (persistence and isolation)", () => {
  let users: TwoUsers;
  // Set only once createTwoUsers() succeeded, so afterAll never masks its error with a TypeError.
  let created: TwoUsers | undefined;
  let serviceA: InviteService;
  let serviceB: InviteService;
  let repositoryB: InviteRepository;
  let groupOfA: Group;
  let tokenT: InviteToken;

  async function newInvite(): Promise<InviteToken> {
    return unwrap(await serviceA.create({ group: groupOfA, createdBy: users.userA.id })).token;
  }

  async function lookup(repository: InviteRepository, token: InviteToken): Promise<InviteLookup> {
    const found = unwrap(await repository.findByToken(token));
    if (found === null) {
      throw new Error("Expected the invite to be found");
    }
    return found;
  }

  beforeAll(async () => {
    users = await createTwoUsers();
    created = users;
    serviceA = createInviteService(users.userA.client);
    serviceB = createInviteService(users.userB.client);
    repositoryB = createSupabaseInviteRepository(users.userB.client);

    const { groupId } = unwrap(
      await createGroupService(users.userA.client).create({ name: "Mokotów", hostId: users.userA.id }),
    );
    groupOfA = unwrap(await createGroupService(users.userA.client).getForMember({ groupId, userId: users.userA.id }));
    tokenT = await newInvite();
  });

  afterAll(async () => {
    if (created === undefined) {
      return;
    }
    // groups.host_id does not cascade, so the users' groups go before the users themselves; invites cascade with them.
    const { error } = await created.admin.from("groups").delete().in("host_id", [created.userA.id, created.userB.id]);
    if (error) {
      throw error;
    }
    await created.cleanup();
  });

  it("stores only the hash of the token", async () => {
    const rows = await withDb(async (client) => {
      const hash = createHash("sha256").update(tokenT.value, "utf8").digest("hex");
      const matching = await client.query("select id from public.group_invites where encode(token_hash, 'hex') = $1", [
        hash,
      ]);
      const leaking = await client.query("select id from public.group_invites i where i::text like $1", [
        `%${tokenT.value}%`,
      ]);
      return { matching: matching.rowCount, leaking: leaking.rowCount };
    });

    expect(rows).toEqual({ matching: 1, leaking: 0 });
  });

  it("shows B the group name and an active invite without membership", async () => {
    const found = await lookup(repositoryB, tokenT);

    expect(found.groupName).toBe("Mokotów");
    expect(found.callerIsMember).toBe(false);
    expect(found.invite.groupId).toBe(groupOfA.id);
    expect(found.invite.createdBy).toBe(users.userA.id);
    expect(found.invite.isActive(new Date())).toBe(true);
  });

  it("returns null for an unknown token", async () => {
    const unknown = InviteToken.generate();

    expect(await repositoryB.findByToken(unknown)).toEqual({ data: null });
  });

  it("refuses B creating an invite for A's group", async () => {
    const { error } = await users.userB.client.rpc(
      "create_group_invite",
      createArgs(groupOfA.id, InviteToken.generate().value, users.userB.id),
    );

    expect(error?.code).toBe("42501");
  });

  it("refuses A storing another user as the inviter", async () => {
    const { error } = await users.userA.client.rpc(
      "create_group_invite",
      createArgs(groupOfA.id, InviteToken.generate().value, users.userB.id),
    );

    expect(error?.code).toBe("42501");
  });

  it("refuses a token shorter than 43 characters", async () => {
    const { error } = await users.userA.client.rpc(
      "create_group_invite",
      createArgs(groupOfA.id, "short12345", users.userA.id),
    );

    expect(error?.code).toBe("22023");
  });

  it("lets B redeem the invite, becoming a member", async () => {
    const result = await serviceB.redeem({ token: tokenT.value, userId: users.userB.id });

    expect(result).toEqual({ data: { groupId: groupOfA.id, joined: true } });
    const groupOfB = unwrap(
      await createGroupService(users.userB.client).getForMember({ groupId: groupOfA.id, userId: users.userB.id }),
    );
    expect(groupOfB.isMember(users.userB.id)).toBe(true);
  });

  it("rejects redeeming the same invite again", async () => {
    const result = await serviceB.redeem({ token: tokenT.value, userId: users.userB.id });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    const found = await lookup(repositoryB, tokenT);
    expect(found.invite.usedBy).toBe(users.userB.id);
  });

  it("uses up the invite of an existing member and reports joined: false", async () => {
    const token = await newInvite();

    const result = await serviceA.redeem({ token: token.value, userId: users.userA.id });

    expect(result).toEqual({ data: { groupId: groupOfA.id, joined: false } });
    const found = await lookup(createSupabaseInviteRepository(users.userA.client), token);
    expect(found.invite.usedBy).toBe(users.userA.id);
    expect(found.callerIsMember).toBe(true);
  });

  it("rejects an expired invite, even through a direct call with an old p_used_at", async () => {
    const token = await newInvite();
    const found = await lookup(repositoryB, token);
    const { error: updateError } = await users.admin
      .from("group_invites")
      .update({
        created_at: new Date(Date.now() - 8 * DAY_MS).toISOString(),
        expires_at: new Date(Date.now() - DAY_MS).toISOString(),
      })
      .eq("id", found.invite.id);
    expect(updateError).toBeNull();

    const viaService = await serviceB.redeem({ token: token.value, userId: users.userB.id });
    const direct = await users.userB.client.rpc("redeem_group_invite", {
      p_token: token.value,
      p_used_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    });

    expect("error" in viaService && viaService.error.code).toBe("invite_invalid");
    expect(direct.error?.code).toBe("SD001");
    const after = await lookup(repositoryB, token);
    expect(after.invite.usedAt).toBeNull();
  });

  it("lets exactly one of two parallel redeems win", async () => {
    const token = await newInvite();

    const results = await Promise.all([
      serviceB.redeem({ token: token.value, userId: users.userB.id }),
      serviceB.redeem({ token: token.value, userId: users.userB.id }),
    ]);

    const successes = results.filter((result) => "data" in result);
    const failures = results.filter((result) => "error" in result);
    expect(successes).toHaveLength(1);
    expect(failures.map((result) => "error" in result && result.error.code)).toEqual(["invite_invalid"]);
  });

  it("does not let anon execute the persistence functions", async () => {
    const created = await users.anon.rpc("create_group_invite", createArgs(groupOfA.id, tokenT.value, users.userA.id));
    const found = await users.anon.rpc("get_group_invite", { p_token: tokenT.value });
    const redeemed = await users.anon.rpc("redeem_group_invite", {
      p_token: tokenT.value,
      p_used_at: new Date().toISOString(),
    });

    expect([created.error?.code, found.error?.code, redeemed.error?.code]).toEqual(["42501", "42501", "42501"]);
  });

  it("refuses direct table access to A and B", async () => {
    const clients: [string, DbClient][] = [
      ["A", users.userA.client],
      ["B", users.userB.client],
    ];
    for (const [who, client] of clients) {
      const selected = await client.from("group_invites").select();
      const inserted = await client.from("group_invites").insert({
        id: randomUUID(),
        group_id: groupOfA.id,
        token_hash: "\\x" + "00".repeat(32),
        created_by: users[who === "A" ? "userA" : "userB"].id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      });
      expect({ who, select: selected.error?.code, insert: inserted.error?.code }).toEqual({
        who,
        select: "42501",
        insert: "42501",
      });
    }
  });
});
