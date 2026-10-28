import type { GroupError, GroupErrorCode } from "@/lib/groups/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<GroupErrorCode, string> = {
  invalid_group_name: "Nazwa grupy musi mieć od 1 do 60 znaków",
  group_not_found: "Nie znaleziono grupy",
  invite_invalid: "To zaproszenie jest już nieważne — poproś kogoś z grupy o nowe",
  group_changed: "Grupa zmieniła się w tym samym czasie, spróbuj ponownie",
  not_authenticated: "Zaloguj się, aby kontynuować",
  unexpected: "Coś poszło nie tak, spróbuj ponownie",
};

const GENERIC_MESSAGE = "Coś poszło nie tak, spróbuj ponownie";

/** Shown in place of a group list or group page that could not be loaded, whatever the error code. */
export const GROUPS_LOAD_FAILED_MESSAGE = "Nie udało się wczytać Twoich grup, spróbuj ponownie";

function isGroupErrorCode(code: string): code is GroupErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function groupErrorMessage(code: string): string {
  return isGroupErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function groupError(code: GroupErrorCode, context: Record<string, unknown> = {}): GroupError {
  return { error: { code, message: MESSAGES[code], context } };
}
