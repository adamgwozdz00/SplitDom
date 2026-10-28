import { AccountNumber } from "@/lib/member-profiles/account-number.value";
import type { MemberProfile } from "@/lib/member-profiles/member-profile.aggregate";
import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import { DisplayName } from "@/lib/member-profiles/display-name.value";
import type { AccountNumbers, DisplayNames, MemberProfileRepository, Result } from "@/lib/member-profiles/types";

/**
 * The only entry point to the MemberProfile aggregate: it loads the signed-in user's profile through the
 * repository, runs a command on it and saves it, leaving the rules to the aggregate.
 */
export class MemberProfileService {
  constructor(private readonly repository: MemberProfileRepository) {}

  getOwn(userId: string): Promise<Result<MemberProfile>> {
    return this.repository.loadOwn(userId);
  }

  /** Stores the user's account number; blank input clears it. */
  saveAccountNumber(input: { userId: string; raw: string }): Promise<Result<void>> {
    return this.change(input.userId, (profile) =>
      input.raw.trim() === ""
        ? profile.clearAccountNumber(input.userId)
        : profile.setAccountNumber(input.userId, input.raw),
    );
  }

  /** Stores the user's display name; blank input clears it. */
  saveDisplayName(input: { userId: string; raw: string }): Promise<Result<void>> {
    return this.change(input.userId, (profile) =>
      input.raw.trim() === ""
        ? profile.clearDisplayName(input.userId)
        : profile.setDisplayName(input.userId, input.raw),
    );
  }

  /**
   * Loads the user's profile, runs a command on it and saves it. A save that lost a race is retried once on
   * the reloaded profile, then reported as `profile_changed`.
   */
  private async change(userId: string, command: (profile: MemberProfile) => Result<void>): Promise<Result<void>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = await this.repository.loadOwn(userId);
      if ("error" in loaded) {
        return loaded;
      }
      const profile = loaded.data;
      const changed = command(profile);
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

  /** The display names of those of `userIds` who have one and share `groupId` with the signed-in user. */
  async displayNamesFor(input: { groupId: string; userIds: string[] }): Promise<Result<DisplayNames>> {
    if (input.userIds.length === 0) {
      return { data: new Map() };
    }
    const rows = await this.repository.displayNames(input.groupId, input.userIds);
    if ("error" in rows) {
      return rows;
    }
    return { data: new Map(rows.data.map((row) => [row.userId, DisplayName.fromStored(row.displayName)])) };
  }
}
