import { Money } from "@/lib/billing-periods/money.value";
import type { OpeningDebtSnapshot } from "@/lib/billing-periods/types";

/**
 * A debt carried into a billing period from the period before it: when a period is closed, each non-zero posted
 * pair debt becomes an opening debt of the next period. It is immutable and counts in both balances of the new
 * period like an expense share of the debtor paid by the creditor; ordinary payments settle it. Invariants: the
 * debtor and the creditor differ and the amount is positive.
 */
export class OpeningDebt {
  private constructor(
    readonly debtorId: string,
    readonly creditorId: string,
    readonly amount: Money,
  ) {}

  static of(input: { debtorId: string; creditorId: string; amount: Money }): OpeningDebt {
    if (input.debtorId === input.creditorId) {
      throw new Error(`OpeningDebt: debtor and creditor are the same user (${input.debtorId})`);
    }
    if (!input.amount.isPositive()) {
      throw new Error(`OpeningDebt ${input.debtorId} → ${input.creditorId}: amount must be positive`);
    }
    return new OpeningDebt(input.debtorId, input.creditorId, input.amount);
  }

  /** Rebuilds an opening debt from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: OpeningDebtSnapshot): OpeningDebt {
    return OpeningDebt.of({
      debtorId: snapshot.debtorId,
      creditorId: snapshot.creditorId,
      amount: Money.ofGrosze(snapshot.amountGrosze),
    });
  }

  toSnapshot(): OpeningDebtSnapshot {
    return { debtorId: this.debtorId, creditorId: this.creditorId, amountGrosze: this.amount.grosze };
  }
}
