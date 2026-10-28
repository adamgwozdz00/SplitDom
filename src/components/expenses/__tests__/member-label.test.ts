import { describe, expect, it } from "vitest";
import { DisplayName } from "@/lib/member-profiles";
import { memberLabel } from "@/components/expenses/member-label";

const joinedAt = new Date("2026-10-15T12:00:00.000Z");
const members = [
  { userId: "host", joinedAt, email: "host@example.com" },
  { userId: "other", joinedAt, email: "other@example.com" },
  { userId: "no-email", joinedAt, email: null },
];

const names = new Map([
  ["host", DisplayName.fromStored("Hosia")],
  ["other", DisplayName.fromStored("Ola")],
  ["stranger", DisplayName.fromStored("Obcy")],
]);
const noNames = new Map<string, DisplayName>();

describe("memberLabel", () => {
  it("labels the viewer as You, even when their email is known", () => {
    expect(memberLabel(members, "host", "host", noNames)).toBe("You");
  });

  it("labels another member by email", () => {
    expect(memberLabel(members, "other", "host", noNames)).toBe("other@example.com");
  });

  it("labels a member without a known email as Member", () => {
    expect(memberLabel(members, "no-email", "host", noNames)).toBe("Member");
  });

  it("labels an unknown user as Member", () => {
    expect(memberLabel(members, "stranger", "host", noNames)).toBe("Member");
  });

  it("labels the viewer as You even with a display name", () => {
    expect(memberLabel(members, "host", "host", names)).toBe("You");
  });

  it("prefers the display name to the email", () => {
    expect(memberLabel(members, "other", "host", names)).toBe("Ola");
  });

  it("falls back to the email without a display name", () => {
    expect(memberLabel(members, "other", "host", new Map())).toBe("other@example.com");
  });

  it("labels a member with neither as Member", () => {
    expect(memberLabel(members, "no-email", "host", names)).toBe("Member");
  });

  it("ignores a display name of a user who is not a member", () => {
    expect(memberLabel(members, "stranger", "host", names)).toBe("Member");
  });
});
