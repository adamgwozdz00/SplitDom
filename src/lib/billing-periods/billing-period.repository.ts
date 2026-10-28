import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import { BillingPeriodService } from "@/lib/billing-periods/billing-period.service";
import type { Payment } from "@/lib/billing-periods/payment.entity";
import type {
  BillingPeriodError,
  BillingPeriodRepository,
  BillingPeriodSnapshot,
  ExpenseSnapshot,
  OpeningDebtSnapshot,
  Result,
  PaymentSnapshot,
} from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

type JsonObject = Record<string, Json | undefined>;

/**
 * BillingPeriodRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `billing_period_aggregate` migration and its successors, which scope every read and write to `auth.uid()`.
 */
export function createSupabaseBillingPeriodRepository(client: SupabaseClient<Database>): BillingPeriodRepository {
  return {
    async findCurrentOfGroup(group) {
      const { data, error } = await client.rpc("get_current_billing_period", { p_group_id: group.id });
      if (error) {
        return fromDbError(error);
      }
      return data === null ? { data: null } : restore(data, group);
    },

    async open(period) {
      const snapshot = period.toSnapshot();
      const { error } = await client.rpc("open_billing_period", {
        p_period_id: snapshot.id,
        p_group_id: snapshot.groupId,
        p_month: snapshot.month,
        p_opened_at: snapshot.openedAt,
        p_version: snapshot.version,
      });
      // The group got its open period from a concurrent call (the one-open-period index).
      if (error?.code === "23505") {
        return { data: "conflict" };
      }
      return error ? fromDbError(error) : { data: "opened" };
    },

    async save(period) {
      const { data, error } = await client.rpc("save_billing_period_with_confirmations", {
        p_period_id: period.id,
        p_group_id: period.groupId,
        p_expected_version: period.version,
        p_added: period.newExpenses().map((expense) => toRow(expense.toSnapshot())),
        p_changed: period.changedExpenses().map((expense) => toRow(expense.toSnapshot())),
        p_removed: [...period.removedExpenseIds()],
        p_sent: period.sentPayments().map(toPaymentRow),
        p_withdrawn: [...period.withdrawnPaymentIds()],
        p_confirmed: period.confirmedPayments().map((payment) => ({
          id: payment.id,
          confirmed_at: payment.confirmedAt?.toISOString() ?? null,
        })),
        p_rejected: period.rejectedPayments().map((payment) => ({
          id: payment.id,
          rejected_at: payment.rejectedAt?.toISOString() ?? null,
        })),
      });
      if (error) {
        return fromDbError(error);
      }
      return data ? { data: "saved" } : { data: "conflict" };
    },

    async close(closed, next) {
      if (closed.closedAt === null) {
        return billingPeriodError("unexpected", { periodId: closed.id });
      }
      const { data, error } = await client.rpc("close_billing_period", {
        p_period_id: closed.id,
        p_group_id: closed.groupId,
        p_expected_version: closed.version,
        p_closed_at: closed.closedAt.toISOString(),
        p_next_period_id: next.id,
        p_next_month: next.month.toDate(),
        p_next_opened_at: next.openedAt.toISOString(),
        p_opening: next.openingDebts.map((debt) => ({
          debtor_id: debt.debtorId,
          creditor_id: debt.creditorId,
          amount: debt.amount.grosze,
        })),
        p_moved: [...closed.movedPaymentIds()],
      });
      // The group got another open period, or a period for the same month, from a concurrent write. Every other
      // refusal is judged in `fromDbError`: "group not found" after a close attempt means a backstop of the
      // function tripped (host, next month, timestamps, opening debts or moved payments), not a missing group.
      if (error?.code === "23505") {
        return { data: "conflict" };
      }
      if (error) {
        return fromDbError(error);
      }
      return data ? { data: "closed" } : { data: "conflict" };
    },

    async listOpenMonthsOfCurrentUser() {
      const { data, error } = await client.rpc("list_my_open_billing_months");
      if (error) {
        return fromDbError(error);
      }
      try {
        if (!Array.isArray(data)) {
          throw new TypeError("open months: expected an array");
        }
        return {
          data: data.map((value) => {
            const row = asObject(value, "open_month");
            return {
              groupId: asString(row.group_id, "open_month.group_id"),
              month: BillingMonth.fromDate(asString(row.month, "open_month.month")),
            };
          }),
        };
      } catch {
        return billingPeriodError("unexpected");
      }
    },
  };
}

/**
 * The BillingPeriodService for a request, persisting through the signed-in user's Supabase client. The generators
 * must stay arrows: workerd throws "Illegal invocation" for an unbound crypto.randomUUID.
 */
export function createBillingPeriodService(client: SupabaseClient<Database>): BillingPeriodService {
  return new BillingPeriodService(
    createSupabaseBillingPeriodRepository(client),
    () => crypto.randomUUID(),
    () => new Date(),
  );
}

function fromDbError(error: PostgrestError): BillingPeriodError {
  switch (error.code) {
    case "28000":
      return billingPeriodError("not_authenticated");
    // Also raised by save_billing_period_with_confirmations when an expense or a payment is not the caller's (or a
    // decided payment was not sent to the caller), and by close_billing_period when the caller is not the group's
    // host (or the next period, its opening debts or the moved payments do not match the closed period); the
    // aggregate checks the author, the recipient and the host first, so in practice this is a caller who is not a
    // member of the group.
    case "42501":
      return billingPeriodError("group_not_found");
    default:
      return billingPeriodError("unexpected", { dbCode: error.code });
  }
}

