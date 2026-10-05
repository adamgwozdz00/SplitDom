// 32 random bytes in base64url without padding: 256 bits of entropy in 43 URL-safe characters.
const BYTES = 32;
const SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The invite's bearer secret. Whoever holds it may join the group, so it is never guessable. */
export class InviteToken {
  static readonly LENGTH = 43;

  private constructor(readonly value: string) {}

  /** Draws a fresh token from the platform CSPRNG. */
  static generate(): InviteToken {
    const bytes = crypto.getRandomValues(new Uint8Array(BYTES));
    // Node 22.14 (Vitest) has no Uint8Array.prototype.toBase64, so encode through btoa, which workerd has too.
    const base64 = btoa(String.fromCharCode(...bytes));
    return new InviteToken(base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  }

  /** Accepts only the shape `generate` produces, so malformed input never reaches the database. */
  static parse(raw: string): InviteToken | null {
    return SHAPE.test(raw) ? new InviteToken(raw) : null;
  }
}
