import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { Expense } from "@/lib/billing-periods/expense.entity";
import type { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import type { Money } from "@/lib/billing-periods/money.value";
import { OpeningDebt } from "@/lib/billing-periods/opening-debt.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { PurchaseDateWindow } from "@/lib/billing-periods/purchase-date.value";
import { Payment } from "@/lib/billing-periods/payment.entity";
import { EqualSplitPolicy } from "@/lib/billing-periods/split-policy";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { BillingPeriodErrorCode, BillingPeriodSnapshot, Result } from "@/lib/billing-periods/types";

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
  openingDebts: readonly OpeningDebt[];
}

/**
 * One billing period of a group: the aggregate root for the period's expenses. It adds expenses,
 * splits them between its participants (the group's members, given when it is loaded) and derives
 * the balances. The host closes it once its month has ended, which opens the next period with the
 * posted debts carried over as opening debts and the pending payments moved along.
 */
export class BillingPeriod {
  readonly id: string;
  readonly groupId: string;
  readonly month: BillingMonth;
  readonly openedAt: Date;
  readonly version: number;
  readonly participants: readonly string[];
  readonly openingDebts: readonly OpeningDebt[];
  private closedAtValue: Date | null;
  private closedHere = false;
  private readonly moved: string[] = [];
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
    this.closedAtValue = state.closedAt;
    this.version = state.version;
    this.participants = Object.freeze([...state.participants]);
    this.openingDebts = Object.freeze([...state.openingDebts]);
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
      openingDebts: [],
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
      openingDebts: snapshot.openingDebts.map((debt) => OpeningDebt.restore(debt)),
    });
  }

  /** When the period was closed; null while it is open. */
  get closedAt(): Date | null {
    return this.closedAtValue;
  }

  get expenses(): readonly Expense[] {
    return [...this.stored, ...this.added];
  }

  isOpen(): boolean {
    return this.closedAtValue === null;
  }

  /**
   * Why `userId` may not close the period at `now`, or null when they may. Refuses, in this order, a closed
   * period, a user who is not the group's host (`hostId`), a month that has not ended yet (Europe/Warsaw) and a
   * host who still owes someone on the posted balances (a pending payment does not count until confirmed).
   * Other members' debts never block: they carry over.
   */
  closeRefusal(input: { userId: string; hostId: string; now: Date }): BillingPeriodErrorCode | null {
    if (!this.isOpen()) {
      return "billing_period_closed";
    }
    if (input.userId !== input.hostId) {
      return "not_group_host";
    }
    if (!this.month.hasEndedAt(input.now)) {
      return "period_not_ended";
    }
    if (this.postedBalances().debts.some((debt) => debt.debtorId === input.hostId)) {
      return "host_has_debts";
    }
    return null;
  }

  /**
   * The host closes the period at `now` and gets the next one. Refuses with `closeRefusal`. Otherwise this period
   * is closed at `now` (a pending write) and the returned period, `nextPeriodId`, covers the month after this one,
   * opened at `now` with the same participants and no expenses. Every posted pair debt of this period becomes one
   * of its opening debts and every pending payment of this period moves to it unchanged, so both its balances
   * equal this period's at the moment of the close. Confirmed and rejected payments stay here.
   */
  close(input: { userId: string; hostId: string; nextPeriodId: string; now: Date }): Result<BillingPeriod> {
    const refusal = this.closeRefusal(input);
    if (refusal !== null) {
      return billingPeriodError(refusal, { periodId: this.id });
    }
    const openingDebts = this.postedBalances().debts.map((debt) =>
      OpeningDebt.of({ debtorId: debt.debtorId, creditorId: debt.creditorId, amount: debt.amount }),
    );
    const pending = this.payments.filter((payment) => payment.isPending());
    const next = new BillingPeriod({
      id: input.nextPeriodId,
      groupId: this.groupId,
      month: this.month.next(),
      openedAt: input.now,
      closedAt: null,
      version: 0,
      participants: this.participants,
      expenses: [],
      payments: pending,
      openingDebts,
    });
    // Clocks of separate Worker isolates can differ by milliseconds, so an early close is recorded at `openedAt`.
    this.closedAtValue = input.now.getTime() < this.openedAt.getTime() ? this.openedAt : input.now;
    this.closedHere = true;
    this.moved.push(...pending.map((payment) => payment.id));
    return { data: next };
  }

  /** Whether the period was closed since it was loaded, which the repository still has to store. */
  closedNow(): boolean {
    return this.closedHere;
  }

  /** The ids of the pending payments the close moved to the next period, which the repository still has to move. */
  movedPaymentIds(): readonly string[] {
    return [...this.moved];
  }

  /** Whether `payment` was carried over from the previous period: it was sent before this period opened. */
  isCarried(payment: Payment): boolean {
    return payment.sentAt.getTime() < this.openedAt.getTime();
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

  /**
   * Whether a confirmed payment has settled `expense` (FR-005), applied oldest first: confirmed payments of a pair
   * first settle the opening debt carried in the same direction, so for each direction between the expense's
   * payer and one of its sharers, the expense is locked once the confirmed payments in that direction add up to
   * more than the opening debt in that direction (0 when there is none). The lock covers every expense of the
   * pair, in both directions and including later ones. Pending and rejected payments never count; with no
   * opening debt any confirmed payment of the pair locks.
   */
  isLocked(expense: Expense): boolean {
    return expense
      .sharerIds()
      .filter((sharerId) => sharerId !== expense.payerId)
      .some(
        (sharerId) =>
          this.confirmedBeyondOpeningDebt(expense.payerId, sharerId) ||
          this.confirmedBeyondOpeningDebt(sharerId, expense.payerId),
      );
  }

  private confirmedBeyondOpeningDebt(senderId: string, recipientId: string): boolean {
    const confirmed = this.payments
      .filter(
        (payment) => payment.isConfirmed() && payment.senderId === senderId && payment.recipientId === recipientId,
      )
      .reduce((sum, payment) => sum + payment.amount.grosze, 0);
    const carried = this.openingDebts
      .filter((debt) => debt.debtorId === senderId && debt.creditorId === recipientId)
      .reduce((sum, debt) => sum + debt.amount.grosze, 0);
    return confirmed > carried;
  }

  /** Whether `userId` may change `expense`: the period is open, they paid it and no confirmed payment locks it. */
  canEdit(expense: Expense, userId: string): boolean {
    return this.isOpen() && expense.payerId === userId && !this.isLocked(expense);
  }

  /**
   * The expense `userId` may change. Refuses, in this order, a closed period, an unknown expense, an
   * expense someone else paid and an expense locked by a confirmed payment.
   */
  editableExpense(expenseId: string, userId: string): Result<Expense> {
    if (!this.isOpen()) {
      return billingPeriodError("billing_period_closed", { periodId: this.id });
    }
    const expense = this.expenses.find((candidate) => candidate.id === expenseId);
    if (!expense) {
      return billingPeriodError("expense_not_found", { periodId: this.id, expenseId });
    }
    if (expense.payerId !== userId) {
      return billingPeriodError("not_expense_author", { periodId: this.id, expenseId });
    }
    if (this.isLocked(expense)) {
      return billingPeriodError("expense_locked", { periodId: this.id, expenseId });
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

  /** Opening debts, expenses and every payment not withdrawn or rejected: what the members owe if every payment sent did arrive. */
  pendingBalances(): PeriodBalances {
    return PeriodBalances.of({
      memberIds: this.participants,
      expenses: this.expenses,
      payments: this.payments.filter((payment) => !payment.isRejected()),
      openingDebts: this.openingDebts,
    });
  }

  /** Opening debts, expenses and confirmed payments only: what is settled for certain. */
  postedBalances(): PeriodBalances {
    return PeriodBalances.of({
      memberIds: this.participants,
      expenses: this.expenses,
      payments: this.payments.filter((payment) => payment.isConfirmed()),
      openingDebts: this.openingDebts,
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
      openingDebts: this.openingDebts.map((debt) => debt.toSnapshot()),
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
