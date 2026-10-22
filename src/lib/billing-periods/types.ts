import type { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import type { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import type { Group } from "@/lib/groups";

export type BillingPeriodErrorCode =
  | "invalid_expense_title"
  | "invalid_amount"
  | "invalid_purchase_date"
  | "billing_period_closed"
  | "expense_not_found"
  | "not_expense_author"
  | "expense_locked"
  | "no_debt_to_pay"
  | "payment_exceeds_debt"
  | "payment_not_found"
  | "not_payment_sender"
  | "payment_confirmed"
  | "not_payment_recipient"
  | "payment_not_pending"
  | "period_changed"
  | "group_not_found"
  | "not_authenticated"
  | "unexpected";

// Project-wide error shape, owned here until a shared module is introduced.
export interface BillingPeriodError {
  error: { code: BillingPeriodErrorCode; message: string; context: Record<string, unknown> };
}

export type Result<T> = { data: T } | BillingPeriodError;

/**
 * Persistence shape of an expense inside a BillingPeriod. Amounts are integer grosze, `purchasedOn` is
 * `YYYY-MM-DD`, `createdAt` a UTC ISO string.
 */
export interface ExpenseSnapshot {
  id: string;
  payerId: string;
  title: string;
  amount: number;
  purchasedOn: string;
  createdAt: string;
  shares: { userId: string; amount: number }[];
}

/**
 * Persistence shape of a payment. `amount` is integer grosze; `sentAt`, `confirmedAt` and `rejectedAt` are UTC
 * ISO strings (`confirmedAt` and `rejectedAt` are null until the recipient decides, and never both set).
 */
export interface PaymentSnapshot {
  id: string;
  senderId: string;
  recipientId: string;
  amount: number;
  sentAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
}

/** Persistence shape of the BillingPeriod aggregate. `month` is `YYYY-MM-01`; timestamps are UTC ISO strings. */
export interface BillingPeriodSnapshot {
  id: string;
  groupId: string;
  month: string;
  openedAt: string;
  closedAt: string | null;
  version: number;
  expenses: ExpenseSnapshot[];
  payments: PaymentSnapshot[];
}

/** Loads and persists BillingPeriod aggregates on behalf of the signed-in user. */
export interface BillingPeriodRepository {
  /** The group's latest period, restored with the group's member ids as participants; null when it has none. */
  findCurrentOfGroup(group: Group): Promise<Result<BillingPeriod | null>>;
  /** Stores a newly opened period; `"conflict"` when the group already got one concurrently. */
  open(period: BillingPeriod): Promise<Result<"opened" | "conflict">>;
  /** Stores the expense and payment changes (including confirmed and rejected payments) since load if the period's version is unchanged; `"conflict"` otherwise. */
  save(period: BillingPeriod): Promise<Result<"saved" | "conflict">>;
  /** The open period's month of every group the signed-in user belongs to. */
  listOpenMonthsOfCurrentUser(): Promise<Result<{ groupId: string; month: BillingMonth }[]>>;
}
