import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { Expense } from "@/lib/billing-periods/expense.entity";
import type { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import type { Money } from "@/lib/billing-periods/money.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { PurchaseDateWindow } from "@/lib/billing-periods/purchase-date.value";
import { EqualSplitPolicy } from "@/lib/billing-periods/split-policy";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { BillingPeriodSnapshot, Result } from "@/lib/billing-periods/types";

const EQUAL_SPLIT = new EqualSplitPolicy();

interface BillingPeriodState {
  id: string;
  groupId: string;
  month: BillingMonth;
  openedAt: Date;
  closedAt: Date | null;
  version: number;
  participants: readonly string[];
  expenses: readonly Expense[];
}

/**
 * One billing period of a group: the aggregate root for the period's expenses. It adds expenses,
 * splits them between its participants (the group's members, given when it is loaded) and derives
 * the balances.
 */
export class BillingPeriod {
  readonly id: string;
  readonly groupId: string;
  readonly month: BillingMonth;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly version: number;
  readonly participants: readonly string[];
  private readonly stored: readonly Expense[];
  private readonly added: Expense[] = [];

  private constructor(state: BillingPeriodState) {
    if (state.closedAt !== null && state.closedAt.getTime() < state.openedAt.getTime()) {
      throw new Error(`BillingPeriod ${state.id}: closed before it opened`);
    }
    this.id = state.id;
    this.groupId = state.groupId;
    this.month = state.month;
    this.openedAt = state.openedAt;
    this.closedAt = state.closedAt;
    this.version = state.version;
    this.participants = Object.freeze([...state.participants]);
    this.stored = Object.freeze([...state.expenses]);
  }

  static open(input: { id: string; groupId: string; participants: readonly string[]; now: Date }): BillingPeriod {
    return new BillingPeriod({
      id: input.id,
      groupId: input.groupId,
      month: BillingMonth.of(input.now),
      openedAt: input.now,
      closedAt: null,
      version: 0,
      participants: input.participants,
      expenses: [],
    });
  }

  /** Rebuilds a period from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: BillingPeriodSnapshot, participants: readonly string[]): BillingPeriod {
    return new BillingPeriod({
      id: snapshot.id,
      groupId: snapshot.groupId,
      month: BillingMonth.fromDate(snapshot.month),
      openedAt: parseInstant(snapshot.openedAt),
      closedAt: snapshot.closedAt === null ? null : parseInstant(snapshot.closedAt),
      version: snapshot.version,
      participants,
      expenses: snapshot.expenses.map((expense) => Expense.restore(expense)),
    });
  }

  get expenses(): readonly Expense[] {
    return [...this.stored, ...this.added];
  }

  isOpen(): boolean {
    return this.closedAt === null;
  }

  /** The purchase dates an expense added at `now` may carry: within the period's month and not in the future. */
  purchaseDateWindow(now: Date): PurchaseDateWindow {
    return PurchaseDate.window(this.month, now);
  }

  /**
   * Adds an expense paid by `payerId`, split equally between the participants. Refuses, in this order,
   * a closed period, a payer who is not a participant and a purchase date outside the window.
   */
  addExpense(input: {
    id: string;
    payerId: string;
    title: ExpenseTitle;
    amount: Money;
    purchasedOn: string;
    now: Date;
  }): Result<Expense> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    if (!this.participants.includes(input.payerId)) {
      return billingPeriodError("group_not_found", { groupId: this.groupId });
    }
    const purchasedOn = PurchaseDate.create(input.purchasedOn, { month: this.month, now: input.now });
    if ("error" in purchasedOn) {
      return purchasedOn;
    }
    const expense = new Expense({
      id: input.id,
      payerId: input.payerId,
      title: input.title,
      amount: input.amount,
      purchasedOn: purchasedOn.data,
      createdAt: input.now,
      shares: EQUAL_SPLIT.split({ amount: input.amount, participants: this.participants, payerId: input.payerId }),
    });
    this.added.push(expense);
    return { data: expense };
  }

  /** The expenses added since the period was opened or loaded, which the repository still has to store. */
  newExpenses(): readonly Expense[] {
    return [...this.added];
  }

  /** By purchase date, then by creation time, newest first. */
  expensesNewestFirst(): readonly Expense[] {
    return [...this.expenses].sort(
      (a, b) => b.purchasedOn.value.localeCompare(a.purchasedOn.value) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  balances(): PeriodBalances {
    return PeriodBalances.of({ memberIds: this.participants, expenses: this.expenses });
  }

  toSnapshot(): BillingPeriodSnapshot {
    return {
      id: this.id,
      groupId: this.groupId,
      month: this.month.toDate(),
      openedAt: this.openedAt.toISOString(),
      closedAt: this.closedAt === null ? null : this.closedAt.toISOString(),
      version: this.version,
      expenses: this.expenses.map((expense) => expense.toSnapshot()),
    };
  }
}

function parseInstant(value: string): Date {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid stored timestamp "${value}"`);
  }
  return instant;
}
