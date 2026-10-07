import type { Expense } from "@/lib/billing-periods/expense.aggregate";

export type BillingPeriodErrorCode =
  | "invalid_expense_title"
  | "invalid_amount"
  | "invalid_purchase_date"
  | "group_not_found"
  | "not_authenticated"
  | "unexpected";

// Project-wide error shape, owned here until a shared module is introduced.
export interface BillingPeriodError {
  error: { code: BillingPeriodErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | BillingPeriodError;

/** Persistence shape of the Expense aggregate. Amounts are integer grosze, `purchasedOn` is `YYYY-MM-DD`, `createdAt` a UTC ISO string. */
export interface ExpenseSnapshot {
  id: string;
  groupId: string;
  periodId: string;
  payerId: string;
  title: string;
  amount: number;
  purchasedOn: string;
  createdAt: string;
  shares: { userId: string; amount: number }[];
}

/** Persists and loads Expense aggregates on behalf of the signed-in user. */
export interface ExpenseRepository {
  add(expense: Expense): Promise<Result<void>>;
  listForPeriod(groupId: string, periodId: string): Promise<Result<Expense[]>>;
}
