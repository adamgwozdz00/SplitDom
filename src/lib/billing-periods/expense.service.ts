import { Expense } from "@/lib/billing-periods/expense.aggregate";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { ExpenseRepository, Result } from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

/**
 * The only entry point to the Expense aggregate: it parses raw form input into value objects, stores
 * expenses through the repository and loads the open period's summary. The clock and id generator are
 * injected so tests are deterministic.
 */
export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly newId: () => string,
    private readonly clock: () => Date,
  ) {}

  /** Adds an expense paid by `payerId` to the group's open period. Validates title, then amount, then date. */
  async add(input: {
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
    const now = this.clock();
    const purchasedOn = PurchaseDate.create(input.purchasedOn, { month: input.group.openPeriod.month, now });
    if ("error" in purchasedOn) {
      return purchasedOn;
    }

    const expense = Expense.add({
      id: this.newId(),
      group: input.group,
      payerId: input.payerId,
      title: title.data,
      amount: amount.data,
      purchasedOn: purchasedOn.data,
      now,
    });
    if ("error" in expense) {
      return expense;
    }

    const saved = await this.repository.add(expense.data);
    if ("error" in saved) {
      return saved;
    }
    return { data: { expenseId: expense.data.id } };
  }

  /** The open period's expenses, newest first, and the balances of the group's members. */
  async summarizeOpenPeriod(group: Group): Promise<Result<{ expenses: Expense[]; balances: PeriodBalances }>> {
    const result = await this.repository.listForPeriod(group.id, group.openPeriod.id);
    if ("error" in result) {
      return result;
    }
    const expenses = [...result.data].sort(
      (a, b) => b.purchasedOn.value.localeCompare(a.purchasedOn.value) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const balances = PeriodBalances.of({ memberIds: group.members.map((member) => member.userId), expenses });
    return { data: { expenses, balances } };
  }
}
