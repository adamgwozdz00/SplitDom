import { describe, expect, it } from "vitest";
import {
  aGroup,
  anOctoberPeriod,
  FakeBillingPeriodRepository,
  GROUP_ID,
  HOST_ID,
  memberId,
  PERIOD_ID,
} from "@/lib/billing-periods/__tests__/billing-periods.harness";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import { BillingPeriodService } from "@/lib/billing-periods/billing-period.service";

const NOW = new Date("2026-10-15T09:15:30.123Z");
const B = memberId(1);

function serviceWith(
  repository: FakeBillingPeriodRepository,
  options: { ids?: string[]; now?: Date } = {},
): BillingPeriodService {
  const remaining = [...(options.ids ?? ["expense-1"])];
  return new BillingPeriodService(
    repository,
    () => {
      const id = remaining.shift();
      if (id === undefined) {
        throw new Error("No more test ids");
      }
      return id;
    },
    () => options.now ?? NOW,
  );
}

const valid = { title: "Czynsz", amount: "400", purchasedOn: "2026-10-15" };

describe("BillingPeriodService.openFor", () => {
  it("opens and stores a first period for the clock's Warsaw month when the group has none", async () => {
    const repository = new FakeBillingPeriodRepository();
    // 23:30 UTC on 31 October is already November in Warsaw.
    const now = new Date("2026-10-31T23:30:00.000Z");

    const result = await serviceWith(repository, { ids: ["period-1"], now }).openFor(aGroup({ memberCount: 3 }));

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect(result.data.id).toBe("period-1");
    expect(result.data.participants).toEqual([HOST_ID, B, memberId(2)]);
    expect(repository.openCalls).toEqual([result.data]);
    expect(repository.stored(GROUP_ID)).toEqual({
      id: "period-1",
      groupId: GROUP_ID,
      month: "2026-11-01",
      openedAt: "2026-10-31T23:30:00.000Z",
      closedAt: null,
      version: 0,
      expenses: [],
    });
  });

  it("returns the existing open period without writing", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod({ version: 3 })]);

    const result = await serviceWith(repository, { ids: [] }).openFor(aGroup());

    expect("data" in result && [result.data.id, result.data.version]).toEqual([PERIOD_ID, 3]);
    expect(repository.openCalls).toHaveLength(0);
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("reports a closed latest period as unexpected", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod({ closedAt: "2026-10-31T20:00:00.000Z" })]);

    const result = await serviceWith(repository, { ids: [] }).openFor(aGroup());

    expect("error" in result && result.error.code).toBe("unexpected");
    expect(repository.openCalls).toHaveLength(0);
  });

  it("reloads the period a concurrent call opened first", async () => {
    const repository = new FakeBillingPeriodRepository();
    repository.openConflicts = 1;
    repository.onConflict = () => {
      repository.put(anOctoberPeriod({ id: "theirs" }));
    };

    const result = await serviceWith(repository, { ids: ["mine"] }).openFor(aGroup());

    expect("data" in result && result.data.id).toBe("theirs");
    expect(repository.openCalls).toHaveLength(1);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeBillingPeriodRepository();
    const failure = billingPeriodError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).openFor(aGroup())).toBe(failure);
  });
});

describe("BillingPeriodService.addExpense", () => {
  it("validates the title first, without touching the repository", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod()]);

    const result = await serviceWith(repository).addExpense({
      group: aGroup(),
      payerId: HOST_ID,
      title: " ",
      amount: "abc",
      purchasedOn: "nope",
    });

    expect("error" in result && result.error.code).toBe("invalid_expense_title");
    expect(repository.findCalls).toHaveLength(0);
  });

  it("validates the amount next, without touching the repository", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod()]);

    const result = await serviceWith(repository).addExpense({
      group: aGroup(),
      payerId: HOST_ID,
      title: "Czynsz",
      amount: "0",
      purchasedOn: "nope",
    });

    expect("error" in result && result.error.code).toBe("invalid_amount");
    expect(repository.findCalls).toHaveLength(0);
  });

  it("saves exactly the new expense, built from the injected id and clock", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod({ group, expenses: [{ id: "earlier" }] })]);

    const result = await serviceWith(repository).addExpense({ group, payerId: B, ...valid, title: "  Czynsz " });

    expect(result).toEqual({ data: { expenseId: "expense-1" } });
    expect(repository.saveCalls).toHaveLength(1);
    expect(repository.saveCalls[0]?.newExpenses().map((expense) => expense.toSnapshot())).toEqual([
      {
        id: "expense-1",
        payerId: B,
        title: "Czynsz",
        amount: 40000,
        purchasedOn: "2026-10-15",
        createdAt: "2026-10-15T09:15:30.123Z",
        shares: [
          { userId: HOST_ID, amount: 20000 },
          { userId: B, amount: 20000 },
        ],
      },
    ]);
    expect(repository.stored(group.id)?.expenses.map((expense) => expense.id)).toEqual(["earlier", "expense-1"]);
    expect(repository.stored(group.id)?.version).toBe(1);
  });

  it("leaves the date to the period and saves nothing when it refuses it", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod()]);

    const result = await serviceWith(repository).addExpense({
      group: aGroup(),
      payerId: HOST_ID,
      ...valid,
      purchasedOn: "2026-10-16",
    });

    expect("error" in result && result.error.code).toBe("invalid_purchase_date");
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("retries once on a conflict, with the same expense id, on top of the concurrent write", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod({ group })]);
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      repository.put(anOctoberPeriod({ group, expenses: [{ id: "theirs", payerId: B }], version: 1 }));
    };

    const result = await serviceWith(repository).addExpense({ group, payerId: HOST_ID, ...valid });

    expect(result).toEqual({ data: { expenseId: "expense-1" } });
    expect(repository.saveCalls).toHaveLength(2);
    expect(repository.saveCalls[1]?.newExpenses().map((expense) => expense.id)).toEqual(["expense-1"]);
    expect(repository.stored(group.id)?.expenses.map((expense) => expense.id)).toEqual(["theirs", "expense-1"]);
    expect(repository.stored(group.id)?.version).toBe(2);
  });

  it("gives up with period_changed after a second conflict", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod()]);
    repository.saveConflicts = 2;

    const result = await serviceWith(repository).addExpense({ group: aGroup(), payerId: HOST_ID, ...valid });

    expect(result).toEqual(billingPeriodError("period_changed", { groupId: GROUP_ID }));
    expect("error" in result && result.error.message).toBe("Someone else just changed this billing period, try again");
    expect(repository.saveCalls).toHaveLength(2);
  });

  it("reports billing_period_closed when the period is closed by the time it is reloaded", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod({ group })]);
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      repository.put(anOctoberPeriod({ group, version: 1, closedAt: "2026-10-15T09:00:00.000Z" }));
    };

    const result = await serviceWith(repository).addExpense({ group, payerId: HOST_ID, ...valid });

    expect("error" in result && result.error.code).toBe("billing_period_closed");
    expect(repository.saveCalls).toHaveLength(1);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeBillingPeriodRepository([anOctoberPeriod()]);
    const failure = billingPeriodError("unexpected", { dbCode: "23503" });
    repository.failure = failure;

    expect(await serviceWith(repository).addExpense({ group: aGroup(), payerId: HOST_ID, ...valid })).toBe(failure);
  });
});

