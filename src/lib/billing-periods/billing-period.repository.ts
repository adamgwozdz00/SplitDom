import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db";
import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import { BillingPeriodService } from "@/lib/billing-periods/billing-period.service";
import type {
  BillingPeriodError,
  BillingPeriodRepository,
  BillingPeriodSnapshot,
  ExpenseSnapshot,
  Result,
} from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

type JsonObject = Record<string, Json | undefined>;

/**
 * BillingPeriodRepository on the signed-in user's Supabase client. It talks to the persistence functions
 * from the `billing_period_aggregate` migration, which scope every read and write to `auth.uid()`.
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
      const { data, error } = await client.rpc("save_billing_period", {
        p_period_id: period.id,
        p_group_id: period.groupId,
        p_expected_version: period.version,
        p_expenses: period.newExpenses().map((expense) => toRow(expense.toSnapshot())),
      });
      if (error) {
        return fromDbError(error);
      }
      return data ? { data: "saved" } : { data: "conflict" };
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

/** Maps an expense to the snake_case shape `save_billing_period` stores. */
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
  return {
    id: asString(period.id, "period.id"),
    groupId: asString(period.group_id, "period.group_id"),
    month: asString(period.month, "period.month"),
    openedAt: asInstant(period.opened_at, "period.opened_at"),
    closedAt: period.closed_at === null ? null : asInstant(period.closed_at, "period.closed_at"),
    version: asInteger(period.version, "period.version"),
    expenses: expenses.map(toExpenseSnapshot),
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
