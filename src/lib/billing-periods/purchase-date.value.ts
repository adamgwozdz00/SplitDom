import { BillingMonth } from "@/lib/billing-periods/billing-month.value";
import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { Result } from "@/lib/billing-periods/types";

// "Today" is the household's calendar day in Poland, whatever timezone the server runs in.
const WARSAW_CALENDAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

// Rendered from the stored calendar day as a UTC instant, so it never shifts with the server timezone.
const LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface PurchaseDateWindow {
  /** First day of the period month. */
  min: string;
  /** The earlier of the period month's last day and today. */
  max: string;
  /** Today when it falls in the period month, otherwise the month's last day. */
  default: string;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function format(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Parses `YYYY-MM-DD` into parts, or null when it is not a real calendar date. */
function parseCalendarDate(raw: string): { year: number; month: number; day: number } | null {
  const match = DATE_INPUT.exec(raw);
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  probe.setUTCFullYear(year);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function todayInWarsaw(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("PurchaseDate: invalid current time");
  }
  const parts = WARSAW_CALENDAR.formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return format(part("year"), part("month"), part("day"));
}

/** The calendar day an expense was bought. It must fall inside the open period's month and not be in the future. */
export class PurchaseDate {
  private constructor(readonly value: string) {}

  static window(month: BillingMonth, now: Date): PurchaseDateWindow {
    const first = month.toDate();
    const [year, monthNumber] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const last = format(year, monthNumber, lastDay);
    const today = todayInWarsaw(now);
    const inMonth = today >= first && today <= last;
    return {
      min: first,
      max: today < last ? today : last,
      default: inMonth ? today : last,
    };
  }

  static create(raw: string, context: { month: BillingMonth; now: Date }): Result<PurchaseDate> {
    if (!parseCalendarDate(raw)) {
      return billingPeriodError("invalid_purchase_date", { value: raw });
    }
    const window = PurchaseDate.window(context.month, context.now);
    if (raw < window.min || raw > window.max) {
      return billingPeriodError("invalid_purchase_date", { value: raw, min: window.min, max: window.max });
    }
    return { data: new PurchaseDate(raw) };
  }

  /** Rebuilds a stored date without applying the window rule again; the format is still checked. */
  static fromStored(value: string): PurchaseDate {
    if (!parseCalendarDate(value)) {
      throw new RangeError(`PurchaseDate.fromStored: expected YYYY-MM-DD, got "${value}"`);
    }
    return new PurchaseDate(value);
  }

  month(): BillingMonth {
    return BillingMonth.fromDate(`${this.value.slice(0, 7)}-01`);
  }

  /** e.g. "5 Oct 2026". */
  label(): string {
    const parsed = parseCalendarDate(this.value);
    if (!parsed) {
      return this.value;
    }
    const instant = new Date(Date.UTC(2000, parsed.month - 1, parsed.day));
    instant.setUTCFullYear(parsed.year);
    const parts = LABEL_FORMAT.formatToParts(instant);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("day")} ${part("month")} ${part("year")}`;
  }

  equals(other: PurchaseDate): boolean {
    return this.value === other.value;
  }
}
