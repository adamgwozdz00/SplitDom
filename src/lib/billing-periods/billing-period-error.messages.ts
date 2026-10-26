import type { BillingPeriodError, BillingPeriodErrorCode } from "@/lib/billing-periods/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<BillingPeriodErrorCode, string> = {
  invalid_expense_title: "Title must be 1–60 characters",
  invalid_amount: "Amount must be between 0,01 and 1 000 000,00 zł, e.g. 12,50",
  invalid_purchase_date: "Purchase date must fall within the current billing period and not be in the future",
  billing_period_closed: "This billing period is closed, so expenses can no longer be changed",
  expense_not_found: "Expense not found",
  not_expense_author: "Only the member who paid an expense can change it",
  expense_locked: "This expense can no longer be changed because a payment for it has been confirmed",
  no_debt_to_pay: "You don't owe this member anything right now",
  payment_exceeds_debt: "The amount is more than you owe this member right now",
  payment_not_found: "Payment not found",
  not_payment_sender: "Only the member who sent a payment can withdraw it",
  payment_confirmed: "A confirmed payment can no longer be withdrawn",
  not_payment_recipient: "Only the member a payment was sent to can confirm or reject it",
  payment_not_pending: "This payment has already been confirmed or rejected",
  not_group_host: "Only the group's host can close the billing period",
  period_not_ended: "This month has not ended yet; you can close it from the 1st of next month",
  host_has_debts: "Settle your own debts from this month first; they must be confirmed by their recipients",
  period_changed: "Someone else just changed this billing period, try again",
  group_not_found: "Group not found",
  not_authenticated: "Sign in to continue",
  unexpected: "Something went wrong, try again",
};

const GENERIC_MESSAGE = "Something went wrong, try again";

/** Shown in place of the expenses section when it could not be loaded, whatever the error code. */
export const EXPENSES_LOAD_FAILED_MESSAGE = "Couldn't load the expenses, try again";

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
