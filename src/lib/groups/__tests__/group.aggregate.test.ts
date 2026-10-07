import { describe, expect, it } from "vitest";
import { aGroup, groupName } from "@/lib/groups/__tests__/groups.harness";
import { Group } from "@/lib/groups/group.aggregate";

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

  describe("memberLabel", () => {
    const group = Group.restore({
      ...aGroup({ hostId: HOST }).toSnapshot(),
      members: [
        { userId: HOST, joinedAt: "2026-10-15T12:00:00.000Z", email: "host@example.com" },
        { userId: OTHER, joinedAt: "2026-10-16T12:00:00.000Z", email: "other@example.com" },
        { userId: "no-email", joinedAt: "2026-10-17T12:00:00.000Z", email: null },
      ],
    });

    it("labels the viewer as You, even when their email is known", () => {
      expect(group.memberLabel(HOST, HOST)).toBe("You");
    });

    it("labels another member by email", () => {
      expect(group.memberLabel(OTHER, HOST)).toBe("other@example.com");
    });

    it("labels a member without a known email as Member", () => {
      expect(group.memberLabel("no-email", HOST)).toBe("Member");
    });

    it("labels an unknown user as Member", () => {
      expect(group.memberLabel("stranger", HOST)).toBe("Member");
    });
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
