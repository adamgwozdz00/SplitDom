import { describe, expect, it } from "vitest";
import { aGroup, anInvite, aToken, FakeInviteRepository } from "@/lib/invites/__tests__/invites.harness";
import { inviteError } from "@/lib/invites/invite-error.messages";
import { InviteService } from "@/lib/invites/invite.service";

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVITEE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_INVITEE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = new Date("2026-10-15T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-10-22T12:00:00.000Z");
const NOW = new Date("2026-10-16T09:15:30.123Z");
const TOKEN = aToken("T");
const MALFORMED_TOKENS = ["", "too-short", `${"a".repeat(42)}+`, "a".repeat(44)];

function serviceWith(repository: FakeInviteRepository, now: Date = NOW): InviteService {
  return new InviteService(
    repository,
    () => INVITE_ID,
    () => now,
    () => TOKEN,
  );
}

/** A repository holding one invite under TOKEN, created by the host at CREATED_AT. */
function repositoryWithInvite(details: { callerIsMember?: boolean } = {}): FakeInviteRepository {
  const repository = new FakeInviteRepository();
  repository.add(TOKEN, anInvite({ now: CREATED_AT }), { groupName: "Mokotów", ...details });
  return repository;
}

describe("InviteService.create", () => {
  it("saves the invite with the generated token and returns the token and expiry", async () => {
    const repository = new FakeInviteRepository();

    const result = await serviceWith(repository).create({ group: aGroup({ hostId: HOST }), createdBy: HOST });

    expect(result).toEqual({ data: { token: TOKEN, expiresAt: new Date("2026-10-23T09:15:30.123Z") } });
    expect(repository.createCalls).toHaveLength(1);
    expect(repository.createCalls[0]?.token).toBe(TOKEN);
    expect(repository.createCalls[0]?.invite.toSnapshot()).toEqual({
      id: INVITE_ID,
      groupId: GROUP_ID,
      createdBy: HOST,
      createdAt: "2026-10-16T09:15:30.123Z",
      expiresAt: "2026-10-23T09:15:30.123Z",
      usedAt: null,
      usedBy: null,
    });
  });

  it("refuses a non-member without touching the repository", async () => {
    const repository = new FakeInviteRepository();

    const result = await serviceWith(repository).create({ group: aGroup({ hostId: HOST }), createdBy: INVITEE });

    expect("error" in result && result.error.code).toBe("group_not_found");
    expect(repository.createCalls).toHaveLength(0);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeInviteRepository();
    const failure = inviteError("not_authenticated", { dbCode: "28000" });
    repository.failure = failure;

    const result = await serviceWith(repository).create({ group: aGroup({ hostId: HOST }), createdBy: HOST });

    expect(result).toBe(failure);
  });
});

describe("InviteService.preview", () => {
  it("shows the group name and the caller's member flag for a valid invite", async () => {
    const result = await serviceWith(repositoryWithInvite({ callerIsMember: true })).preview({ token: TOKEN.value });

    expect(result).toEqual({
      data: { groupId: GROUP_ID, groupName: "Mokotów", callerIsMember: true, expiresAt: EXPIRES_AT },
    });
  });

  it.each(MALFORMED_TOKENS)("rejects the malformed token %j without asking the repository", async (token) => {
    const repository = repositoryWithInvite();

    const result = await serviceWith(repository).preview({ token });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.findCalls).toEqual([]);
  });

  it("rejects an unknown token", async () => {
    const result = await serviceWith(repositoryWithInvite()).preview({ token: aToken("U").value });

    expect("error" in result && result.error.code).toBe("invite_invalid");
  });

  it("rejects an expired invite", async () => {
    const result = await serviceWith(repositoryWithInvite(), EXPIRES_AT).preview({ token: TOKEN.value });

    expect("error" in result && result.error.code).toBe("invite_invalid");
  });

  it("rejects a used invite", async () => {
    const repository = repositoryWithInvite();
    await serviceWith(repository).redeem({ token: TOKEN.value, userId: INVITEE });

    const result = await serviceWith(repository).preview({ token: TOKEN.value });

    expect("error" in result && result.error.code).toBe("invite_invalid");
  });

  it("passes a repository error through", async () => {
    const repository = repositoryWithInvite();
    const failure = inviteError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).preview({ token: TOKEN.value })).toBe(failure);
  });
});

describe("InviteService.redeem", () => {
  it("passes the redeemed invite to the repository and returns the group it joined", async () => {
    const repository = repositoryWithInvite();

    const result = await serviceWith(repository).redeem({ token: TOKEN.value, userId: INVITEE });

    expect(result).toEqual({ data: { groupId: GROUP_ID, joined: true } });
    expect(repository.redeemCalls).toHaveLength(1);
    expect(repository.redeemCalls[0]?.token.value).toBe(TOKEN.value);
    expect(repository.redeemCalls[0]?.invite.toSnapshot()).toMatchObject({
      id: INVITE_ID,
      usedAt: "2026-10-16T09:15:30.123Z",
      usedBy: INVITEE,
    });
  });

  it("uses up the invite for a caller who is already a member", async () => {
    const repository = repositoryWithInvite({ callerIsMember: true });

    const result = await serviceWith(repository).redeem({ token: TOKEN.value, userId: HOST });

    expect(result).toEqual({ data: { groupId: GROUP_ID, joined: false } });
    expect(repository.stored(TOKEN)?.usedBy).toBe(HOST);
  });

  it.each(MALFORMED_TOKENS)("rejects the malformed token %j without asking the repository", async (token) => {
    const repository = repositoryWithInvite();

    const result = await serviceWith(repository).redeem({ token, userId: INVITEE });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.findCalls).toEqual([]);
    expect(repository.redeemCalls).toEqual([]);
  });

  it("rejects an unknown token", async () => {
    const repository = repositoryWithInvite();

    const result = await serviceWith(repository).redeem({ token: aToken("U").value, userId: INVITEE });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.redeemCalls).toEqual([]);
  });

  it("rejects an expired invite without asking the repository to redeem it", async () => {
    const repository = repositoryWithInvite();

    const result = await serviceWith(repository, EXPIRES_AT).redeem({ token: TOKEN.value, userId: INVITEE });

    expect("error" in result && result.error.code).toBe("invite_invalid");
    expect(repository.redeemCalls).toEqual([]);
  });

  it("rejects an invite that was already used", async () => {
    const repository = repositoryWithInvite();
    await serviceWith(repository).redeem({ token: TOKEN.value, userId: INVITEE });

    const second = await serviceWith(repository).redeem({ token: TOKEN.value, userId: SECOND_INVITEE });

    expect("error" in second && second.error.code).toBe("invite_invalid");
    expect(repository.redeemCalls).toHaveLength(1);
  });

  it("passes through the repository's invite_invalid when a concurrent call took the invite first", async () => {
    const repository = repositoryWithInvite();
    const service = serviceWith(repository);

    // Both calls look the invite up while it is still unused; only one can claim it.
    const results = await Promise.all([
      service.redeem({ token: TOKEN.value, userId: INVITEE }),
      service.redeem({ token: TOKEN.value, userId: SECOND_INVITEE }),
    ]);

    expect(repository.redeemCalls).toHaveLength(2);
    expect(results.filter((result) => "data" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result && result.error.code === "invite_invalid")).toHaveLength(1);
  });

  it("passes a repository error through", async () => {
    const repository = repositoryWithInvite();
    const failure = inviteError("not_authenticated", { dbCode: "28000" });
    repository.failure = failure;

    expect(await serviceWith(repository).redeem({ token: TOKEN.value, userId: INVITEE })).toBe(failure);
  });
});
