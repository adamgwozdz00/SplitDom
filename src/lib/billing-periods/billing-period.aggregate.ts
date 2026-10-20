import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { Expense } from "@/lib/billing-periods/expense.entity";
import type { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import type { Money } from "@/lib/billing-periods/money.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { PurchaseDateWindow } from "@/lib/billing-periods/purchase-date.value";
import { Transfer } from "@/lib/billing-periods/transfer.entity";
import type { TransferState } from "@/lib/billing-periods/transfer.entity";
import type { PairDebt } from "@/lib/billing-periods/period-balances.value";
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
  transfers: readonly Transfer[];
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
  private readonly stored: Expense[];
  private readonly added: Expense[] = [];
  private readonly changed = new Set<string>();
  private readonly removed: string[] = [];
  private readonly storedTransfers: Transfer[];
  private readonly addedTransfers: Transfer[] = [];
  private readonly changedTransfers = new Set<string>();
  private readonly unmarked: string[] = [];

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
    this.stored = [...state.expenses];
    this.storedTransfers = [...state.transfers];
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
      transfers: [],
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
      transfers: snapshot.transfers.map((transfer) => Transfer.restore(transfer)),
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

  /** Whether `userId` may change `expense`: the period is open and they paid it. */
  canEdit(expense: Expense, userId: string): boolean {
    return this.isOpen() && expense.payerId === userId;
  }

  /**
   * The expense `userId` may change. Refuses, in this order, a closed period, an unknown expense and an
   * expense someone else paid.
   */
  editableExpense(expenseId: string, userId: string): Result<Expense> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    const expense = this.expenses.find((candidate) => candidate.id === expenseId);
    if (!expense) {
      return billingPeriodError("expense_not_found", { periodId: this.id, expenseId });
    }
    if (!this.canEdit(expense, userId)) {
      return billingPeriodError("not_expense_author", { periodId: this.id, expenseId });
    }
    return { data: expense };
  }

  /**
   * Changes the title, amount and purchase date of `userId`'s own expense. The new amount is split equally
   * between the users who already hold a share of it (the payer's share absorbs the remainder), so a member
   * who joined later takes no part. After the checks of `editableExpense` it refuses a date outside the window.
   */
  editExpense(input: {
    expenseId: string;
    userId: string;
    title: ExpenseTitle;
    amount: Money;
    purchasedOn: string;
    now: Date;
  }): Result<Expense> {
    const editable = this.editableExpense(input.expenseId, input.userId);
    if ("error" in editable) {
      return editable;
    }
    const purchasedOn = PurchaseDate.create(input.purchasedOn, { month: this.month, now: input.now });
    if ("error" in purchasedOn) {
      return purchasedOn;
    }
    const expense = editable.data;
    const revised = expense.revise({
      title: input.title,
      amount: input.amount,
      purchasedOn: purchasedOn.data,
      shares: EQUAL_SPLIT.split({ amount: input.amount, participants: expense.sharerIds(), payerId: expense.payerId }),
    });
    const addedAt = this.added.findIndex((candidate) => candidate.id === revised.id);
    if (addedAt >= 0) {
      this.added[addedAt] = revised;
    } else {
      this.stored[this.stored.findIndex((candidate) => candidate.id === revised.id)] = revised;
      this.changed.add(revised.id);
    }
    return { data: revised };
  }

  /** Deletes `userId`'s own expense, under the same checks as `editableExpense`. */
  removeExpense(input: { expenseId: string; userId: string }): Result<void> {
    const editable = this.editableExpense(input.expenseId, input.userId);
    if ("error" in editable) {
      return editable;
    }
    const addedAt = this.added.findIndex((candidate) => candidate.id === input.expenseId);
    if (addedAt >= 0) {
      this.added.splice(addedAt, 1);
    } else {
      this.stored.splice(
        this.stored.findIndex((candidate) => candidate.id === input.expenseId),
        1,
      );
      this.changed.delete(input.expenseId);
      this.removed.push(input.expenseId);
    }
    return { data: undefined };
  }

  /** The loaded expenses changed since, which the repository still has to store. */
  changedExpenses(): readonly Expense[] {
    return this.stored.filter((expense) => this.changed.has(expense.id));
  }

  /** The ids of the loaded expenses deleted since, which the repository still has to delete. */
  removedExpenseIds(): readonly string[] {
    return [...this.removed];
  }

  /** The expenses added since the period was opened or loaded, which the repository still has to store. */
  newExpenses(): readonly Expense[] {
    return [...this.added];
  }

  get transfers(): readonly Transfer[] {
    return [...this.storedTransfers, ...this.addedTransfers];
  }

  /** The mark `debtorId` made for their transfer to `creditorId`, or null. */
  sentTransferOf(debtorId: string, creditorId: string): Transfer | null {
    return (
      this.transfers.find((transfer) => transfer.debtorId === debtorId && transfer.creditorId === creditorId) ?? null
    );
  }

  /**
   * Marks `debtorId`'s transfer to `creditorId` as sent, recording the `amount` they sent (the one the debtor
   * saw, not necessarily the debt now). Refuses, in this order, a closed period, a debtor who is not a
   * participant and a pair without a debt from the debtor to the creditor. A pair has one mark: marking again
   * with another amount replaces it (keeping its id), with the same amount changes nothing.
   */
  markTransferSent(input: {
    id: string;
    debtorId: string;
    creditorId: string;
    amount: Money;
    now: Date;
  }): Result<Transfer> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    if (!this.participants.includes(input.debtorId)) {
      return billingPeriodError("group_not_found", { groupId: this.groupId });
    }
    const owes = this.balances().debts.some(
      (debt) => debt.debtorId === input.debtorId && debt.creditorId === input.creditorId,
    );
    if (!owes) {
      return billingPeriodError("no_debt_to_mark", { periodId: this.id });
    }

    const existing = this.sentTransferOf(input.debtorId, input.creditorId);
    if (!existing) {
      const created = new Transfer({
        id: input.id,
        debtorId: input.debtorId,
        creditorId: input.creditorId,
        amount: input.amount,
        sentAt: input.now,
      });
      this.addedTransfers.push(created);
      return { data: created };
    }
    if (existing.amount.equals(input.amount)) {
      return { data: existing };
    }
    const replaced = existing.replace({ amount: input.amount, sentAt: input.now });
    const addedAt = this.addedTransfers.findIndex((candidate) => candidate.id === existing.id);
    if (addedAt >= 0) {
      this.addedTransfers[addedAt] = replaced;
    } else {
      this.storedTransfers[this.storedTransfers.findIndex((candidate) => candidate.id === existing.id)] = replaced;
      this.changedTransfers.add(replaced.id);
    }
    return { data: replaced };
  }

  /** Removes `debtorId`'s mark for `creditorId`. Refuses a closed period and a pair without a mark. */
  undoTransferSent(input: { debtorId: string; creditorId: string }): Result<void> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    const transfer = this.sentTransferOf(input.debtorId, input.creditorId);
    if (!transfer) {
      return billingPeriodError("transfer_not_found", { periodId: this.id });
    }
    const addedAt = this.addedTransfers.findIndex((candidate) => candidate.id === transfer.id);
    if (addedAt >= 0) {
      this.addedTransfers.splice(addedAt, 1);
    } else {
      this.storedTransfers.splice(
        this.storedTransfers.findIndex((candidate) => candidate.id === transfer.id),
        1,
      );
      this.changedTransfers.delete(transfer.id);
      this.unmarked.push(transfer.id);
    }
    return { data: undefined };
  }

  /** The marks where `userId` is the debtor or the creditor, with their state against the current debts. */
  sentTransfersInvolving(userId: string): { transfer: Transfer; state: TransferState; debt: PairDebt | null }[] {
    const debts = this.balances().debts;
    return this.transfers
      .filter((transfer) => transfer.debtorId === userId || transfer.creditorId === userId)
      .map((transfer) => ({ transfer, ...transfer.stateAgainst(debts) }));
  }

  /** The marks added or replaced since load, which the repository still has to store. */
  markedTransfers(): readonly Transfer[] {
    return [
      ...this.storedTransfers.filter((transfer) => this.changedTransfers.has(transfer.id)),
      ...this.addedTransfers,
    ];
  }

  /** The ids of the loaded marks undone since, which the repository still has to delete. */
  unmarkedTransferIds(): readonly string[] {
    return [...this.unmarked];
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
      transfers: this.transfers.map((transfer) => transfer.toSnapshot()),
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
