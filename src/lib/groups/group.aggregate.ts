import { GroupName } from "@/lib/groups/group-name.value";
import type { GroupInviteSnapshot, GroupMember, GroupSnapshot, UsedInvite } from "@/lib/groups/types";

interface GroupState {
  id: string;
  name: GroupName;
  hostId: string;
  createdAt: Date;
  members: readonly GroupMember[];
  version: number;
}

/**
 * A settlement group: its permanent host and its members. The billing period lives in its own aggregate.
 * Invariants: the host is a member, and the host never changes.
 */
export class Group {
  readonly id: string;
  readonly name: GroupName;
  readonly hostId: string;
  readonly createdAt: Date;
  readonly members: readonly GroupMember[];
  /** The version this group was loaded at; 0 for a new group. */
  readonly version: number;

  private constructor(state: GroupState) {
    if (!state.members.some((member) => member.userId === state.hostId)) {
      throw new Error(`Group ${state.id}: the host is not a member`);
    }
    this.id = state.id;
    this.name = state.name;
    this.hostId = state.hostId;
    this.createdAt = state.createdAt;
    this.members = Object.freeze(state.members.map((member) => Object.freeze({ ...member })));
    this.version = state.version;
  }

  static create(input: { id: string; name: GroupName; hostId: string; now: Date }): Group {
    return new Group({
      id: input.id,
      name: input.name,
      hostId: input.hostId,
      createdAt: input.now,
      // The email is not persisted by add_group; it is loaded with the group.
      members: [{ userId: input.hostId, joinedAt: input.now, email: null }],
      version: 0,
    });
  }

  /** Rebuilds a group from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: GroupSnapshot): Group {
    return new Group({
      id: snapshot.id,
      name: GroupName.fromStored(snapshot.name),
      hostId: snapshot.hostId,
      createdAt: parseInstant(snapshot.createdAt),
      members: snapshot.members.map((member) => ({
        userId: member.userId,
        joinedAt: parseInstant(member.joinedAt),
        email: member.email,
      })),
      version: snapshot.version,
    });
  }

  isHost(userId: string): boolean {
    return this.hostId === userId;
  }

  isMember(userId: string): boolean {
    return this.members.some((member) => member.userId === userId);
  }

  /** How a member is shown to `viewerId`: "You", their email, or "Member" when the email is unknown. */
  memberLabel(userId: string, viewerId: string): string {
    if (userId === viewerId) {
      return "You";
    }
    return this.members.find((member) => member.userId === userId)?.email ?? "Member";
  }

  /** Invites created since the group was loaded. Pending-change tracking arrives with Group.invite. */
  newInvites(): GroupInviteSnapshot[] {
    return [];
  }

  /** Invites used since the group was loaded. */
  usedInvites(): UsedInvite[] {
    return [];
  }

  /** Members added since the group was loaded. */
  newMembers(): GroupMember[] {
    return [];
  }

  toSnapshot(): GroupSnapshot {
    return {
      id: this.id,
      name: this.name.value,
      hostId: this.hostId,
      createdAt: this.createdAt.toISOString(),
      members: this.members.map((member) => ({
        userId: member.userId,
        joinedAt: member.joinedAt.toISOString(),
        email: member.email,
      })),
      version: this.version,
      invites: [],
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
