import type { Group } from "@/lib/groups/group.aggregate";

export type GroupErrorCode =
  "invalid_group_name" | "group_not_found" | "invite_invalid" | "group_changed" | "not_authenticated" | "unexpected";

// Project-wide error shape, owned here until a second module needs it.
export interface GroupError {
  error: { code: GroupErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | GroupError;

export interface GroupMember {
  readonly userId: string;
  readonly joinedAt: Date;
  /** Null when the email is not known to the aggregate (a freshly created group). */
  readonly email: string | null;
}

/** Persistence shape of the Group aggregate. Timestamps are UTC ISO strings with millisecond precision. */
export interface GroupSnapshot {
  id: string;
  name: string;
  hostId: string;
  createdAt: string;
  members: { userId: string; joinedAt: string; email: string | null }[];
  /** Optimistic lock: the repository saves only while the stored version still equals this one. */
  version: number;
  /** The group's active invites; the token is never stored, only its hash (64-char lowercase hex). */
  invites: GroupInviteSnapshot[];
}

export interface GroupInviteSnapshot {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
}

/** An invite of the group that was used since the group was loaded. */
export interface UsedInvite {
  readonly id: string;
  readonly usedAt: Date;
  readonly usedBy: string;
}

/** What the invite page needs to know, without loading the group aggregate. */
export interface InvitePreview {
  groupId: string;
  groupName: string;
  expiresAt: Date;
  /** Set when the invite has been used. */
  usedAt?: Date;
  callerIsMember: boolean;
}

/** Loads and persists Group aggregates on behalf of the signed-in user. */
export interface GroupRepository {
  listGroupsOfCurrentUser(): Promise<Result<Group[]>>;
  findGroupOfCurrentUser(groupId: string): Promise<Result<Group | null>>;
  create(group: Group): Promise<Result<void>>;
  /** The group of an active invite, without member emails and with only that invite; null when none matches. */
  findByInviteToken(tokenHash: string): Promise<Result<Group | null>>;
  /** The invite page read model; used and expired invites are returned too. Null when none matches. */
  previewInvite(tokenHash: string): Promise<Result<InvitePreview | null>>;
  /** Saves the group's pending changes if its version is unchanged; "conflict" means a concurrent write won. */
  save(group: Group): Promise<Result<"saved" | "conflict">>;
}
