import { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";
import type { GroupInviteSnapshot } from "@/lib/groups/types";

interface InviteState {
  id: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  tokenHash: InviteTokenHash;
  usedAt: Date | null;
  usedBy: string | null;
}

/**
 * An invitation inside a Group. Valid for 7 days and works once; using it records who and when.
 * Only the group creates, finds and uses invites, so there is no aggregate-level rule here beyond its own validity.
 */
export class Invite {
  static readonly VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

  readonly id: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly tokenHash: InviteTokenHash;
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
    this.createdBy = state.createdBy;
    this.createdAt = state.createdAt;
    this.expiresAt = state.expiresAt;
    this.tokenHash = state.tokenHash;
    this.usedAt = state.usedAt;
    this.usedBy = state.usedBy;
  }

  static create(input: { id: string; createdBy: string; tokenHash: InviteTokenHash; now: Date }): Invite {
    return new Invite({
      id: input.id,
      createdBy: input.createdBy,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + Invite.VALIDITY_MS),
      tokenHash: input.tokenHash,
      usedAt: null,
      usedBy: null,
    });
  }

  /** Rebuilds an active invite from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: GroupInviteSnapshot): Invite {
    const tokenHash = InviteTokenHash.parse(snapshot.tokenHash);
    if (tokenHash === null) {
      throw new Error(`Invite ${snapshot.id}: malformed token hash`);
    }
    return new Invite({
      id: snapshot.id,
      createdBy: snapshot.createdBy,
      createdAt: parseInstant(snapshot.createdAt),
      expiresAt: parseInstant(snapshot.expiresAt),
      tokenHash,
      usedAt: null,
      usedBy: null,
    });
  }

  /** Unused and not yet expired. At exactly `expiresAt` the invite is already inactive. */
  isActive(now: Date): boolean {
    return this.usedAt === null && now.getTime() < this.expiresAt.getTime();
  }

  /** A copy marked as used by `userId`; the group decides whether the invite may still be used. */
  use(userId: string, now: Date): Invite {
    return new Invite({
      id: this.id,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      tokenHash: this.tokenHash,
      usedAt: now,
      usedBy: userId,
    });
  }

  toSnapshot(): GroupInviteSnapshot {
    return {
      id: this.id,
      createdBy: this.createdBy,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      tokenHash: this.tokenHash.value,
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
