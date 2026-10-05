// Public API of the expenses domain module. Never import `@/lib/supabase` here: it pulls in
// `astro:env/server`, which plain Vitest cannot resolve.
export type * from "@/lib/expenses/types";
export { EXPENSES_LOAD_FAILED_MESSAGE, expenseErrorMessage } from "@/lib/expenses/expense-error.messages";
export { Expense } from "@/lib/expenses/expense.aggregate";
export { ExpenseService } from "@/lib/expenses/expense.service";
export { ExpenseTitle } from "@/lib/expenses/expense-title.value";
export { Money } from "@/lib/expenses/money.value";
export { PeriodBalances } from "@/lib/expenses/period-balances.value";
export type { MemberBalance, PairDebt } from "@/lib/expenses/period-balances.value";
export { PurchaseDate } from "@/lib/expenses/purchase-date.value";
export type { PurchaseDateWindow } from "@/lib/expenses/purchase-date.value";
