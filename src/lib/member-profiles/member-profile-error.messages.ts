import type { MemberProfileError, MemberProfileErrorCode } from "@/lib/member-profiles/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<MemberProfileErrorCode, string> = {
  invalid_account_number: "Enter a valid 26-digit Polish account number (NRB), e.g. 61 1090 1014 0000 0712 1981 2874",
  invalid_display_name: "Enter a name of 1 to 40 characters",
  not_owner: "Only the owner can change a profile",
  profile_changed: "Your profile was just changed elsewhere, try again",
  not_authenticated: "Sign in to continue",
  unexpected: "Something went wrong, try again",
};

const GENERIC_MESSAGE = "Something went wrong, try again";

function isMemberProfileErrorCode(code: string): code is MemberProfileErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function memberProfileErrorMessage(code: string): string {
  return isMemberProfileErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function memberProfileError(
  code: MemberProfileErrorCode,
  context: Record<string, unknown> = {},
): MemberProfileError {
  return { error: { code, message: MESSAGES[code], context } };
}
