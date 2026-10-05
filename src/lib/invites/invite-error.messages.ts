import type { InviteError, InviteErrorCode } from "@/lib/invites/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<InviteErrorCode, string> = {
  invite_invalid: "This invite is no longer valid — ask a group member for a new one",
  group_not_found: "Group not found",
  not_authenticated: "Sign in to continue",
  unexpected: "Something went wrong, try again",
};

const GENERIC_MESSAGE = "Something went wrong, try again";

function isInviteErrorCode(code: string): code is InviteErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function inviteErrorMessage(code: string): string {
  return isInviteErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function inviteError(code: InviteErrorCode, context: Record<string, unknown> = {}): InviteError {
  return { error: { code, message: MESSAGES[code], context } };
}
