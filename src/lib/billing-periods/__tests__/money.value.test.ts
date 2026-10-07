import { describe, expect, it } from "vitest";
import { Money } from "@/lib/billing-periods/money.value";

// Intl uses non-breaking spaces; compare on a normalised form.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("Money.parse", () => {
  it.each([
    ["400", 40000],
    ["400,5", 40050],
    ["400.50", 40050],
    ["0,01", 1],
    [" 12 ", 1200],
    ["1000000", 100000000],
    ["1000000,00", 100000000],
  ])("accepts %j as %i grosze", (raw, grosze) => {
    expect(Money.parse(raw)).toEqual({ data: Money.ofGrosze(grosze) });
  });

  it.each(["", "0", "0,00", "-5", "12,345", "1.234,50", "1 234", "1000000,01", "abc", "12,", ",5", "1e3"])(
    "rejects %j",
    (raw) => {
      const result = Money.parse(raw);
      expect("error" in result && result.error.code).toBe("invalid_amount");
    },
  );

  it("rejects an absurdly long number without losing precision", () => {
    const result = Money.parse("9".repeat(40));
    expect("error" in result && result.error.code).toBe("invalid_amount");
  });
});

describe("Money.ofGrosze", () => {
  it("accepts negative integers (balances)", () => {
    expect(Money.ofGrosze(-20000).grosze).toBe(-20000);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (value) => {
    expect(() => Money.ofGrosze(value)).toThrow(RangeError);
  });
});

describe("Money arithmetic and predicates", () => {
  it("adds and subtracts", () => {
    expect(Money.ofGrosze(300).plus(Money.ofGrosze(50)).grosze).toBe(350);
    expect(Money.ofGrosze(300).minus(Money.ofGrosze(500)).grosze).toBe(-200);
  });

  it("tells zero, positive and negative apart", () => {
    expect(Money.ofGrosze(0).isZero()).toBe(true);
    expect(Money.ofGrosze(0).isPositive()).toBe(false);
    expect(Money.ofGrosze(1).isPositive()).toBe(true);
    expect(Money.ofGrosze(-1).isPositive()).toBe(false);
    expect(Money.ofGrosze(-1).isZero()).toBe(false);
  });
});

describe("Money labels", () => {
  it("formats 40000 grosze as 400,00 zł", () => {
    const label = plain(Money.ofGrosze(40000).label());
    expect(label).toContain("400,00");
    expect(label).toContain("zł");
  });

  it("groups thousands", () => {
    expect(plain(Money.ofGrosze(123456789).label())).toBe("1 234 567,89 zł");
  });

  it("signs a positive balance with +", () => {
    expect(plain(Money.ofGrosze(20000).signedLabel())).toBe("+200,00 zł");
  });

  it("signs a negative balance with the minus sign", () => {
    expect(plain(Money.ofGrosze(-20000).signedLabel())).toBe("−200,00 zł");
  });

  it("leaves zero unsigned", () => {
    expect(plain(Money.ofGrosze(0).signedLabel())).toBe("0,00 zł");
  });
});
