import { describe, expect, it } from "vitest";
import { BillingPeriod } from "@/lib/billing-periods/billing-period.aggregate";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import type { BillingPeriodSnapshot } from "@/lib/billing-periods/types";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const PERIOD_ID = "22222222-2222-4222-8222-222222222222";
const HOST = "host";
const MEMBER = "member";
const MID_OCTOBER = new Date("2026-10-15T12:00:00.000Z");

function title(raw = "Czynsz"): ExpenseTitle {
  const result = ExpenseTitle.create(raw);
  if ("error" in result) {
    throw new Error(`Invalid test title "${raw}"`);
  }
  return result.data;
}

function octoberPeriod(participants: readonly string[] = [HOST, MEMBER]): BillingPeriod {
  return BillingPeriod.open({
    id: PERIOD_ID,
    groupId: GROUP_ID,
    participants,
    now: new Date("2026-10-01T08:00:00.000Z"),
  });
}

function add(
  period: BillingPeriod,
  input: { id?: string; payerId?: string; grosze?: number; purchasedOn?: string; now?: Date } = {},
) {
  return period.addExpense({
    id: input.id ?? "e-1",
    payerId: input.payerId ?? HOST,
    title: title(),
    amount: Money.ofGrosze(input.grosze ?? 40000),
    purchasedOn: input.purchasedOn ?? "2026-10-10",
    now: input.now ?? MID_OCTOBER,
  });
}

describe("BillingPeriod.open", () => {
  it("opens an empty period for the Warsaw month of now", () => {
    // 23:30 UTC on 31 October is already November in Warsaw.
    const now = new Date("2026-10-31T23:30:00.000Z");
    const period = BillingPeriod.open({ id: PERIOD_ID, groupId: GROUP_ID, participants: [HOST], now });

    expect(period.month.toDate()).toBe("2026-11-01");
    expect(period.openedAt).toEqual(now);
    expect(period.closedAt).toBeNull();
    expect(period.isOpen()).toBe(true);
    expect(period.version).toBe(0);
    expect(period.expenses).toEqual([]);
  });
});

describe("BillingPeriod.addExpense", () => {
  it("splits 400 zł between two participants into 200 zł each and records the expense (US-01)", () => {
    const period = octoberPeriod();

    const result = add(period, { payerId: MEMBER, grosze: 40000 });

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect(result.data.shares.map((share) => [share.userId, share.amount.grosze])).toEqual([
      [HOST, 20000],
      [MEMBER, 20000],
    ]);
    expect(result.data.createdAt).toEqual(MID_OCTOBER);
    expect(period.expenses).toEqual([result.data]);
    expect(period.newExpenses()).toEqual([result.data]);
  });

  it("derives each participant's balance and the netted debt from its expenses", () => {
    const period = octoberPeriod();
    add(period, { id: "e-1", payerId: HOST, grosze: 40000 });
    add(period, { id: "e-2", payerId: MEMBER, grosze: 10000 });

    const balances = period.balances();

    expect(balances.members.map((member) => [member.userId, member.balance.grosze])).toEqual([
      [HOST, 15000],
      [MEMBER, -15000],
    ]);
    expect(balances.debts.map((debt) => [debt.debtorId, debt.creditorId, debt.amount.grosze])).toEqual([
      [MEMBER, HOST, 15000],
    ]);
  });
});

describe("BillingPeriod.addExpense refusals", () => {
  function closedPeriod(): BillingPeriod {
    const snapshot = octoberPeriod().toSnapshot();
    return BillingPeriod.restore({ ...snapshot, closedAt: "2026-11-02T08:00:00.000Z" }, [HOST, MEMBER]);
  }

  it.each([
    ["a closed period", closedPeriod, {}, "billing_period_closed"],
    ["a payer who is not a participant", octoberPeriod, { payerId: "stranger" }, "group_not_found"],
    ["a date in the future", octoberPeriod, { purchasedOn: "2026-10-16" }, "invalid_purchase_date"],
    ["a date outside the period month", octoberPeriod, { purchasedOn: "2026-09-30" }, "invalid_purchase_date"],
  ] as const)("refuses %s and records nothing", (_, build, input, code) => {
    const period = build();

    const result = add(period, input);

    expect("error" in result ? result.error.code : "added").toBe(code);
    expect(period.expenses).toEqual([]);
    expect(period.newExpenses()).toEqual([]);
  });

  it("checks that the period is open before the payer and the date", () => {
    const result = add(closedPeriod(), { payerId: "stranger", purchasedOn: "2026-09-30" });

    expect("error" in result ? result.error.code : "added").toBe("billing_period_closed");
  });

  it("checks the payer before the date", () => {
    const result = add(octoberPeriod(), { payerId: "stranger", purchasedOn: "2026-09-30" });

    expect("error" in result ? result.error.code : "added").toBe("group_not_found");
  });
});

