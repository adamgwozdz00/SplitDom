import { describe, expect, it } from "vitest";
import { aGroup, anInvite } from "@/lib/invites/__tests__/invites.harness";
import { Invite } from "@/lib/invites/invite.aggregate";

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-15T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-10-22T12:00:00.000Z");

describe("Invite", () => {
  describe("create", () => {
    it("lets a member invite, valid for exactly 7 days and unused", () => {
      const result = Invite.create({ id: INVITE_ID, group: aGroup({ hostId: HOST }), createdBy: HOST, now: NOW });

      expect("data" in result && result.data.toSnapshot()).toEqual({
        id: INVITE_ID,
        groupId: GROUP_ID,
        createdBy: HOST,
        createdAt: "2026-10-15T12:00:00.000Z",
        expiresAt: "2026-10-22T12:00:00.000Z",
        usedAt: null,
        usedBy: null,
      });
    });

    it("reports the group as not found to a non-member", () => {
      const result = Invite.create({ id: INVITE_ID, group: aGroup({ hostId: HOST }), createdBy: OTHER, now: NOW });

      expect("error" in result && result.error).toMatchObject({
        code: "group_not_found",
        context: { groupId: GROUP_ID },
      });
    });
  });

  describe("isActive", () => {
    const invite = anInvite({ now: NOW });

    it("is active 1 ms before it expires", () => {
      expect(invite.isActive(new Date(EXPIRES_AT.getTime() - 1))).toBe(true);
    });

    it("is inactive at exactly its expiry", () => {
      expect(invite.isActive(EXPIRES_AT)).toBe(false);
    });

    it("is inactive once redeemed", () => {
      const redeemed = invite.redeem(OTHER, NOW);

      expect("data" in redeemed && redeemed.data.isActive(NOW)).toBe(false);
    });
  });

  describe("redeem", () => {
    it("records who used the invite and when, leaving the original untouched", () => {
      const invite = anInvite({ now: NOW });
      const usedAt = new Date("2026-10-16T08:30:00.000Z");

      const result = invite.redeem(OTHER, usedAt);

      expect("data" in result && result.data.toSnapshot()).toMatchObject({
        id: INVITE_ID,
        usedAt: "2026-10-16T08:30:00.000Z",
        usedBy: OTHER,
      });
      expect(invite.usedAt).toBeNull();
    });

    it("refuses an expired invite", () => {
      const result = anInvite({ now: NOW }).redeem(OTHER, EXPIRES_AT);

      expect("error" in result && result.error.code).toBe("invite_invalid");
    });

    it("refuses an invite that was already used", () => {
      const first = anInvite({ now: NOW }).redeem(OTHER, NOW);
      if ("error" in first) {
        throw new Error("First redeem failed");
      }

      const second = first.data.redeem(HOST, NOW);

      expect("error" in second && second.error.code).toBe("invite_invalid");
    });
  });

  describe("restore", () => {
    it("round-trips an unused invite through a snapshot", () => {
      const snapshot = anInvite({ now: NOW }).toSnapshot();

      expect(Invite.restore(snapshot).toSnapshot()).toEqual(snapshot);
    });

    it("round-trips a used invite through a snapshot", () => {
      const redeemed = anInvite({ now: NOW }).redeem(OTHER, NOW);
      if ("error" in redeemed) {
        throw new Error("Redeem failed");
      }
      const snapshot = redeemed.data.toSnapshot();

      const restored = Invite.restore(snapshot);

      expect(restored.toSnapshot()).toEqual(snapshot);
      expect(restored.isActive(NOW)).toBe(false);
    });

    it.each([
      ["before", "2026-10-15T11:59:59.999Z"],
      ["at", "2026-10-15T12:00:00.000Z"],
    ])("throws when the invite expires %s its creation", (_label, expiresAt) => {
      const snapshot = { ...anInvite({ now: NOW }).toSnapshot(), expiresAt };

      expect(() => Invite.restore(snapshot)).toThrow(/expires before it was created/);
    });

    it("throws when a user is recorded without a time of use", () => {
      const snapshot = { ...anInvite({ now: NOW }).toSnapshot(), usedBy: OTHER };

      expect(() => Invite.restore(snapshot)).toThrow(/no time of use/);
    });

    it("throws on an unparseable timestamp", () => {
      const snapshot = { ...anInvite({ now: NOW }).toSnapshot(), createdAt: "not a date" };

      expect(() => Invite.restore(snapshot)).toThrow(/Invalid stored timestamp/);
    });
  });
});
