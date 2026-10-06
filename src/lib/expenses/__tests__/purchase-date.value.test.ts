import { describe, expect, it } from "vitest";
import { PurchaseDate } from "@/lib/expenses/purchase-date.value";
import { BillingMonth } from "@/lib/groups";

const OCTOBER = BillingMonth.fromDate("2026-10-01");
const NOVEMBER = BillingMonth.fromDate("2026-11-01");
const MID_OCTOBER = new Date("2026-10-15T12:00:00.000Z");

function created(raw: string, month: BillingMonth, now: Date) {
  return PurchaseDate.create(raw, { month, now });
}

describe("PurchaseDate.create", () => {
  it("accepts a day inside the period month, up to today", () => {
    expect(created("2026-10-01", OCTOBER, MID_OCTOBER)).toEqual({ data: PurchaseDate.fromStored("2026-10-01") });
    expect(created("2026-10-15", OCTOBER, MID_OCTOBER)).toEqual({ data: PurchaseDate.fromStored("2026-10-15") });
  });

  it.each(["", "2026-10-1", "15-10-2026", "2026/10/10", "2026-10-10T00:00", "abc", "2026-13-01", "2026-00-10"])(
    "rejects the badly formatted %j",
    (raw) => {
      const result = created(raw, OCTOBER, MID_OCTOBER);
      expect("error" in result && result.error.code).toBe("invalid_purchase_date");
    },
  );

  it("rejects an impossible calendar date", () => {
    const result = created("2026-02-30", BillingMonth.fromDate("2026-02-01"), new Date("2026-02-28T12:00:00.000Z"));
    expect("error" in result && result.error.code).toBe("invalid_purchase_date");
  });

  it("rejects a date outside the period month", () => {
    for (const raw of ["2026-09-30", "2026-11-01"]) {
      const result = created(raw, OCTOBER, new Date("2026-11-05T12:00:00.000Z"));
      expect("error" in result && result.error.code).toBe("invalid_purchase_date");
    }
  });

  it("rejects a future date", () => {
    const result = created("2026-10-16", OCTOBER, MID_OCTOBER);
    expect("error" in result && result.error.code).toBe("invalid_purchase_date");
  });

  it("uses the Warsaw calendar day: 23:30 UTC on 31 Oct is already 1 Nov", () => {
    const now = new Date("2026-10-31T23:30:00.000Z");

    expect(PurchaseDate.window(OCTOBER, now).max).toBe("2026-10-31");
    expect("data" in created("2026-10-31", OCTOBER, now)).toBe(true);
    expect("data" in created("2026-11-01", NOVEMBER, now)).toBe(true);
  });

  it("does not accept a Warsaw-tomorrow date that is still today in UTC", () => {
    const now = new Date("2026-10-14T23:30:00.000Z");

    expect("data" in created("2026-10-15", OCTOBER, now)).toBe(true);
    expect("error" in created("2026-10-16", OCTOBER, now)).toBe(true);
  });
});

describe("PurchaseDate.window", () => {
  it("defaults to today inside the period month", () => {
    expect(PurchaseDate.window(OCTOBER, MID_OCTOBER)).toEqual({
      min: "2026-10-01",
      max: "2026-10-15",
      default: "2026-10-15",
    });
  });

  it("defaults to the last day of the month when the month has ended", () => {
    expect(PurchaseDate.window(OCTOBER, new Date("2026-11-03T12:00:00.000Z"))).toEqual({
      min: "2026-10-01",
      max: "2026-10-31",
      default: "2026-10-31",
    });
  });

  it("handles a leap-year February", () => {
    expect(PurchaseDate.window(BillingMonth.fromDate("2028-02-01"), new Date("2028-03-05T12:00:00.000Z")).max).toBe(
      "2028-02-29",
    );
  });
});

describe("PurchaseDate", () => {
  it("exposes its month", () => {
    expect(PurchaseDate.fromStored("2026-10-05").month().equals(OCTOBER)).toBe(true);
  });

  it("labels in English without shifting", () => {
    expect(PurchaseDate.fromStored("2026-10-05").label()).toBe("5 Oct 2026");
    expect(PurchaseDate.fromStored("2026-09-30").label()).toBe("30 Sep 2026");
  });

  it("rejects a malformed stored value", () => {
    expect(() => PurchaseDate.fromStored("2026-02-30")).toThrow();
    expect(() => PurchaseDate.fromStored("nope")).toThrow();
  });
});
