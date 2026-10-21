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
      payments: [],
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

const edited = { title: "Prąd", amount: "90", purchasedOn: "2026-10-12" };

function storedWith(group = aGroup(), version = 0) {
  return anOctoberPeriod({ group, expenses: [{ id: "mine", payerId: HOST_ID, grosze: 40000 }], version });
}

describe("BillingPeriodService.editExpense", () => {
  it("validates the title, then the amount, without touching the repository", async () => {
    const repository = new FakeBillingPeriodRepository([storedWith()]);
    const service = serviceWith(repository, { ids: [] });
    const base = { group: aGroup(), userId: HOST_ID, expenseId: "mine" };

    const badTitle = await service.editExpense({ ...base, ...edited, title: " ", amount: "abc" });
    const badAmount = await service.editExpense({ ...base, ...edited, amount: "0" });

    expect("error" in badTitle && badTitle.error.code).toBe("invalid_expense_title");
    expect("error" in badAmount && badAmount.error.code).toBe("invalid_amount");
    expect(repository.findCalls).toHaveLength(0);
  });

  it("saves exactly the changed expense and bumps the version", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).editExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
      ...edited,
    });

    expect(result).toEqual({ data: { expenseId: "mine" } });
    expect(repository.saveCalls).toHaveLength(1);
    expect(repository.saveCalls[0]?.changedExpenses().map((expense) => expense.id)).toEqual(["mine"]);
    expect(repository.saveCalls[0]?.newExpenses()).toEqual([]);
    const stored = repository.stored(group.id);
    expect(stored?.version).toBe(1);
    expect(stored?.expenses[0]).toMatchObject({ id: "mine", title: "Prąd", amount: 9000, purchasedOn: "2026-10-12" });
  });

  it("saves nothing when the period refuses a non-author", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).editExpense({
      group,
      userId: B,
      expenseId: "mine",
      ...edited,
    });

    expect("error" in result && result.error.code).toBe("not_expense_author");
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("retries once on a conflict, on top of the concurrent write", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      repository.put(
        anOctoberPeriod({
          group,
          expenses: [
            { id: "mine", payerId: HOST_ID, grosze: 40000 },
            { id: "theirs", payerId: B },
          ],
          version: 1,
        }),
      );
    };

    const result = await serviceWith(repository, { ids: [] }).editExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
      ...edited,
    });

    expect(result).toEqual({ data: { expenseId: "mine" } });
    expect(repository.saveCalls).toHaveLength(2);
    expect(repository.stored(group.id)?.expenses.map((expense) => expense.id)).toEqual(["mine", "theirs"]);
    expect(repository.stored(group.id)?.version).toBe(2);
  });

  it("gives up with period_changed after a second conflict", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);
    repository.saveConflicts = 2;

    const result = await serviceWith(repository, { ids: [] }).editExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
      ...edited,
    });

    expect(result).toEqual(billingPeriodError("period_changed", { groupId: GROUP_ID }));
  });

  it("reports billing_period_closed when the period is closed by the time it is reloaded", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      repository.put({ ...storedWith(group, 1), closedAt: "2026-10-15T09:00:00.000Z" });
    };

    const result = await serviceWith(repository, { ids: [] }).editExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
      ...edited,
    });

    // A closed latest period is reported by openFor/reload as unexpected only on the first load; here it is the reload.
    expect("error" in result && result.error.code).toBe("billing_period_closed");
    expect(repository.saveCalls).toHaveLength(1);
  });
});

describe("BillingPeriodService.deleteExpense", () => {
  it("deletes the author's expense and bumps the version", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).deleteExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
    });

    expect(result).toEqual({ data: undefined });
    expect(repository.saveCalls[0]?.removedExpenseIds()).toEqual(["mine"]);
    expect(repository.stored(group.id)?.expenses).toEqual([]);
    expect(repository.stored(group.id)?.version).toBe(1);
  });

  it.each([
    ["someone else's expense", B, "mine", "not_expense_author"],
    ["an unknown expense", HOST_ID, "nope", "expense_not_found"],
  ] as const)("refuses %s and saves nothing", async (_, userId, expenseId, expected) => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).deleteExpense({ group, userId, expenseId });

    expect("error" in result && result.error.code).toBe(expected);
    expect(repository.saveCalls).toHaveLength(0);
  });

  it("reports expense_not_found when a concurrent write already deleted it", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      repository.put(anOctoberPeriod({ group, version: 1 }));
    };

    const result = await serviceWith(repository, { ids: [] }).deleteExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
    });

    expect("error" in result && result.error.code).toBe("expense_not_found");
  });
});

describe("BillingPeriodService.getEditableExpense", () => {
  it("returns the period and the expense for its author", async () => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).getEditableExpense({
      group,
      userId: HOST_ID,
      expenseId: "mine",
    });

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect(result.data.expense.id).toBe("mine");
    expect(result.data.period.id).toBe(PERIOD_ID);
    expect(repository.saveCalls).toHaveLength(0);
  });

  it.each([
    ["someone else's expense", B, "mine", "not_expense_author"],
    ["an unknown expense", HOST_ID, "nope", "expense_not_found"],
  ] as const)("refuses %s", async (_, userId, expenseId, expected) => {
    const group = aGroup();
    const repository = new FakeBillingPeriodRepository([storedWith(group)]);

    const result = await serviceWith(repository, { ids: [] }).getEditableExpense({ group, userId, expenseId });

    expect("error" in result && result.error.code).toBe(expected);
  });
});

