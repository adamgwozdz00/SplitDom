import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { Expense } from "@/lib/billing-periods/expense.entity";
import type { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import type { Money } from "@/lib/billing-periods/money.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { PurchaseDateWindow } from "@/lib/billing-periods/purchase-date.value";
import { Payment } from "@/lib/billing-periods/payment.entity";
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
  payments: readonly Payment[];
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
  private readonly storedPayments: Payment[];
  private readonly addedPayments: Payment[] = [];
  private readonly withdrawn: string[] = [];
  private readonly confirmed: string[] = [];
  private readonly rejected: string[] = [];

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
    this.storedPayments = [...state.payments];
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
      payments: [],
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
      payments: snapshot.payments.map((payment) => Payment.restore(payment)),
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

  /** Whether `userId` may change `expense`: the period is open and they paid it. Payments never lock an expense (FR-005 as amended). */
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

  get payments(): readonly Payment[] {
    return [...this.storedPayments, ...this.addedPayments];
  }

  /**
   * Records that `senderId` sent `amount` to `recipientId`: an entry in the period's ledger that counts in the
   * balances at once. Sending the same `id` again returns the payment already recorded (a repeated submit or a
   * retry), unless someone else sent it. Otherwise refuses, in this order, a closed period, a sender who is not
   * a participant, a pair without a pending debt from the sender to the recipient, and an amount above that debt.
   */
  sendPayment(input: { id: string; senderId: string; recipientId: string; amount: Money; now: Date }): Result<Payment> {
    const existing = this.payments.find((payment) => payment.id === input.id);
    if (existing) {
      return existing.senderId === input.senderId
        ? { data: existing }
        : billingPeriodError("unexpected", { periodId: this.id });
    }
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    if (!this.participants.includes(input.senderId)) {
      return billingPeriodError("group_not_found", { groupId: this.groupId });
    }
    const debt = this.pendingBalances().debts.find(
      (candidate) => candidate.debtorId === input.senderId && candidate.creditorId === input.recipientId,
    );
    if (!debt) {
      return billingPeriodError("no_debt_to_pay", { periodId: this.id });
    }
    if (input.amount.grosze > debt.amount.grosze) {
      return billingPeriodError("payment_exceeds_debt", { periodId: this.id });
    }
    const payment = new Payment({
      id: input.id,
      senderId: input.senderId,
      recipientId: input.recipientId,
      amount: input.amount,
      sentAt: input.now,
      confirmedAt: null,
      rejectedAt: null,
    });
    this.addedPayments.push(payment);
    return { data: payment };
  }

  /**
   * Withdraws `userId`'s own payment. Refuses, in this order, a closed period, an unknown payment, a payment
   * someone else sent, a payment the recipient has confirmed and one the recipient has rejected.
   */
  withdrawPayment(input: { paymentId: string; userId: string }): Result<void> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    const payment = this.payments.find((candidate) => candidate.id === input.paymentId);
    if (!payment) {
      return billingPeriodError("payment_not_found", { periodId: this.id, paymentId: input.paymentId });
    }
    if (payment.senderId !== input.userId) {
      return billingPeriodError("not_payment_sender", { periodId: this.id, paymentId: payment.id });
    }
    if (payment.isConfirmed()) {
      return billingPeriodError("payment_confirmed", { periodId: this.id, paymentId: payment.id });
    }
    if (payment.isRejected()) {
      return billingPeriodError("payment_not_pending", { periodId: this.id, paymentId: payment.id });
    }
    const addedAt = this.addedPayments.findIndex((candidate) => candidate.id === payment.id);
    if (addedAt >= 0) {
      this.addedPayments.splice(addedAt, 1);
    } else {
      this.storedPayments.splice(
        this.storedPayments.findIndex((candidate) => candidate.id === payment.id),
        1,
      );
      this.withdrawn.push(payment.id);
    }
    return { data: undefined };
  }

  /**
   * The recipient `userId` confirms a payment: it becomes posted, the pending balances do not change. Refuses, in
   * this order, a closed period, an unknown payment and a user who is not the recipient. Confirming a confirmed
   * payment succeeds without a change; confirming a rejected one gives `payment_not_pending`.
   */
  confirmPayment(input: { paymentId: string; userId: string; now: Date }): Result<void> {
    return this.decidePayment(input, "confirmed");
  }

  /**
   * The recipient `userId` rejects a payment: it stays in the ledger as rejected and counts in neither balance.
   * Same refusals as `confirmPayment`, mirrored: rejecting a rejected payment succeeds without a change, rejecting
   * a confirmed one gives `payment_not_pending`.
   */
  rejectPayment(input: { paymentId: string; userId: string; now: Date }): Result<void> {
    return this.decidePayment(input, "rejected");
  }

  private decidePayment(
    input: { paymentId: string; userId: string; now: Date },
    decision: "confirmed" | "rejected",
  ): Result<void> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    const payment = this.payments.find((candidate) => candidate.id === input.paymentId);
    if (!payment) {
      return billingPeriodError("payment_not_found", { periodId: this.id, paymentId: input.paymentId });
    }
    if (payment.recipientId !== input.userId) {
      return billingPeriodError("not_payment_recipient", { periodId: this.id, paymentId: payment.id });
    }
    if (payment.status() === decision) {
      return { data: undefined };
    }
    if (!payment.isPending()) {
      return billingPeriodError("payment_not_pending", { periodId: this.id, paymentId: payment.id });
    }
    const decided = decision === "confirmed" ? payment.confirm(input.now) : payment.reject(input.now);
    const addedAt = this.addedPayments.findIndex((candidate) => candidate.id === payment.id);
    if (addedAt >= 0) {
      this.addedPayments[addedAt] = decided;
    } else {
      this.storedPayments[this.storedPayments.findIndex((candidate) => candidate.id === payment.id)] = decided;
    }
    (decision === "confirmed" ? this.confirmed : this.rejected).push(payment.id);
    return { data: undefined };
  }

  /** The payments sent since the period was loaded, which the repository still has to store. */
  sentPayments(): readonly Payment[] {
    return [...this.addedPayments];
  }

  /** The ids of the loaded payments withdrawn since, which the repository still has to delete. */
  withdrawnPaymentIds(): readonly string[] {
    return [...this.withdrawn];
  }

  /** The loaded payments confirmed since, which the repository still has to store as confirmed. */
  confirmedPayments(): readonly Payment[] {
    return this.storedPayments.filter((payment) => this.confirmed.includes(payment.id));
  }

  /** The loaded payments rejected since, which the repository still has to store as rejected. */
  rejectedPayments(): readonly Payment[] {
    return this.storedPayments.filter((payment) => this.rejected.includes(payment.id));
  }

  /** By time sent, newest first (then by id, so the order is stable). */
  paymentsNewestFirst(): readonly Payment[] {
    return [...this.payments].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || a.id.localeCompare(b.id));
  }

  /** By purchase date, then by creation time, newest first. */
  expensesNewestFirst(): readonly Expense[] {
    return [...this.expenses].sort(
      (a, b) => b.purchasedOn.value.localeCompare(a.purchasedOn.value) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** Expenses plus every payment not withdrawn or rejected: what the members owe if every payment sent did arrive. */
  pendingBalances(): PeriodBalances {
    return PeriodBalances.of({
      memberIds: this.participants,
      expenses: this.expenses,
      payments: this.payments.filter((payment) => !payment.isRejected()),
    });
  }

  /** Expenses plus confirmed payments only: what is settled for certain. */
  postedBalances(): PeriodBalances {
    return PeriodBalances.of({
      memberIds: this.participants,
      expenses: this.expenses,
      payments: this.payments.filter((payment) => payment.isConfirmed()),
    });
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
      payments: this.payments.map((payment) => payment.toSnapshot()),
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
