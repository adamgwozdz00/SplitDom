import { expenseError } from "@/lib/expenses/expense-error.messages";
import type { Result } from "@/lib/expenses/types";

const AMOUNT_INPUT = /^(\d+)(?:[.,](\d{1,2}))?$/;

const PLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

const MINUS = "−";

/** An amount of money in integer grosze. Signed, so balances (which can be negative) share it with expense amounts. */
export class Money {
  /** The range of an expense amount: 0,01 zł to 1 000 000,00 zł. */
  static readonly MIN_EXPENSE_GROSZE = 1;
  static readonly MAX_EXPENSE_GROSZE = 100_000_000;

  private constructor(readonly grosze: number) {}

  /** Parses a form amount such as "400", "400,5" or "400.50": no thousands separators, at most 2 decimals. */
  static parse(raw: string): Result<Money> {
    const match = AMOUNT_INPUT.exec(raw.trim());
    if (!match) {
      return expenseError("invalid_amount");
    }
    const grosze = Number(match[1]) * 100 + Number((match.at(2) ?? "").padEnd(2, "0"));
    if (!Number.isSafeInteger(grosze) || grosze < Money.MIN_EXPENSE_GROSZE || grosze > Money.MAX_EXPENSE_GROSZE) {
      return expenseError("invalid_amount");
    }
    return { data: new Money(grosze) };
  }

  static ofGrosze(grosze: number): Money {
    if (!Number.isSafeInteger(grosze)) {
      throw new RangeError(`Money.ofGrosze: expected a safe integer, got ${grosze}`);
    }
    return new Money(grosze);
  }

  plus(other: Money): Money {
    return Money.ofGrosze(this.grosze + other.grosze);
  }

  minus(other: Money): Money {
    return Money.ofGrosze(this.grosze - other.grosze);
  }

  isZero(): boolean {
    return this.grosze === 0;
  }

  isPositive(): boolean {
    return this.grosze > 0;
  }

  equals(other: Money): boolean {
    return this.grosze === other.grosze;
  }

  /** e.g. "400,00 zł" (the separators are non-breaking spaces). */
  label(): string {
    return PLN.format(this.grosze / 100);
  }

  /** `label()` with an explicit sign: "+200,00 zł", "−200,00 zł", and plain "0,00 zł" for zero. */
  signedLabel(): string {
    if (this.grosze === 0) {
      return this.label();
    }
    const magnitude = PLN.format(Math.abs(this.grosze) / 100);
    return `${this.grosze > 0 ? "+" : MINUS}${magnitude}`;
  }
}
