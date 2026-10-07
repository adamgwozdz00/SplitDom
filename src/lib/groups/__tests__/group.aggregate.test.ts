import { describe, expect, it } from "vitest";
import { aGroup, aTokenHash, groupName } from "@/lib/groups/__tests__/groups.harness";
import { Group } from "@/lib/groups/group.aggregate";

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH = aTokenHash("ab");
const OTHER_HASH = aTokenHash("cd");
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-15T12:00:00.000Z");

describe("Group", () => {
  describe("create", () => {
    const now = new Date("2026-10-31T23:30:00.000Z");
    const group = Group.create({
      id: "11111111-1111-4111-8111-111111111111",
      name: groupName("Mokotów"),
      hostId: HOST,
      now,
    });

    it("makes the host the only member, joined now", () => {
      expect(group.hostId).toBe(HOST);
      expect(group.members).toEqual([{ userId: HOST, joinedAt: now, email: null }]);
      expect(group.createdAt).toEqual(now);
    });
  });

  it("knows its host and members", () => {
    const group = aGroup({ hostId: HOST });

    expect(group.isHost(HOST)).toBe(true);
    expect(group.isMember(HOST)).toBe(true);
    expect(group.isHost(OTHER)).toBe(false);
    expect(group.isMember(OTHER)).toBe(false);
  });

  describe("invite", () => {
    it("lets a member invite, valid for 7 days, and tracks it as pending", () => {
      const group = aGroup({ hostId: HOST });

      const result = group.invite({ id: INVITE_ID, by: HOST, tokenHash: HASH, now: NOW });

      expect("data" in result && result.data.toSnapshot()).toEqual({
        id: INVITE_ID,
        createdBy: HOST,
        createdAt: "2026-10-15T12:00:00.000Z",
        expiresAt: "2026-10-22T12:00:00.000Z",
        tokenHash: HASH.value,
      });
      expect(group.newInvites().map((invite) => invite.id)).toEqual([INVITE_ID]);
      expect(group.toSnapshot().invites).toHaveLength(1);
    });

    it("reports the group as not found to a non-member and records nothing", () => {
      const group = aGroup({ hostId: HOST });

      const result = group.invite({ id: INVITE_ID, by: OTHER, tokenHash: HASH, now: NOW });

      expect("error" in result && result.error).toMatchObject({
        code: "group_not_found",
        context: { groupId: group.id },
      });
      expect(group.newInvites()).toEqual([]);
    });
  });

  describe("join", () => {
    function groupWithInvite(): Group {
      const group = aGroup({ hostId: HOST });
      group.invite({ id: INVITE_ID, by: HOST, tokenHash: HASH, now: NOW });
      return Group.restore(group.toSnapshot());
    }

    it("uses up the invite and adds the user as a member", () => {
      const group = groupWithInvite();
      const at = new Date("2026-10-16T08:30:00.000Z");

      const result = group.join({ tokenHash: HASH, userId: OTHER, now: at });

      expect(result).toEqual({ data: { joined: true } });
      expect(group.isMember(OTHER)).toBe(true);
      expect(group.newMembers()).toEqual([{ userId: OTHER, joinedAt: at, email: null }]);
      expect(group.usedInvites()).toEqual([{ id: INVITE_ID, usedAt: at, usedBy: OTHER }]);
      expect(group.toSnapshot().invites).toEqual([]);
    });

    it("cannot use an invite twice", () => {
      const group = groupWithInvite();
      group.join({ tokenHash: HASH, userId: OTHER, now: NOW });

      const again = group.join({ tokenHash: HASH, userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", now: NOW });

      expect("error" in again && again.error.code).toBe("invite_invalid");
      expect(group.members).toHaveLength(2);
    });

    it("refuses an invite at exactly its expiry", () => {
      const group = groupWithInvite();

      const result = group.join({ tokenHash: HASH, userId: OTHER, now: new Date("2026-10-22T12:00:00.000Z") });

      expect("error" in result && result.error.code).toBe("invite_invalid");
    });

    it("gives invite_invalid for an unknown token hash", () => {
      const group = groupWithInvite();

      const result = group.join({ tokenHash: OTHER_HASH, userId: OTHER, now: NOW });

      expect("error" in result && result.error.code).toBe("invite_invalid");
      expect(group.usedInvites()).toEqual([]);
    });

    it("uses up the invite of a member who joins, without adding a second membership", () => {
      const group = groupWithInvite();

      const result = group.join({ tokenHash: HASH, userId: HOST, now: NOW });

      expect(result).toEqual({ data: { joined: false } });
      expect(group.members).toHaveLength(1);
      expect(group.newMembers()).toEqual([]);
      expect(group.usedInvites()).toHaveLength(1);
    });
  });

  it("starts with no pending changes after restore", () => {
    const group = Group.restore(aGroup({ hostId: HOST }).toSnapshot());

    expect([group.newInvites(), group.usedInvites(), group.newMembers()]).toEqual([[], [], []]);
  });

  it("round-trips through a snapshot", () => {
    const group = aGroup({ hostId: HOST, name: "Wakacje 2026" });

    const snapshot = group.toSnapshot();
    const restored = Group.restore(snapshot);

    expect(snapshot).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Wakacje 2026",
      hostId: HOST,
      createdAt: "2026-10-15T12:00:00.000Z",
      members: [{ userId: HOST, joinedAt: "2026-10-15T12:00:00.000Z", email: null }],
      version: 0,
      invites: [],
    });
    expect(restored.toSnapshot()).toEqual(snapshot);
    expect(restored.isHost(HOST)).toBe(true);
  });

  it("restores a group with other members", () => {
    const snapshot = aGroup({ hostId: HOST }).toSnapshot();
    snapshot.members.push({ userId: OTHER, joinedAt: "2026-10-20T08:00:00.000Z", email: "other@example.com" });

    const restored = Group.restore(snapshot);

    expect(restored.isMember(OTHER)).toBe(true);
    expect(restored.isHost(OTHER)).toBe(false);
  });

  describe("restore rejects corrupt data", () => {
    it("throws when the host is not a member", () => {
      const snapshot = aGroup({ hostId: HOST }).toSnapshot();
      snapshot.members = [{ userId: OTHER, joinedAt: snapshot.createdAt, email: null }];

      expect(() => Group.restore(snapshot)).toThrow(/host is not a member/);
    });

    it("restores a stored name as it is, without applying the creation rule again", () => {
      const snapshot = aGroup().toSnapshot();
      snapshot.name = "\u200B";

      expect(Group.restore(snapshot).name.value).toBe("\u200B");
    });

    it("throws on an empty stored name", () => {
      const snapshot = aGroup().toSnapshot();
      snapshot.name = "";

      expect(() => Group.restore(snapshot)).toThrow(/empty stored name/);
    });
  });
});
