import { describe, expect, it } from "vitest";
import { Money } from "@/lib/billing-periods/money.value";
import { OpeningDebt } from "@/lib/billing-periods/opening-debt.value";

describe("OpeningDebt", () => {
  it("carries a debtor, a creditor and a positive amount, and round-trips its snapshot", () => {
    const debt = OpeningDebt.of({ debtorId: "b", creditorId: "a", amount: Money.ofGrosze(5000) });

    expect([debt.debtorId, debt.creditorId, debt.amount.grosze]).toEqual(["b", "a", 5000]);
    expect(debt.toSnapshot()).toEqual({ debtorId: "b", creditorId: "a", amountGrosze: 5000 });
    expect(OpeningDebt.restore(debt.toSnapshot())).toEqual(debt);
  });

  it("refuses the same member on both sides", () => {
    expect(() => OpeningDebt.of({ debtorId: "a", creditorId: "a", amount: Money.ofGrosze(5000) })).toThrow();
  });

  it.each([0, -1])("refuses an amount of %i grosze", (grosze) => {
    expect(() => OpeningDebt.of({ debtorId: "b", creditorId: "a", amount: Money.ofGrosze(grosze) })).toThrow();
    expect(() => OpeningDebt.restore({ debtorId: "b", creditorId: "a", amountGrosze: grosze })).toThrow();
  });
});
