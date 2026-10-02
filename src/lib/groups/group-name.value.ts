import { groupError } from "@/lib/groups/group-error.messages";
import type { Result } from "@/lib/groups/types";

// A name must show something on the dashboard, so invisible-only input (e.g. U+200B) is not a name.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

export class GroupName {
  static readonly MAX_LENGTH = 60;

  private constructor(readonly value: string) {}

  static create(raw: string): Result<GroupName> {
    const value = raw.trim();
    // Count code points, not UTF-16 units, to match Postgres char_length() on the stored name.
    const length = Array.from(value).length;
    if (length < 1 || length > GroupName.MAX_LENGTH || !VISIBLE.test(value)) {
      return groupError("invalid_group_name", { length });
    }
    return { data: new GroupName(value) };
  }

  /**
   * Rebuilds a name that was already accepted and stored. The creation rule is not applied again:
   * the database still holds names written before a rule changed or past the aggregate, and one such
   * name must not make the user's groups unreadable.
   */
  static fromStored(value: string): GroupName {
    if (value.length === 0) {
      throw new Error("GroupName.fromStored: empty stored name");
    }
    return new GroupName(value);
  }
}
