import type { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { Expense } from "@/lib/billing-periods/expense.entity";
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
   * period opens the next one in the same write.
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

  /** The open period with its expenses newest first and the balances of its participants. */
  async summarizeOpen(group: Group): Promise<
    Result<{
      period: BillingPeriod;
      expenses: readonly Expense[];
      /** Expenses plus every payment not withdrawn: what the page shows. */
      balances: PeriodBalances;
      /** Expenses plus confirmed payments only: what rules (confirming, closing) judge. */
      postedBalances: PeriodBalances;
      payments: readonly Payment[];
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
  // period (closed or not, so the aggregate decides whether the command still applies).
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
  private async reload(group: Group): Promise<Result<BillingPeriod>> {
    const reloaded = await this.repository.findCurrentOfGroup(group);
    if ("error" in reloaded) {
      return reloaded;
    }
    return reloaded.data ? { data: reloaded.data } : billingPeriodError("unexpected", { groupId: group.id });
  }

  private openOrUnexpected(period: BillingPeriod): Result<BillingPeriod> {
    return period.isOpen()
      ? { data: period }
      : billingPeriodError("unexpected", { groupId: period.groupId, periodId: period.id });
  }
}
