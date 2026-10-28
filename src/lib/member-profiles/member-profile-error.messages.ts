import type { MemberProfileError, MemberProfileErrorCode } from "@/lib/member-profiles/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<MemberProfileErrorCode, string> = {
  invalid_account_number: "Wpisz poprawny 26-cyfrowy numer konta (NRB), np. 61 1090 1014 0000 0712 1981 2874",
  not_owner: "Profil może zmienić tylko jego właściciel",
  profile_changed: "Twój profil został właśnie zmieniony gdzie indziej, spróbuj ponownie",
  not_authenticated: "Zaloguj się, aby kontynuować",
  unexpected: "Coś poszło nie tak, spróbuj ponownie",
};

const GENERIC_MESSAGE = "Coś poszło nie tak, spróbuj ponownie";

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
