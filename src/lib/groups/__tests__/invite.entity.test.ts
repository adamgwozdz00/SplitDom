import { describe, expect, it } from "vitest";
import { Invite } from "@/lib/groups/invite.entity";
import { aTokenHash } from "@/lib/groups/__tests__/groups.harness";

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-15T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-10-22T12:00:00.000Z");
const HASH = aTokenHash("ab");

function anInvite(): Invite {
  return Invite.create({ id: "33333333-3333-4333-8333-333333333333", createdBy: HOST, tokenHash: HASH, now: NOW });
}

describe("Invite", () => {
  it("is created unused and valid for exactly 7 days", () => {
    expect(anInvite().toSnapshot()).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      createdBy: HOST,
      createdAt: "2026-10-15T12:00:00.000Z",
      expiresAt: "2026-10-22T12:00:00.000Z",
      tokenHash: "ab".repeat(32),
    });
    expect(anInvite().usedAt).toBeNull();
  });

  it("is active 1 ms before it expires and inactive at exactly its expiry", () => {
    expect(anInvite().isActive(new Date(EXPIRES_AT.getTime() - 1))).toBe(true);
    expect(anInvite().isActive(EXPIRES_AT)).toBe(false);
  });

  it("records who used it and when, and is inactive afterwards, leaving the original untouched", () => {
    const invite = anInvite();
    const usedAt = new Date("2026-10-16T08:30:00.000Z");

    const used = invite.use(OTHER, usedAt);

    expect(used.usedBy).toBe(OTHER);
    expect(used.usedAt).toEqual(usedAt);
    expect(used.isActive(usedAt)).toBe(false);
    expect(invite.usedAt).toBeNull();
  });

  it("rejects a stored invite that expires before it was created", () => {
    const snapshot = { ...anInvite().toSnapshot(), expiresAt: "2026-10-14T12:00:00.000Z" };

    expect(() => Invite.restore(snapshot)).toThrow(/expires before it was created/);
  });

  it("rejects a stored invite whose hash is malformed", () => {
    const snapshot = { ...anInvite().toSnapshot(), tokenHash: "nope" };

    expect(() => Invite.restore(snapshot)).toThrow(/token hash/);
  });
});