describe("BillingPeriodService.summarizeOpen", () => {
  it("sorts expenses by purchase date, then creation time, newest first", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([
      anOctoberPeriod({
        group,
        expenses: [
          { id: "older", purchasedOn: "2026-10-03" },
          { id: "same-early", purchasedOn: "2026-10-10", now: new Date("2026-10-10T08:00:00Z") },
          { id: "newest", purchasedOn: "2026-10-12", now: new Date("2026-10-12T12:00:00Z") },
          { id: "same-late", purchasedOn: "2026-10-10", now: new Date("2026-10-10T20:00:00Z") },
        ],
      }),
    ]);

    const result = await serviceWith(repository).summarizeOpen(group);

    expect("data" in result && result.data.period.id).toBe(PERIOD_ID);
    expect("data" in result && result.data.expenses.map((expense) => expense.id)).toEqual([
      "newest",
      "same-late",
      "same-early",
      "older",
    ]);
  });

  it("computes balances over the group's members in join order", async () => {
    const group = aGroup({ memberCount: 3 });
    const repository = new FakeBillingPeriodRepository([
      anOctoberPeriod({ group, expenses: [{ id: "e-1", payerId: B, grosze: 30000 }] }),
    ]);

    const result = await serviceWith(repository).summarizeOpen(group);

    expect("data" in result && result.data.balances.members.map((m) => [m.userId, m.balance.grosze])).toEqual([
      [HOST_ID, -10000],
      [B, 20000],
      [memberId(2), -10000],
    ]);
  });

  it("opens a first period and returns zero balances for a group without one", async () => {
    const repository = new FakeBillingPeriodRepository();

    const result = await serviceWith(repository, { ids: ["period-1"] }).summarizeOpen(aGroup());

    expect("data" in result && result.data.period.id).toBe("period-1");
    expect("data" in result && result.data.expenses).toEqual([]);
    expect("data" in result && result.data.balances.debts).toEqual([]);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeBillingPeriodRepository();
    const failure = billingPeriodError("unexpected", { dbCode: "XX000" });
    repository.failure = failure;

    expect(await serviceWith(repository).summarizeOpen(aGroup())).toBe(failure);
  });
});

describe("BillingPeriodService.openMonthsOf", () => {
  it("maps each group with an open period to its month", async () => {
    const other = aGroup({ id: "other-group" });
    const closed = aGroup({ id: "closed-group" });
    const repository = new FakeBillingPeriodRepository([
      anOctoberPeriod(),
      anOctoberPeriod({ group: other, id: "other-period" }),
      anOctoberPeriod({ group: closed, id: "closed-period", closedAt: "2026-10-31T20:00:00.000Z" }),
    ]);

    const result = await serviceWith(repository).openMonthsOf();

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect([...result.data].map(([groupId, month]) => [groupId, month.toDate()])).toEqual([
      [GROUP_ID, "2026-10-01"],
      ["other-group", "2026-10-01"],
    ]);
  });

  it("passes a repository error through unchanged", async () => {
    const repository = new FakeBillingPeriodRepository();
    const failure = billingPeriodError("not_authenticated");
    repository.failure = failure;

    expect(await serviceWith(repository).openMonthsOf()).toBe(failure);
  });
});
