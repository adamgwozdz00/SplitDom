import { Money } from "@/lib/billing-periods/money.value";
import type { PaymentSnapshot } from "@/lib/billing-periods/types";

// Rendered in Europe/Warsaw, like the period's month and the purchase dates.
const SENT_ON_FORMAT = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "numeric", month: "short" });

interface PaymentState {
  id: string;
  senderId: string;
  recipientId: string;
  amount: Money;
  sentAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
}

export type PaymentStatus = "pending" | "confirmed" | "rejected";

/**
 * One bank transfer the sender reports having made to the recipient: an entry in the period's ledger, next to
 * the expenses. It is pending from the moment it is sent and counts in the pending balances. The recipient then
 * confirms it (it becomes posted and permanent) or rejects it (it stays in the ledger but counts nowhere); both
 * decisions are final. Invariants: the sender and the recipient differ, the amount is positive, a decision is
 * not earlier than the payment, and a payment is never both confirmed and rejected.
 */
export class Payment {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly amount: Money;
  readonly sentAt: Date;
  readonly confirmedAt: Date | null;
  readonly rejectedAt: Date | null;

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
    if (state.rejectedAt !== null && state.rejectedAt.getTime() < state.sentAt.getTime()) {
      throw new Error(`Payment ${state.id}: rejected before it was sent`);
    }
    if (state.confirmedAt !== null && state.rejectedAt !== null) {
      throw new Error(`Payment ${state.id}: both confirmed and rejected`);
    }
    this.id = state.id;
    this.senderId = state.senderId;
    this.recipientId = state.recipientId;
    this.amount = state.amount;
    this.sentAt = state.sentAt;
    this.confirmedAt = state.confirmedAt;
    this.rejectedAt = state.rejectedAt;
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
      rejectedAt: snapshot.rejectedAt === null ? null : parseInstant(snapshot.rejectedAt),
    });
  }

  isConfirmed(): boolean {
    return this.confirmedAt !== null;
  }

  isRejected(): boolean {
    return this.rejectedAt !== null;
  }

  isPending(): boolean {
    return this.confirmedAt === null && this.rejectedAt === null;
  }

  status(): PaymentStatus {
    if (this.confirmedAt !== null) {
      return "confirmed";
    }
    return this.rejectedAt !== null ? "rejected" : "pending";
  }

  /** The confirmed copy of this pending payment, decided at `at` (not earlier than it was sent). */
  confirm(at: Date): Payment {
    return new Payment({ ...this.decidableState(), confirmedAt: this.decisionTime(at) });
  }

  /** The rejected copy of this pending payment, decided at `at` (not earlier than it was sent). */
  reject(at: Date): Payment {
    return new Payment({ ...this.decidableState(), rejectedAt: this.decisionTime(at) });
  }

  /** The Warsaw calendar day the payment was sent, e.g. "20 paź". */
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
      rejectedAt: this.rejectedAt === null ? null : this.rejectedAt.toISOString(),
    };
  }

  // Clocks of separate Worker isolates can differ by milliseconds, so an early decision is recorded at `sentAt`.
  private decisionTime(at: Date): Date {
    return at.getTime() < this.sentAt.getTime() ? this.sentAt : at;
  }

  private decidableState(): PaymentState {
    if (!this.isPending()) {
      throw new Error(`Payment ${this.id}: already ${this.status()}`);
    }
    return {
      id: this.id,
      senderId: this.senderId,
      recipientId: this.recipientId,
      amount: this.amount,
      sentAt: this.sentAt,
      confirmedAt: null,
      rejectedAt: null,
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
