import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import type { Result } from "@/lib/billing-periods/types";

// A title must show something in the list, so invisible-only input (e.g. U+200B) is not a title.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

export class ExpenseTitle {
  static readonly MAX_LENGTH = 60;

  private constructor(readonly value: string) {}

  static create(raw: string): Result<ExpenseTitle> {
    const value = raw.trim();
    // Count code points, not UTF-16 units, to match Postgres char_length() on the stored title.
    const length = Array.from(value).length;
    if (length < 1 || length > ExpenseTitle.MAX_LENGTH || !VISIBLE.test(value)) {
      return billingPeriodError("invalid_expense_title", { length });
    }
    return { data: new ExpenseTitle(value) };
  }

  /** Rebuilds a title that was already accepted and stored, without applying the creation rule again. */
  static fromStored(value: string): ExpenseTitle {
    if (value.length === 0) {
      throw new Error("ExpenseTitle.fromStored: empty stored title");
    }
    return new ExpenseTitle(value);
  }
}
