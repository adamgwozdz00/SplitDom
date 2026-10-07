import type { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { Expense } from "@/lib/billing-periods/expense.entity";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import type { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import type { BillingPeriodRepository, Result } from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

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

    const first = await this.addAndSave(await this.openFor(input.group), command);
    if (first !== "conflict") {
      return first;
    }
    const retry = await this.addAndSave(await this.reload(input.group), command);
    if (retry !== "conflict") {
      return retry;
    }
    return billingPeriodError("period_changed", { groupId: input.group.id });
  }

  /** The open period with its expenses newest first and the balances of its participants. */
  async summarizeOpen(
    group: Group,
  ): Promise<Result<{ period: BillingPeriod; expenses: readonly Expense[]; balances: PeriodBalances }>> {
    const period = await this.openFor(group);
    if ("error" in period) {
      return period;
    }
    return {
      data: { period: period.data, expenses: period.data.expensesNewestFirst(), balances: period.data.balances() },
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

  private async addAndSave(
    loaded: Result<BillingPeriod>,
    command: Parameters<BillingPeriod["addExpense"]>[0],
  ): Promise<Result<{ expenseId: string }> | "conflict"> {
    if ("error" in loaded) {
      return loaded;
    }
    const added = loaded.data.addExpense(command);
    if ("error" in added) {
      return added;
    }
    const saved = await this.repository.save(loaded.data);
    if ("error" in saved) {
      return saved;
    }
    return saved.data === "saved" ? { data: { expenseId: command.id } } : "conflict";
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
