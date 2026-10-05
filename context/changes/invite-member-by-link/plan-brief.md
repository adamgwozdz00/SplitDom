# Invite a Member by Link (S-03) — Plan Brief

> Full plan: `context/changes/invite-member-by-link/plan.md`
> Research: `context/changes/invite-member-by-link/research.md`

## What & Why

A group member generates an invite link on the group page and sends it through any channel themselves. The invited person signs in, confirms, and joins the group (FR-003, must-have). The north star S-04 needs a group with at least two members, and this slice is how the second member gets in. It is also the first flow where a stranger touches a group, so per-group privacy matters here for the first time.

## Starting Point

S-02 delivered:

- the `Group` aggregate, which has no way to add a member;
- `groups` / `group_members` tables, closed to direct API access;
- persistence functions in `public`, scoped to `auth.uid()`;
- `/dashboard` and `/groups/[id]`.

A non-member cannot load a group (404). After any sign-in, the user always lands on `/dashboard`, and no return URL exists.

## Desired End State

**Generating.** Every member sees "Generate invite" on the group page. Clicking it shows the link once, with Share (on supported browsers) and Copy, and the note "works once, expires in 7 days".

**Opening the link signed out.** The visitor goes to sign-in, then comes back to the invite. This works with password, Google, or a new account confirmed by email in the same browser.

**On the invite page.** It shows the group name and "Join group". Joining lands on the group page as a member. A used, expired or unknown link shows one "no longer valid" message.

## Key Decisions Made

| Decision                   | Choice                                                                                                        | Why (1 sentence)                                                                                                                                           | Source          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Invite model               | Single-use, one invite per person, expires 7 days after generation                                            | Limits the damage of a forwarded link without needing a revoke UI.                                                                                         | Research (user) |
| Already a member           | Joining still uses up the invite and opens the group                                                          | One simple rule: a redeemed invite is always used.                                                                                                         | Research (user) |
| UI scope                   | Only a "Generate invite" button; no invite list, no revoke, no cap                                            | The smallest UI that delivers FR-003.                                                                                                                      | Research (user) |
| Who invites                | Any member                                                                                                    | Matches the PRD's flat permission model; the host has no admin rights beyond closing periods.                                                              | Plan (user)     |
| Link vs code               | Link only; no short typeable code                                                                             | A 256-bit link needs no rate limiting or new dependency.                                                                                                   | Plan (user)     |
| Aggregate boundary         | Separate `Invite` aggregate in `src/lib/invites/`; no `Group.join` (the invitee cannot load the group)        | The invite has its own lifecycle, and a non-member never receives the group snapshot.                                                                      | Plan (user)     |
| Atomic join                | One persistence function claims the invite and inserts the membership in one transaction                      | Single use under concurrency needs both writes to commit together; this is the documented exception to "only the Group repository writes `group_members`". | Plan (user)     |
| Return after sign-in       | Short-lived HttpOnly `SameSite=Lax` "pending invite" cookie, read by `signin.ts` and `callback.ts`            | Touches about 4 files, needs no form or Supabase redirect changes, and keeps the token out of auth URLs.                                                   | Plan (user)     |
| Showing the generated link | Form POST, then a one-time HttpOnly cookie scoped to `/groups/<id>`, then the page renders the link once      | Same form-POST pattern as S-02, works without JavaScript, and keeps the token out of URLs and history.                                                     | Plan (user)     |
| Signed-out visitor         | Redirected straight to sign-in; the group name is shown only to a signed-in holder of the token               | Anonymous visitors and link-preview bots never see group data, and no function is granted to `anon`.                                                       | Plan (user)     |
| Token storage              | 32 random bytes (base64url, 43 characters); only `sha256` stored; hashed inside Postgres                      | A database leak yields no usable links; lookups take the plaintext, so a leaked hash is not a credential.                                                  | Research + Plan |
| SQL backstops              | `auth.uid()` identity; member-only creation; minimum token length; `used_at is null` claim; expiry on `now()` | A signed-in browser can call the RPCs directly; these stop forging, guessable tokens, double use and replaying an expired invite with an old timestamp.    | Plan            |
| Invalid-invite message     | One message for used, expired and unknown invites (404)                                                       | Never reveals which invites exist or what state they are in.                                                                                               | Plan            |

