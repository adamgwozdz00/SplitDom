import type { GroupError, GroupErrorCode } from "@/lib/groups/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<GroupErrorCode, string> = {
  invalid_group_name: "Group name must be 1–60 characters",
  group_not_found: "Group not found",
  not_authenticated: "Sign in to continue",
  unexpected: "Something went wrong, try again",
};

const GENERIC_MESSAGE = "Something went wrong, try again";

/** Shown in place of a group list or group page that could not be loaded, whatever the error code. */
export const GROUPS_LOAD_FAILED_MESSAGE = "Couldn't load your groups, try again";

function isGroupErrorCode(code: string): code is GroupErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function groupErrorMessage(code: string): string {
  return isGroupErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function groupError(code: GroupErrorCode, context: Record<string, unknown> = {}): GroupError {
  return { error: { code, message: MESSAGES[code], context } };
}
