import { BillingMonth } from "@/lib/groups/billing-month.value";
import { GroupName } from "@/lib/groups/group-name.value";
import type { GroupMember, GroupSnapshot, OpenPeriod } from "@/lib/groups/types";

interface GroupState {
  id: string;
  name: GroupName;
  hostId: string;
  createdAt: Date;
  members: readonly GroupMember[];
  openPeriod: OpenPeriod;
}

/**
 * A settlement group: its permanent host, its members and its single open billing period.
 * Invariants: the host is a member, the host never changes, and exactly one period is open.
 */
export class Group {
  readonly id: string;
  readonly name: GroupName;
  readonly hostId: string;
  readonly createdAt: Date;
  readonly members: readonly GroupMember[];
  readonly openPeriod: OpenPeriod;

  private constructor(state: GroupState) {
    if (!state.members.some((member) => member.userId === state.hostId)) {
      throw new Error(`Group ${state.id}: the host is not a member`);
    }
    this.id = state.id;
    this.name = state.name;
    this.hostId = state.hostId;
    this.createdAt = state.createdAt;
    this.members = Object.freeze(state.members.map((member) => Object.freeze({ ...member })));
    this.openPeriod = Object.freeze({ ...state.openPeriod });
  }

  static create(input: { id: string; name: GroupName; hostId: string; now: Date; periodId: string }): Group {
    return new Group({
      id: input.id,
      name: input.name,
      hostId: input.hostId,
      createdAt: input.now,
      members: [{ userId: input.hostId, joinedAt: input.now }],
      openPeriod: { id: input.periodId, month: BillingMonth.of(input.now), openedAt: input.now },
    });
  }

  /** Rebuilds a group from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: GroupSnapshot): Group {
    // Snapshots come from storage, so the type alone does not prove the open period exists.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!snapshot.openPeriod) {
      throw new Error(`Group ${snapshot.id}: no open billing period`);
    }
    return new Group({
      id: snapshot.id,
      name: GroupName.fromStored(snapshot.name),
      hostId: snapshot.hostId,
      createdAt: parseInstant(snapshot.createdAt),
      members: snapshot.members.map((member) => ({
        userId: member.userId,
        joinedAt: parseInstant(member.joinedAt),
      })),
      openPeriod: {
        id: snapshot.openPeriod.id,
        month: BillingMonth.fromDate(snapshot.openPeriod.month),
        openedAt: parseInstant(snapshot.openPeriod.openedAt),
      },
    });
  }

  isHost(userId: string): boolean {
    return this.hostId === userId;
  }

  isMember(userId: string): boolean {
    return this.members.some((member) => member.userId === userId);
  }

  toSnapshot(): GroupSnapshot {
    return {
      id: this.id,
      name: this.name.value,
      hostId: this.hostId,
      createdAt: this.createdAt.toISOString(),
      members: this.members.map((member) => ({ userId: member.userId, joinedAt: member.joinedAt.toISOString() })),
      openPeriod: {
        id: this.openPeriod.id,
        month: this.openPeriod.month.toDate(),
        openedAt: this.openPeriod.openedAt.toISOString(),
      },
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
