// Billing months follow the household's calendar in Poland, whatever timezone the server runs in.
const WARSAW_CALENDAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "numeric",
});

// The label is rendered from the month's first day in UTC, so it never shifts with the server timezone.
const LABEL_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long" });

const MONTH_DATE = /^(\d{4})-(0[1-9]|1[0-2])-01$/;

/** The calendar month (Europe/Warsaw) a billing period covers. */
export class BillingMonth {
  private constructor(
    private readonly year: number,
    private readonly month: number,
  ) {}

  static of(instant: Date): BillingMonth {
    if (Number.isNaN(instant.getTime())) {
      throw new RangeError("BillingMonth.of: invalid date");
    }
    const parts = WARSAW_CALENDAR.formatToParts(instant);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    return new BillingMonth(year, month);
  }

  /** Parses the stored form, `YYYY-MM-01`; any other format is rejected. */
  static fromDate(date: string): BillingMonth {
    const match = MONTH_DATE.exec(date);
    if (!match) {
      throw new RangeError(`BillingMonth.fromDate: expected YYYY-MM-01, got "${date}"`);
    }
    return new BillingMonth(Number(match[1]), Number(match[2]));
  }

  toDate(): string {
    return `${String(this.year).padStart(4, "0")}-${String(this.month).padStart(2, "0")}-01`;
  }

  /** e.g. "October 2026". */
  label(): string {
    return LABEL_FORMAT.format(new Date(Date.UTC(this.year, this.month - 1, 1)));
  }

  equals(other: BillingMonth): boolean {
    return this.year === other.year && this.month === other.month;
  }
}
