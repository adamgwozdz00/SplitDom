import { Group, GroupName } from "@/lib/groups";
import { inviteError } from "@/lib/invites/invite-error.messages";
import { Invite } from "@/lib/invites/invite.aggregate";
import { InviteToken } from "@/lib/invites/invite-token.value";
import type { InviteError, InviteLookup, InviteRepository, Result } from "@/lib/invites/types";

interface StoredInvite {
  invite: Invite;
  groupName: string;
  callerIsMember: boolean;
}

/**
 * In-memory InviteRepository for unit tests, scoped to one signed-in caller like the real one.
 * It holds invites by token value with their group name and the caller's member flag, and `redeem`
 * claims an invite only while the stored one is unused, as the database's conditional update does.
 */
export class FakeInviteRepository implements InviteRepository {
  readonly createCalls: { invite: Invite; token: InviteToken }[] = [];
  readonly findCalls: string[] = [];
  readonly redeemCalls: { invite: Invite; token: InviteToken }[] = [];
  /** When set, every call fails with this error. */
  failure: InviteError | null = null;

  private readonly invites = new Map<string, StoredInvite>();

  /** Stores an invite as if it had been created earlier, by anyone. */
  add(token: InviteToken, invite: Invite, details: { groupName?: string; callerIsMember?: boolean } = {}): void {
    this.invites.set(token.value, {
      invite,
      groupName: details.groupName ?? "Mokotów",
      callerIsMember: details.callerIsMember ?? false,
    });
  }

  /** The invite currently stored under `token`. */
  stored(token: InviteToken): Invite | undefined {
    return this.invites.get(token.value)?.invite;
  }

  create(invite: Invite, token: InviteToken): Promise<Result<void>> {
    this.createCalls.push({ invite, token });
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    // Only a member may create an invite, so the caller is a member of its group.
    this.add(token, invite, { callerIsMember: true });
    return Promise.resolve({ data: undefined });
  }

  findByToken(token: InviteToken): Promise<Result<InviteLookup | null>> {
    this.findCalls.push(token.value);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    const stored = this.invites.get(token.value);
    return Promise.resolve({ data: stored ? { ...stored } : null });
  }

  redeem(invite: Invite, token: InviteToken): Promise<Result<{ groupId: string; joined: boolean }>> {
    this.redeemCalls.push({ invite, token });
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    const stored = this.invites.get(token.value);
    if (stored?.invite.usedAt !== null) {
      return Promise.resolve(inviteError("invite_invalid"));
    }
    const joined = !stored.callerIsMember;
    this.invites.set(token.value, { ...stored, invite, callerIsMember: true });
    return Promise.resolve({ data: { groupId: invite.groupId, joined } });
  }
}

/** A valid token made of one repeated character, so tests can tell tokens apart. */
export function aToken(char = "A"): InviteToken {
  const token = InviteToken.parse(char.repeat(InviteToken.LENGTH));
  if (!token) {
    throw new Error(`Invalid test token character "${char}"`);
  }
  return token;
}

/** A freshly created group, built through the groups module's public API. */
export function aGroup(overrides: { id?: string; hostId?: string; now?: Date } = {}): Group {
  const name = GroupName.create("Mokotów");
  if ("error" in name) {
    throw new Error("Invalid test group name");
  }
  return Group.create({
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    name: name.data,
    hostId: overrides.hostId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now: overrides.now ?? new Date("2026-10-01T08:00:00.000Z"),
  });
}

/** A fresh invite to `group` created by its host at `now`. */
export function anInvite(input: { id?: string; group?: Group; now?: Date } = {}): Invite {
  const group = input.group ?? aGroup();
  const result = Invite.create({
    id: input.id ?? "33333333-3333-4333-8333-333333333333",
    group,
    createdBy: group.hostId,
    now: input.now ?? new Date("2026-10-15T12:00:00.000Z"),
  });
  if ("error" in result) {
    throw new Error("Test invite could not be created");
  }
  return result.data;
}
