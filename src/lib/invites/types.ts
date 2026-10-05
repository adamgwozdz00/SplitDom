import type { Invite } from "@/lib/invites/invite.aggregate";
import type { InviteToken } from "@/lib/invites/invite-token.value";

export type InviteErrorCode = "invite_invalid" | "group_not_found" | "not_authenticated" | "unexpected";

// The project-wide `{ error: { code, message, context } }` shape, declared again for this module's codes.
export interface InviteError {
  error: { code: InviteErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | InviteError;

/** Persistence shape of the Invite aggregate. Timestamps are UTC ISO strings with millisecond precision. */
export interface InviteSnapshot {
  id: string;
  groupId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

/** An invite found by its token, with what the invite page shows beyond the aggregate. */
export interface InviteLookup {
  invite: Invite;
  groupName: string;
  /** Whether the signed-in caller already belongs to the invite's group. */
  callerIsMember: boolean;
}

/** Loads and persists Invite aggregates on behalf of the signed-in user. */
export interface InviteRepository {
  create(invite: Invite, token: InviteToken): Promise<Result<void>>;
  findByToken(token: InviteToken): Promise<Result<InviteLookup | null>>;
  /** Claims the invite and adds the caller to its group; `joined` is false when the caller was already a member. */
  redeem(invite: Invite, token: InviteToken): Promise<Result<{ groupId: string; joined: boolean }>>;
}
