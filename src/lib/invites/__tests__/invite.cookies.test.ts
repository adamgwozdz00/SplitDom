import type { AstroCookies } from "astro";
import { describe, expect, it } from "vitest";
import { InviteToken, stashNewInvite, takeNewInvite } from "@/lib/invites";

interface SetCall {
  value: string;
  options: Record<string, unknown>;
}

function fakeCookies() {
  const jar = new Map<string, string>();
  const sets: SetCall[] = [];
  const deletes: Record<string, unknown>[] = [];
  const cookies = {
    set(name: string, value: string, options: Record<string, unknown> = {}) {
      jar.set(name, value);
      sets.push({ value, options });
    },
    get(name: string) {
      const value = jar.get(name);
      return value === undefined ? undefined : { value };
    },
    delete(name: string, options: Record<string, unknown> = {}) {
      jar.delete(name);
      deletes.push(options);
    },
  } as unknown as AstroCookies;
  return { cookies, jar, sets, deletes };
}

const GROUP_ID = "11111111-1111-1111-1111-111111111111";
const http = new URL("http://localhost:4321/api/groups/x/invites");
const https = new URL("https://example.com/api/groups/x/invites");

describe("new-invite cookie", () => {
  it("round-trips the token", () => {
    const { cookies } = fakeCookies();
    const token = InviteToken.generate();
    stashNewInvite(cookies, http, GROUP_ID, token);
    expect(takeNewInvite(cookies, GROUP_ID)?.value).toBe(token.value);
  });

  it("sets the documented flags on the group path", () => {
    const { cookies, sets } = fakeCookies();
    stashNewInvite(cookies, http, GROUP_ID, InviteToken.generate());
    expect(sets[0].options).toMatchObject({
      path: `/groups/${GROUP_ID}`,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 300,
    });
  });

  it("deletes the cookie on take, with the same path", () => {
    const { cookies, deletes } = fakeCookies();
    stashNewInvite(cookies, http, GROUP_ID, InviteToken.generate());
    takeNewInvite(cookies, GROUP_ID);
    expect(deletes[0]).toMatchObject({ path: `/groups/${GROUP_ID}` });
    expect(takeNewInvite(cookies, GROUP_ID)).toBeNull();
  });

  it("returns null when there is no cookie", () => {
    const { cookies } = fakeCookies();
    expect(takeNewInvite(cookies, GROUP_ID)).toBeNull();
  });

  it("returns null for a malformed value", () => {
    const { cookies, jar } = fakeCookies();
    jar.set("sd_new_invite", "not-a-token");
    expect(takeNewInvite(cookies, GROUP_ID)).toBeNull();
  });

  it("is Secure only for an https URL", () => {
    const a = fakeCookies();
    stashNewInvite(a.cookies, http, GROUP_ID, InviteToken.generate());
    expect(a.sets[0].options.secure).toBe(false);
    const b = fakeCookies();
    stashNewInvite(b.cookies, https, GROUP_ID, InviteToken.generate());
    expect(b.sets[0].options.secure).toBe(true);
  });
});
