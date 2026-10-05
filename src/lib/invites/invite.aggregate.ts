import type { Group } from "@/lib/groups";
import { inviteError } from "@/lib/invites/invite-error.messages";
import type { InviteSnapshot, Result } from "@/lib/invites/types";

interface InviteState {
  id: string;
  groupId: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
}

/**
 * An invitation to join a settlement group.
 * Rules: only a member of the group may create one, it is valid for 7 days, and it works once.
 * Redeeming it records who used it and when; the redeemer becomes a member of the group.
 */
export class Invite {
  static readonly VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

  readonly id: string;
  readonly groupId: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly usedBy: string | null;

  private constructor(state: InviteState) {
    if (state.expiresAt.getTime() <= state.createdAt.getTime()) {
      throw new Error(`Invite ${state.id}: expires before it was created`);
    }
    if (state.usedBy !== null && state.usedAt === null) {
      throw new Error(`Invite ${state.id}: has a user but no time of use`);
    }
    this.id = state.id;
    this.groupId = state.groupId;
    this.createdBy = state.createdBy;
    this.createdAt = state.createdAt;
    this.expiresAt = state.expiresAt;
    this.usedAt = state.usedAt;
    this.usedBy = state.usedBy;
  }

  /** Only a member of `group` may invite; to anyone else the group does not exist. */
  static create(input: { id: string; group: Group; createdBy: string; now: Date }): Result<Invite> {
    if (!input.group.isMember(input.createdBy)) {
      return inviteError("group_not_found", { groupId: input.group.id });
    }
    return {
      data: new Invite({
        id: input.id,
        groupId: input.group.id,
        createdBy: input.createdBy,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + Invite.VALIDITY_MS),
        usedAt: null,
        usedBy: null,
      }),
    };
  }

  /** Rebuilds an invite from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: InviteSnapshot): Invite {
    return new Invite({
      id: snapshot.id,
      groupId: snapshot.groupId,
      createdBy: snapshot.createdBy,
      createdAt: parseInstant(snapshot.createdAt),
      expiresAt: parseInstant(snapshot.expiresAt),
      usedAt: snapshot.usedAt === null ? null : parseInstant(snapshot.usedAt),
      usedBy: snapshot.usedBy,
    });
  }

  /** Unused and not yet expired. At exactly `expiresAt` the invite is already inactive. */
  isActive(now: Date): boolean {
    return this.usedAt === null && now.getTime() < this.expiresAt.getTime();
  }

  /** Uses up the invite for `userId`; an expired or used invite is no longer valid. */
  redeem(userId: string, now: Date): Result<Invite> {
    if (!this.isActive(now)) {
      return inviteError("invite_invalid", { inviteId: this.id });
    }
    return {
      data: new Invite({
        id: this.id,
        groupId: this.groupId,
        createdBy: this.createdBy,
        createdAt: this.createdAt,
        expiresAt: this.expiresAt,
        usedAt: now,
        usedBy: userId,
      }),
    };
  }

  toSnapshot(): InviteSnapshot {
    return {
      id: this.id,
      groupId: this.groupId,
      createdBy: this.createdBy,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      usedAt: this.usedAt?.toISOString() ?? null,
      usedBy: this.usedBy,
    };
  }
}

function parseInstant(value: string): Date {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid stored timestamp "${value}"`);
  }
  return instant;
}
