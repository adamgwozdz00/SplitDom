import type { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { Expense } from "@/lib/billing-periods/expense.entity";
import type { OpeningDebt } from "@/lib/billing-periods/opening-debt.value";
import type { Payment } from "@/lib/billing-periods/payment.entity";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import type { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import type { BillingPeriodRepository, Result } from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only entry point to the BillingPeriod aggregate: it loads a period through the repository, runs a
 * command on it and saves it, leaving the rules to the aggregate. The clock and id generator are injected
 * so tests are deterministic. `group` is always one already loaded for its member, so a missing period
 * means "none yet", not "not a member".
 */
export class BillingPeriodService {
  constructor(
    private readonly repository: BillingPeriodRepository,
    private readonly newId: () => string,
    private readonly clock: () => Date,
  ) {}

  /**
   * The group's open period. A group without any period gets its first one opened here (self-repair); when a
   * concurrent call opened it first, that one is reloaded. A closed latest period is unexpected: closing a
   * period opens the next one in the same write, so after a close the latest period is the new open one.
   */
  async openFor(group: Group): Promise<Result<BillingPeriod>> {
    const current = await this.repository.findCurrentOfGroup(group);
    if ("error" in current) {
      return current;
    }
    if (current.data) {
      return this.openOrUnexpected(current.data);
    }

    const period = BillingPeriod.open({
      id: this.newId(),
      groupId: group.id,
      participants: group.members.map((member) => member.userId),
      now: this.clock(),
    });
    const opened = await this.repository.open(period);
    if ("error" in opened) {
      return opened;
    }
    if (opened.data === "opened") {
      return { data: period };
    }

    const reloaded = await this.repository.findCurrentOfGroup(group);
    if ("error" in reloaded) {
      return reloaded;
    }
    return reloaded.data
      ? this.openOrUnexpected(reloaded.data)
      : billingPeriodError("unexpected", { groupId: group.id });
  }

  /**
   * Adds an expense paid by `payerId` to the group's open period. Validates the title, then the amount;
   * the period judges the payer and the date. A save that lost a race is retried once on the reloaded
   * period with the same expense id, so a period closed meanwhile refuses it.
   */
  async addExpense(input: {
    group: Group;
    payerId: string;
    title: string;
    amount: string;
    purchasedOn: string;
  }): Promise<Result<{ expenseId: string }>> {
    const title = ExpenseTitle.create(input.title);
    if ("error" in title) {
      return title;
    }
    const amount = Money.parse(input.amount);
    if ("error" in amount) {
      return amount;
    }
    const command = {
      id: this.newId(),
      payerId: input.payerId,
      title: title.data,
      amount: amount.data,
      purchasedOn: input.purchasedOn,
      now: this.clock(),
    };

    const added = await this.change(input.group, (period) => period.addExpense(command));
    return "error" in added ? added : { data: { expenseId: command.id } };
  }

  /**
   * Changes `userId`'s own expense in the group's open period. Validates the title, then the amount; the
   * period judges the expense, its author and the date. Retried like `addExpense` on a lost race.
   */
  async editExpense(input: {
    group: Group;
    userId: string;
    expenseId: string;
    title: string;
    amount: string;
    purchasedOn: string;
  }): Promise<Result<{ expenseId: string }>> {
    const title = ExpenseTitle.create(input.title);
    if ("error" in title) {
      return title;
    }
    const amount = Money.parse(input.amount);
    if ("error" in amount) {
      return amount;
    }
    const now = this.clock();

    const edited = await this.change(input.group, (period) =>
      period.editExpense({
        expenseId: input.expenseId,
        userId: input.userId,
        title: title.data,
        amount: amount.data,
        purchasedOn: input.purchasedOn,
        now,
      }),
    );
    return "error" in edited ? edited : { data: { expenseId: input.expenseId } };
  }

  /** Deletes `userId`'s own expense from the group's open period, retried like `addExpense` on a lost race. */
  async deleteExpense(input: { group: Group; userId: string; expenseId: string }): Promise<Result<void>> {
    return this.change(input.group, (period) =>
      period.removeExpense({ expenseId: input.expenseId, userId: input.userId }),
    );
  }

  /**
   * Records a payment `senderId` made to `recipientId`. `paymentId` is the id the form carried, so a repeated
   * submit or a retry after a lost race records it once; the retry judges the amount against the period as it
   * is then, so a debt that shrank meanwhile refuses it.
   */
  async sendPayment(input: {
    group: Group;
    senderId: string;
    recipientId: string;
    paymentId: string;
    amount: string;
  }): Promise<Result<void>> {
    if (!UUID.test(input.paymentId)) {
      return billingPeriodError("unexpected", { groupId: input.group.id });
    }
    const amount = Money.parse(input.amount);
    if ("error" in amount) {
      return amount;
    }
    const command = {
      id: input.paymentId,
      senderId: input.senderId,
      recipientId: input.recipientId,
      amount: amount.data,
      now: this.clock(),
    };
    const sent = await this.change(input.group, (period) => period.sendPayment(command));
    return "error" in sent ? sent : { data: undefined };
  }

  /** Withdraws `userId`'s own unconfirmed payment, retried like `addExpense` on a lost race. */
  async withdrawPayment(input: { group: Group; userId: string; paymentId: string }): Promise<Result<void>> {
    return this.change(input.group, (period) =>
      period.withdrawPayment({ paymentId: input.paymentId, userId: input.userId }),
    );
  }

  /**
   * The recipient `userId` confirms a payment sent to them, retried like `addExpense` on a lost race. The retry
   * judges the payment as it is then: withdrawn meanwhile gives `payment_not_found`, decided meanwhile gives a
   * success (the same decision) or `payment_not_pending`.
   */
  async confirmPayment(input: { group: Group; userId: string; paymentId: string }): Promise<Result<void>> {
    const now = this.clock();
    return this.change(input.group, (period) =>
      period.confirmPayment({ paymentId: input.paymentId, userId: input.userId, now }),
    );
  }

  /** The recipient `userId` rejects a payment sent to them; retried and judged like `confirmPayment`. */
  async rejectPayment(input: { group: Group; userId: string; paymentId: string }): Promise<Result<void>> {
    const now = this.clock();
    return this.change(input.group, (period) =>
      period.rejectPayment({ paymentId: input.paymentId, userId: input.userId, now }),
    );
  }

  /** The open period and one of its expenses, when `userId` may change it (for the edit page). */
  async getEditableExpense(input: {
    group: Group;
    userId: string;
    expenseId: string;
  }): Promise<Result<{ period: BillingPeriod; expense: Expense }>> {
    const period = await this.openFor(input.group);
    if ("error" in period) {
      return period;
    }
    const expense = period.data.editableExpense(input.expenseId, input.userId);
    return "error" in expense ? expense : { data: { period: period.data, expense: expense.data } };
  }

  /**
   * The host `userId` closes the group's open period `periodId` (the id the form carried) and opens the next one
   * in the same write. The clock is read once, and the host is the group's. Idempotent per period: when the open
   * period is no longer `periodId`, the close already happened and the result is a success without a write. That
   * also holds for an id this group never had (a hand-built POST): it is a success without a write too, before
   * the host is checked, and leaks nothing, because a non-host gets `not_group_host` only for the real open id,
   * which the page shows to the host alone. A close that lost a race is retried once on the reloaded period under the same checks; a second lost race gives
   * `period_changed`.
   */
  async closePeriod(input: { group: Group; userId: string; periodId: string }): Promise<Result<void>> {
    const now = this.clock();
    const attempt = (loaded: Result<BillingPeriod>) =>
      this.closeAndStore(loaded, { hostId: input.group.hostId, userId: input.userId, periodId: input.periodId, now });

    const first = await attempt(await this.openFor(input.group));
    if (first !== "conflict") {
      return first;
    }
    const retry = await attempt(await this.reload(input.group));
    if (retry !== "conflict") {
      return retry;
    }
    return billingPeriodError("period_changed", { groupId: input.group.id });
  }

  /** The open period with its expenses newest first, its opening debts and the balances of its participants. */
  async summarizeOpen(group: Group): Promise<
    Result<{
      period: BillingPeriod;
      expenses: readonly Expense[];
      /** Expenses plus every payment not withdrawn: what the page shows. */
      balances: PeriodBalances;
      /** Expenses plus confirmed payments only: what rules (confirming, closing) judge. */
      postedBalances: PeriodBalances;
      payments: readonly Payment[];
      /** The debts carried over from the previous period. */
      openingDebts: readonly OpeningDebt[];
    }>
  > {
    const period = await this.openFor(group);
    if ("error" in period) {
      return period;
    }
    return {
      data: {
        period: period.data,
        expenses: period.data.expensesNewestFirst(),
        balances: period.data.pendingBalances(),
        postedBalances: period.data.postedBalances(),
        payments: period.data.paymentsNewestFirst(),
        openingDebts: period.data.openingDebts,
      },
    };
  }

  /** The open period's month of every group the signed-in user belongs to, by group id. */
  async openMonthsOf(): Promise<Result<Map<string, BillingMonth>>> {
    const result = await this.repository.listOpenMonthsOfCurrentUser();
    if ("error" in result) {
      return result;
    }
    return { data: new Map(result.data.map((row) => [row.groupId, row.month])) };
  }

  // Runs a command on the open period and saves it; a save that lost a race is retried once on the reloaded
  // period (closed or not, so the aggregate decides whether the command still applies). After a close the
  // reloaded period is the new open one, so a retry lands there: a decision or withdrawal of a moved payment
  // applies to it, a send is capped by its pending debt (carried debts included), an edit or delete of an
  // expense of the closed period gives `expense_not_found` and an add dated in the old month
  // `invalid_purchase_date`.
  private async change<T>(group: Group, command: (period: BillingPeriod) => Result<T>): Promise<Result<T>> {
    const first = await this.runAndSave(await this.openFor(group), command);
    if (first !== "conflict") {
      return first;
    }
    const retry = await this.runAndSave(await this.reload(group), command);
    if (retry !== "conflict") {
      return retry;
    }
    return billingPeriodError("period_changed", { groupId: group.id });
  }

  private async runAndSave<T>(
    loaded: Result<BillingPeriod>,
    command: (period: BillingPeriod) => Result<T>,
  ): Promise<Result<T> | "conflict"> {
    if ("error" in loaded) {
      return loaded;
    }
    const result = command(loaded.data);
    if ("error" in result) {
      return result;
    }
    const saved = await this.repository.save(loaded.data);
    if ("error" in saved) {
      return saved;
    }
    return saved.data === "saved" ? result : "conflict";
  }

  // The latest period as stored now, closed or not, so the aggregate decides whether the command still applies.
  // After a close it is the new open period, which the close stored in the same write.
  private async reload(group: Group): Promise<Result<BillingPeriod>> {
    const reloaded = await this.repository.findCurrentOfGroup(group);
    if ("error" in reloaded) {
      return reloaded;
    }
    return reloaded.data ? { data: reloaded.data } : billingPeriodError("unexpected", { groupId: group.id });
  }

  // Closes the loaded period when it is still `periodId` and stores the close; any other loaded period means the
  // close already happened.
  private async closeAndStore(
    loaded: Result<BillingPeriod>,
    input: { hostId: string; userId: string; periodId: string; now: Date },
  ): Promise<Result<void> | "conflict"> {
    if ("error" in loaded) {
      return loaded;
    }
    const period = loaded.data;
    if (period.id !== input.periodId) {
      return { data: undefined };
    }
    const next = period.close({
      userId: input.userId,
      hostId: input.hostId,
      nextPeriodId: this.newId(),
      now: input.now,
    });
    if ("error" in next) {
      return next;
    }
    const closed = await this.repository.close(period, next.data);
    if ("error" in closed) {
      return closed;
    }
    return closed.data === "closed" ? { data: undefined } : "conflict";
  }

  private openOrUnexpected(period: BillingPeriod): Result<BillingPeriod> {
    return period.isOpen()
      ? { data: period }
      : billingPeriodError("unexpected", { groupId: period.groupId, periodId: period.id });
  }
}
