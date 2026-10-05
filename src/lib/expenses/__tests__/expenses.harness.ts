import { Expense } from "@/lib/expenses/expense.aggregate";
import { ExpenseTitle } from "@/lib/expenses/expense-title.value";
import { Money } from "@/lib/expenses/money.value";
import { PurchaseDate } from "@/lib/expenses/purchase-date.value";
import type { ExpenseError, ExpenseRepository, Result } from "@/lib/expenses/types";
import { Group, GroupName } from "@/lib/groups";

/** In-memory ExpenseRepository for unit tests. It lists the expenses of the requested period, like a repository scoped to "me". */
export class FakeExpenseRepository implements ExpenseRepository {
  readonly addCalls: Expense[] = [];
  readonly listCalls: { groupId: string; periodId: string }[] = [];
  /** When set, every call fails with this error. */
  failure: ExpenseError | null = null;

  constructor(private readonly expenses: Expense[] = []) {}

  add(expense: Expense): Promise<Result<void>> {
    this.addCalls.push(expense);
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    this.expenses.push(expense);
    return Promise.resolve({ data: undefined });
  }

  listForPeriod(groupId: string, periodId: string): Promise<Result<Expense[]>> {
    this.listCalls.push({ groupId, periodId });
    if (this.failure) {
      return Promise.resolve(this.failure);
    }
    return Promise.resolve({
      data: this.expenses.filter((expense) => expense.groupId === groupId && expense.periodId === periodId),
    });
  }
}

export const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The id of the n-th test member (0 is the host): "member-0" ... */
export function memberId(position: number): string {
  return position === 0 ? HOST_ID : `member-${position}`;
}

/**
 * A group hosted by member 0 with `memberCount` members who joined in order, built through the groups
 * module's public API. Its open period is October 2026.
 */
export function aGroup(overrides: { id?: string; memberCount?: number; now?: Date } = {}): Group {
  const name = GroupName.create("Mokotów");
  if ("error" in name) {
    throw new Error("Invalid test group name");
  }
  const created = Group.create({
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    name: name.data,
    hostId: HOST_ID,
    now: overrides.now ?? new Date("2026-10-01T08:00:00.000Z"),
    periodId: "22222222-2222-4222-8222-222222222222",
  });
  const snapshot = created.toSnapshot();
  const count = overrides.memberCount ?? 2;
  return Group.restore({
    ...snapshot,
    members: Array.from({ length: count }, (_, position) => ({
      userId: memberId(position),
      joinedAt: new Date(Date.parse(snapshot.createdAt) + position * 60_000).toISOString(),
      email: position === 0 ? null : `member-${position}@example.com`,
    })),
  });
}

export function money(grosze: number): Money {
  return Money.ofGrosze(grosze);
}

/** An expense paid by `payerId` (default: the host) in `group`, split through `Expense.add`. */
export function anExpense(
  input: {
    id?: string;
    group?: Group;
    payerId?: string;
    title?: string;
    grosze?: number;
    purchasedOn?: string;
    now?: Date;
  } = {},
): Expense {
  const title = ExpenseTitle.create(input.title ?? "Czynsz");
  if ("error" in title) {
    throw new Error("Invalid test expense title");
  }
  const result = Expense.add({
    id: input.id ?? "33333333-3333-4333-8333-333333333333",
    group: input.group ?? aGroup(),
    payerId: input.payerId ?? HOST_ID,
    title: title.data,
    amount: Money.ofGrosze(input.grosze ?? 40000),
    purchasedOn: PurchaseDate.fromStored(input.purchasedOn ?? "2026-10-10"),
    now: input.now ?? new Date("2026-10-10T12:00:00.000Z"),
  });
  if ("error" in result) {
    throw new Error(`Invalid test expense: ${result.error.code}`);
  }
  return result.data;
}