describe("BillingPeriod queries", () => {
  it("offers purchase dates from the first of its month up to today", () => {
    expect(octoberPeriod().purchaseDateWindow(MID_OCTOBER)).toEqual({
      min: "2026-10-01",
      max: "2026-10-15",
      default: "2026-10-15",
    });
  });

  it("lists expenses newest first by purchase date, then by creation time", () => {
    const period = octoberPeriod();
    add(period, { id: "older-day", purchasedOn: "2026-10-03", now: new Date("2026-10-14T09:00:00.000Z") });
    add(period, { id: "same-day-early", purchasedOn: "2026-10-05", now: new Date("2026-10-14T10:00:00.000Z") });
    add(period, { id: "same-day-late", purchasedOn: "2026-10-05", now: new Date("2026-10-14T11:00:00.000Z") });

    expect(period.expensesNewestFirst().map((expense) => expense.id)).toEqual([
      "same-day-late",
      "same-day-early",
      "older-day",
    ]);
  });
});

describe("BillingPeriod.restore", () => {
  const snapshot: BillingPeriodSnapshot = {
    id: PERIOD_ID,
    groupId: GROUP_ID,
    month: "2026-10-01",
    openedAt: "2026-10-01T08:00:00.000Z",
    closedAt: null,
    version: 3,
    expenses: [
      {
        id: "e-1",
        payerId: HOST,
        title: "Czynsz",
        amount: 40000,
        purchasedOn: "2026-10-10",
        createdAt: "2026-10-10T12:00:00.000Z",
        shares: [
          { userId: HOST, amount: 20000 },
          { userId: MEMBER, amount: 20000 },
        ],
      },
    ],
    transfers: [],
  };

  it("round-trips a snapshot", () => {
    expect(BillingPeriod.restore(snapshot, [HOST, MEMBER]).toSnapshot()).toEqual(snapshot);
  });

  it("round-trips a period with an added expense, which then counts as stored", () => {
    const period = octoberPeriod();
    add(period, { id: "e-1" });

    const restored = BillingPeriod.restore(period.toSnapshot(), [HOST, MEMBER]);

    expect(restored.toSnapshot()).toEqual(period.toSnapshot());
    expect(restored.expenses).toHaveLength(1);
    expect(restored.newExpenses()).toEqual([]);
  });

  it("lists only the expenses added after it was restored as new", () => {
    const period = BillingPeriod.restore(snapshot, [HOST, MEMBER]);

    const added = add(period, { id: "e-2" });

    expect(period.expenses.map((expense) => expense.id)).toEqual(["e-1", "e-2"]);
    expect(period.newExpenses()).toEqual("data" in added ? [added.data] : []);
  });

  it.each([
    ["a malformed month", { month: "2026-10-15" }],
    ["an unparseable timestamp", { openedAt: "not a date" }],
    ["a close before the opening", { closedAt: "2026-09-30T08:00:00.000Z" }],
    ["an expense whose shares do not sum to its amount", { expenses: [{ ...snapshot.expenses[0], amount: 40001 }] }],
  ])("rejects %s", (_, override) => {
    expect(() => BillingPeriod.restore({ ...snapshot, ...override }, [HOST, MEMBER])).toThrow();
  });
});

function edit(
  period: BillingPeriod,
  input: { expenseId?: string; userId?: string; grosze?: number; purchasedOn?: string; titleText?: string } = {},
) {
  return period.editExpense({
    expenseId: input.expenseId ?? "e-1",
    userId: input.userId ?? HOST,
    title: title(input.titleText ?? "Prąd"),
    amount: Money.ofGrosze(input.grosze ?? 9000),
    purchasedOn: input.purchasedOn ?? "2026-10-12",
    now: MID_OCTOBER,
  });
}

function closedWithExpense(): BillingPeriod {
  const period = octoberPeriod();
  add(period, { id: "e-1" });
  return BillingPeriod.restore({ ...period.toSnapshot(), closedAt: "2026-11-02T08:00:00.000Z" }, [HOST, MEMBER]);
}