## Scope

**In scope:**

- `src/lib/invites/`: `InviteToken`, `Invite`, `InviteService`, Supabase repository, cookie helpers, errors and messages.
- Migration: `group_invites` plus `create_group_invite`, `get_group_invite` and `redeem_group_invite`.
- `POST /api/groups/[id]/invites` and an `InvitePanel` on the group page.
- `/invite/[token]`, `POST /api/invites/redeem`, the middleware entry, and the sign-in and callback return.
- Unit, DB and smoke tests.
- `CLAUDE.md` and `deploy-plan.md` notes.

**Out of scope:**

- Short codes, QR codes, revoke, invite lists.
- Anonymous preview, a general `next` return URL.
- Email sending, Supabase admin invite APIs, service role, Astro sessions/KV, rate-limit binding.
- Member names, cross-browser email confirmation.
- New npm dependencies.

## Architecture / Approach

**Generating an invite.** The group page POSTs to `/api/groups/<id>/invites`. The endpoint first checks membership with `GroupService.getForMember`. `InviteService.create` then runs `Invite.create`, where the creator must be a member and `expiresAt` is now + 7 days. It saves through `create_group_invite`, which stores the hash. The endpoint stashes the token in a one-time cookie and redirects to `/groups/<id>`, which shows the link with Share and Copy.

**Opening the link.**

- **Signed out:** `GET /invite/<token>` sets the pending-invite cookie and redirects to sign-in. `signin.ts` or `callback.ts` sends the user back.
- **Signed in:** `InviteService.preview` (`get_group_invite`) renders the name and the Join form.

**Joining.** The form POSTs to `/api/invites/redeem`. `InviteService.redeem` runs `Invite.redeem`, which requires an active invite. `redeem_group_invite` then claims the invite and inserts the membership atomically. The endpoint redirects to `/groups/<id>`.

## Phases at a Glance

| Phase                                                | What it delivers                                                                          | Key risk                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Invite domain model (TypeScript)                  | Token, aggregate, service, errors; unit tests, no database                                | Base64url encoding must work on both Node 22.14 (tests) and workerd                       |
| 2. Persistence and isolation                         | Migration, types, repository; DB tests for isolation, single use, expiry, race, backstops | Exactly-once under concurrency; covered by a parallel-redeem test                         |
| 3. Generate and share on the group page              | Endpoint, one-time link cookie, `InvitePanel` with Share/Copy, smoke steps                | Clipboard and Share quirks on Safari; the link is rendered on the server before the click |
| 4. Invite page, joining, sign-in return, smoke, docs | `/invite/[token]`, redeem endpoint, pending-invite cookie, second-user smoke flow, docs   | The cookie must survive the Google and email-confirmation round trips (`SameSite=Lax`)    |

**Prerequisites:** S-02 merged (done); local Supabase running; Node 22.14 (`nvm use`).
**Estimated effort:** ~3 sessions across 4 phases.

## Open Risks & Assumptions

- A signed-in browser can call the persistence functions directly. The SQL backstops cover identity, membership, token length, double use and expiry. Any further misuse only ever affects a group the caller is a member of.
- Confirming a new account's email in another browser loses the pending invite, as it already loses the PKCE verifier. The invitee can reopen the link after signing in, or use Google.
- The invite token appears in the GET path, which Workers observability logs. This is accepted for a single-use, 7-day token. The POST carries it in the body, and the page sends `Referrer-Policy: no-referrer`.
- Whoever redeems first joins, because the link is a bearer token. A forwarded link admits its first holder. Expiry and single use are the only controls, and there is no revoke in the MVP.

## Success Criteria (Summary)

- A member invites a second person from a phone. That person signs in with Google or email and joins in a few taps, and both see the same group.
- An invite works exactly once and stops working after 7 days. A stranger without a valid link cannot see or join the group, in the app or through the Supabase API.
- CI is green: unit, DB (including the race) and smoke (second-user join), the type check and the generated-types drift check.
