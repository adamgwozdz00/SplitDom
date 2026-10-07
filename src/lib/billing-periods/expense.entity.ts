import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { ExpenseShare } from "@/lib/billing-periods/split-policy";
import type { ExpenseSnapshot } from "@/lib/billing-periods/types";

interface ExpenseState {
  id: string;
  payerId: string;
  title: ExpenseTitle;
  amount: Money;
  purchasedOn: PurchaseDate;
  createdAt: Date;
  shares: readonly ExpenseShare[];
}

/**
 * One purchase inside a billing period, with its stored split. It keeps its own id because it will be
 * edited and deleted (S-05); the period it belongs to owns the group and period ids.
 * Invariants: at least one share, the payer has a share, one share per user, no negative share,
 * and the shares sum to the amount.
 */
export class Expense {
  readonly id: string;
  readonly payerId: string;
  readonly title: ExpenseTitle;
  readonly amount: Money;
  readonly purchasedOn: PurchaseDate;
  readonly createdAt: Date;
  readonly shares: readonly ExpenseShare[];

  constructor(state: ExpenseState) {
    if (state.shares.length === 0) {
      throw new Error(`Expense ${state.id}: no shares`);
    }
    if (!state.shares.some((share) => share.userId === state.payerId)) {
      throw new Error(`Expense ${state.id}: the payer has no share`);
    }
    if (new Set(state.shares.map((share) => share.userId)).size !== state.shares.length) {
      throw new Error(`Expense ${state.id}: duplicate share user`);
    }
    if (state.shares.some((share) => share.amount.grosze < 0)) {
      throw new Error(`Expense ${state.id}: negative share`);
    }
    const total = state.shares.reduce((sum, share) => sum + share.amount.grosze, 0);
    if (total !== state.amount.grosze) {
      throw new Error(`Expense ${state.id}: shares sum to ${total}, not ${state.amount.grosze}`);
    }
    this.id = state.id;
    this.payerId = state.payerId;
    this.title = state.title;
    this.amount = state.amount;
    this.purchasedOn = state.purchasedOn;
    this.createdAt = state.createdAt;
    this.shares = Object.freeze(state.shares.map((share) => Object.freeze({ ...share })));
  }

  /** Rebuilds an expense from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: ExpenseSnapshot): Expense {
    return new Expense({
      id: snapshot.id,
      payerId: snapshot.payerId,
      title: ExpenseTitle.fromStored(snapshot.title),
      amount: Money.ofGrosze(snapshot.amount),
      purchasedOn: PurchaseDate.fromStored(snapshot.purchasedOn),
      createdAt: parseInstant(snapshot.createdAt),
      shares: snapshot.shares.map((share) => ({ userId: share.userId, amount: Money.ofGrosze(share.amount) })),
    });
  }

  toSnapshot(): ExpenseSnapshot {
    return {
      id: this.id,
      payerId: this.payerId,
      title: this.title.value,
      amount: this.amount.grosze,
      purchasedOn: this.purchasedOn.value,
      createdAt: this.createdAt.toISOString(),
      shares: this.shares.map((share) => ({ userId: share.userId, amount: share.amount.grosze })),
    };
  }
}

function parseInstant(value: string): Date {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid stored timestamp "${value}"`);
  }
  return instant;
}
