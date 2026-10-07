import { describe, expect, it } from "vitest";
import { aToken } from "@/lib/groups/__tests__/groups.harness";
import { InviteTokenHash } from "@/lib/groups/invite-token-hash.value";

const TOKEN = aToken("a");

describe("InviteTokenHash", () => {
  it("hashes a token to 64 lowercase hex characters", async () => {
    const hash = await InviteTokenHash.of(TOKEN);

    expect(hash.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the SHA-256 of the token text, the same as the database computes", async () => {
    const hash = await InviteTokenHash.of(TOKEN);

    // printf %s aaaa…(43) | shasum -a 256
    expect(hash.value).toBe("66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0");
  });

  it("gives different hashes for different tokens", async () => {
    const other = aToken("b");

    expect((await InviteTokenHash.of(TOKEN)).value).not.toBe((await InviteTokenHash.of(other)).value);
  });

  it("parses a stored hash and rejects other shapes", () => {
    const hex = "ab".repeat(32);

    expect(InviteTokenHash.parse(hex)?.value).toBe(hex);
    expect(InviteTokenHash.parse("AB".repeat(32))).toBeNull();
    expect(InviteTokenHash.parse("ab".repeat(31))).toBeNull();
  });
});
