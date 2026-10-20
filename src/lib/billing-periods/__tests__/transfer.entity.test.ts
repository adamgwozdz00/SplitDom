import { describe, expect, it } from "vitest";
import { Money } from "@/lib/billing-periods/money.value";
import type { PairDebt } from "@/lib/billing-periods/period-balances.value";
import { Transfer } from "@/lib/billing-periods/transfer.entity";
import type { TransferSnapshot } from "@/lib/billing-periods/types";

const DEBTOR = "debtor";
const CREDITOR = "creditor";

const snapshot: TransferSnapshot = {
  id: "t-1",
  debtorId: DEBTOR,
  creditorId: CREDITOR,
  amount: 40000,
  sentAt: "2026-10-20T10:00:00.000Z",
};

function debt(
  grosze: number,
  direction: { debtorId: string; creditorId: string } = { debtorId: DEBTOR, creditorId: CREDITOR },
): PairDebt {
  return { ...direction, amount: Money.ofGrosze(grosze) };
}

describe("Transfer.restore", () => {
  it("round-trips a snapshot", () => {
    expect(Transfer.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it.each([
    ["the debtor and the creditor being the same user", { creditorId: DEBTOR }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -100 }],
    ["an unparseable timestamp", { sentAt: "not a date" }],
  ])("rejects %s", (_, override) => {
    expect(() => Transfer.restore({ ...snapshot, ...override })).toThrow();
  });
});

describe("Transfer.stateAgainst", () => {
  const transfer = Transfer.restore(snapshot);

  it("is current when the debt in the same direction has the same amount", () => {
    const debts = [debt(40000)];
    expect(transfer.stateAgainst(debts)).toEqual({ state: "current", debt: debts[0] });
  });

  it.each([
    ["larger", 45000],
    ["smaller", 30000],
  ])("is outdated when the debt is %s", (_, grosze) => {
    const debts = [debt(grosze)];
    expect(transfer.stateAgainst(debts)).toEqual({ state: "outdated", debt: debts[0] });
  });

  it("has no debt when the pair owes nothing", () => {
    expect(transfer.stateAgainst([])).toEqual({ state: "no_debt", debt: null });
  });

  it("has no debt when the debt went the other way", () => {
    expect(transfer.stateAgainst([debt(40000, { debtorId: CREDITOR, creditorId: DEBTOR })])).toEqual({
      state: "no_debt",
      debt: null,
    });
  });

  it("ignores debts of other pairs", () => {
    expect(transfer.stateAgainst([debt(40000, { debtorId: DEBTOR, creditorId: "other" })]).state).toBe("no_debt");
  });
});

describe("Transfer.replace", () => {
  it("keeps the id and takes the new amount and time", () => {
    const replaced = Transfer.restore(snapshot).replace({
      amount: Money.ofGrosze(45000),
      sentAt: new Date("2026-10-21T08:00:00.000Z"),
    });

    expect(replaced.toSnapshot()).toEqual({ ...snapshot, amount: 45000, sentAt: "2026-10-21T08:00:00.000Z" });
  });
});

describe("Transfer.sentOnLabel", () => {
  it("shows the Warsaw calendar day", () => {
    expect(Transfer.restore(snapshot).sentOnLabel()).toBe("Oct 20");
    // 23:30 UTC on 20 October is already 21 October in Warsaw.
    expect(Transfer.restore({ ...snapshot, sentAt: "2026-10-20T23:30:00.000Z" }).sentOnLabel()).toBe("Oct 21");
  });
});
