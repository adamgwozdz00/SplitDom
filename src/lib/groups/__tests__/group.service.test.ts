import { describe, expect, it } from "vitest";
import { aGroup, aGroupWithInvite, aToken, FakeGroupRepository } from "@/lib/groups/__tests__/groups.harness";
import { groupError } from "@/lib/groups/group-error.messages";
import { GroupService } from "@/lib/groups/group.service";
import { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";

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

function serviceWith(repository: FakeGroupRepository, ids: string[] = [], clock: () => Date = () => NOW): GroupService {
  return new GroupService(repository, sequentialIds(...ids), clock, () => aToken("n"));
}

const INVITE_TOKEN = aToken("i");
const IN_EIGHT_DAYS = () => new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);

describe("GroupService.create", () => {
  it("saves one aggregate built from the injected id and clock and returns it", async () => {
    const repository = new FakeGroupRepository();

    const result = await serviceWith(repository, ["group-1"]).create({ name: "  Mokotów ", hostId: USER });

    expect("data" in result && result.data).toBe(repository.createCalls[0]);
    expect(repository.createCalls).toHaveLength(1);
    expect(repository.createCalls[0]?.toSnapshot()).toEqual({
      id: "group-1",
      name: "Mokotów",
      hostId: USER,
      createdAt: "2026-10-02T09:15:30.123Z",
      members: [{ userId: USER, joinedAt: "2026-10-02T09:15:30.123Z", email: null }],
      version: 0,
      invites: [],
    });
  });

  it("lets a user who already has a group create another", async () => {
    const repository = new FakeGroupRepository();
    const service = serviceWith(repository, ["group-1", "group-2"]);

    await service.create({ name: "Mokotów", hostId: USER });
    const second = await service.create({ name: "Wakacje 2026", hostId: USER });

    expect("data" in second && second.data.id).toBe("group-2");
    expect(repository.createCalls.map((group) => group.id)).toEqual(["group-1", "group-2"]);
  });

  it("rejects an invalid name without touching the repository", async () => {
    const repository = new FakeGroupRepository();

    const result = await serviceWith(repository, ["group-1"]).create({ name: "   ", hostId: USER });

    expect("error" in result && result.error.code).toBe("invalid_group_name");
    expect(repository.createCalls).toHaveLength(0);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeGroupRepository();
    const failure = groupError("not_authenticated", { dbCode: "28000" });
    repository.failure = failure;

    const result = await serviceWith(repository, ["group-1"]).create({ name: "Mokotów", hostId: USER });

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

describe("GroupService.invite", () => {
  it("returns the plaintext token once and saves only its hash on the group", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: USER })]);

    const result = await serviceWith(repository, ["invite-1"]).invite({ groupId: GROUP_ID, userId: USER });

    expect(result).toEqual({
      data: { token: aToken("n"), expiresAt: new Date("2026-10-09T09:15:30.123Z") },
    });
    const stored = repository.storedSnapshot(GROUP_ID);
    expect(stored?.invites).toEqual([
      expect.objectContaining({
        id: "invite-1",
        createdBy: USER,
        tokenHash: (await InviteTokenHash.of(aToken("n"))).value,
      }),
    ]);
    expect(JSON.stringify(stored)).not.toContain(aToken("n").value);
  });

  it("reports a non-member's request as the group not being found and saves nothing", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: OTHER })]);

    const result = await serviceWith(repository, ["invite-1"]).invite({ groupId: GROUP_ID, userId: USER });

    expect("error" in result && result.error.code).toBe("group_not_found");
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("retries once after losing a race and then succeeds", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: USER })]);
    repository.conflicts = 1;

    const result = await serviceWith(repository, ["invite-1"]).invite({ groupId: GROUP_ID, userId: USER });

    expect("data" in result).toBe(true);
    expect(repository.saveCalls).toHaveLength(2);
    expect(repository.storedSnapshot(GROUP_ID)?.invites).toHaveLength(1);
  });

  it("gives up with group_changed when the retry loses the race too", async () => {
    const repository = new FakeGroupRepository([aGroup({ id: GROUP_ID, hostId: USER })]);
    repository.conflicts = 2;

    const result = await serviceWith(repository, ["invite-1"]).invite({ groupId: GROUP_ID, userId: USER });

    expect("error" in result && result.error.code).toBe("group_changed");
    expect(repository.saveCalls).toHaveLength(2);
    expect(repository.storedSnapshot(GROUP_ID)?.invites).toEqual([]);
  });
});

