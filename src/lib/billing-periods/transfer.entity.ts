import { Money } from "@/lib/billing-periods/money.value";
import type { PairDebt } from "@/lib/billing-periods/period-balances.value";
import type { TransferSnapshot } from "@/lib/billing-periods/types";

// Rendered in Europe/Warsaw, like the period's month and the purchase dates.
const SENT_ON_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", month: "short", day: "numeric" });

/** How a mark relates to the current debt of its pair. */
export type TransferState = "current" | "outdated" | "no_debt";

interface TransferInit {
  id: string;
  debtorId: string;
  creditorId: string;
  amount: Money;
  sentAt: Date;
}

/**
 * The debtor's note that they sent `amount` to `creditorId` at `sentAt`. It is a reminder, not a settlement:
 * it never changes balances or debts, and the debt it refers to may change afterwards.
 * Invariants: the debtor and the creditor differ, and the amount is positive.
 */
export class Transfer {
  readonly id: string;
  readonly debtorId: string;
  readonly creditorId: string;
  readonly amount: Money;
  readonly sentAt: Date;

  constructor(state: TransferInit) {
    if (state.debtorId === state.creditorId) {
      throw new Error(`Transfer ${state.id}: debtor and creditor are the same user`);
    }
    if (!state.amount.isPositive()) {
      throw new Error(`Transfer ${state.id}: amount must be positive`);
    }
    if (Number.isNaN(state.sentAt.getTime())) {
      throw new Error(`Transfer ${state.id}: invalid sent time`);
    }
    this.id = state.id;
    this.debtorId = state.debtorId;
    this.creditorId = state.creditorId;
    this.amount = state.amount;
    this.sentAt = state.sentAt;
  }

  /** Rebuilds a mark from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: TransferSnapshot): Transfer {
    return new Transfer({
      id: snapshot.id,
      debtorId: snapshot.debtorId,
      creditorId: snapshot.creditorId,
      amount: Money.ofGrosze(snapshot.amount),
      sentAt: new Date(snapshot.sentAt),
    });
  }

  /** A copy with a new amount and time; the id stays. */
  replace(input: { amount: Money; sentAt: Date }): Transfer {
    return new Transfer({
      id: this.id,
      debtorId: this.debtorId,
      creditorId: this.creditorId,
      amount: input.amount,
      sentAt: input.sentAt,
    });
  }

  /**
   * Compares the mark with the debt in its own direction: "current" when the amounts are equal, "outdated"
   * when the debt differs, "no_debt" when the pair owes nothing that way (settled or turned around).
   */
  stateAgainst(debts: readonly PairDebt[]): { state: TransferState; debt: PairDebt | null } {
    const debt = debts.find(
      (candidate) => candidate.debtorId === this.debtorId && candidate.creditorId === this.creditorId,
    );
    if (!debt) {
      return { state: "no_debt", debt: null };
    }
    return { state: debt.amount.equals(this.amount) ? "current" : "outdated", debt };
  }

  /** The Warsaw calendar day of the mark, e.g. "Oct 20". */
  sentOnLabel(): string {
    return SENT_ON_FORMAT.format(this.sentAt);
  }

  toSnapshot(): TransferSnapshot {
    return {
      id: this.id,
      debtorId: this.debtorId,
      creditorId: this.creditorId,
      amount: this.amount.grosze,
      sentAt: this.sentAt.toISOString(),
    };
  }
}
