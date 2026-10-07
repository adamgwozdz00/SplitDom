import { describe, expect, it } from "vitest";
import { memberLabel } from "@/components/expenses/member-label";

const joinedAt = new Date("2026-10-15T12:00:00.000Z");
const members = [
  { userId: "host", joinedAt, email: "host@example.com" },
  { userId: "other", joinedAt, email: "other@example.com" },
  { userId: "no-email", joinedAt, email: null },
];

describe("memberLabel", () => {
  it("labels the viewer as You, even when their email is known", () => {
    expect(memberLabel(members, "host", "host")).toBe("You");
  });

  it("labels another member by email", () => {
    expect(memberLabel(members, "other", "host")).toBe("other@example.com");
  });

  it("labels a member without a known email as Member", () => {
    expect(memberLabel(members, "no-email", "host")).toBe("Member");
  });

  it("labels an unknown user as Member", () => {
    expect(memberLabel(members, "stranger", "host")).toBe("Member");
  });
});
