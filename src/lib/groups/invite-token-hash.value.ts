import type { InviteToken } from "@/lib/groups/invite-token.value";

const SHAPE = /^[0-9a-f]{64}$/;

/** SHA-256 of an invite token as 64 lowercase hex characters: the only form in which a token is stored or looked up. */
export class InviteTokenHash {
  private constructor(readonly value: string) {}

  /** Web Crypto's digest is async, so callers hash the token and hand the hash to the synchronous aggregate. */
  static async of(token: InviteToken): Promise<InviteTokenHash> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.value));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return new InviteTokenHash(hex);
  }

  /** Accepts only the shape `of` produces, for hashes read back from storage. */
  static parse(raw: string): InviteTokenHash | null {
    return SHAPE.test(raw) ? new InviteTokenHash(raw) : null;
  }
}