function code(result: { data: unknown } | { error: { code: string } }): string {
  return "error" in result ? result.error.code : "ok";
}

describe("BillingPeriod.editExpense", () => {
  it("changes title, amount and date, keeping id, payer and creation time, and re-splits the amount", () => {
    const period = octoberPeriod();
    add(period, { id: "e-1", payerId: HOST, grosze: 40000 });

    const result = edit(period, { grosze: 9000, purchasedOn: "2026-10-12", titleText: "Prąd" });

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect(result.data.toSnapshot()).toEqual({
      id: "e-1",
      payerId: HOST,
      title: "Prąd",
      amount: 9000,
      purchasedOn: "2026-10-12",
      createdAt: MID_OCTOBER.toISOString(),
      shares: [
        { userId: HOST, amount: 4500 },
        { userId: MEMBER, amount: 4500 },
      ],
    });
    expect(period.expenses).toEqual([result.data]);
  });

  it("splits the new amount between the original sharers only, the payer absorbing the remainder", () => {
    const stored = octoberPeriod();
    add(stored, { id: "e-1", payerId: HOST, grosze: 40000 });
    // "late" joined the group after the expense was added, so it holds no share of it.
    const period = BillingPeriod.restore(stored.toSnapshot(), [HOST, MEMBER, "late"]);

    const result = edit(period, { grosze: 10001 });

    if ("error" in result) {
      throw new Error(result.error.code);
    }
    expect(result.data.shares.map((share) => [share.userId, share.amount.grosze])).toEqual([
      [HOST, 5001],
      [MEMBER, 5000],
    ]);
    expect(period.balances().members.find((member) => member.userId === "late")?.balance.grosze).toBe(0);
  });

  it("reports a stored expense as changed, not new, and reflects it in the balances", () => {
    const stored = octoberPeriod();
    add(stored, { id: "e-1", payerId: HOST, grosze: 40000 });
    const period = BillingPeriod.restore(stored.toSnapshot(), [HOST, MEMBER]);

    edit(period, { grosze: 10000 });

    expect(period.changedExpenses().map((expense) => expense.id)).toEqual(["e-1"]);
    expect(period.newExpenses()).toEqual([]);
    expect(period.removedExpenseIds()).toEqual([]);
    expect(period.balances().members.map((member) => [member.userId, member.balance.grosze])).toEqual([
      [HOST, 5000],
      [MEMBER, -5000],
    ]);
  });

  it("changes an expense added since the period was loaded in place", () => {
    const period = octoberPeriod();
    add(period, { id: "e-1" });

    edit(period, { grosze: 2000 });

    expect(period.newExpenses().map((expense) => expense.amount.grosze)).toEqual([2000]);
    expect(period.changedExpenses()).toEqual([]);
  });

  it.each([
    ["a closed period", closedWithExpense, { expenseId: "e-1" }, "billing_period_closed"],
    ["an unknown expense", () => octoberPeriodWith("e-1"), { expenseId: "nope" }, "expense_not_found"],
    ["someone else's expense", () => octoberPeriodWith("e-1"), { userId: MEMBER }, "not_expense_author"],
    ["a date in the future", () => octoberPeriodWith("e-1"), { purchasedOn: "2026-10-16" }, "invalid_purchase_date"],
    [
      "a date outside the month",
      () => octoberPeriodWith("e-1"),
      { purchasedOn: "2026-09-30" },
      "invalid_purchase_date",
    ],
  ] as const)("refuses %s and changes nothing", (_, build, input, expected) => {
    const period = build();
    const before = period.toSnapshot();

    expect(code(edit(period, input))).toBe(expected);
    expect(period.toSnapshot()).toEqual(before);
    expect(period.changedExpenses()).toEqual([]);
  });

  it("checks the period, then the expense, then its author, then the date", () => {
    expect(code(edit(closedWithExpense(), { expenseId: "nope", userId: MEMBER, purchasedOn: "2026-09-30" }))).toBe(
      "billing_period_closed",
    );
    expect(code(edit(octoberPeriodWith("e-1"), { expenseId: "nope", userId: MEMBER, purchasedOn: "2026-09-30" }))).toBe(
      "expense_not_found",
    );
    expect(code(edit(octoberPeriodWith("e-1"), { userId: MEMBER, purchasedOn: "2026-09-30" }))).toBe(
      "not_expense_author",
    );
  });
});

function octoberPeriodWith(expenseId: string): BillingPeriod {
  const period = octoberPeriod();
  add(period, { id: expenseId });
  return period;
}

