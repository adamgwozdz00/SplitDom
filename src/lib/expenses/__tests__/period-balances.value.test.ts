import { describe, expect, it } from "vitest";
import { aGroup, anExpense, HOST_ID, memberId } from "@/lib/expenses/__tests__/expenses.harness";
import type { Expense } from "@/lib/expenses/expense.aggregate";
import { PeriodBalances } from "@/lib/expenses/period-balances.value";

const A = HOST_ID;
const B = memberId(1);
const C = memberId(2);

function balancesOf(memberIds: string[], expenses: Expense[]) {
  const result = PeriodBalances.of({ memberIds, expenses });
  return {
    members: result.members.map((member) => [member.userId, member.balance.grosze]),
    debts: result.debts.map((debt) => [debt.debtorId, debt.creditorId, debt.amount.grosze]),
  };
}

describe("PeriodBalances.of", () => {
  it("shows A +200 zł, B −200 zł and one debt B → A when A pays 400 zł between A and B (US-01)", () => {
    const group = aGroup({ memberCount: 2 });

    const result = balancesOf([A, B], [anExpense({ group, payerId: A, grosze: 40000 })]);

    expect(result.members).toEqual([
      [A, 20000],
      [B, -20000],
    ]);
    expect(result.debts).toEqual([[B, A, 20000]]);
  });

  it("nets opposite debts: A pays 400 and B pays 100 gives one debt B → A of 150 zł", () => {
    const group = aGroup({ memberCount: 2 });

    const result = balancesOf(
      [A, B],
      [
        anExpense({ id: "e-1", group, payerId: A, grosze: 40000 }),
        anExpense({ id: "e-2", group, payerId: B, grosze: 10000 }),
      ],
    );

    expect(result.debts).toEqual([[B, A, 15000]]);
    expect(result.members).toEqual([
      [A, 15000],
      [B, -15000],
    ]);
  });

  it("drops a pair whose debts cancel out", () => {
    const group = aGroup({ memberCount: 2 });

    const result = balancesOf(
      [A, B],
      [
        anExpense({ id: "e-1", group, payerId: A, grosze: 20000 }),
        anExpense({ id: "e-2", group, payerId: B, grosze: 20000 }),
      ],
    );

    expect(result.debts).toEqual([]);
    expect(result.members).toEqual([
      [A, 0],
      [B, 0],
    ]);
  });

  it("handles three members: A pays 300 zł, B pays 90 zł, all split among A, B and C", () => {
    const group = aGroup({ memberCount: 3 });

    const result = balancesOf(
      [A, B, C],
      [
        anExpense({ id: "e-1", group, payerId: A, grosze: 30000 }),
        anExpense({ id: "e-2", group, payerId: B, grosze: 9000 }),
      ],
    );

    // B owes A 100 and A owes B 30 → B owes A 70; C owes A 100 and B 30.
    expect(result.debts).toEqual([
      [B, A, 7000],
      [C, A, 10000],
      [C, B, 3000],
    ]);
    expect(result.members).toEqual([
      [A, 17000],
      [B, -4000],
      [C, -13000],
    ]);
  });

  it("orders debts by debtor then creditor in the given member order", () => {
    const group = aGroup({ memberCount: 3 });

    const reversed = balancesOf(
      [C, B, A],
      [
        anExpense({ id: "e-1", group, payerId: A, grosze: 30000 }),
        anExpense({ id: "e-2", group, payerId: B, grosze: 9000 }),
      ],
    );

    expect(reversed.members.map(([userId]) => userId)).toEqual([C, B, A]);
    expect(reversed.debts.map(([debtor, creditor]) => [debtor, creditor])).toEqual([
      [C, B],
      [C, A],
      [B, A],
    ]);
  });

  it("gives a member without expenses a zero balance", () => {
    const result = balancesOf([A, B, C], [anExpense({ group: aGroup({ memberCount: 2 }), payerId: A, grosze: 40000 })]);

    expect(result.members[2]).toEqual([C, 0]);
  });

  it("gives every member zero and no debts for an empty period", () => {
    expect(balancesOf([A, B, C], [])).toEqual({
      members: [
        [A, 0],
        [B, 0],
        [C, 0],
      ],
      debts: [],
    });
  });

  it("shows no debt for a payer who is the only member", () => {
    const group = aGroup({ memberCount: 1 });

    expect(balancesOf([A], [anExpense({ group, payerId: A, grosze: 500 })])).toEqual({
      members: [[A, 0]],
      debts: [],
    });
  });

  it("handles a payer's own remainder grosze: 100 zł among three", () => {
    const group = aGroup({ memberCount: 3 });

    const result = balancesOf([A, B, C], [anExpense({ group, payerId: A, grosze: 10000 })]);

    expect(result.debts).toEqual([
      [B, A, 3333],
      [C, A, 3333],
    ]);
    expect(result.members).toEqual([
      [A, 6666],
      [B, -3333],
      [C, -3333],
    ]);
  });
});

describe("PeriodBalances invariants", () => {
  // A fixed pseudo-random sequence (LCG) keeps the grid deterministic without a property-testing dependency.
  function sequence(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state;
    };
  }

  for (const memberCount of [1, 2, 3, 4, 5, 6]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`holds for ${memberCount} member(s), seed ${seed}`, () => {
        const group = aGroup({ memberCount });
        const next = sequence(seed * 7919 + memberCount);
        const expenses = Array.from({ length: 12 }, (_, position) =>
          anExpense({
            id: `e-${position}`,
            group,
            payerId: memberId(next() % memberCount),
            grosze: 1 + (next() % 100_000_000),
          }),
        );
        const memberIds = group.members.map((member) => member.userId);

        const { members, debts } = PeriodBalances.of({ memberIds, expenses });

        expect(members.reduce((sum, member) => sum + member.balance.grosze, 0)).toBe(0);
        for (const member of members) {
          const incoming = debts.filter((debt) => debt.creditorId === member.userId);
          const outgoing = debts.filter((debt) => debt.debtorId === member.userId);
          const net =
            incoming.reduce((sum, debt) => sum + debt.amount.grosze, 0) -
            outgoing.reduce((sum, debt) => sum + debt.amount.grosze, 0);
          expect(member.balance.grosze).toBe(net);
        }
        for (const debt of debts) {
          expect(debt.amount.isPositive()).toBe(true);
          expect(debts.some((other) => other.debtorId === debt.creditorId && other.creditorId === debt.debtorId)).toBe(
            false,
          );
        }
      });
    }
  }
});
