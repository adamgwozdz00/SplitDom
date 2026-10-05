import type { AstroCookies } from "astro";
import { InviteToken } from "@/lib/invites/invite-token.value";

const NEW_INVITE_COOKIE = "sd_new_invite";
const NEW_INVITE_MAX_AGE_SECONDS = 300;

function newInvitePath(groupId: string): string {
  return `/groups/${groupId}`;
}

/** Hands a freshly generated token to the next page load of the group page, without a URL or browser history. */
export function stashNewInvite(cookies: AstroCookies, url: URL, groupId: string, token: InviteToken): void {
  cookies.set(NEW_INVITE_COOKIE, token.value, {
    path: newInvitePath(groupId),
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: NEW_INVITE_MAX_AGE_SECONDS,
  });
}

/** Reads and deletes the stashed token; a missing or malformed value gives null. */
export function takeNewInvite(cookies: AstroCookies, groupId: string): InviteToken | null {
  const raw = cookies.get(NEW_INVITE_COOKIE)?.value;
  if (raw === undefined) {
    return null;
  }
  cookies.delete(NEW_INVITE_COOKIE, { path: newInvitePath(groupId) });
  return InviteToken.parse(raw);
}
