// Public API of the billing-periods domain module. Never import `@/lib/supabase` here: it pulls in
// `astro:env/server`, which plain Vitest cannot resolve.
export type * from "@/lib/billing-periods/types";
export { BillingMonth } from "@/lib/billing-periods/billing-month.value";
export {
  EXPENSES_LOAD_FAILED_MESSAGE,
  billingPeriodErrorMessage,
} from "@/lib/billing-periods/billing-period-error.messages";
export { Expense } from "@/lib/billing-periods/expense.aggregate";
export { ExpenseService } from "@/lib/billing-periods/expense.service";
export { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
export { Money } from "@/lib/billing-periods/money.value";
export { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
export type { MemberBalance, PairDebt } from "@/lib/billing-periods/period-balances.value";
export { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
export type { PurchaseDateWindow } from "@/lib/billing-periods/purchase-date.value";
export { createExpenseService, createSupabaseExpenseRepository } from "@/lib/billing-periods/expense.repository";
