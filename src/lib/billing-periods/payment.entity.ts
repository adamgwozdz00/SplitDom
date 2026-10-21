import { Money } from "@/lib/billing-periods/money.value";
import type { PaymentSnapshot } from "@/lib/billing-periods/types";

// Rendered in Europe/Warsaw, like the period's month and the purchase dates.
const SENT_ON_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", month: "short", day: "numeric" });

interface PaymentState {
  id: string;
  senderId: string;
  recipientId: string;
  amount: Money;
  sentAt: Date;
  confirmedAt: Date | null;
}

/**
 * One bank transfer the sender reports having made to the recipient: an entry in the period's ledger, next to
 * the expenses. It counts in the balances from the moment it is sent (pending); the recipient's confirmation
 * (S-08) makes it posted. Invariants: the sender and the recipient differ, the amount is positive, and a
 * confirmation is not earlier than the payment.
 */
export class Payment {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly amount: Money;
  readonly sentAt: Date;
  readonly confirmedAt: Date | null;

  constructor(state: PaymentState) {
    if (state.senderId === state.recipientId) {
      throw new Error(`Payment ${state.id}: sender and recipient are the same user`);
    }
    if (!state.amount.isPositive()) {
      throw new Error(`Payment ${state.id}: amount must be positive`);
    }
    if (state.confirmedAt !== null && state.confirmedAt.getTime() < state.sentAt.getTime()) {
      throw new Error(`Payment ${state.id}: confirmed before it was sent`);
    }
    this.id = state.id;
    this.senderId = state.senderId;
    this.recipientId = state.recipientId;
    this.amount = state.amount;
    this.sentAt = state.sentAt;
    this.confirmedAt = state.confirmedAt;
  }

  /** Rebuilds a payment from storage; throws when the stored data breaks an invariant. */
  static restore(snapshot: PaymentSnapshot): Payment {
    return new Payment({
      id: snapshot.id,
      senderId: snapshot.senderId,
      recipientId: snapshot.recipientId,
      amount: Money.ofGrosze(snapshot.amount),
      sentAt: parseInstant(snapshot.sentAt),
      confirmedAt: snapshot.confirmedAt === null ? null : parseInstant(snapshot.confirmedAt),
    });
  }

  isConfirmed(): boolean {
    return this.confirmedAt !== null;
  }

  /** The Warsaw calendar day the payment was sent, e.g. "Oct 20". */
  sentOnLabel(): string {
    return SENT_ON_FORMAT.format(this.sentAt);
  }

  toSnapshot(): PaymentSnapshot {
    return {
      id: this.id,
      senderId: this.senderId,
      recipientId: this.recipientId,
      amount: this.amount.grosze,
      sentAt: this.sentAt.toISOString(),
      confirmedAt: this.confirmedAt === null ? null : this.confirmedAt.toISOString(),
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
