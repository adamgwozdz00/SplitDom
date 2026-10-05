import { describe, expect, it } from "vitest";
import { aGroup, anExpense, FakeExpenseRepository, HOST_ID, memberId } from "@/lib/expenses/__tests__/expenses.harness";
import { expenseError } from "@/lib/expenses/expense-error.messages";
import { ExpenseService } from "@/lib/expenses/expense.service";

const NOW = new Date("2026-10-15T09:15:30.123Z");
const B = memberId(1);

function serviceWith(repository: FakeExpenseRepository, ids: string[] = ["expense-1"]): ExpenseService {
  const remaining = [...ids];
  return new ExpenseService(
    repository,
    () => {
      const id = remaining.shift();
      if (id === undefined) {
        throw new Error("No more test ids");
      }
      return id;
    },
    () => NOW,
  );
}

const valid = { title: "Czynsz", amount: "400", purchasedOn: "2026-10-15" };

describe("ExpenseService.add", () => {
  it("stores one expense built from the injected id and clock", async () => {
    const repository = new FakeExpenseRepository();
    const group = aGroup({ memberCount: 2 });

    const result = await serviceWith(repository).add({ group, payerId: B, ...valid, title: "  Czynsz " });

    expect(result).toEqual({ data: { expenseId: "expense-1" } });
    expect(repository.addCalls).toHaveLength(1);
    expect(repository.addCalls[0]?.toSnapshot()).toEqual({
      id: "expense-1",
      groupId: group.id,
      periodId: group.openPeriod.id,
      payerId: B,
      title: "Czynsz",
      amount: 40000,
      purchasedOn: "2026-10-15",
      createdAt: "2026-10-15T09:15:30.123Z",
      shares: [
        { userId: HOST_ID, amount: 20000 },
        { userId: B, amount: 20000 },
      ],
    });
  });

  it("validates the title first", async () => {
    const repository = new FakeExpenseRepository();

    const result = await serviceWith(repository).add({
      group: aGroup(),
      payerId: HOST_ID,
      title: " ",
      amount: "abc",
      purchasedOn: "nope",
    });

    expect("error" in result && result.error.code).toBe("invalid_expense_title");
    expect(repository.addCalls).toHaveLength(0);
  });

  it("validates the amount before the date", async () => {
    const repository = new FakeExpenseRepository();

    const result = await serviceWith(repository).add({
      group: aGroup(),
      payerId: HOST_ID,
      title: "Czynsz",
      amount: "0",
      purchasedOn: "nope",
    });

    expect("error" in result && result.error.code).toBe("invalid_amount");
    expect(repository.addCalls).toHaveLength(0);
  });

  it("rejects an invalid date without touching the repository", async () => {
    const repository = new FakeExpenseRepository();

    const result = await serviceWith(repository).add({
      group: aGroup(),
      payerId: HOST_ID,
      ...valid,
      purchasedOn: "2026-10-16",
    });

    expect("error" in result && result.error.code).toBe("invalid_purchase_date");
    expect(repository.addCalls).toHaveLength(0);
  });

  it("judges the date against the group's open period month and the injected clock", async () => {
    const repository = new FakeExpenseRepository();

    const result = await serviceWith(repository).add({
      group: aGroup(),
      payerId: HOST_ID,
      ...valid,
      purchasedOn: "2026-09-30",
    });

    expect("error" in result && result.error.code).toBe("invalid_purchase_date");
  });

  it("reports a payer who is not a member as group_not_found", async () => {
    const repository = new FakeExpenseRepository();

    const result = await serviceWith(repository).add({ group: aGroup(), payerId: "stranger", ...valid });

    expect("error" in result && result.error.code).toBe("group_not_found");
    expect(repository.addCalls).toHaveLength(0);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeExpenseRepository();
    const failure = expenseError("unexpected", { dbCode: "23503" });
    repository.failure = failure;

    expect(await serviceWith(repository).add({ group: aGroup(), payerId: HOST_ID, ...valid })).toBe(failure);
  });
});

describe("ExpenseService.summarizeOpenPeriod", () => {
  it("lists the open period of the group", async () => {
    const group = aGroup();
    const repository = new FakeExpenseRepository();

    await serviceWith(repository).summarizeOpenPeriod(group);

    expect(repository.listCalls).toEqual([{ groupId: group.id, periodId: group.openPeriod.id }]);
  });

  it("sorts expenses by purchase date, then creation time, newest first", async () => {
    const group = aGroup();
    const older = anExpense({ id: "older", group, purchasedOn: "2026-10-03" });
    const sameDayEarly = anExpense({
      id: "same-early",
      group,
      purchasedOn: "2026-10-10",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    const sameDayLate = anExpense({
      id: "same-late",
      group,
      purchasedOn: "2026-10-10",
      now: new Date("2026-10-10T20:00:00Z"),
    });
    const newest = anExpense({ id: "newest", group, purchasedOn: "2026-10-12" });
    const repository = new FakeExpenseRepository([older, sameDayEarly, newest, sameDayLate]);

    const result = await serviceWith(repository).summarizeOpenPeriod(group);

    expect("data" in result && result.data.expenses.map((expense) => expense.id)).toEqual([
      "newest",
      "same-late",
      "same-early",
      "older",
    ]);
  });

  it("computes balances over the group's members in join order", async () => {
    const group = aGroup({ memberCount: 3 });
    const repository = new FakeExpenseRepository([anExpense({ group, payerId: B, grosze: 30000 })]);

    const result = await serviceWith(repository).summarizeOpenPeriod(group);

    expect("data" in result && result.data.balances.members.map((m) => [m.userId, m.balance.grosze])).toEqual([
      [HOST_ID, -10000],
      [B, 20000],
      [memberId(2), -10000],
    ]);
  });

  it("returns zero balances for a period without expenses", async () => {
    const result = await serviceWith(new FakeExpenseRepository()).summarizeOpenPeriod(aGroup());

    expect("data" in result && result.data.expenses).toEqual([]);
    expect("data" in result && result.data.balances.debts).toEqual([]);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeExpenseRepository();
    const failure = expenseError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).summarizeOpenPeriod(aGroup())).toBe(failure);
  });
});
