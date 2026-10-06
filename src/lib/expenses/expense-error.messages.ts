import type { ExpenseError, ExpenseErrorCode } from "@/lib/expenses/types";

// After a redirect only the code survives, so the message for each code lives here.
const MESSAGES: Record<ExpenseErrorCode, string> = {
  invalid_expense_title: "Title must be 1–60 characters",
  invalid_amount: "Amount must be between 0,01 and 1 000 000,00 zł, e.g. 12,50",
  invalid_purchase_date: "Purchase date must fall within the current billing period and not be in the future",
  group_not_found: "Group not found",
  not_authenticated: "Sign in to continue",
  unexpected: "Something went wrong, try again",
};

const GENERIC_MESSAGE = "Something went wrong, try again";

/** Shown in place of the expenses section when it could not be loaded, whatever the error code. */
export const EXPENSES_LOAD_FAILED_MESSAGE = "Couldn't load the expenses, try again";

function isExpenseErrorCode(code: string): code is ExpenseErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

export function expenseErrorMessage(code: string): string {
  return isExpenseErrorCode(code) ? MESSAGES[code] : GENERIC_MESSAGE;
}

export function expenseError(code: ExpenseErrorCode, context: Record<string, unknown> = {}): ExpenseError {
  return { error: { code, message: MESSAGES[code], context } };
}
