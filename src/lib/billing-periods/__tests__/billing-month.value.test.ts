import { describe, expect, it } from "vitest";
import { BillingMonth } from "@/lib/billing-periods/billing-month.value";

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

  it.each([
    ["2026-10-01", "2026-11-01"],
    // December rolls over to January of the next year.
    ["2026-12-01", "2027-01-01"],
    ["2027-01-01", "2027-02-01"],
  ])("puts %s before the next month %s", (month, next) => {
    expect(BillingMonth.fromDate(month).next().toDate()).toBe(next);
    expect(BillingMonth.fromDate(next).previous().toDate()).toBe(month);
  });

  it("makes previous() the inverse of next()", () => {
    const december = BillingMonth.fromDate("2026-12-01");

    expect(december.next().previous().equals(december)).toBe(true);
    expect(december.previous().next().equals(december)).toBe(true);
  });

  describe("hasEndedAt", () => {
    it.each([
      // Winter offset +01:00 (DST ended on 25 October 2026).
      ["2026-10-01", "2026-10-31T22:30:00Z", false],
      ["2026-10-01", "2026-10-31T23:30:00Z", true],
      // Summer offset +02:00.
      ["2026-07-01", "2026-07-31T21:30:00Z", false],
      ["2026-07-01", "2026-07-31T22:30:00Z", true],
      // DST started on 29 March 2026, so the end of March is already +02:00.
      ["2026-03-01", "2026-03-31T21:30:00Z", false],
      ["2026-03-01", "2026-03-31T22:30:00Z", true],
      // December ends into the next year.
      ["2026-12-01", "2026-12-31T22:30:00Z", false],
      ["2026-12-01", "2026-12-31T23:30:00Z", true],
    ])("judges %s as ended at %s: %s (23:30 on the last day vs 00:30 on the 1st, Warsaw)", (month, instant, ended) => {
      expect(BillingMonth.fromDate(month).hasEndedAt(new Date(instant))).toBe(ended);
    });

    it("is true long after the month and false before it started", () => {
      const october = BillingMonth.fromDate("2026-10-01");

      expect(october.hasEndedAt(new Date("2027-03-15T12:00:00Z"))).toBe(true);
      expect(october.hasEndedAt(new Date("2026-09-15T12:00:00Z"))).toBe(false);
    });
  });
});
