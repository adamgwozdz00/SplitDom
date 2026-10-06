import { describe, expect, it } from "vitest";
import { aGroup, anExpense, HOST_ID, memberId } from "@/lib/expenses/__tests__/expenses.harness";
import { Expense } from "@/lib/expenses/expense.aggregate";
import { ExpenseTitle } from "@/lib/expenses/expense-title.value";
import { Money } from "@/lib/expenses/money.value";
import { PurchaseDate } from "@/lib/expenses/purchase-date.value";
import type { ExpenseSnapshot } from "@/lib/expenses/types";

function shareOf(expense: Expense, userId: string): number | undefined {
  return expense.shares.find((share) => share.userId === userId)?.amount.grosze;
}

describe("Expense.add", () => {
  it("splits 400 zł between two members into 200 zł each (US-01)", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 2 }), payerId: memberId(1), grosze: 40000 });

    expect(shareOf(expense, memberId(1))).toBe(20000);
    expect(shareOf(expense, HOST_ID)).toBe(20000);
  });

  it("gives the payer the extra grosz when 100 zł is split three ways", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 3 }), payerId: HOST_ID, grosze: 10000 });

    expect(shareOf(expense, HOST_ID)).toBe(3334);
    expect(shareOf(expense, memberId(1))).toBe(3333);
    expect(shareOf(expense, memberId(2))).toBe(3333);
  });

  it("gives the payer both leftover grosze for 10001 split three ways", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 3 }), payerId: memberId(2), grosze: 10001 });

    expect(shareOf(expense, memberId(2))).toBe(3335);
    expect(shareOf(expense, HOST_ID)).toBe(3333);
    expect(shareOf(expense, memberId(1))).toBe(3333);
  });

  it("lets the payer absorb a single grosz between two members", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 2 }), payerId: HOST_ID, grosze: 1 });

    expect(shareOf(expense, HOST_ID)).toBe(1);
    expect(shareOf(expense, memberId(1))).toBe(0);
  });

  it("charges the whole amount to a payer who is the only member", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 1 }), payerId: HOST_ID, grosze: 12345 });

    expect(expense.shares).toHaveLength(1);
    expect(shareOf(expense, HOST_ID)).toBe(12345);
  });

  it("keeps one share per member in join order", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 3 }), payerId: memberId(2) });

    expect(expense.shares.map((share) => share.userId)).toEqual([HOST_ID, memberId(1), memberId(2)]);
  });

  it("reports a payer who is not a member as group_not_found", () => {
    const title = ExpenseTitle.create("Czynsz");
    const group = aGroup();
    if ("error" in title) {
      throw new Error("title");
    }

    const result = Expense.add({
      id: "e-1",
      group,
      payerId: "stranger",
      title: title.data,
      amount: Money.ofGrosze(100),
      purchasedOn: PurchaseDate.fromStored("2026-10-10"),
      now: new Date("2026-10-10T12:00:00.000Z"),
    });

    expect("error" in result && result.error).toMatchObject({
      code: "group_not_found",
      context: { groupId: group.id },
    });
  });

  it("stores the group id and the id of the group's open period", () => {
    const group = aGroup();
    const expense = anExpense({ group });

    expect(expense.groupId).toBe(group.id);
    expect(expense.periodId).toBe(group.openPeriod.id);
  });

  it("records the injected time as the creation time", () => {
    const now = new Date("2026-10-10T12:34:56.789Z");

    expect(anExpense({ now }).createdAt).toEqual(now);
  });
});

describe("Expense.add split invariants", () => {
  const amounts = [1, 2, 3, 99, 100, 101, 9999, 10000, 10001, 99999999, 100000000];
  const counts = [1, 2, 3, 4, 5, 6];

  for (const grosze of amounts) {
    for (const count of counts) {
      it(`splits ${grosze} grosze between ${count} member(s) for every payer`, () => {
        const group = aGroup({ memberCount: count });
        for (let payer = 0; payer < count; payer += 1) {
          const expense = anExpense({ group, payerId: memberId(payer), grosze });
          const floor = Math.floor(grosze / count);
          const remainder = grosze % count;

          expect(expense.shares.reduce((sum, share) => sum + share.amount.grosze, 0)).toBe(grosze);
          for (const share of expense.shares) {
            const expected = share.userId === memberId(payer) ? floor + remainder : floor;
            expect(share.amount.grosze).toBe(expected);
          }
        }
      });
    }
  }
});

describe("Expense.restore", () => {
  const snapshot: ExpenseSnapshot = {
    id: "e-1",
    groupId: "g-1",
    periodId: "p-1",
    payerId: "a",
    title: "Czynsz",
    amount: 100,
    purchasedOn: "2026-10-10",
    createdAt: "2026-10-10T12:00:00.000Z",
    shares: [
      { userId: "a", amount: 50 },
      { userId: "b", amount: 50 },
    ],
  };

  it("round-trips a snapshot", () => {
    expect(Expense.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("round-trips an expense built with add", () => {
    const expense = anExpense({ group: aGroup({ memberCount: 3 }), grosze: 10001 });

    expect(Expense.restore(expense.toSnapshot()).toSnapshot()).toEqual(expense.toSnapshot());
  });

  it("rejects shares that do not sum to the amount", () => {
    expect(() => Expense.restore({ ...snapshot, amount: 101 })).toThrow();
  });

  it("rejects a snapshot without shares", () => {
    expect(() => Expense.restore({ ...snapshot, shares: [] })).toThrow();
  });

  it("rejects a snapshot where the payer has no share", () => {
    expect(() =>
      Expense.restore({
        ...snapshot,
        shares: [
          { userId: "b", amount: 50 },
          { userId: "c", amount: 50 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a duplicate share user", () => {
    expect(() =>
      Expense.restore({
        ...snapshot,
        shares: [
          { userId: "a", amount: 50 },
          { userId: "a", amount: 50 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a negative share even when the sum matches", () => {
    expect(() =>
      Expense.restore({
        ...snapshot,
        shares: [
          { userId: "a", amount: 150 },
          { userId: "b", amount: -50 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a bad stored timestamp", () => {
    expect(() => Expense.restore({ ...snapshot, createdAt: "nope" })).toThrow();
  });
});