describe("GroupService.join", () => {
  it("adds the user as a member, uses up the invite and returns the group id", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);

    const result = await serviceWith(repository).join({ token: INVITE_TOKEN.value, userId: USER });

    expect(result).toEqual({ data: { groupId: GROUP_ID, joined: true } });
    const stored = repository.storedSnapshot(GROUP_ID);
    expect(stored?.members.map((member) => member.userId)).toEqual([OTHER, USER]);
    expect(stored?.invites).toEqual([]);
  });

  it("uses up the invite of a member who opens it without adding them twice", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: USER, now: NOW }),
    ]);

    const result = await serviceWith(repository).join({ token: INVITE_TOKEN.value, userId: USER });

    expect(result).toEqual({ data: { groupId: GROUP_ID, joined: false } });
    const stored = repository.storedSnapshot(GROUP_ID);
    expect(stored?.members).toHaveLength(1);
    expect(stored?.invites).toEqual([]);
  });

  it("rejects a malformed token without a database call", async () => {
    const repository = new FakeGroupRepository();

    const result = await serviceWith(repository).join({ token: "short", userId: USER });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.tokenLookups).toEqual([]);
  });

  it("rejects an unknown token", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);

    const result = await serviceWith(repository).join({ token: aToken("z").value, userId: USER });

    expect("error" in result && result.error.code).toBe("invite_invalid");
  });

  it("rejects an expired invite and saves nothing", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);

    const result = await serviceWith(repository, [], IN_EIGHT_DAYS).join({ token: INVITE_TOKEN.value, userId: USER });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("lets only one of two concurrent joins with the same token succeed", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);
    const service = serviceWith(repository);
    const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const results = await Promise.all([
      service.join({ token: INVITE_TOKEN.value, userId: USER }),
      service.join({ token: INVITE_TOKEN.value, userId: third }),
    ]);

    expect(results.filter((result) => "data" in result)).toHaveLength(1);
    expect(results.flatMap((result) => ("error" in result ? [result.error.code] : []))).toEqual(["invite_invalid"]);
    expect(repository.storedSnapshot(GROUP_ID)?.members).toHaveLength(2);
  });

  it("passes a repository error through", async () => {
    const repository = new FakeGroupRepository();
    const failure = groupError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).join({ token: INVITE_TOKEN.value, userId: USER })).toBe(failure);
  });
});

describe("GroupService.previewInvite", () => {
  it("shows the group name, expiry and whether the caller is already a member", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);
    repository.callerId = USER;

    const result = await serviceWith(repository).previewInvite({ token: INVITE_TOKEN.value });

    expect(result).toEqual({
      data: {
        groupId: GROUP_ID,
        groupName: "Mokotów",
        callerIsMember: false,
        expiresAt: new Date("2026-10-09T09:15:30.123Z"),
      },
    });
  });

  it("gives the same invite_invalid for malformed, unknown, used and expired tokens", async () => {
    const repository = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);
    const service = serviceWith(repository);
    await service.join({ token: INVITE_TOKEN.value, userId: USER });

    const used = await service.previewInvite({ token: INVITE_TOKEN.value });
    const unknown = await service.previewInvite({ token: aToken("z").value });
    const malformed = await service.previewInvite({ token: "short" });

    for (const result of [used, unknown, malformed]) {
      expect("error" in result && result.error.code).toBe("invite_invalid");
    }
    const fresh = new FakeGroupRepository([
      await aGroupWithInvite(INVITE_TOKEN, { id: GROUP_ID, hostId: OTHER, now: NOW }),
    ]);
    const expired = await serviceWith(fresh, [], IN_EIGHT_DAYS).previewInvite({ token: INVITE_TOKEN.value });
    expect("error" in expired && expired.error.code).toBe("invite_invalid");
  });
});
