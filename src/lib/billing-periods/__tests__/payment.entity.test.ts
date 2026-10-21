import { describe, expect, it } from "vitest";
import { Payment } from "@/lib/billing-periods/payment.entity";
import type { PaymentSnapshot } from "@/lib/billing-periods/types";

const snapshot: PaymentSnapshot = {
  id: "p-1",
  senderId: "sender",
  recipientId: "recipient",
  amount: 10000,
  sentAt: "2026-10-20T10:00:00.000Z",
  confirmedAt: null,
};

describe("Payment.restore", () => {
  it("round-trips an unconfirmed and a confirmed payment", () => {
    expect(Payment.restore(snapshot).toSnapshot()).toEqual(snapshot);
    const confirmed = { ...snapshot, confirmedAt: "2026-10-21T08:00:00.000Z" };
    expect(Payment.restore(confirmed).toSnapshot()).toEqual(confirmed);
  });

  it("knows whether it is confirmed", () => {
    expect(Payment.restore(snapshot).isConfirmed()).toBe(false);
    expect(Payment.restore({ ...snapshot, confirmedAt: snapshot.sentAt }).isConfirmed()).toBe(true);
  });

  it.each([
    ["the sender being the recipient", { recipientId: "sender" }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -100 }],
    ["an unparseable sent time", { sentAt: "not a date" }],
    ["a confirmation before the payment was sent", { confirmedAt: "2026-10-20T09:00:00.000Z" }],
    ["an unparseable confirmation time", { confirmedAt: "not a date" }],
  ])("rejects %s", (_, override) => {
    expect(() => Payment.restore({ ...snapshot, ...override })).toThrow();
  });
});

describe("Payment.sentOnLabel", () => {
  it("shows the Warsaw calendar day", () => {
    expect(Payment.restore(snapshot).sentOnLabel()).toBe("Oct 20");
    // 23:30 UTC on 20 October is already 21 October in Warsaw.
    expect(Payment.restore({ ...snapshot, sentAt: "2026-10-20T23:30:00.000Z" }).sentOnLabel()).toBe("Oct 21");
  });
});
