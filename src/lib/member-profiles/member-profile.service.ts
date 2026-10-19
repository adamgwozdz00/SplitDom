import { AccountNumber } from "@/lib/member-profiles/account-number.value";
import type { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";
import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import type { AccountNumbers, MemberProfileRepository, Result } from "@/lib/member-profiles/types";

/**
 * The only entry point to the MemberProfile aggregate: it loads the signed-in user's profile through the
 * repository, runs a command on it and saves it, leaving the rules to the aggregate.
 */
export class MemberProfileService {
  constructor(private readonly repository: MemberProfileRepository) {}

  getOwn(userId: string): Promise<Result<MemberProfile>> {
    return this.repository.loadOwn(userId);
  }

  /**
   * Stores the user's account number; blank input clears it. A save that lost a race is retried once on
   * the reloaded profile, then reported as `profile_changed`.
   */
  async saveAccountNumber(input: { userId: string; raw: string }): Promise<Result<void>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = await this.repository.loadOwn(input.userId);
      if ("error" in loaded) {
        return loaded;
      }
      const profile = loaded.data;
      const changed =
        input.raw.trim() === ""
          ? profile.clearAccountNumber(input.userId)
          : profile.setAccountNumber(input.userId, input.raw);
      if ("error" in changed) {
        return changed;
      }
      const saved = await this.repository.save(profile);
      if ("error" in saved) {
        return saved;
      }
      if (saved.data === "saved") {
        return { data: undefined };
      }
    }
    return memberProfileError("profile_changed");
  }

  /** The account numbers of those of `userIds` who have one and share `groupId` with the signed-in user. */
  async accountNumbersFor(input: { groupId: string; userIds: string[] }): Promise<Result<AccountNumbers>> {
    if (input.userIds.length === 0) {
      return { data: new Map() };
    }
    const rows = await this.repository.accountNumbers(input.groupId, input.userIds);
    if ("error" in rows) {
      return rows;
    }
    return {
      data: new Map(rows.data.map((row) => [row.userId, AccountNumber.fromStored(row.accountNumber)])),
    };
  }
}
