import type { AstroCookies } from "astro";
import { InviteToken } from "@/lib/groups/invite-token.value";

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

const PENDING_INVITE_COOKIE = "sd_pending_invite";
// Long enough to confirm a new account's email before coming back to the invite.
const PENDING_INVITE_MAX_AGE_SECONDS = 86_400;

/** Remembers which invite an anonymous visitor opened, so sign-in can return to it. */
export function rememberPendingInvite(cookies: AstroCookies, url: URL, token: InviteToken): void {
  cookies.set(PENDING_INVITE_COOKIE, token.value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: PENDING_INVITE_MAX_AGE_SECONDS,
  });
}

export function hasPendingInvite(cookies: AstroCookies): boolean {
  return cookies.get(PENDING_INVITE_COOKIE) !== undefined;
}

/**
 * Reads and deletes the pending invite; returns `/invite/<token>` only when the cookie holds a well-formed token.
 * The path is always built here, so a cookie value can never cause an open redirect.
 */
export function takePendingInvitePath(cookies: AstroCookies): string | null {
  const raw = cookies.get(PENDING_INVITE_COOKIE)?.value;
  cookies.delete(PENDING_INVITE_COOKIE, { path: "/" });
  if (raw === undefined) {
    return null;
  }
  const token = InviteToken.parse(raw);
  return token ? `/invite/${token.value}` : null;
}