describe("BillingPeriodService payments", () => {
  const PAYMENT = "11111111-1111-4111-8111-aaaaaaaaaaaa";
  // B owes the host 200 zł after the host paid 400 zł.
  function repositoryWithDebt(): FakeBillingPeriodRepository {
    return new FakeBillingPeriodRepository([anOctoberPeriod({ expenses: [{ id: "e-1", grosze: 40000 }] })]);
  }

  const send = { group: aGroup(), senderId: B, recipientId: HOST_ID, paymentId: PAYMENT, amount: "200,00" };

  it("stores the payment and bumps the version", async () => {
    const repository = repositoryWithDebt();

    const result = await serviceWith(repository).sendPayment(send);

    expect(result).toEqual({ data: undefined });
    expect(repository.stored(GROUP_ID)).toMatchObject({
      version: 1,
      payments: [
        { id: PAYMENT, senderId: B, recipientId: HOST_ID, amount: 20000, sentAt: NOW.toISOString(), confirmedAt: null },
      ],
    });
  });

  it("rejects an invalid amount and a payment id that is not a UUID without touching the repository", async () => {
    const repository = repositoryWithDebt();
    const service = serviceWith(repository);

    expect(await service.sendPayment({ ...send, amount: "abc" })).toMatchObject({ error: { code: "invalid_amount" } });
    expect(await service.sendPayment({ ...send, paymentId: "not-a-uuid" })).toMatchObject({
      error: { code: "unexpected" },
    });
    expect(repository.saveCalls).toEqual([]);
  });

  it("refuses the creditor paying the debtor, and more than the debt", async () => {
    const repository = repositoryWithDebt();
    const service = serviceWith(repository);

    expect(await service.sendPayment({ ...send, senderId: HOST_ID, recipientId: B })).toMatchObject({
      error: { code: "no_debt_to_pay" },
    });
    expect(await service.sendPayment({ ...send, amount: "200,01" })).toMatchObject({
      error: { code: "payment_exceeds_debt" },
    });
    expect(repository.stored(GROUP_ID)?.payments).toEqual([]);
  });

  it("records a repeated submit with the same id once", async () => {
    const repository = repositoryWithDebt();
    const service = serviceWith(repository);

    await service.sendPayment({ ...send, amount: "100,00" });
    const again = await service.sendPayment({ ...send, amount: "100,00" });

    expect(again).toEqual({ data: undefined });
    expect(repository.stored(GROUP_ID)?.payments).toHaveLength(1);
  });

  it("retries a lost race on the reloaded period and records the payment once", async () => {
    const repository = repositoryWithDebt();
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      // Another expense lands first: the debt grows to 250 zł.
      repository.put(
        anOctoberPeriod({
          expenses: [
            { id: "e-1", grosze: 40000 },
            { id: "e-2", grosze: 10000 },
          ],
          version: 1,
        }),
      );
    };

    const result = await serviceWith(repository).sendPayment(send);

    expect(result).toEqual({ data: undefined });
    expect(repository.saveCalls).toHaveLength(2);
    expect(repository.stored(GROUP_ID)?.payments).toHaveLength(1);
  });

  it("refuses on the retry when a concurrent change made the payment larger than the debt", async () => {
    const repository = repositoryWithDebt();
    repository.saveConflicts = 1;
    repository.onConflict = () => {
      // The host's expense is deleted meanwhile: only 100 zł of debt is left.
      repository.put(anOctoberPeriod({ expenses: [{ id: "e-1", grosze: 20000 }], version: 1 }));
    };

    const result = await serviceWith(repository).sendPayment(send);

    expect(result).toMatchObject({ error: { code: "payment_exceeds_debt" } });
    expect(repository.stored(GROUP_ID)?.payments).toEqual([]);
  });

  it("answers period_changed after two lost races", async () => {
    const repository = repositoryWithDebt();
    repository.saveConflicts = 2;

    expect(await serviceWith(repository).sendPayment(send)).toMatchObject({ error: { code: "period_changed" } });
  });

  it("withdraws a stored payment, retried on a lost race, and reports an unknown one", async () => {
    const repository = repositoryWithDebt();
    await serviceWith(repository).sendPayment(send);
    repository.saveConflicts = 1;

    const result = await serviceWith(repository).withdrawPayment({ group: aGroup(), userId: B, paymentId: PAYMENT });

    expect(result).toEqual({ data: undefined });
    expect(repository.stored(GROUP_ID)?.payments).toEqual([]);
    expect(
      await serviceWith(repository).withdrawPayment({ group: aGroup(), userId: B, paymentId: PAYMENT }),
    ).toMatchObject({
      error: { code: "payment_not_found" },
    });
  });

  it("summarizes the open period with pending and posted balances and the payments newest first", async () => {
    const repository = repositoryWithDebt();
    await serviceWith(repository).sendPayment({ ...send, amount: "50,00" });

    const summary = await serviceWith(repository).summarizeOpen(aGroup());

    if ("error" in summary) {
      throw new Error(summary.error.code);
    }
    expect(summary.data.balances.debts.map((debt) => debt.amount.grosze)).toEqual([15000]);
    expect(summary.data.postedBalances.debts.map((debt) => debt.amount.grosze)).toEqual([20000]);
    expect(summary.data.payments.map((payment) => payment.id)).toEqual([PAYMENT]);
  });
});
