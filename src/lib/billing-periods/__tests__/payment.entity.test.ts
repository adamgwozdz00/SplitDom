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
  rejectedAt: null,
};

describe("Payment.restore", () => {
  it("round-trips a pending, a confirmed and a rejected payment", () => {
    expect(Payment.restore(snapshot).toSnapshot()).toEqual(snapshot);
    const confirmed = { ...snapshot, confirmedAt: "2026-10-21T08:00:00.000Z" };
    expect(Payment.restore(confirmed).toSnapshot()).toEqual(confirmed);
    const rejected = { ...snapshot, rejectedAt: "2026-10-21T08:00:00.000Z" };
    expect(Payment.restore(rejected).toSnapshot()).toEqual(rejected);
  });

  it("reports its status as pending, confirmed or rejected", () => {
    const pending = Payment.restore(snapshot);
    const confirmed = Payment.restore({ ...snapshot, confirmedAt: "2026-10-21T08:00:00.000Z" });
    const rejected = Payment.restore({ ...snapshot, rejectedAt: "2026-10-21T08:00:00.000Z" });

    expect([pending.status(), confirmed.status(), rejected.status()]).toEqual(["pending", "confirmed", "rejected"]);
    expect([pending.isPending(), confirmed.isPending(), rejected.isPending()]).toEqual([true, false, false]);
    expect([pending.isRejected(), confirmed.isRejected(), rejected.isRejected()]).toEqual([false, false, true]);
    expect([pending.isConfirmed(), confirmed.isConfirmed(), rejected.isConfirmed()]).toEqual([false, true, false]);
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
    ["a rejection before the payment was sent", { rejectedAt: "2026-10-20T09:00:00.000Z" }],
    ["an unparseable rejection time", { rejectedAt: "not a date" }],
    [
      "both a confirmation and a rejection",
      { confirmedAt: "2026-10-21T08:00:00.000Z", rejectedAt: "2026-10-21T09:00:00.000Z" },
    ],
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

describe("Payment.confirm and Payment.reject", () => {
  const AT = new Date("2026-10-21T08:00:00.000Z");

  it("return a decided copy and leave the original unchanged", () => {
    const pending = Payment.restore(snapshot);

    const confirmed = pending.confirm(AT);
    const rejected = pending.reject(AT);

    expect(confirmed.status()).toBe("confirmed");
    expect(confirmed.confirmedAt).toEqual(AT);
    expect(rejected.status()).toBe("rejected");
    expect(rejected.rejectedAt).toEqual(AT);
    expect(pending.status()).toBe("pending");
  });

  it("record a decision time earlier than the sent time as the sent time", () => {
    const early = new Date("2026-10-20T09:59:59.000Z");

    expect(Payment.restore(snapshot).confirm(early).confirmedAt).toEqual(new Date(snapshot.sentAt));
    expect(Payment.restore(snapshot).reject(early).rejectedAt).toEqual(new Date(snapshot.sentAt));
  });

  it("throw when the payment is not pending", () => {
    const confirmed = Payment.restore(snapshot).confirm(AT);
    const rejected = Payment.restore(snapshot).reject(AT);

    expect(() => confirmed.confirm(AT)).toThrow();
    expect(() => confirmed.reject(AT)).toThrow();
    expect(() => rejected.confirm(AT)).toThrow();
    expect(() => rejected.reject(AT)).toThrow();
  });
});
