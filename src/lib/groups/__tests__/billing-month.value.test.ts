import { describe, expect, it } from "vitest";
import { BillingMonth } from "@/lib/groups/billing-month.value";

describe("BillingMonth", () => {
  it.each([
    ["2026-10-15T12:00:00Z", "2026-10-01"],
    // Warsaw is already on 1 November.
    ["2026-10-31T23:30:00Z", "2026-11-01"],
    // Winter offset +01:00.
    ["2026-11-30T22:59:59Z", "2026-11-01"],
    ["2026-11-30T23:00:00Z", "2026-12-01"],
    // Summer offset +02:00, so a hard-coded +1 hour fails here.
    ["2026-07-31T21:59:59Z", "2026-07-01"],
    ["2026-07-31T22:00:00Z", "2026-08-01"],
  ])("puts %s in the Warsaw month %s", (instant, month) => {
    expect(BillingMonth.of(new Date(instant)).toDate()).toBe(month);
  });

  it("labels the Warsaw month of a UTC instant that is still the previous month in UTC", () => {
    const month = BillingMonth.of(new Date("2026-10-31T23:30:00Z"));

    expect(month.toDate()).toBe("2026-11-01");
    expect(month.label()).toBe("November 2026");
  });

  it("labels a month in English", () => {
    expect(BillingMonth.fromDate("2026-10-01").label()).toBe("October 2026");
  });

  it("round-trips the stored form", () => {
    expect(BillingMonth.fromDate("2026-01-01").toDate()).toBe("2026-01-01");
  });

  it.each(["2026-10-15", "2026-13-01", "2026-10", "01-10-2026", ""])("fromDate rejects %j", (date) => {
    expect(() => BillingMonth.fromDate(date)).toThrow();
  });

  it("rejects an invalid instant", () => {
    expect(() => BillingMonth.of(new Date("not a date"))).toThrow();
  });

  it("compares by month", () => {
    const october = BillingMonth.fromDate("2026-10-01");

    expect(october.equals(BillingMonth.of(new Date("2026-10-15T12:00:00Z")))).toBe(true);
    expect(october.equals(BillingMonth.fromDate("2026-11-01"))).toBe(false);
  });
});
