import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { Expense } from "@/lib/billing-periods/expense.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import { ExpenseService } from "@/lib/billing-periods/expense.service";
import type { BillingPeriodError, ExpenseRepository, ExpenseSnapshot, Result } from "@/lib/billing-periods/types";

type JsonObject = Record<string, Json | undefined>;

/**
 * ExpenseRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `expenses` migration, which scope every read and write to `auth.uid()`.
 */
export function createSupabaseExpenseRepository(client: SupabaseClient<Database>): ExpenseRepository {
  return {
    async add(expense) {
      const snapshot = expense.toSnapshot();
      const { error } = await client.rpc("add_expense", {
        p_expense_id: snapshot.id,
        p_group_id: snapshot.groupId,
        p_period_id: snapshot.periodId,
        p_payer_id: snapshot.payerId,
        p_title: snapshot.title,
        p_amount: snapshot.amount,
        p_purchased_on: snapshot.purchasedOn,
        p_created_at: snapshot.createdAt,
        p_shares: snapshot.shares.map((share) => ({ user_id: share.userId, amount: share.amount })),
      });
      return error ? fromDbError(error) : { data: undefined };
    },

    async listForPeriod(groupId, periodId) {
      const { data, error } = await client.rpc("list_period_expenses", {
        p_group_id: groupId,
        p_period_id: periodId,
      });
      if (error) {
        return fromDbError(error);
      }
      if (data === null) {
        return billingPeriodError("group_not_found", { groupId });
      }
      return restoreAll(data, groupId);
    },
  };
}

/**
 * The ExpenseService for a request, persisting through the signed-in user's Supabase client. The generators
 * must stay arrows: workerd throws "Illegal invocation" for an unbound crypto.randomUUID.
 */
export function createExpenseService(client: SupabaseClient<Database>): ExpenseService {
  return new ExpenseService(
    createSupabaseExpenseRepository(client),
    () => crypto.randomUUID(),
    () => new Date(),
  );
}

function fromDbError(error: PostgrestError): BillingPeriodError {
  switch (error.code) {
    case "28000":
      return billingPeriodError("not_authenticated");
    case "42501":
      return billingPeriodError("group_not_found");
    default:
      return billingPeriodError("unexpected", { dbCode: error.code });
  }
}

// Stored data that cannot be mapped or breaks an invariant surfaces as `unexpected`, never as a raw throw.
// One corrupt expense fails the whole list: it is a data-integrity bug, not a user error.
function restoreAll(value: Json, groupId: string): Result<Expense[]> {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError("expenses: expected an array");
    }
    return { data: value.map((row) => Expense.restore(toSnapshot(row))) };
  } catch {
    return billingPeriodError("unexpected", { groupId });
  }
}

/** Maps the persistence functions' snake_case JSON to an ExpenseSnapshot; throws TypeError on a malformed shape. */
function toSnapshot(value: Json): ExpenseSnapshot {
  const row = asObject(value, "expense");
  const shares = row.shares;
  if (!Array.isArray(shares)) {
    throw new TypeError("expense.shares: expected an array");
  }
  return {
    id: asString(row.id, "expense.id"),
    groupId: asString(row.group_id, "expense.group_id"),
    periodId: asString(row.period_id, "expense.period_id"),
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
