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

/** What balances need from a payment: who sent money to whom. */
export interface PaymentBetween {
  readonly senderId: string;
  readonly recipientId: string;
  readonly amount: Money;
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
 * A payment from B to A counts like money B gave A: it raises B's balance, lowers A's and counts as a debt of A
 * to B in the pair netting, so it can settle a debt or turn it around.
 * An opening debt of A to B (carried from the previous period) counts like an expense share of A paid by B: it
 * lowers A's balance, raises B's and adds to what A owes B in the pair netting.
 * Only the given members count; an expense share, payment or opening debt of anyone else is ignored.
 */
export class PeriodBalances {
  private constructor(
    readonly members: readonly MemberBalance[],
    readonly debts: readonly PairDebt[],
  ) {}

  static of(input: {
    memberIds: readonly string[];
    expenses: readonly PaidExpense[];
    payments?: readonly PaymentBetween[];
    openingDebts?: readonly PairDebt[];
  }): PeriodBalances {
    const { memberIds, expenses, payments = [], openingDebts = [] } = input;
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

    for (const payment of payments) {
      const sender = index.get(payment.senderId);
      const recipient = index.get(payment.recipientId);
      if (sender === undefined || recipient === undefined || sender === recipient) {
        continue;
      }
      balance[sender] = (balance[sender] ?? 0) + payment.amount.grosze;
      balance[recipient] = (balance[recipient] ?? 0) - payment.amount.grosze;
      owed[recipient][sender] = (owed[recipient][sender] ?? 0) + payment.amount.grosze;
    }

    for (const opening of openingDebts) {
      const debtor = index.get(opening.debtorId);
      const creditor = index.get(opening.creditorId);
      if (debtor === undefined || creditor === undefined || debtor === creditor) {
        continue;
      }
      balance[creditor] = (balance[creditor] ?? 0) + opening.amount.grosze;
      balance[debtor] = (balance[debtor] ?? 0) - opening.amount.grosze;
      owed[debtor][creditor] = (owed[debtor][creditor] ?? 0) + opening.amount.grosze;
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