describe("BillingPeriod.removeExpense", () => {
  it("removes the author's expense and drops it from the balances", () => {
    const stored = octoberPeriodWith("e-1");
    const period = BillingPeriod.restore(stored.toSnapshot(), [HOST, MEMBER]);

    const result = period.removeExpense({ expenseId: "e-1", userId: HOST });

    expect(code(result)).toBe("ok");
    expect(period.expenses).toEqual([]);
    expect(period.removedExpenseIds()).toEqual(["e-1"]);
    expect(period.balances().debts).toEqual([]);
  });

  it("forgets an expense added since the period was loaded instead of reporting it removed", () => {
    const period = octoberPeriodWith("e-1");

    period.removeExpense({ expenseId: "e-1", userId: HOST });

    expect(period.newExpenses()).toEqual([]);
    expect(period.removedExpenseIds()).toEqual([]);
  });

  it.each([
    ["a closed period", closedWithExpense, { expenseId: "e-1", userId: HOST }, "billing_period_closed"],
    ["an unknown expense", () => octoberPeriodWith("e-1"), { expenseId: "nope", userId: HOST }, "expense_not_found"],
    [
      "someone else's expense",
      () => octoberPeriodWith("e-1"),
      { expenseId: "e-1", userId: MEMBER },
      "not_expense_author",
    ],
  ] as const)("refuses %s and removes nothing", (_, build, input, expected) => {
    const period = build();
    const before = period.toSnapshot();

    expect(code(period.removeExpense(input))).toBe(expected);
    expect(period.toSnapshot()).toEqual(before);
    expect(period.removedExpenseIds()).toEqual([]);
  });
});

describe("BillingPeriod.canEdit", () => {
  it("lets only the payer edit, and only while the period is open", () => {
    const open = octoberPeriodWith("e-1");
    const closed = closedWithExpense();

    expect(open.canEdit(open.expenses[0], HOST)).toBe(true);
    expect(open.canEdit(open.expenses[0], MEMBER)).toBe(false);
    expect(closed.canEdit(closed.expenses[0], HOST)).toBe(false);
  });
});

