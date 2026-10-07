import { describe, expect, it } from "vitest";
import { Money } from "@/lib/billing-periods/money.value";
import { EqualSplitPolicy } from "@/lib/billing-periods/split-policy";

const policy = new EqualSplitPolicy();

function split(grosze: number, participants: readonly string[], payerId: string) {
  return policy
    .split({ amount: Money.ofGrosze(grosze), participants, payerId })
    .map((share) => ({ userId: share.userId, grosze: share.amount.grosze }));
}

describe("EqualSplitPolicy", () => {
  it("splits 400 zł between two participants into 200 zł each (US-01)", () => {
    expect(split(40000, ["a", "b"], "b")).toEqual([
      { userId: "a", grosze: 20000 },
      { userId: "b", grosze: 20000 },
    ]);
  });

  it("lets the payer absorb the leftover grosz when 100 zł is split three ways, in participant order", () => {
    expect(split(10000, ["a", "b", "c"], "b")).toEqual([
      { userId: "a", grosze: 3333 },
      { userId: "b", grosze: 3334 },
      { userId: "c", grosze: 3333 },
    ]);
  });

  it("charges the whole amount to a payer who is the only participant", () => {
    expect(split(123, ["a"], "a")).toEqual([{ userId: "a", grosze: 123 }]);
  });

  describe("invariants", () => {
    const amounts = [1, 2, 3, 99, 100, 101, 9999, 10000, 10001, 99999999, 100000000];
    const counts = [1, 2, 3, 4, 5, 6];

    for (const grosze of amounts) {
      for (const count of counts) {
        it(`splits ${grosze} grosze between ${count} participant(s) for every payer`, () => {
          const participants = Array.from({ length: count }, (_, position) => `p-${position}`);
          for (const payerId of participants) {
            const shares = split(grosze, participants, payerId);
            const floor = Math.floor(grosze / count);
            const remainder = grosze % count;

            expect(shares.reduce((sum, share) => sum + share.grosze, 0)).toBe(grosze);
            expect(shares.map((share) => share.userId)).toEqual(participants);
            for (const share of shares) {
              expect(share.grosze).toBe(share.userId === payerId ? floor + remainder : floor);
            }
          }
        });
      }
    }
  });
});
