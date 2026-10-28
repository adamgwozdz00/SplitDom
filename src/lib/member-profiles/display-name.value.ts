import { memberProfileError } from "@/lib/member-profiles/member-profile-error.messages";
import type { Result } from "@/lib/member-profiles/types";

const MAX_LENGTH = 40;
// Control characters (newlines, tabs, ...) would break the one-line labels the group shows.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** The name a member goes by in their groups: 1 to 40 characters, no control characters. */
export class DisplayName {
  private constructor(readonly value: string) {}

  static parse(raw: string): Result<DisplayName> {
    const trimmed = raw.trim();
    const length = Array.from(trimmed).length;
    if (length === 0 || length > MAX_LENGTH || CONTROL_CHARACTERS.test(trimmed)) {
      return memberProfileError("invalid_display_name");
    }
    return { data: new DisplayName(trimmed) };
  }

  /** Rebuilds a name that was already accepted and stored; the creation rule is not applied again. */
  static fromStored(value: string): DisplayName {
    return new DisplayName(value);
  }
}
