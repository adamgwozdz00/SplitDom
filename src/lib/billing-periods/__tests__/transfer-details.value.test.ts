import { describe, expect, it } from "vitest";
import { Money } from "@/lib/billing-periods/money.value";
import { PeriodBalances } from "@/lib/billing-periods/period-balances.value";
import { TransferDetails, creditorIdsOf } from "@/lib/billing-periods/transfer-details.value";
import { Expense } from "@/lib/billing-periods/expense.entity";

describe("TransferDetails", () => {
  it("builds the amount, title and account of a debt", () => {
    const details = TransferDetails.of({
      amount: Money.ofGrosze(40050),
      accountDigits: "34109010140000000000000000",
      groupName: "Mokotów",
      monthLabel: "październik 2026",
    });

    expect(details.amount).toBe("400,50");
    expect(details.title).toBe("SplitDom Mokotów październik 2026");
    expect(details.account).toBe("34109010140000000000000000");
  });

  it("keeps amount and title when the creditor has no account number", () => {
    const details = TransferDetails.of({
      amount: Money.ofGrosze(10000),
      accountDigits: null,
      groupName: "Dom",
      monthLabel: "październik 2026",
    });

    expect(details.account).toBeNull();
    expect(details.amount).toBe("100,00");
  });

  it("truncates a title to 140 characters", () => {
    const details = TransferDetails.of({
      amount: Money.ofGrosze(100),
      accountDigits: null,
      groupName: "🏠".repeat(200),
      monthLabel: "październik 2026",
    });

    expect(Array.from(details.title)).toHaveLength(140);
    expect(details.title.startsWith("SplitDom 🏠")).toBe(true);
  });
});

describe("creditorIdsOf", () => {
  function balances() {
    // u1 paid 300 split by u1,u2,u3: u2 and u3 owe u1 100 each.
    const expense = Expense.restore({
      id: "e1",
      payerId: "u1",
      title: "Rent",
      amount: 30000,
      purchasedOn: "2026-10-01",
      createdAt: "2026-10-01T10:00:00.000Z",
      shares: [
        { userId: "u1", amount: 10000 },
        { userId: "u2", amount: 10000 },
        { userId: "u3", amount: 10000 },
      ],
    });
    return PeriodBalances.of({ memberIds: ["u1", "u2", "u3"], expenses: [expense] });
  }

  it("lists the creditors of the viewer's own debts", () => {
    expect(creditorIdsOf(balances(), "u2")).toEqual(["u1"]);
  });

  it("is empty for a creditor and for a member without debts", () => {
    expect(creditorIdsOf(balances(), "u1")).toEqual([]);
    expect(creditorIdsOf(balances(), "u9")).toEqual([]);
  });
});
