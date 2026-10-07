import { Money } from "@/lib/billing-periods/money.value";

/** What one participant owes for one expense. */
export interface ExpenseShare {
  readonly userId: string;
  readonly amount: Money;
}

/** How an expense amount is divided between a period's participants. */
export interface SplitPolicy {
  split(input: { amount: Money; participants: readonly string[]; payerId: string }): ExpenseShare[];
}

/**
 * Every participant owes `floor(amount / n)`; the payer's share also absorbs the leftover grosze
 * (`amount mod n`). Shares follow the participants' order and always sum to the amount.
 */
export class EqualSplitPolicy implements SplitPolicy {
  split(input: { amount: Money; participants: readonly string[]; payerId: string }): ExpenseShare[] {
    const { amount, participants, payerId } = input;
    const count = participants.length;
    const each = Math.floor(amount.grosze / count);
    const remainder = amount.grosze % count;
    return participants.map((userId) => ({
      userId,
      amount: Money.ofGrosze(userId === payerId ? each + remainder : each),
    }));
  }
}
