import { billingPeriodError } from "@/lib/billing-periods/billing-period-error.messages";
import { ExpenseTitle } from "@/lib/billing-periods/expense-title.value";
import { Money } from "@/lib/billing-periods/money.value";
import { PurchaseDate } from "@/lib/billing-periods/purchase-date.value";
import type { ExpenseSnapshot, Result } from "@/lib/billing-periods/types";
import type { Group } from "@/lib/groups";

export interface ExpenseShare {
  readonly userId: string;
  readonly amount: Money;
}

interface ExpenseState {
  id: string;
  groupId: string;
  periodId: string;
  payerId: string;
  title: ExpenseTitle;
  amount: Money;
  purchasedOn: PurchaseDate;
  createdAt: Date;
  shares: readonly ExpenseShare[];
}

/**
 * One purchase paid by a member of a group during its open billing period, with its stored equal split.
 * Every member at that moment owes `floor(amount / n)`; the payer's share also absorbs the leftover
 * grosze (`amount mod n`). Shares always sum to the amount.
 */
export class Expense {
  readonly id: string;
  readonly groupId: string;
  readonly periodId: string;
  readonly payerId: string;
  readonly title: ExpenseTitle;
  readonly amount: Money;
  readonly purchasedOn: PurchaseDate;
  readonly createdAt: Date;
  readonly shares: readonly ExpenseShare[];

  private constructor(state: ExpenseState) {
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
    this.groupId = state.groupId;
    this.periodId = state.periodId;
    this.payerId = state.payerId;
    this.title = state.title;
    this.amount = state.amount;
    this.purchasedOn = state.purchasedOn;
    this.createdAt = state.createdAt;
    this.shares = Object.freeze(state.shares.map((share) => Object.freeze({ ...share })));
  }

  /** Adds an expense to the group's open period, split equally between its current members. */
  static add(input: {
    id: string;
    group: Group;
    payerId: string;
    title: ExpenseTitle;
    amount: Money;
    purchasedOn: PurchaseDate;
    now: Date;
  }): Result<Expense> {
    const { group, payerId, amount } = input;
    if (!group.isMember(payerId)) {
      return billingPeriodError("group_not_found", { groupId: group.id });
    }
    const count = group.members.length;
    const each = Math.floor(amount.grosze / count);
    const remainder = amount.grosze % count;
    return {
      data: new Expense({
        id: input.id,
        groupId: group.id,
        periodId: group.openPeriod.id,
        payerId,
        title: input.title,
        amount,
        purchasedOn: input.purchasedOn,
        createdAt: input.now,
        shares: group.members.map((member) => ({
          userId: member.userId,
          amount: Money.ofGrosze(member.userId === payerId ? each + remainder : each),
        })),
      }),
    };
  }

  /** Rebuilds an expense from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: ExpenseSnapshot): Expense {
    return new Expense({
      id: snapshot.id,
      groupId: snapshot.groupId,
      periodId: snapshot.periodId,
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
      groupId: this.groupId,
      periodId: this.periodId,
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
