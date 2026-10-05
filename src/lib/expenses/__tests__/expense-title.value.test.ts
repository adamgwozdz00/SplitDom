import { describe, expect, it } from "vitest";
import { ExpenseTitle } from "@/lib/expenses/expense-title.value";

describe("ExpenseTitle.create", () => {
  it("trims the title", () => {
    expect(ExpenseTitle.create("  Czynsz ")).toEqual({ data: ExpenseTitle.fromStored("Czynsz") });
  });

  it.each(["", "   ", "​​"])("rejects the empty or invisible-only title %j", (raw) => {
    const result = ExpenseTitle.create(raw);
    expect("error" in result && result.error.code).toBe("invalid_expense_title");
  });

  it("accepts 60 code points and rejects 61", () => {
    expect("data" in ExpenseTitle.create("a".repeat(60))).toBe(true);
    const tooLong = ExpenseTitle.create("a".repeat(61));
    expect("error" in tooLong && tooLong.error.code).toBe("invalid_expense_title");
  });

  it("counts an emoji as one code point", () => {
    expect("data" in ExpenseTitle.create("🍕".repeat(60))).toBe(true);
    expect("error" in ExpenseTitle.create("🍕".repeat(61))).toBe(true);
  });
});

describe("ExpenseTitle.fromStored", () => {
  it("restores a stored title without applying the creation rule", () => {
    expect(ExpenseTitle.fromStored("a".repeat(80)).value).toHaveLength(80);
  });

  it("rejects an empty stored title", () => {
    expect(() => ExpenseTitle.fromStored("")).toThrow();
  });
});
