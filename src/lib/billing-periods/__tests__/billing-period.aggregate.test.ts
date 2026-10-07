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
