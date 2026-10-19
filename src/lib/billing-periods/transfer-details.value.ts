import type { Money } from "@/lib/billing-periods/money.value";
import type { PeriodBalances } from "@/lib/billing-periods/period-balances.value";

const TITLE_PREFIX = "SplitDom";
const MAX_TITLE_LENGTH = 140;

/** The members `debtorId` owes money to in these balances: the only ones whose account numbers they may see. */
export function creditorIdsOf(balances: PeriodBalances, debtorId: string): string[] {
  return balances.debts.filter((debt) => debt.debtorId === debtorId).map((debt) => debt.creditorId);
}

/**
 * Plain text a debtor pastes into any online banking to settle one debt. `account` is the creditor's 26
 * digits, or null when they have not provided one yet.
 */
export class TransferDetails {
  private constructor(
    /** The amount as typed into a bank form, e.g. `400,50`. */
    readonly amount: string,
    readonly title: string,
    readonly account: string | null,
  ) {}

  static of(input: {
    amount: Money;
    accountDigits: string | null;
    groupName: string;
    monthLabel: string;
  }): TransferDetails {
    // Count code points, not UTF-16 units, so a title never ends on half an emoji.
    const title = Array.from(`${TITLE_PREFIX} ${input.groupName} ${input.monthLabel}`)
      .slice(0, MAX_TITLE_LENGTH)
      .join("");
    return new TransferDetails(input.amount.formInput(), title, input.accountDigits);
  }
}