describe("BillingPeriod transfers", () => {
  // MEMBER owes HOST 200 zł after HOST pays 400 zł.
  function withDebt(): BillingPeriod {
    const period = octoberPeriod();
    add(period, { id: "e-1", payerId: HOST, grosze: 40000 });
    return period;
  }

  function mark(
    period: BillingPeriod,
    input: { id?: string; debtorId?: string; creditorId?: string; grosze?: number; now?: Date } = {},
  ) {
    return period.markTransferSent({
      id: input.id ?? "t-1",
      debtorId: input.debtorId ?? MEMBER,
      creditorId: input.creditorId ?? HOST,
      amount: Money.ofGrosze(input.grosze ?? 20000),
      now: input.now ?? MID_OCTOBER,
    });
  }

  function restoredWithMark(): BillingPeriod {
    const period = withDebt();
    mark(period);
    const stored = BillingPeriod.restore(period.toSnapshot(), [HOST, MEMBER]);
    return stored;
  }

  describe("markTransferSent", () => {
    it("records the posted amount, not the current debt", () => {
      const period = withDebt();

      const result = mark(period, { grosze: 15000 });

      expect(result).toMatchObject({ data: { debtorId: MEMBER, creditorId: HOST } });
      expect(period.sentTransferOf(MEMBER, HOST)?.amount.grosze).toBe(15000);
      expect(period.markedTransfers().map((transfer) => transfer.id)).toEqual(["t-1"]);
    });

    it("does not change the balances or the debts", () => {
      const period = withDebt();
      const before = period.balances();

      mark(period);

      expect(period.balances()).toEqual(before);
    });

    it("refuses a closed period", () => {
      const period = BillingPeriod.restore({ ...withDebt().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" }, [
        HOST,
        MEMBER,
      ]);

      expect(mark(period)).toMatchObject({ error: { code: "billing_period_closed" } });
    });

    it("refuses a debtor who is not a participant", () => {
      expect(mark(withDebt(), { debtorId: "stranger" })).toMatchObject({ error: { code: "group_not_found" } });
    });

    it("refuses the creditor marking for their debtor", () => {
      expect(mark(withDebt(), { debtorId: HOST, creditorId: MEMBER })).toMatchObject({
        error: { code: "no_debt_to_mark" },
      });
    });

    it("refuses a settled pair and marking oneself", () => {
      expect(mark(octoberPeriod())).toMatchObject({ error: { code: "no_debt_to_mark" } });
      expect(mark(withDebt(), { debtorId: MEMBER, creditorId: MEMBER })).toMatchObject({
        error: { code: "no_debt_to_mark" },
      });
    });

    it("replaces the pair's mark with a different amount, keeping its id", () => {
      const period = restoredWithMark();

      const result = mark(period, { id: "t-2", grosze: 25000, now: new Date("2026-10-16T12:00:00.000Z") });

      expect(result).toMatchObject({ data: { id: "t-1" } });
      expect(period.sentTransferOf(MEMBER, HOST)?.amount.grosze).toBe(25000);
      expect(period.markedTransfers().map((transfer) => transfer.id)).toEqual(["t-1"]);
    });

    it("leaves a repeated mark with the same amount untouched", () => {
      const period = restoredWithMark();

      mark(period, { id: "t-2", now: new Date("2026-10-17T12:00:00.000Z") });

      expect(period.markedTransfers()).toEqual([]);
      expect(period.sentTransferOf(MEMBER, HOST)?.toSnapshot().sentAt).toBe(MID_OCTOBER.toISOString());
    });
  });

  describe("undoTransferSent", () => {
    it("removes a loaded mark and lists it as unmarked", () => {
      const period = restoredWithMark();

      const result = period.undoTransferSent({ debtorId: MEMBER, creditorId: HOST });

      expect(result).toEqual({ data: undefined });
      expect(period.sentTransferOf(MEMBER, HOST)).toBeNull();
      expect(period.unmarkedTransferIds()).toEqual(["t-1"]);
    });

    it("drops a mark added since load without any pending write", () => {
      const period = withDebt();
      mark(period);

      period.undoTransferSent({ debtorId: MEMBER, creditorId: HOST });

      expect(period.markedTransfers()).toEqual([]);
      expect(period.unmarkedTransferIds()).toEqual([]);
    });

    it("reports a missing mark", () => {
      expect(withDebt().undoTransferSent({ debtorId: MEMBER, creditorId: HOST })).toMatchObject({
        error: { code: "transfer_not_found" },
      });
    });

    it("refuses a closed period", () => {
      const period = BillingPeriod.restore(
        { ...restoredWithMark().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" },
        [HOST, MEMBER],
      );

      expect(period.undoTransferSent({ debtorId: MEMBER, creditorId: HOST })).toMatchObject({
        error: { code: "billing_period_closed" },
      });
    });
  });

  describe("sentTransfersInvolving", () => {
    it("derives the state of a mark from the current debts", () => {
      const period = restoredWithMark();
      expect(period.sentTransfersInvolving(MEMBER)).toMatchObject([{ state: "current" }]);

      add(period, { id: "e-2", payerId: HOST, grosze: 10000 });
      expect(period.sentTransfersInvolving(MEMBER)).toMatchObject([{ state: "outdated" }]);

      // The member pays back more than they owe: the debt turns around.
      add(period, { id: "e-3", payerId: MEMBER, grosze: 100000 });
      expect(period.sentTransfersInvolving(MEMBER)).toMatchObject([{ state: "no_debt", debt: null }]);
    });

    it("returns the mark to both the debtor and the creditor, and to nobody else", () => {
      const period = BillingPeriod.restore(restoredWithMark().toSnapshot(), [HOST, MEMBER, "third"]);

      expect(period.sentTransfersInvolving(MEMBER)).toHaveLength(1);
      expect(period.sentTransfersInvolving(HOST)).toHaveLength(1);
      expect(period.sentTransfersInvolving("third")).toEqual([]);
    });

    it("keeps a mark when its expense is edited or deleted", () => {
      const period = restoredWithMark();

      edit(period, { grosze: 60000 });
      expect(period.sentTransfersInvolving(MEMBER)).toMatchObject([{ state: "outdated" }]);

      period.removeExpense({ expenseId: "e-1", userId: HOST });
      expect(period.sentTransfersInvolving(MEMBER)).toMatchObject([{ state: "no_debt" }]);
      expect(period.unmarkedTransferIds()).toEqual([]);
    });
  });

  it("round-trips transfers through the snapshot", () => {
    const period = withDebt();
    mark(period);

    const restored = BillingPeriod.restore(period.toSnapshot(), [HOST, MEMBER]);

    expect(restored.toSnapshot().transfers).toEqual(period.toSnapshot().transfers);
    expect(restored.markedTransfers()).toEqual([]);
  });
});
