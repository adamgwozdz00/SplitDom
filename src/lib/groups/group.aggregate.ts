import { groupError } from "@/lib/groups/group-error.messages";
import { GroupName } from "@/lib/groups/group-name.value";
import { Invite } from "@/lib/groups/invite.entity";
import type { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";
import type { GroupInviteSnapshot, GroupMember, GroupSnapshot, Result, UsedInvite } from "@/lib/groups/types";

interface GroupState {
  id: string;
  name: GroupName;
  hostId: string;
  createdAt: Date;
  members: readonly GroupMember[];
  version: number;
  invites: readonly Invite[];
}

/**
 * A settlement group: its permanent host, its members and its active invites. The billing period lives in its own
 * aggregate. Invariants: the host is a member and never changes, nobody removes members, a user is a member at most
 * once, and an invite is used at most once. Changes since loading are tracked for the repository to save.
 */
export class Group {
  readonly id: string;
  readonly name: GroupName;
  readonly hostId: string;
  readonly createdAt: Date;
  /** The version this group was loaded at; 0 for a new group. */
  readonly version: number;

  private memberList: readonly GroupMember[];
  private inviteList: readonly Invite[];
  private readonly createdInvites: Invite[] = [];
  private readonly consumedInvites: UsedInvite[] = [];
  private readonly addedMembers: GroupMember[] = [];

  private constructor(state: GroupState) {
    if (!state.members.some((member) => member.userId === state.hostId)) {
      throw new Error(`Group ${state.id}: the host is not a member`);
    }
    this.id = state.id;
    this.name = state.name;
    this.hostId = state.hostId;
    this.createdAt = state.createdAt;
    this.memberList = state.members.map((member) => Object.freeze({ ...member }));
    this.inviteList = state.invites;
    this.version = state.version;
  }

  get members(): readonly GroupMember[] {
    return this.memberList;
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
      invites: [],
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
      invites: snapshot.invites.map((invite) => Invite.restore(invite)),
    });
  }

  isHost(userId: string): boolean {
    return this.hostId === userId;
  }

  isMember(userId: string): boolean {
    return this.members.some((member) => member.userId === userId);
  }

  /** Only a member may invite; to anyone else the group does not exist. */
  invite(input: { id: string; by: string; tokenHash: InviteTokenHash; now: Date }): Result<Invite> {
    if (!this.isMember(input.by)) {
      return groupError("group_not_found", { groupId: this.id });
    }
    const invite = Invite.create({ id: input.id, createdBy: input.by, tokenHash: input.tokenHash, now: input.now });
    this.inviteList = [...this.inviteList, invite];
    this.createdInvites.push(invite);
    return { data: invite };
  }

  /**
   * Uses up the active invite with this hash for `userId`, who becomes a member unless they already are
   * (`joined = false`; the invite is still used up).
   */
  join(input: { tokenHash: InviteTokenHash; userId: string; now: Date }): Result<{ joined: boolean }> {
    const invite = this.inviteList.find(
      (candidate) => candidate.tokenHash.value === input.tokenHash.value && candidate.isActive(input.now),
    );
    if (!invite) {
      return groupError("invite_invalid", { groupId: this.id });
    }
    this.inviteList = this.inviteList.filter((candidate) => candidate !== invite);
    this.consumedInvites.push({ id: invite.id, usedAt: input.now, usedBy: input.userId });
    if (this.isMember(input.userId)) {
      return { data: { joined: false } };
    }
    const member: GroupMember = Object.freeze({ userId: input.userId, joinedAt: input.now, email: null });
    this.memberList = [...this.memberList, member];
    this.addedMembers.push(member);
    return { data: { joined: true } };
  }

  /** Invites created since the group was loaded. */
  newInvites(): GroupInviteSnapshot[] {
    return this.createdInvites.map((invite) => invite.toSnapshot());
  }

  /** Invites used since the group was loaded. */
  usedInvites(): UsedInvite[] {
    return [...this.consumedInvites];
  }

  /** Members added since the group was loaded. */
  newMembers(): GroupMember[] {
    return [...this.addedMembers];
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
      invites: this.inviteList.map((invite) => invite.toSnapshot()),
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
