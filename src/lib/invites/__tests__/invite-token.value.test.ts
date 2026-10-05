import { describe, expect, it } from "vitest";
import { InviteToken } from "@/lib/invites/invite-token.value";

describe("InviteToken", () => {
  it("generates 43 base64url characters", () => {
    const token = InviteToken.generate();

    expect(token.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(InviteToken.LENGTH).toBe(43);
  });

  it("generates a different token each time", () => {
    expect(InviteToken.generate().value).not.toBe(InviteToken.generate().value);
  });

  it("parses a generated token", () => {
    const generated = InviteToken.generate();

    expect(InviteToken.parse(generated.value)?.value).toBe(generated.value);
  });

  it.each([
    ["42 characters", "a".repeat(42)],
    ["44 characters", "a".repeat(44)],
    ["a plus sign", `${"a".repeat(42)}+`],
    ["a slash", `${"a".repeat(42)}/`],
    ["padding", `${"a".repeat(42)}=`],
    ["an empty string", ""],
  ])("rejects %s", (_label, raw) => {
    expect(InviteToken.parse(raw)).toBeNull();
  });
});
