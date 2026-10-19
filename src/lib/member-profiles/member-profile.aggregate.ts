import { AccountNumber } from "@/lib/member-profiles/account-number.value";
import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import type { MemberProfileSnapshot, Result } from "@/lib/member-profiles/types";

/**
 * The profile of one person across all their groups. Only its owner changes it. `version` is the
 * optimistic-lock counter the repository checks on save (0 for a profile that was never stored).
 */
export class MemberProfile {
  private constructor(
    readonly userId: string,
    private account: AccountNumber | null,
    readonly version: number,
  ) {}

  /** A profile that has never been stored. */
  static empty(userId: string): MemberProfile {
    return new MemberProfile(userId, null, 0);
  }

  static restore(snapshot: MemberProfileSnapshot): MemberProfile {
    return new MemberProfile(
      snapshot.userId,
      snapshot.accountNumber === null ? null : AccountNumber.fromStored(snapshot.accountNumber),
      snapshot.version,
    );
  }

  get accountNumber(): AccountNumber | null {
    return this.account;
  }

  /** Sets the owner's account number from raw input; `by` must be the owner. */
  setAccountNumber(by: string, raw: string): Result<void> {
    if (by !== this.userId) {
      return memberProfileError("not_owner");
    }
    const parsed = AccountNumber.parse(raw);
    if ("error" in parsed) {
      return parsed;
    }
    this.account = parsed.data;
    return { data: undefined };
  }

  clearAccountNumber(by: string): Result<void> {
    if (by !== this.userId) {
      return memberProfileError("not_owner");
    }
    this.account = null;
    return { data: undefined };
  }

  toSnapshot(): MemberProfileSnapshot {
    return { userId: this.userId, accountNumber: this.account?.digits ?? null, version: this.version };
  }
}
