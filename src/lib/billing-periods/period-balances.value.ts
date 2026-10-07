import { Money } from "@/lib/billing-periods/money.value";
import type { ExpenseShare } from "@/lib/billing-periods/split-policy";

export interface MemberBalance {
  readonly userId: string;
  /** Paid minus own shares: positive when the member is owed money, negative when they owe. */
  readonly balance: Money;
}

/** What balances need from an expense: who paid and how it was split. */
export interface PaidExpense {
  readonly payerId: string;
  readonly shares: readonly ExpenseShare[];
}

export interface PairDebt {
  readonly debtorId: string;
  readonly creditorId: string;
  readonly amount: Money;
}

/**
 * Each member's balance and the netted debt of each pair of members, derived from one period's expenses.
 * "A owes B" is A's shares in expenses B paid minus B's shares in expenses A paid, kept only when positive,
 * so a pair never appears in both directions and each balance equals incoming minus outgoing debts.
 * Only the given members count; an expense share held by anyone else is ignored.
 */
export class PeriodBalances {
  private constructor(
    readonly members: readonly MemberBalance[],
    readonly debts: readonly PairDebt[],
  ) {}

  static of(input: { memberIds: readonly string[]; expenses: readonly PaidExpense[] }): PeriodBalances {
    const { memberIds, expenses } = input;
    const index = new Map(memberIds.map((id, position) => [id, position]));
    const size = memberIds.length;

    const balance = new Array<number>(size).fill(0);
    // owed[a][b]: grosze member a owes member b through expenses b paid.
    const owed = Array.from({ length: size }, () => new Array<number>(size).fill(0));

    for (const expense of expenses) {
      const payer = index.get(expense.payerId);
      if (payer === undefined) {
        continue;
      }
      for (const share of expense.shares) {
        const debtor = index.get(share.userId);
        if (debtor === undefined) {
          continue;
        }
        balance[payer] = (balance[payer] ?? 0) + share.amount.grosze;
        balance[debtor] = (balance[debtor] ?? 0) - share.amount.grosze;
        if (debtor !== payer) {
          owed[debtor][payer] = (owed[debtor][payer] ?? 0) + share.amount.grosze;
        }
      }
    }

    const members = memberIds.map((userId, position) => ({
      userId,
      balance: Money.ofGrosze(balance[position] ?? 0),
    }));

    const debts: PairDebt[] = [];
    for (let debtor = 0; debtor < size; debtor += 1) {
      for (let creditor = 0; creditor < size; creditor += 1) {
        const net = owed[debtor][creditor] - owed[creditor][debtor];
        if (net > 0) {
          debts.push({ debtorId: memberIds[debtor], creditorId: memberIds[creditor], amount: Money.ofGrosze(net) });
        }
      }
    }

    return new PeriodBalances(members, debts);
  }
}
