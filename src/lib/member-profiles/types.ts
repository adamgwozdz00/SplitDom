import type { AccountNumber } from "@/lib/member-profiles/account-number.value";
import type { DisplayName } from "@/lib/member-profiles/display-name.value";
import type { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";

export type MemberProfileErrorCode =
  | "invalid_account_number"
  | "invalid_display_name"
  | "not_owner"
  | "profile_changed"
  | "not_authenticated"
  | "unexpected";

// Project-wide error shape, owned here until a shared module is introduced.
export interface MemberProfileError {
  error: { code: MemberProfileErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | MemberProfileError;

/** Persistence shape of the MemberProfile aggregate. `version` is 0 for a profile that was never stored. */
export interface MemberProfileSnapshot {
  userId: string;
  accountNumber: string | null;
  displayName: string | null;
  version: number;
}

/** Loads and persists MemberProfile aggregates on behalf of the signed-in user. */
export interface MemberProfileRepository {
  /** The signed-in user's profile; an empty version-0 profile when none is stored yet. */
  loadOwn(userId: string): Promise<Result<MemberProfile>>;
  /** Stores the profile if its version is unchanged; `"conflict"` otherwise. */
  save(profile: MemberProfile): Promise<Result<"saved" | "conflict">>;
  /** The stored account numbers (26 digits) of those of `userIds` who share the group with the signed-in user. */
  accountNumbers(groupId: string, userIds: string[]): Promise<Result<{ userId: string; accountNumber: string }[]>>;
  /** The display names of those of `userIds` who have one and share the group with the signed-in user. */
  displayNames(groupId: string, userIds: string[]): Promise<Result<{ userId: string; displayName: string }[]>>;
}

export type AccountNumbers = Map<string, AccountNumber>;

export type DisplayNames = Map<string, DisplayName>;
