import type { BillingPeriodError, BillingPeriodErrorCode } from "@/lib/billing-periods/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<BillingPeriodErrorCode, string> = {
  invalid_expense_title: "Tytuł musi mieć od 1 do 60 znaków",
  invalid_amount: "Kwota musi wynosić od 0,01 do 1 000 000,00 zł, np. 12,50",
  invalid_purchase_date: "Data zakupu musi przypadać w bieżącym okresie rozliczeniowym i nie może być z przyszłości",
  billing_period_closed: "Ten okres rozliczeniowy jest zamknięty, więc wydatków nie można już zmieniać",
  expense_not_found: "Nie znaleziono wydatku",
  not_expense_author: "Wydatek może zmienić tylko osoba, która za niego zapłaciła",
  expense_locked: "Tego wydatku nie można już zmienić, bo potwierdzono wpłatę, która go dotyczy",
  no_debt_to_pay: "Nie masz teraz długu wobec tej osoby",
  payment_exceeds_debt: "Kwota jest większa niż Twój obecny dług wobec tej osoby",
  payment_not_found: "Nie znaleziono wpłaty",
  not_payment_sender: "Wpłatę może wycofać tylko osoba, która ją wysłała",
  payment_confirmed: "Potwierdzonej wpłaty nie można już wycofać",
  not_payment_recipient: "Wpłatę może potwierdzić lub odrzucić tylko jej odbiorca",
  payment_not_pending: "Ta wpłata została już potwierdzona lub odrzucona",
  not_group_host: "Okres rozliczeniowy może zamknąć tylko gospodarz grupy",
  period_not_ended: "Ten miesiąc jeszcze się nie skończył; zamkniesz go od 1. dnia następnego miesiąca",
  host_has_debts: "Najpierw spłać swoje długi z tego miesiąca; ich odbiorcy muszą potwierdzić wpłaty",
  period_changed: "Ktoś właśnie zmienił ten okres rozliczeniowy, spróbuj ponownie",
  group_not_found: "Nie znaleziono grupy",
  not_authenticated: "Zaloguj się, aby kontynuować",
  unexpected: "Coś poszło nie tak, spróbuj ponownie",
};

const GENERIC_MESSAGE = "Coś poszło nie tak, spróbuj ponownie";

/** Shown in place of the expenses section when it could not be loaded, whatever the error code. */
export const EXPENSES_LOAD_FAILED_MESSAGE = "Nie udało się wczytać wydatków, spróbuj ponownie";

function isBillingPeriodErrorCode(code: string): code is BillingPeriodErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function billingPeriodErrorMessage(code: string): string {
  return isBillingPeriodErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function billingPeriodError(
  code: BillingPeriodErrorCode,
  context: Record<string, unknown> = {},
): BillingPeriodError {
  return { error: { code, message: MESSAGES[code], context } };
}
