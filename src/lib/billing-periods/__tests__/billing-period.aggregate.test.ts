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

    const balances = period.pendingBalances();

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

  it("sums the expenses of the period and of each payer (the group page summary)", () => {
    const period = octoberPeriod();
    expect(period.totalExpenses().grosze).toBe(0);
    add(period, { id: "rent", payerId: HOST, grosze: 10000 });
    add(period, { id: "food", payerId: MEMBER, grosze: 5400 });

    expect(period.totalExpenses().grosze).toBe(15400);
    expect(period.paidBy(HOST).grosze).toBe(10000);
    expect(period.paidBy(MEMBER).grosze).toBe(5400);
    expect(period.paidBy("stranger").grosze).toBe(0);
  });

  it("reads one member's pending balance, zero for a non-member", () => {
    const period = octoberPeriod();
    add(period, { payerId: HOST, grosze: 40000 });

    expect(period.pendingBalances().balanceOf(HOST).grosze).toBe(20000);
    expect(period.pendingBalances().balanceOf(MEMBER).grosze).toBe(-20000);
    expect(period.pendingBalances().balanceOf("stranger").grosze).toBe(0);
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
    payments: [],
    openingDebts: [{ debtorId: MEMBER, creditorId: HOST, amountGrosze: 5000 }],
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
    [
      "an opening debt of a member to themselves",
      { openingDebts: [{ debtorId: HOST, creditorId: HOST, amountGrosze: 1 }] },
    ],
    [
      "an opening debt that is not positive",
      { openingDebts: [{ debtorId: MEMBER, creditorId: HOST, amountGrosze: 0 }] },
    ],
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
    expect(period.pendingBalances().members.find((member) => member.userId === "late")?.balance.grosze).toBe(0);
  });

  it("reports a stored expense as changed, not new, and reflects it in the balances", () => {
    const stored = octoberPeriod();
    add(stored, { id: "e-1", payerId: HOST, grosze: 40000 });
    const period = BillingPeriod.restore(stored.toSnapshot(), [HOST, MEMBER]);

    edit(period, { grosze: 10000 });

    expect(period.changedExpenses().map((expense) => expense.id)).toEqual(["e-1"]);
    expect(period.newExpenses()).toEqual([]);
    expect(period.removedExpenseIds()).toEqual([]);
    expect(period.pendingBalances().members.map((member) => [member.userId, member.balance.grosze])).toEqual([
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
    expect(period.pendingBalances().debts).toEqual([]);
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

describe("BillingPeriod payments", () => {
  const SENT_AT = new Date("2026-10-16T12:00:00.000Z");

  // HOST paid 400 zł between HOST and MEMBER, so MEMBER owes HOST 200 zł.
  function withDebt(): BillingPeriod {
    const period = octoberPeriod();
    add(period, { id: "e-1", payerId: HOST, grosze: 40000 });
    return period;
  }

  function send(
    period: BillingPeriod,
    input: { id?: string; senderId?: string; recipientId?: string; grosze?: number; now?: Date } = {},
  ) {
    return period.sendPayment({
      id: input.id ?? "p-1",
      senderId: input.senderId ?? MEMBER,
      recipientId: input.recipientId ?? HOST,
      amount: Money.ofGrosze(input.grosze ?? 20000),
      now: input.now ?? SENT_AT,
    });
  }

  // The period as it was stored after MEMBER sent `p-1`, so the payment counts as loaded.
  function storedWithPayment(confirmedAt: string | null = null, rejectedAt: string | null = null): BillingPeriod {
    const period = withDebt();
    send(period);
    const snapshot = period.toSnapshot();
    return BillingPeriod.restore(
      { ...snapshot, payments: snapshot.payments.map((payment) => ({ ...payment, confirmedAt, rejectedAt })) },
      [HOST, MEMBER],
    );
  }

  const DECIDED_AT = new Date("2026-10-17T08:00:00.000Z");
  const decide = (period: BillingPeriod, kind: "confirm" | "reject", userId = HOST, paymentId = "p-1") =>
    kind === "confirm"
      ? period.confirmPayment({ paymentId, userId, now: DECIDED_AT })
      : period.rejectPayment({ paymentId, userId, now: DECIDED_AT });

  const debtsOf = (period: BillingPeriod) =>
    period.pendingBalances().debts.map((debt) => [debt.debtorId, debt.creditorId, debt.amount.grosze]);

  describe("sendPayment", () => {
    it("settles the pair when the whole debt is paid, and keeps the payment in the ledger", () => {
      const period = withDebt();

      const result = send(period);

      expect(result).toMatchObject({ data: { id: "p-1", senderId: MEMBER, recipientId: HOST } });
      expect(debtsOf(period)).toEqual([]);
      expect(period.sentPayments().map((payment) => payment.id)).toEqual(["p-1"]);
    });

    it("leaves the rest as the debt after a partial payment, and allows several payments per pair", () => {
      const period = withDebt();

      send(period, { id: "p-1", grosze: 5000 });
      send(period, { id: "p-2", grosze: 5000 });

      expect(debtsOf(period)).toEqual([[MEMBER, HOST, 10000]]);
      expect(period.payments).toHaveLength(2);
    });

    it("refuses more than the pending debt, counting payments already sent", () => {
      const period = withDebt();
      send(period, { id: "p-1", grosze: 15000 });

      expect(send(period, { id: "p-2", grosze: 5001 })).toMatchObject({ error: { code: "payment_exceeds_debt" } });
      expect(send(period, { id: "p-3", grosze: 5000 })).toMatchObject({ data: { id: "p-3" } });
    });

    it("returns the same payment for the same id and records it once", () => {
      const period = withDebt();
      send(period);

      const again = send(period, { now: new Date("2026-10-17T12:00:00.000Z") });

      expect(again).toMatchObject({ data: { id: "p-1" } });
      expect(period.payments).toHaveLength(1);
      expect(period.sentPayments()).toHaveLength(1);
    });

    it("does not treat an id of someone else's payment as a repeat", () => {
      const period = BillingPeriod.restore(storedWithPayment().toSnapshot(), [HOST, MEMBER]);
      add(period, { id: "e-2", payerId: MEMBER, grosze: 80000 });

      expect(send(period, { senderId: HOST, recipientId: MEMBER, grosze: 100 })).toMatchObject({
        error: { code: "unexpected" },
      });
    });

    it("refuses a closed period", () => {
      const closed = BillingPeriod.restore({ ...withDebt().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" }, [
        HOST,
        MEMBER,
      ]);

      expect(send(closed)).toMatchObject({ error: { code: "billing_period_closed" } });
    });

    it("refuses a sender who is not a participant", () => {
      expect(send(withDebt(), { senderId: "stranger" })).toMatchObject({ error: { code: "group_not_found" } });
    });

    it("refuses a payment without a debt: the creditor paying the debtor, a settled pair, paying oneself", () => {
      expect(send(withDebt(), { senderId: HOST, recipientId: MEMBER })).toMatchObject({
        error: { code: "no_debt_to_pay" },
      });
      expect(send(octoberPeriod())).toMatchObject({ error: { code: "no_debt_to_pay" } });
      expect(send(withDebt(), { senderId: MEMBER, recipientId: MEMBER })).toMatchObject({
        error: { code: "no_debt_to_pay" },
      });
      expect(send(withDebt(), { recipientId: "stranger" })).toMatchObject({ error: { code: "no_debt_to_pay" } });
    });
  });

  describe("pending and posted balances", () => {
    it("counts a sent payment in the pending balances only until it is confirmed", () => {
      const sent = storedWithPayment();
      expect(debtsOf(sent)).toEqual([]);
      expect(sent.postedBalances().debts.map((debt) => debt.amount.grosze)).toEqual([20000]);

      const confirmed = storedWithPayment("2026-10-17T08:00:00.000Z");
      expect(confirmed.postedBalances().debts).toEqual([]);
      expect(debtsOf(confirmed)).toEqual([]);
    });

    it("keeps the payments when an expense is edited or deleted, and only the balances change", () => {
      const period = storedWithPayment();

      edit(period, { grosze: 60000 });
      expect(debtsOf(period)).toEqual([[MEMBER, HOST, 10000]]);

      period.removeExpense({ expenseId: "e-1", userId: HOST });
      expect(debtsOf(period)).toEqual([[HOST, MEMBER, 20000]]);
      expect(period.payments).toHaveLength(1);
      expect(period.withdrawnPaymentIds()).toEqual([]);
    });

    it("shows the true debt through a whole scenario where the debt later turns around", () => {
      const period = octoberPeriod();
      // A (HOST) pays 200 zł: B owes 100 zł. B sends it.
      add(period, { id: "e-1", payerId: HOST, grosze: 20000 });
      send(period, { id: "p-1", grosze: 10000 });
      expect(debtsOf(period)).toEqual([]);

      // A pays another 100 zł: B owes 50 zł, not 150 zł. B sends it.
      add(period, { id: "e-2", payerId: HOST, grosze: 10000 });
      expect(debtsOf(period)).toEqual([[MEMBER, HOST, 5000]]);
      send(period, { id: "p-2", grosze: 5000 });
      expect(debtsOf(period)).toEqual([]);

      // B pays 300 zł: A owes B 150 zł, which a mark outside the balances used to lose.
      add(period, { id: "e-3", payerId: MEMBER, grosze: 30000 });
      expect(debtsOf(period)).toEqual([[HOST, MEMBER, 15000]]);
      expect(period.pendingBalances().members.map((member) => member.balance.grosze)).toEqual([-15000, 15000]);
      // Nothing is confirmed, so the posted balances know the expenses only: B's 150 zł and A's 150 zł cancel.
      expect(period.postedBalances().debts).toEqual([]);
    });
  });

  describe("withdrawPayment", () => {
    it("removes the sender's unconfirmed payment and lists it for deletion", () => {
      const period = storedWithPayment();

      const result = period.withdrawPayment({ paymentId: "p-1", userId: MEMBER });

      expect(result).toEqual({ data: undefined });
      expect(period.payments).toEqual([]);
      expect(period.withdrawnPaymentIds()).toEqual(["p-1"]);
      expect(debtsOf(period)).toEqual([[MEMBER, HOST, 20000]]);
    });

    it("drops a payment sent since load without any pending write", () => {
      const period = withDebt();
      send(period);

      period.withdrawPayment({ paymentId: "p-1", userId: MEMBER });

      expect(period.sentPayments()).toEqual([]);
      expect(period.withdrawnPaymentIds()).toEqual([]);
    });

    it("refuses, in order, a closed period, an unknown payment, someone else's payment and a confirmed one", () => {
      const closed = BillingPeriod.restore(
        { ...storedWithPayment().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" },
        [HOST, MEMBER],
      );
      expect(closed.withdrawPayment({ paymentId: "p-1", userId: MEMBER })).toMatchObject({
        error: { code: "billing_period_closed" },
      });

      const period = storedWithPayment();
      expect(period.withdrawPayment({ paymentId: "nope", userId: MEMBER })).toMatchObject({
        error: { code: "payment_not_found" },
      });
      expect(period.withdrawPayment({ paymentId: "p-1", userId: HOST })).toMatchObject({
        error: { code: "not_payment_sender" },
      });
      expect(
        storedWithPayment("2026-10-17T08:00:00.000Z").withdrawPayment({ paymentId: "p-1", userId: MEMBER }),
      ).toMatchObject({ error: { code: "payment_confirmed" } });
    });
  });

  describe("confirmPayment", () => {
    it("lets the recipient confirm: posted balances include the payment, pending balances do not change", () => {
      const period = storedWithPayment();
      const pendingBefore = debtsOf(period);
      expect(period.postedBalances().debts.map((debt) => debt.amount.grosze)).toEqual([20000]);

      expect(decide(period, "confirm")).toEqual({ data: undefined });

      expect(period.postedBalances().debts).toEqual([]);
      expect(debtsOf(period)).toEqual(pendingBefore);
      expect(period.payments[0].status()).toBe("confirmed");
      expect(period.payments[0].confirmedAt).toEqual(DECIDED_AT);
      expect(period.confirmedPayments().map((payment) => payment.id)).toEqual(["p-1"]);
      expect(period.rejectedPayments()).toEqual([]);
    });

    it("refuses, in order, a closed period, an unknown payment and a user who is not the recipient", () => {
      const closed = BillingPeriod.restore(
        { ...storedWithPayment().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" },
        [HOST, MEMBER],
      );
      expect(decide(closed, "confirm")).toMatchObject({ error: { code: "billing_period_closed" } });

      const period = storedWithPayment();
      expect(decide(period, "confirm", HOST, "nope")).toMatchObject({ error: { code: "payment_not_found" } });
      expect(decide(period, "confirm", MEMBER)).toMatchObject({ error: { code: "not_payment_recipient" } });
      expect(decide(period, "confirm", "stranger")).toMatchObject({ error: { code: "not_payment_recipient" } });
      expect(period.confirmedPayments()).toEqual([]);
    });

    it("succeeds again without a second pending write when the payment is already confirmed", () => {
      const period = storedWithPayment();
      decide(period, "confirm");

      expect(decide(period, "confirm")).toEqual({ data: undefined });
      expect(period.confirmedPayments()).toHaveLength(1);

      const alreadyStored = storedWithPayment("2026-10-17T08:00:00.000Z");
      expect(decide(alreadyStored, "confirm")).toEqual({ data: undefined });
      expect(alreadyStored.confirmedPayments()).toEqual([]);
    });

    it("refuses to confirm a rejected payment", () => {
      expect(decide(storedWithPayment(null, "2026-10-17T08:00:00.000Z"), "confirm")).toMatchObject({
        error: { code: "payment_not_pending" },
      });
    });

    it("confirms a payment sent since the period was loaded", () => {
      const period = withDebt();
      send(period);

      expect(decide(period, "confirm")).toEqual({ data: undefined });
      expect(period.payments[0].isConfirmed()).toBe(true);
      expect(period.postedBalances().debts).toEqual([]);
    });
  });

  describe("rejectPayment", () => {
    it("keeps the payment in the ledger but drops it from both balances, so the debt comes back", () => {
      const period = storedWithPayment();
      expect(debtsOf(period)).toEqual([]);

      expect(decide(period, "reject")).toEqual({ data: undefined });

      expect(period.payments).toHaveLength(1);
      expect(period.payments[0].status()).toBe("rejected");
      expect(period.payments[0].rejectedAt).toEqual(DECIDED_AT);
      expect(debtsOf(period)).toEqual([[MEMBER, HOST, 20000]]);
      expect(period.postedBalances().debts.map((debt) => debt.amount.grosze)).toEqual([20000]);
      expect(period.rejectedPayments().map((payment) => payment.id)).toEqual(["p-1"]);
      expect(period.confirmedPayments()).toEqual([]);
    });

    it("lets the sender pay the full debt again after a rejection", () => {
      const period = storedWithPayment();
      decide(period, "reject");

      expect(send(period, { id: "p-2", grosze: 20000 })).toMatchObject({ data: { id: "p-2" } });
      expect(debtsOf(period)).toEqual([]);
    });

    it("refuses, in order, a closed period, an unknown payment and a user who is not the recipient", () => {
      const closed = BillingPeriod.restore(
        { ...storedWithPayment().toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" },
        [HOST, MEMBER],
      );
      expect(decide(closed, "reject")).toMatchObject({ error: { code: "billing_period_closed" } });

      const period = storedWithPayment();
      expect(decide(period, "reject", HOST, "nope")).toMatchObject({ error: { code: "payment_not_found" } });
      expect(decide(period, "reject", MEMBER)).toMatchObject({ error: { code: "not_payment_recipient" } });
      expect(decide(period, "reject", "stranger")).toMatchObject({ error: { code: "not_payment_recipient" } });
      expect(period.rejectedPayments()).toEqual([]);
    });

    it("succeeds again without a second pending write when the payment is already rejected", () => {
      const period = storedWithPayment();
      decide(period, "reject");

      expect(decide(period, "reject")).toEqual({ data: undefined });
      expect(period.rejectedPayments()).toHaveLength(1);

      const alreadyStored = storedWithPayment(null, "2026-10-17T08:00:00.000Z");
      expect(decide(alreadyStored, "reject")).toEqual({ data: undefined });
      expect(alreadyStored.rejectedPayments()).toEqual([]);
    });

    it("refuses to reject a confirmed payment", () => {
      expect(decide(storedWithPayment("2026-10-17T08:00:00.000Z"), "reject")).toMatchObject({
        error: { code: "payment_not_pending" },
      });
    });
  });

  describe("after a decision", () => {
    it("refuses the sender to withdraw a rejected payment", () => {
      expect(
        storedWithPayment(null, "2026-10-17T08:00:00.000Z").withdrawPayment({ paymentId: "p-1", userId: MEMBER }),
      ).toMatchObject({ error: { code: "payment_not_pending" } });
    });

    it("locks the expense of the pair of a confirmed payment: no edit, no delete, the payment stays", () => {
      const period = storedWithPayment();
      decide(period, "confirm");
      const expense = period.expenses[0];

      expect(period.isLocked(expense)).toBe(true);
      expect(period.canEdit(expense, HOST)).toBe(false);
      expect(code(edit(period, { grosze: 60000 }))).toBe("expense_locked");
      expect(period.removeExpense({ expenseId: "e-1", userId: HOST })).toMatchObject({
        error: { code: "expense_locked" },
      });
      expect(period.payments[0].isConfirmed()).toBe(true);
      expect(debtsOf(period)).toEqual([]);
    });
    describe("the expense lock", () => {
      const THIRD = "third";
      const THREE = [HOST, MEMBER, THIRD];

      // HOST paid e-1 and MEMBER paid e-2, both split between all three; payments are stored as given.
      function threeWay(payments: { id: string; from: string; to: string; confirmed?: boolean; rejected?: boolean }[]) {
        const period = octoberPeriod(THREE);
        add(period, { id: "e-1", payerId: HOST, grosze: 30000 });
        add(period, { id: "e-2", payerId: MEMBER, grosze: 30000 });
        const snapshot = period.toSnapshot();
        return BillingPeriod.restore(
          {
            ...snapshot,
            payments: payments.map((payment) => ({
              id: payment.id,
              senderId: payment.from,
              recipientId: payment.to,
              amount: 1000,
              sentAt: "2026-10-16T12:00:00.000Z",
              confirmedAt: payment.confirmed ? "2026-10-17T08:00:00.000Z" : null,
              rejectedAt: payment.rejected ? "2026-10-17T08:00:00.000Z" : null,
            })),
          },
          THREE,
        );
      }
      const lockedIds = (period: BillingPeriod) =>
        period.expenses.filter((expense) => period.isLocked(expense)).map((expense) => expense.id);

      it("locks in the direction sharer to payer", () => {
        expect(lockedIds(threeWay([{ id: "p", from: MEMBER, to: HOST, confirmed: true }]))).toContain("e-1");
      });

      it("locks in the direction payer to sharer", () => {
        expect(lockedIds(threeWay([{ id: "p", from: HOST, to: MEMBER, confirmed: true }]))).toContain("e-1");
      });

      it("locks both expenses of a pair that paid each other's", () => {
        expect(lockedIds(threeWay([{ id: "p", from: MEMBER, to: HOST, confirmed: true }]))).toEqual(["e-1", "e-2"]);
      });

      it("does not lock for a pending or rejected payment", () => {
        expect(lockedIds(threeWay([{ id: "p", from: MEMBER, to: HOST }]))).toEqual([]);
        expect(lockedIds(threeWay([{ id: "p", from: MEMBER, to: HOST, rejected: true }]))).toEqual([]);
      });

      it("does not lock an expense for a confirmed payment of another pair", () => {
        const period = threeWay([{ id: "p", from: THIRD, to: MEMBER, confirmed: true }]);
        expect(lockedIds(period)).toEqual(["e-2"]);
        expect(period.canEdit(period.expenses[0], HOST)).toBe(true);
        expect(code(edit(period, { grosze: 60000 }))).toBe("ok");
      });

      it("refuses in order: closed, unknown, not the author, then locked", () => {
        const period = threeWay([{ id: "p", from: MEMBER, to: HOST, confirmed: true }]);
        expect(code(edit(period, { expenseId: "nope" }))).toBe("expense_not_found");
        expect(code(edit(period, { expenseId: "e-1", userId: THIRD }))).toBe("not_expense_author");
        expect(code(edit(period, { expenseId: "e-1", userId: HOST }))).toBe("expense_locked");

        const snapshot = period.toSnapshot();
        const closed = BillingPeriod.restore({ ...snapshot, closedAt: "2026-11-02T08:00:00.000Z" }, THREE);
        expect(code(edit(closed, { expenseId: "e-1", userId: HOST }))).toBe("billing_period_closed");
      });
    });

    it("round-trips decisions through the snapshot", () => {
      const period = storedWithPayment();
      decide(period, "reject");

      const restored = BillingPeriod.restore(period.toSnapshot(), [HOST, MEMBER]);

      expect(restored.payments[0].status()).toBe("rejected");
      expect(restored.rejectedPayments()).toEqual([]);
    });
  });

  it("lists payments newest first and round-trips them through the snapshot", () => {
    const period = withDebt();
    send(period, { id: "p-1", grosze: 5000, now: new Date("2026-10-15T12:00:00.000Z") });
    send(period, { id: "p-2", grosze: 5000, now: new Date("2026-10-16T12:00:00.000Z") });

    expect(period.paymentsNewestFirst().map((payment) => payment.id)).toEqual(["p-2", "p-1"]);

    const restored = BillingPeriod.restore(period.toSnapshot(), [HOST, MEMBER]);
    expect(restored.toSnapshot().payments).toEqual(period.toSnapshot().payments);
    expect(restored.sentPayments()).toEqual([]);
  });
});

type Status = "pending" | "confirmed" | "rejected";

interface LedgerPayment {
  id: string;
  from: string;
  to: string;
  grosze: number;
  status?: Status;
  sentAt?: string;
}

// A stored period of `month` with the given expenses (split equally between all participants), payments and
// opening debts, restored so that everything counts as loaded.
function ledger(input: {
  participants?: readonly string[];
  month?: "2026-10-01" | "2026-11-01";
  expenses?: { id: string; payerId: string; grosze: number }[];
  payments?: LedgerPayment[];
  openingDebts?: { debtorId: string; creditorId: string; grosze: number }[];
}): BillingPeriod {
  const participants = input.participants ?? [HOST, MEMBER];
  const november = input.month === "2026-11-01";
  const period = BillingPeriod.open({
    id: PERIOD_ID,
    groupId: GROUP_ID,
    participants,
    now: new Date(november ? "2026-11-01T08:00:00.000Z" : "2026-10-01T08:00:00.000Z"),
  });
  for (const expense of input.expenses ?? []) {
    const added = add(period, {
      ...expense,
      purchasedOn: november ? "2026-11-05" : "2026-10-10",
      now: new Date(november ? "2026-11-05T12:00:00.000Z" : "2026-10-10T12:00:00.000Z"),
    });
    if ("error" in added) {
      throw new Error(added.error.code);
    }
  }
  const sentAt = november ? "2026-11-06T12:00:00.000Z" : "2026-10-16T12:00:00.000Z";
  const decidedAt = november ? "2026-11-07T08:00:00.000Z" : "2026-10-17T08:00:00.000Z";
  return BillingPeriod.restore(
    {
      ...period.toSnapshot(),
      payments: (input.payments ?? []).map((payment) => ({
        id: payment.id,
        senderId: payment.from,
        recipientId: payment.to,
        amount: payment.grosze,
        sentAt: payment.sentAt ?? sentAt,
        confirmedAt: payment.status === "confirmed" ? decidedAt : null,
        rejectedAt: payment.status === "rejected" ? decidedAt : null,
      })),
      openingDebts: (input.openingDebts ?? []).map((debt) => ({
        debtorId: debt.debtorId,
        creditorId: debt.creditorId,
        amountGrosze: debt.grosze,
      })),
    },
    participants,
  );
}

const memberBalances = (balances: ReturnType<BillingPeriod["pendingBalances"]>) =>
  balances.members.map((member) => [member.userId, member.balance.grosze]);
const pairDebts = (balances: ReturnType<BillingPeriod["pendingBalances"]>) =>
  balances.debts.map((debt) => [debt.debtorId, debt.creditorId, debt.amount.grosze]);

describe("BillingPeriod.close", () => {
  // 00:30 on 1 November in Warsaw, so October has ended.
  const AFTER_OCTOBER = new Date("2026-10-31T23:30:00.000Z");
  // 23:30 on 31 October in Warsaw: October is still running.
  const LAST_EVENING = new Date("2026-10-31T22:30:00.000Z");
  const NEXT_ID = "next-period";
  const THIRD = "third";

  function closeAs(period: BillingPeriod, input: { userId?: string; now?: Date } = {}) {
    return period.close({
      userId: input.userId ?? HOST,
      hostId: HOST,
      nextPeriodId: NEXT_ID,
      now: input.now ?? AFTER_OCTOBER,
    });
  }

  function refusalOf(period: BillingPeriod, input: { userId?: string; now?: Date } = {}) {
    return period.closeRefusal({ userId: input.userId ?? HOST, hostId: HOST, now: input.now ?? AFTER_OCTOBER });
  }

  function closed(period: BillingPeriod): BillingPeriod {
    const result = closeAs(period);
    if ("error" in result) {
      throw new Error(result.error.code);
    }
    return result.data;
  }

  // MEMBER paid 400 zł between HOST and MEMBER, so the host owes MEMBER 200 zł.
  const hostOwes = (payments: LedgerPayment[] = []) =>
    ledger({ expenses: [{ id: "e-1", payerId: MEMBER, grosze: 40000 }], payments });

  describe("refusals (host only, month must have ended, host's posted debts block)", () => {
    it("refuses, in order, a closed period, a non-host, a month that has not ended and a host who owes", () => {
      const owing = hostOwes();
      const closedPeriod = BillingPeriod.restore({ ...owing.toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" }, [
        HOST,
        MEMBER,
      ]);

      expect(code(closeAs(closedPeriod, { userId: MEMBER, now: LAST_EVENING }))).toBe("billing_period_closed");
      expect(code(closeAs(owing, { userId: MEMBER, now: LAST_EVENING }))).toBe("not_group_host");
      expect(code(closeAs(owing, { now: LAST_EVENING }))).toBe("period_not_ended");
      expect(code(closeAs(owing))).toBe("host_has_debts");
    });

    it("gives the same codes from closeRefusal as from close, and null when the close is allowed", () => {
      const owing = hostOwes();
      const closedPeriod = BillingPeriod.restore({ ...owing.toSnapshot(), closedAt: "2026-11-01T08:00:00.000Z" }, [
        HOST,
        MEMBER,
      ]);
      const cases: [BillingPeriod, { userId?: string; now?: Date }][] = [
        [closedPeriod, {}],
        [owing, { userId: MEMBER }],
        [owing, { now: LAST_EVENING }],
        [owing, {}],
      ];

      for (const [period, input] of cases) {
        expect(refusalOf(period, input)).toBe(code(closeAs(period, input)));
      }
      expect(refusalOf(ledger({}))).toBeNull();
    });

    it("refuses a host whose only debt is covered by a pending payment", () => {
      const period = hostOwes([{ id: "p-1", from: HOST, to: MEMBER, grosze: 20000 }]);

      expect(period.pendingBalances().debts).toEqual([]);
      expect(code(closeAs(period))).toBe("host_has_debts");
    });

    it("lets a host whose debt is settled by a confirmed payment close", () => {
      expect(code(closeAs(hostOwes([{ id: "p-1", from: HOST, to: MEMBER, grosze: 20000, status: "confirmed" }])))).toBe(
        "ok",
      );
    });

    it("lets a host who is only a creditor close, while the other members' debts carry over", () => {
      const period = ledger({ expenses: [{ id: "e-1", payerId: HOST, grosze: 40000 }] });

      expect(code(closeAs(period))).toBe("ok");
    });

    it("leaves a refused period open, with nothing to write", () => {
      const period = hostOwes();

      closeAs(period);

      expect(period.isOpen()).toBe(true);
      expect(period.closedNow()).toBe(false);
      expect(period.movedPaymentIds()).toEqual([]);
    });
  });

  describe("the next period", () => {
    // HOST paid 300 zł and MEMBER paid 90 zł between all three: MEMBER owes HOST 70, THIRD owes HOST 100 and
    // MEMBER 30. THIRD has sent HOST 40 (pending), MEMBER 10 (confirmed) and HOST 25 (rejected).
    const threeWay = () =>
      ledger({
        participants: [HOST, MEMBER, THIRD],
        expenses: [
          { id: "e-1", payerId: HOST, grosze: 30000 },
          { id: "e-2", payerId: MEMBER, grosze: 9000 },
        ],
        payments: [
          { id: "p-pending", from: THIRD, to: HOST, grosze: 4000 },
          { id: "p-confirmed", from: THIRD, to: MEMBER, grosze: 1000, status: "confirmed" },
          { id: "p-rejected", from: THIRD, to: HOST, grosze: 2500, status: "rejected" },
        ],
      });

    it("opens the month after the closed one at now, with version 0, the same participants and no expenses", () => {
      const next = closed(threeWay());

      expect(next.id).toBe(NEXT_ID);
      expect(next.groupId).toBe(GROUP_ID);
      expect(next.month.toDate()).toBe("2026-11-01");
      expect(next.openedAt).toEqual(AFTER_OCTOBER);
      expect(next.closedAt).toBeNull();
      expect(next.version).toBe(0);
      expect(next.participants).toEqual([HOST, MEMBER, THIRD]);
      expect(next.expenses).toEqual([]);
    });

    it("takes the month after the closed one even when the close comes months later", () => {
      const next = closeAs(ledger({}), { now: new Date("2027-01-15T12:00:00.000Z") });

      expect("data" in next && next.data.month.toDate()).toBe("2026-11-01");
    });

    it("carries one opening debt per posted pair debt", () => {
      const period = threeWay();
      const next = closed(period);

      expect(next.openingDebts.map((debt) => [debt.debtorId, debt.creditorId, debt.amount.grosze])).toEqual(
        pairDebts(period.postedBalances()),
      );
      expect(pairDebts(period.postedBalances())).toEqual([
        [MEMBER, HOST, 7000],
        [THIRD, HOST, 10000],
        [THIRD, MEMBER, 2000],
      ]);
    });

    it("moves exactly the pending payments, unchanged, and keeps confirmed and rejected payments behind", () => {
      const period = threeWay();
      const pendingBefore = period.payments.find((payment) => payment.id === "p-pending")?.toSnapshot();

      const next = closed(period);

      expect(next.payments.map((payment) => payment.toSnapshot())).toEqual([pendingBefore]);
      expect(next.sentPayments()).toEqual([]);
      expect(period.movedPaymentIds()).toEqual(["p-pending"]);
      expect(period.payments.map((payment) => payment.id)).toEqual(["p-pending", "p-confirmed", "p-rejected"]);
    });

    it("marks the closed period closed at now as a pending write, and refuses a second close", () => {
      const period = threeWay();

      closed(period);

      expect(period.isOpen()).toBe(false);
      expect(period.closedAt).toEqual(AFTER_OCTOBER);
      expect(period.closedNow()).toBe(true);
      expect(code(closeAs(period))).toBe("billing_period_closed");
    });

    it("records a close that a skewed clock places before the opening at the opening, and opens the next period then", () => {
      const snapshot = octoberPeriod().toSnapshot();
      const period = BillingPeriod.restore({ ...snapshot, openedAt: "2026-11-01T10:00:00.000Z" }, [HOST, MEMBER]);
      const skewed = new Date("2026-11-01T09:59:59.900Z");

      const next = closeAs(period, { now: skewed });

      if ("error" in next) {
        throw new Error(next.error.code);
      }
      expect(period.closedAt).toEqual(new Date("2026-11-01T10:00:00.000Z"));
      expect(next.data.openedAt).toEqual(period.closedAt);
    });

    it("keeps balances unchanged across the close: the pending and posted balances of both periods match", () => {
      const period = threeWay();

      const next = closed(period);

      expect(memberBalances(next.pendingBalances())).toEqual(memberBalances(period.pendingBalances()));
      expect(pairDebts(next.pendingBalances())).toEqual(pairDebts(period.pendingBalances()));
      expect(memberBalances(next.postedBalances())).toEqual(memberBalances(period.postedBalances()));
      expect(pairDebts(next.postedBalances())).toEqual(pairDebts(period.postedBalances()));
    });

    it("round-trips the next period, with its opening debts, through the snapshot", () => {
      const next = closed(threeWay());

      const restored = BillingPeriod.restore(next.toSnapshot(), [HOST, MEMBER, THIRD]);

      expect(restored.toSnapshot()).toEqual(next.toSnapshot());
      expect(restored.toSnapshot().openingDebts).toEqual([
        { debtorId: MEMBER, creditorId: HOST, amountGrosze: 7000 },
        { debtorId: THIRD, creditorId: HOST, amountGrosze: 10000 },
        { debtorId: THIRD, creditorId: MEMBER, amountGrosze: 2000 },
      ]);
    });
  });

  describe("invariant: balances unchanged across the close, for random small ledgers", () => {
    // A fixed pseudo-random sequence (LCG) keeps the grid deterministic without a property-testing dependency.
    function sequence(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state;
      };
    }
    const STATUSES: Status[] = ["pending", "confirmed", "rejected"];

    for (const memberCount of [2, 3, 4]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        it(`holds for ${memberCount} members, seed ${seed}`, () => {
          const next = sequence(seed * 104729 + memberCount);
          const participants = [HOST, ...Array.from({ length: memberCount - 1 }, (_, i) => `member-${i + 1}`)];
          const pick = () => participants[next() % memberCount];
          const payments: LedgerPayment[] = [];
          for (let position = 0; position < 6; position += 1) {
            const from = pick();
            const to = participants.find((candidate) => candidate !== from && next() % 2 === 0) ?? pick();
            if (from !== to) {
              payments.push({
                id: `p-${position}`,
                from,
                to,
                grosze: 1 + (next() % 50_000),
                status: STATUSES[next() % 3],
              });
            }
          }
          // The host settles their own posted debts with confirmed payments, so the close is allowed.
          const draft = ledger({
            participants,
            expenses: Array.from({ length: 5 }, (_, position) => ({
              id: `e-${position}`,
              payerId: pick(),
              grosze: 1 + (next() % 100_000),
            })),
            payments,
          });
          const settling = draft
            .postedBalances()
            .debts.filter((debt) => debt.debtorId === HOST)
            .map((debt, position) => ({
              id: `settle-${position}`,
              from: HOST,
              to: debt.creditorId,
              grosze: debt.amount.grosze,
              status: "confirmed" as const,
            }));
          const period = ledger({
            participants,
            expenses: draft.expenses.map((expense) => ({
              id: expense.id,
              payerId: expense.payerId,
              grosze: expense.amount.grosze,
            })),
            payments: [...payments, ...settling],
          });

          const result = closeAs(period);

          if ("error" in result) {
            throw new Error(result.error.code);
          }
          expect(memberBalances(result.data.pendingBalances())).toEqual(memberBalances(period.pendingBalances()));
          expect(pairDebts(result.data.pendingBalances())).toEqual(pairDebts(period.pendingBalances()));
          expect(memberBalances(result.data.postedBalances())).toEqual(memberBalances(period.postedBalances()));
          expect(pairDebts(result.data.postedBalances())).toEqual(pairDebts(period.postedBalances()));
        });
      }
    }
  });

  describe("isCarried", () => {
    it("is true only for a payment sent before the period opened", () => {
      const period = ledger({
        month: "2026-11-01",
        openingDebts: [{ debtorId: MEMBER, creditorId: HOST, grosze: 5000 }],
        payments: [
          { id: "moved", from: MEMBER, to: HOST, grosze: 1000, sentAt: "2026-10-20T12:00:00.000Z" },
          { id: "new", from: MEMBER, to: HOST, grosze: 1000 },
        ],
      });

      expect(period.payments.filter((payment) => period.isCarried(payment)).map((payment) => payment.id)).toEqual([
        "moved",
      ]);
    });
  });
});

describe("BillingPeriod.isLocked (FR-005, oldest-first)", () => {
  // November: MEMBER carries a 50 zł debt to HOST from October; HOST paid e-1 (40 zł, split between both).
  function november(payments: LedgerPayment[], carried = 5000): BillingPeriod {
    return ledger({
      month: "2026-11-01",
      expenses: [{ id: "e-1", payerId: HOST, grosze: 4000 }],
      payments,
      openingDebts: carried > 0 ? [{ debtorId: MEMBER, creditorId: HOST, grosze: carried }] : [],
    });
  }
  const lockedIds = (period: BillingPeriod) =>
    period.expenses.filter((expense) => period.isLocked(expense)).map((expense) => expense.id);

  it("behaves as in S-08 without an opening debt: one confirmed grosz locks", () => {
    expect(lockedIds(november([{ id: "p", from: MEMBER, to: HOST, grosze: 1, status: "confirmed" }], 0))).toEqual([
      "e-1",
    ]);
  });

  it("does not lock while confirmed payments only cover the carried debt", () => {
    const period = november([
      { id: "p-1", from: MEMBER, to: HOST, grosze: 2000, status: "confirmed" },
      { id: "p-2", from: MEMBER, to: HOST, grosze: 3000, status: "confirmed" },
    ]);

    expect(lockedIds(period)).toEqual([]);
    expect(period.canEdit(period.expenses[0], HOST)).toBe(true);
  });

  it("locks the pair's expenses one grosz above the carried debt, in both directions and including later ones", () => {
    const period = november([{ id: "p-1", from: MEMBER, to: HOST, grosze: 5001, status: "confirmed" }]);
    add(period, {
      id: "e-2",
      payerId: MEMBER,
      grosze: 2000,
      purchasedOn: "2026-11-08",
      now: new Date("2026-11-08T12:00:00.000Z"),
    });

    expect(lockedIds(period)).toEqual(["e-1", "e-2"]);
    expect(code(period.removeExpense({ expenseId: "e-1", userId: HOST }))).toBe("expense_locked");
  });

  it("locks on a confirmed payment in the direction opposite to the opening debt", () => {
    expect(lockedIds(november([{ id: "p", from: HOST, to: MEMBER, grosze: 1, status: "confirmed" }]))).toEqual(["e-1"]);
  });

  it("never counts pending or rejected payments", () => {
    expect(
      lockedIds(
        november([
          { id: "p-1", from: MEMBER, to: HOST, grosze: 5000, status: "confirmed" },
          { id: "p-2", from: MEMBER, to: HOST, grosze: 9000 },
          { id: "p-3", from: MEMBER, to: HOST, grosze: 9000, status: "rejected" },
          { id: "p-4", from: HOST, to: MEMBER, grosze: 9000 },
        ]),
      ),
    ).toEqual([]);
  });
});