// Stored data that cannot be mapped or breaks an invariant surfaces as `unexpected`, never as a raw throw.
// The participants are the group's members, in the order the group holds them.
function restore(value: Json, group: Group): Result<BillingPeriod> {
  try {
    return {
      data: BillingPeriod.restore(
        toSnapshot(value),
        group.members.map((member) => member.userId),
      ),
    };
  } catch {
    return billingPeriodError("unexpected", { groupId: group.id });
  }
}

/** Maps an expense to the snake_case shape `save_billing_period_with_confirmations` stores. */
function toRow(expense: ExpenseSnapshot): Json {
  return {
    id: expense.id,
    payer_id: expense.payerId,
    title: expense.title,
    amount: expense.amount,
    purchased_on: expense.purchasedOn,
    created_at: expense.createdAt,
    shares: expense.shares.map((share) => ({ user_id: share.userId, amount: share.amount })),
  };
}

/** Maps the persistence functions' snake_case JSON to a BillingPeriodSnapshot; throws TypeError on a malformed shape. */
function toSnapshot(value: Json): BillingPeriodSnapshot {
  const period = asObject(value, "period");
  const expenses = period.expenses;
  if (!Array.isArray(expenses)) {
    throw new TypeError("period.expenses: expected an array");
  }
  const payments = period.payments;
  if (!Array.isArray(payments)) {
    throw new TypeError("period.payments: expected an array");
  }
  const openingDebts = period.opening_debts;
  if (!Array.isArray(openingDebts)) {
    throw new TypeError("period.opening_debts: expected an array");
  }
  return {
    id: asString(period.id, "period.id"),
    groupId: asString(period.group_id, "period.group_id"),
    month: asString(period.month, "period.month"),
    openedAt: asInstant(period.opened_at, "period.opened_at"),
    closedAt: period.closed_at === null ? null : asInstant(period.closed_at, "period.closed_at"),
    version: asInteger(period.version, "period.version"),
    expenses: expenses.map(toExpenseSnapshot),
    payments: payments.map(toPaymentSnapshot),
    openingDebts: openingDebts.map(toOpeningDebtSnapshot),
  };
}

function toOpeningDebtSnapshot(value: Json): OpeningDebtSnapshot {
  const row = asObject(value, "opening_debt");
  return {
    debtorId: asString(row.debtor_id, "opening_debt.debtor_id"),
    creditorId: asString(row.creditor_id, "opening_debt.creditor_id"),
    amountGrosze: asInteger(row.amount, "opening_debt.amount"),
  };
}

function toExpenseSnapshot(value: Json): ExpenseSnapshot {
  const row = asObject(value, "expense");
  const shares = row.shares;
  if (!Array.isArray(shares)) {
    throw new TypeError("expense.shares: expected an array");
  }
  return {
    id: asString(row.id, "expense.id"),
    payerId: asString(row.payer_id, "expense.payer_id"),
    title: asString(row.title, "expense.title"),
    amount: asInteger(row.amount, "expense.amount"),
    purchasedOn: asString(row.purchased_on, "expense.purchased_on"),
    createdAt: asInstant(row.created_at, "expense.created_at"),
    shares: shares.map((share) => {
      const item = asObject(share, "expense.shares[]");
      return {
        userId: asString(item.user_id, "share.user_id"),
        amount: asInteger(item.amount, "share.amount"),
      };
    }),
  };
}

/** Maps a payment to the snake_case shape `save_billing_period_with_confirmations` stores. */
function toPaymentRow(payment: Payment): Json {
  const snapshot = payment.toSnapshot();
  return {
    id: snapshot.id,
    sender_id: snapshot.senderId,
    recipient_id: snapshot.recipientId,
    amount: snapshot.amount,
    sent_at: snapshot.sentAt,
  };
}

function toPaymentSnapshot(value: Json): PaymentSnapshot {
  const row = asObject(value, "payment");
  return {
    id: asString(row.id, "payment.id"),
    senderId: asString(row.sender_id, "payment.sender_id"),
    recipientId: asString(row.recipient_id, "payment.recipient_id"),
    amount: asInteger(row.amount, "payment.amount"),
    sentAt: asInstant(row.sent_at, "payment.sent_at"),
    confirmedAt: row.confirmed_at === null ? null : asInstant(row.confirmed_at, "payment.confirmed_at"),
    rejectedAt: row.rejected_at === null ? null : asInstant(row.rejected_at, "payment.rejected_at"),
  };
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: Json | undefined, field: string): JsonObject {
  if (!isObject(value)) {
    throw new TypeError(`${field}: expected an object`);
  }
  return value;
}

function asString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field}: expected a string`);
  }
  return value;
}

function asInteger(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${field}: expected an integer`);
  }
  return value;
}

// Postgres returns microseconds and an offset (`…06.604123+00:00`); the snapshot holds UTC milliseconds.
// An unparseable value makes toISOString() throw RangeError.
function asInstant(value: Json | undefined, field: string): string {
  return new Date(asString(value, field)).toISOString();
}
