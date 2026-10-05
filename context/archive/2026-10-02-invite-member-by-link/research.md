---
date: 2026-10-04T19:50:15+02:00
researcher: Claude (Opus 5.5) for adamgwozdz00
git_commit: 5af596118e60dd1eba96d6643a192bd34f5b692c
branch: chore/close-create-settlement-group
repository: adamgwozdz00/SplitDom
topic: "Ready-made libraries, services and patterns for invite-member-by-link (S-03, FR-003) on the SplitDom stack after S-02"
tags: [research, codebase, external, invite, auth, supabase, astro, cloudflare-workers, prior-art]
status: complete
last_updated: 2026-10-04
last_updated_by: Claude (Opus 5.5)
last_updated_note: "User decisions 2026-10-04: single-use invites valid for 7 days; an already-member consumes the invite; only a Generate invite button (no list, no revoke); no cap on open invites. See Decisions"
---

# Research: libraries, services and patterns for invite-member-by-link (S-03)

**Date**: 2026-10-04T19:50:15+02:00
**Researcher**: Claude (Opus 5.5) for adamgwozdz00
**Git Commit**: 5af596118e60dd1eba96d6643a192bd34f5b692c. Uncommitted changes are limited to `.claude/`, `CLAUDE.md` and this change folder. Nothing in `src/` or `supabase/` is uncommitted.
**Branch**: chore/close-create-settlement-group
**Repository**: adamgwozdz00/SplitDom

## Research Question

The user asked to redo the research for `invite-member-by-link`, replacing the previous research document:

- Look for inspiration on the web: ready-made libraries, services and patterns for this kind of operation.
- Search with Exa and Context7.

The change is roadmap item **S-03** "Invite a member by link or code" (FR-003, `context/foundation/roadmap.md:121-133`). Its prerequisite S-02 `create-settlement-group` is delivered and archived (`context/archive/2026-10-02-create-settlement-group/`).

**Method:**

- One read-only codebase worker re-read the S-02 code, the auth flow, the test harness and the S-02 archive. Its decisive anchors were spot-checked in the main context.
- Two Exa workers covered (a) libraries and services and (b) patterns and prior art.
- Two Context7 workers covered (a) Supabase (`/supabase/supabase`, `/supabase/auth`, `/supabase/ssr`, `/websites/postgrest_en_v14`) and (b) Astro (`/withastro/docs`), Cloudflare Workers (`/llmstxt/developers_cloudflare_workers_llms-full_txt`), nanoid (`/ai/nanoid`) and MDN (`/mdn/content`).
- The main context verified the following directly:
  - Supabase Auth's `IsRedirectURLValid` source
  - `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` / `auth-js` 2.116.0 in `node_modules`
  - npm versions

The previous document (2026-10-02, written before S-02) was removed at the user's request. Where one of its claims is now false, this document says so in [Historical Context](#historical-context-from-prior-changes).

## Summary

1. **No ready-made library or service fits, so the flow is built in-house.** Every product that ships a complete invite flow falls into at least one of these groups:
   - It replaces Supabase Auth: Better Auth, Clerk, WorkOS, Auth0, Kinde, Stack Auth, Supastarter.
   - It needs the service-role key: Supabase `auth.admin.*`, and the MakerKit invite lookup.
   - It addresses the invite to an email: all of the above.

   Supabase has no end-user organizations or invitations feature. Its "Organizations" are dashboard teams only. The closest Supabase material is a membership-table pattern in the pgTAP guide. See [B](#b-libraries-and-services-verdicts).

2. **Basejump is the reference to borrow from, not to adopt.**
   - It has `create_invitation`, `lookup_invitation` and `accept_invitation` as `security definer` RPCs for `authenticated`.
   - It is unmaintained: last release v2.0.3 on 2024-01-14.
   - It stores the token in plaintext and hard-codes a 24 h expiry.
3. **Bill-splitting prior art favours one reusable link per group.**
   - Splitwise has `invite_link`.
   - In Spliit, the group URL itself is the credential.
   - Linear and WhatsApp add "reset link" rotation, limited to admins.
   - Tricount and Settle Up add "claim an existing placeholder participant". This does not apply to SplitDom, because members are user accounts (`supabase/migrations/20261002200553_settlement_groups.sql:24-29`).
4. **The S-02 model sets four constraints the plan must honour:**
   - **Many groups per user.** Membership has `primary key (group_id, user_id)` and no `unique(user_id)` (`settlement_groups.sql:28`). The edge case is therefore "already a member of this group", which `insert … on conflict do nothing returning` reports without an exception.
   - **Persistence functions live directly in `public`**, as `security definer` with `search_path = ''` (`settlement_groups.sql:67-184`; `CLAUDE.md`, Database changes).
   - **Business rules live in a TypeScript aggregate** (`CLAUDE.md`, Code Conventions). The DB backstops only what a direct RPC call could abuse.
   - **A non-member cannot load a group.** `get_my_group` returns null for non-members (`settlement_groups.sql:139-144`), and `/groups/[id]` answers 404 (`src/pages/groups/[id].astro:22`). The invite flow therefore needs its own "load by token" function. The join function must verify the token **for that group** and take the member from `auth.uid()`. Otherwise any signed-in user could join any group by id.
5. **No new runtime dependency is needed for the token.**
   - In workerd 1.20260918.1, `crypto.getRandomValues` plus `Uint8Array.prototype.toBase64({ alphabet: 'base64url', omitPadding: true })` work without `nodejs_compat` (tested locally by the docs worker).
   - Node 22.14, which runs Vitest, lacks `toBase64`.
   - nanoid 6.0.1 (ESM, `crypto.getRandomValues`) is worth adding only for a short typeable code. It is not a direct dependency today.
6. **Carrying the invite across sign-in.**
   - **`next` on the callback URL.** A `redirectTo` / `emailRedirectTo` whose scheme, host and port equal `SITE_URL` passes Supabase's check whatever its query string (`IsRedirectURLValid`). The hosted `site_url` is the Worker origin (`context/deployment/deploy-plan.md:62`).
   - **Short-lived HttpOnly `SameSite=Lax` cookie.** This uses Astro's `cookies.set` API.
   - Supabase's own Astro callback example redirects to `next` **without validation**, so SplitDom must reject `//…` and `/\…` itself.
   - **Do not use `user_metadata`.** Supabase documents it as user-editable and "not a good place to store authorization data".
7. **GET must not join; POST joins.** Messenger link previews and mail scanners fetch shared URLs with GET.
   - Astro's default `security.checkOrigin` blocks cross-site form POSTs with 403.
   - A plain form-POST endpoint under `src/pages/api/` matches the existing `api/groups` pattern. Astro Actions would be the first in the repo and add machinery.

## Detailed Findings

### A. The codebase after S-02 (what the slice plugs into)

**Schema** (`supabase/migrations/20261002200553_settlement_groups.sql`)

- `groups(id, name, host_id, created_at)`. The host marker is `host_id`, which does not cascade (:14-20).
- `group_members(group_id, user_id, joined_at)`, with `primary key (group_id, user_id)` and an index on `user_id` (:24-32).
- `billing_periods`, with a partial unique index that allows one open period per group (:36-49).
- RLS is on with no policies, and table grants are revoked from `anon` and `authenticated` (:53-61).
- Functions `create_group`, `get_my_group` and `list_my_groups` (:67-184). Each has these properties:
  - `security definer` and `search_path = ''`
  - raises `28000` when `auth.uid()` is null
  - execute is revoked from `public, anon` and granted to `authenticated` (:178-184)
- Backstop precedent: `create_group` refuses a `p_host_id` different from `auth.uid()` with `42501` (:85-89). The comment calls it a persistence backstop, "not a business rule".
- Schema `private` exists (`supabase/migrations/20260927211445_private_schema.sql:8-15`) but holds no functions.

**Domain module** (`src/lib/groups/`)

- `Group` aggregate:
  - Invariant "the host is a member" (`group.aggregate.ts:26-36`).
  - `create` and `restore` (:38-71), plus `isHost` and `isMember` (:73-79).
  - No `addMember`/`join` method.
- `GroupService(repository, newId, clock)` has `create`, `listForMember` and `getForMember`. `getForMember` returns `group_not_found` for unknown ids and for non-members alike (per the codebase worker's report on `group.service.ts:53-67`).
- `GroupErrorCode` is a closed union of four codes: `invalid_group_name | group_not_found | not_authenticated | unexpected` (`types.ts:4`). The `MESSAGES` record in `group-error.messages.ts` is keyed by it. New invite codes therefore extend both, or live in a sibling module.
- The module never imports `@/lib/supabase` (`index.ts:1-2`).
- The repository maps `28000` to `not_authenticated` and any other DB code to `unexpected` with `{ dbCode }` (per the worker's report on `group.repository.ts:71-73`).

**Pages and auth**

- `PROTECTED_ROUTES = ["/dashboard", "/groups", "/api/groups"]`, matched by whole path segment (`src/middleware.ts:4,20`). Anonymous requests go to plain `/auth/signin`, with no return URL (`src/middleware.ts:22`).
- Post-auth destinations, all hard-coded:

  | Route    | Destination                                               |
  | -------- | --------------------------------------------------------- |
  | sign-in  | `/dashboard` (`src/pages/api/auth/signin.ts:19`)          |
  | callback | `/dashboard` (`src/pages/auth/callback.ts:33`)            |
  | sign-up  | `/auth/confirm-email` (`src/pages/api/auth/signup.ts:23`) |

- `redirectTo` / `emailRedirectTo` is `${origin}/auth/callback`, with no `next` (`src/pages/api/auth/google.ts:11`; `src/pages/api/auth/signup.ts:16`).
- No `next`/`returnTo` handling exists in `src`. This is the worker's grep; spot-checked on the files above.
- The create-group form POSTs to `src/pages/api/groups/index.ts`. On error it redirects to `/dashboard?error=<code>`, on success to `/groups/<id>`.
- There is no `src/actions/` directory.
- shadcn provides only `button.tsx`.
- `src` has no share or clipboard UI.

**Smoke test**

- `scripts/smoke.mjs:80` asserts that `redirect_to === ${BASE_URL}/auth/callback` exactly. Adding `?next=` to the Google `redirectTo` breaks this assertion.
- `Location` headers are matched with `startsWith`, per the worker's report. So `/auth/signin?next=…` still passes the sign-in redirect assertions.

**No profile table**

- S-02 stores no member names or emails (archive `plan.md:56`).
- An invite preview can show the group name, and a member count if wanted. It cannot show "invited by <name>" without a new decision.

**Test harness**

- `createTwoUsers()` returns `userA`, `userB`, `anon`, an `admin` used only for fixtures, and `cleanup()` (`src/db/__tests__/two-users.harness.ts:54-80`).
  - This covers "A creates, B joins".
  - A third-user scenario would need the internal `createSignedInUser` (:31) exported.
- The RLS guard fails on any `public` table without RLS (`src/db/__tests__/rls-guard.db.test.ts:21-29`).
- `group.repository.db.test.ts` already shows that a direct `group_members` insert by user B is refused. Joining becomes legitimate only through a function.

### B. Libraries and services: verdicts

| Candidate                                                  | What it offers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fit with SplitDom                                                                                                                                     | Verdict                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase `auth.admin.inviteUserByEmail` / `generateLink`   | Invites a new project user by email. Admin API (service role). PKCE is not supported for invites ([docs](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)).                                                                                                                                                                                                                                                                                                            | Email-bound, no group concept, the Worker has no service-role key (`src/lib/supabase.ts`)                                                             | Reject                                                                                                                                 |
| Supabase Organizations                                     | Dashboard team invites. Recreate on change, 24 h validity ([access control](https://supabase.com/docs/guides/platform/access-control)).                                                                                                                                                                                                                                                                                                                                                            | Platform feature, not end-user Auth                                                                                                                   | Reject                                                                                                                                 |
| Supabase Auth Hooks                                        | The listed hooks contain no invitation hook ([auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)).                                                                                                                                                                                                                                                                                                                                                                                      | Nothing to hook into                                                                                                                                  | Reject                                                                                                                                 |
| Supabase pgTAP guide membership model                      | `organizations` + `org_members(org_id, user_id, role)` with a definer role helper (Context7 `/supabase/supabase`, `guides/local-development/testing/pgtap-extended.mdx`)                                                                                                                                                                                                                                                                                                                           | Already matched by `group_members`                                                                                                                    | Pattern already in place                                                                                                               |
| **Basejump** invitations                                   | `invitations` table, plaintext token from `generate_token(30)`, `one_time` or `24_hour`, three definer RPCs. `accept_invitation` inserts `auth.uid()` ([SQL](https://github.com/usebasejump/basejump/blob/cfaeaa314e2bd336ff296c8b45fa5f0fa7e4856b/supabase/migrations/20240414162100_basejump-invitations.sql), [docs](https://usebasejump.com/docs/invitations)). MIT. Last release v2.0.3 on 2024-01-14, last commit 2024-04-15 ([releases](https://github.com/usebasejump/basejump/releases)). | Same anon-key plus RPC shape as ours                                                                                                                  | **Borrow the pattern**. Do not adopt: it is unmaintained, brings its own accounts and billing model, and stores the token in plaintext |
| MakerKit (Supabase kit)                                    | Email invites with `invite_token` and `expires_at`. The lookup "requires an admin client to bypass RLS" ([API](https://makerkit.dev/docs/next-supabase-turbo/api/team-account-api)).                                                                                                                                                                                                                                                                                                               | Needs service role; paid Next.js kit                                                                                                                  | Borrow only the explicit `expires_at`                                                                                                  |
| Supastarter                                                | Organizations through Better Auth ([docs](https://supastarter.dev/docs/nextjs/organizations/overview))                                                                                                                                                                                                                                                                                                                                                                                             | Second auth system                                                                                                                                    | Reject                                                                                                                                 |
| Better Auth organization plugin (v1.7.7, npm)              | `inviteMember` / `acceptInvitation`. Accept requires a matching email ([docs](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/organization.mdx)).                                                                                                                                                                                                                                                                                                                   | Its own auth server and tables. Not among Supabase's third-party auth providers ([list](https://supabase.com/docs/guides/auth/third-party/overview)). | Reject                                                                                                                                 |
| Clerk, WorkOS, Auth0, Kinde, Stack Auth                    | Email-addressed org invitations. Auth0 (`send_invitation_email:false`) and WorkOS (`accept_invitation_url`) can return a URL instead of sending mail ([Auth0](https://auth0.com/docs/api/management/v2/organizations/post-invitations), [WorkOS](https://workos.com/docs/reference/authkit/invitation/send)).                                                                                                                                                                                      | Each is the identity provider                                                                                                                         | Reject                                                                                                                                 |
| Permit.io, SpiceDB (Oso not checked)                       | External authorization services. Permit has an invite UI ([docs](https://docs.permit.io/embeddable-uis/webhooks/)).                                                                                                                                                                                                                                                                                                                                                                                | Would duplicate `group_members` and add an external service                                                                                           | Reject (overkill)                                                                                                                      |
| Web Crypto on Workers                                      | `getRandomValues`, `randomUUID`, `subtle.digest('SHA-256')` (Context7 Cloudflare `runtime-apis/web-crypto`; [docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/))                                                                                                                                                                                                                                                                                                            | Built in                                                                                                                                              | **Use**                                                                                                                                |
| nanoid 6.0.1 (+ nanoid-dictionary 5.0.0)                   | `customAlphabet(alphabet, size)`. ESM-only, engines `^22 \|\| ^24 \|\| >=26`. The 6.0 changes are speed and dropping Node 18/20, with no API break against v5 (Context7 `/ai/nanoid`; [GitHub](https://github.com/ai/nanoid)). The `nolookalikes` alphabet drops easily confused characters.                                                                                                                                                                                                       | Works on Workers (global `crypto.getRandomValues`) and on Node 22.14                                                                                  | Optional: only for a short typeable code                                                                                               |
| cuid2 3.3.0, uuid 14.0.2, id128 1.6.6, `invite-code` 0.0.2 | ID generators (npm, per the libraries worker)                                                                                                                                                                                                                                                                                                                                                                                                                                                      | id128 (2022) and `invite-code` (2018) are stale. The rest add nothing over Web Crypto.                                                                | Reject                                                                                                                                 |
| Astro integrations                                         | Only generic Supabase SSR auth guides ([quickstart](https://supabase.com/docs/guides/auth/quickstarts/astrojs))                                                                                                                                                                                                                                                                                                                                                                                    | No invite integration exists                                                                                                                          | Nothing to adopt                                                                                                                       |

### C. Patterns and prior art

**1. Token design**

- **Random token, hashed at rest.** The Copenhagen Book recommends at least 112 bits from a CSPRNG, stored as SHA-256 ([server-side tokens](https://thecopenhagenbook.com/server-side-tokens)). OWASP asks for random, hashed-at-rest, expiring tokens ([Forgot Password cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)). 32 random bytes give 256 bits, which is 43 base64url characters.
- **Stateless signed token (IHateMoney).** IHateMoney signs invite tokens from the project secret with `itsdangerous`. The only way to revoke is to change that secret, which kills every link at once ([security](https://ihatemoney.readthedocs.io/en/latest/security.html)). An HMAC on Workers is possible. Revoking a single link would bring back a DB lookup, and the Worker would hold a second secret. Verdict: use a DB-stored hashed token.
- **Where to hash (inference).** The lookup and join functions should take the **plaintext** token and hash it inside Postgres.
  - Core `sha256(bytea)` resolves under `search_path = ''` ([binary string functions](https://www.postgresql.org/docs/current/functions-binarystring.html)).
  - The pgcrypto functions are different: on Supabase they live in schema `extensions`, so they must be written as `extensions.digest` / `extensions.gen_random_bytes` (Context7 `/supabase/supabase`, `guides/database/functions.mdx`).
  - Why not accept the hash: if an RPC accepted the hash, a leaked hash would work as a credential through a direct RPC call. Storing hashes would then protect nothing.
  - Creation may pass the hash in, or generate the token inside the database.
- **Short code (if wanted).** Splid shares a group code such as `PWJ E2B P7A` ([splid-js](https://github.com/LinusBolls/splid-js)). An 8-character code over 32 symbols gives 40 bits, which is weaker than a link token. It is acceptable only with expiry and a per-user rate limit (see 5).

**2. Link model in bill-splitting apps**

| App        | Model                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splitwise  | One reusable group link (`invite_link` in the API). Any member can share it. No public documentation on reset or expiry ([KB](https://kb.splitwise.com/groups/how-do-i-join-an-existing-group), [API](https://dev.splitwise.com/)). |
| Tricount   | Join, then "identify yourself" as an existing participant ([FAQ](https://help.tricount.com/en/articles/tricount-faqs))                                                                                                              |
| Spliit     | The unguessable group URL is the credential. No accounts, no rotation ([issue #7](https://github.com/spliit-app/spliit/issues/7)).                                                                                                  |
| Cospend    | Several share links per project, each with a permission level and an optional password ([user docs](https://github.com/julien-nc/cospend-nc/blob/main/docs/user.md))                                                                |
| IHateMoney | `/{project}/join/{token}`, a signed token derived from the project secret ([API](https://ihatemoney.readthedocs.io/en/latest/api.html))                                                                                             |
| Settle Up  | Link or QR code. One user review describes joining but failing to attach to a participant. A single review is weak evidence.                                                                                                        |

**3. Rotation**

- **WhatsApp.** Only admins reset the link, and the old link "can't be restored". By default, members of groups under 33 people can also create links ([FAQ](https://faq.whatsapp.com/3242937609289432)).
- **Linear.** Invite links are persistent and reusable. "Reset invite link" is admin-only ([docs](https://linear.app/docs/invite-members)).
- **Discord and Slack.** They combine expiry (Discord 7 days by default, Slack 30 days) with use limits ([Discord](https://support.discord.com/hc/en-us/articles/208866998-Invites-101), [Slack](https://slack.com/help/articles/360060363633)).
- **Inference for SplitDom.**
  - The PRD gives the host no administrative right beyond closing periods (`context/foundation/prd.md:124`).
  - Rotation removes access rather than granting it, so "any member may rotate, and we record who did" fits the PRD. Restricting it to the host would add an admin right the PRD does not list.
  - This is a product decision.

**4. Keeping the invite across sign-in (Supabase + Astro)**

Redirect validation, verified in source:

- `IsRedirectURLValid` accepts a redirect URL whose scheme, host and port equal `SITE_URL`, whatever its path or query. The port check is skipped for localhost.
- Other URLs are glob-matched against the allow-list, with only `#fragment` stripped ([request.go](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)).
- The auth-js JSDoc agrees: allow-list entries match "the full URL including the query string", and "Redirects to the Site URL's own origin always pass" (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:145-160`).
- Wildcards: `*` does not cross `.` or `/`, while `**` matches everything. Supabase recommends exact paths in production (Context7 `/supabase/supabase`, `guides/auth/redirect-urls.mdx`).
- Our setup:
  - hosted: `site_url` is the Worker origin, with allow-list `…workers.dev/**` (`context/deployment/deploy-plan.md:62`)
  - local: `site_url = "http://127.0.0.1:4321"`, allow-list `localhost:4321/**` and `127.0.0.1:4321/**` (`supabase/config.toml:154,156`)
  - So `/auth/callback?next=/invite/<token>` passes on both.
- Not checked: whether the hosted auth server runs exactly this code. One smoke step would settle it.

Callback `next`:

- Supabase's Next.js callback keeps `next` only "if 'next' is not a relative URL, use the default". That check, `startsWith('/')`, still admits `//evil.com`.
- The Astro quickstart callback does `redirect(next)` with no check at all (Context7 `/supabase/supabase`, `guides/auth/quickstarts/astrojs.mdx`, `_partials/oauth_pkce_flow.mdx`).
- SplitDom should therefore validate `next` itself. Two options, both inference: an allow-listed prefix such as `/invite/`, or parse it and require same-origin, rejecting `//` and `/\`. OWASP recommends allow-listing ([Unvalidated Redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)).

PKCE flow id:

- `auth-js` 2.116.0 offers `experimental.appendPkceFlowIdToRedirects`, which appends `sb_flow_id` to the redirect. The callback then calls `exchangeCodeForSession(code, { flowId })` (`GoTrueClient.d.ts:678-698`; `types.d.ts:145-170`).
- It lets several flows run in one browser. For sign-up confirmation the flag is the only way to correlate the flow ("can only be correlated via this flag").
- It passes through `createServerClient(url, key, { auth: { experimental: … } })`:
  - `@supabase/ssr` spreads `options.auth` (`node_modules/@supabase/ssr/dist/module/createServerClient.js:29-33`)
  - `supabase-js` forwards `experimental` (`node_modules/@supabase/supabase-js/dist/index.mjs:841,859`)
- It does **not** fix confirmation in another browser: "the code exchange must be initiated on the same browser and device" (Context7 `/supabase/supabase`, `guides/auth/sessions/pkce-flow.mdx`). The known limitation in `CLAUDE.md` Notes stays. Google sign-in remains the cross-device path.

Cookie carrier:

- `context.cookies.set(name, value, { httpOnly, secure, sameSite, maxAge, path })` works in middleware, API routes and pages, and `cookies.delete` needs the same `path` (Context7 `/withastro/docs`, api-reference).
- Astro's own docs use exactly this kind of short-lived cookie: `{ path:'/', httpOnly:true, sameSite:'lax', maxAge:60 }` for `ACTION_PAYLOAD` (v5 upgrade guide).
- `SameSite=Lax` survives the top-level GET back from Google. `Strict` would not. This is standard SameSite behaviour, not stated in Astro's docs.
- A cookie is lost when the email is confirmed in another browser. That is the same limitation as the PKCE verifier.

Rejected carriers:

- `user_metadata` / `signUp` `options.data`: "can be updated by the authenticated user" and "is not a good place to store authorization data" (Context7 `/supabase/supabase`, `row-level-security.mdx`).
- `signInWithOAuth` `queryParams`: these are passed to the identity provider, not back to the app (libraries worker; not verified in source).

**5. Safe GET, CSRF, headers, abuse**

- **GET must stay safe.** RFC 9110 §9.2.1 says GET is safe ([RFC](https://www.rfc-editor.org/rfc/rfc9110.html)). WhatsApp, Slack and Microsoft Safe Links fetch shared URLs before the recipient clicks ([Meta](https://developers.facebook.com/docs/whatsapp/link-previews/), [Slack](https://docs.slack.dev/messaging/unfurling-links-in-messages), [Microsoft](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)). Therefore:
  - `GET /invite/<token>` renders a confirmation with a "Join" POST button.
  - Open Graph tags stay generic.
- **CSRF.**
  - `security.checkOrigin` defaults to `true` since Astro 5. It applies to on-demand routes.
  - It checks POST/PATCH/PUT/DELETE with form-like content types and answers 403 "Cross-site POST form submissions are forbidden" (Context7 `/withastro/docs`, configuration-reference; `node_modules/astro/dist/core/app/origin-check.js`).
  - `astro.config.mjs` does not override it.
  - It is a backstop, not authorization.
- **Actions vs API route.**
  - Actions with `accept: 'form'` work without JavaScript on on-demand pages.
  - They are public endpoints (`/_actions/<name>`) that "must" authorize themselves.
  - Redirect-after-POST needs `getActionContext()` middleware (Context7 `/withastro/docs`, guides/actions).
  - Astro 7's upgrade guide changes nothing in actions, cookies, middleware or `checkOrigin`.
  - A `src/pages/api/...` form-POST endpoint matches the existing `api/groups` route and the `?error=<code>` convention.
- **Per-page headers.** `Astro.response.headers.set(...)` and `Astro.response.status` work per page (Context7 `/withastro/docs`). That allows `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on the invite page.
- **Logging.** Do not log the raw tokened path. `wrangler.jsonc` enables Workers observability.
- **Rate limiting.**
  - The Workers `ratelimits` binding:
    - takes a `period` that "Must be either `10` or `60`"
    - counts per Cloudflare location and is "permissive, eventually consistent"
    - should be keyed by user, not IP
    - is read through `import { env } from 'cloudflare:workers'`, because `Astro.locals.runtime` was removed in adapter v13

    Sources: Context7 Cloudflare `runtime-apis/bindings/rate-limit`; `/withastro/docs` cloudflare guide.

  - Free-plan availability is not confirmed by official docs. One third-party post says it is available on all plans.
  - A 256-bit link token does not need rate limiting. A short code does.
- **Audit (inference).** Record `created_by` and `revoked_by` on the link. Optionally record which link a member joined through.

**6. Postgres join semantics and errors**

- **Idempotent join.** `insert … on conflict (group_id, user_id) do nothing returning …` returns no row for an existing member. That tells "joined" and "already a member" apart without an exception ([INSERT](https://www.postgresql.org/docs/current/sql-insert.html)).
- **Atomic claim (if single-use).** Under Read Committed, a concurrent `UPDATE … WHERE used_at IS NULL … RETURNING` re-checks its `WHERE` after waiting. So only one of two racing callers claims the row ([transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)).
- **Errors.**
  - supabase-js returns `PostgrestError { code, message, details, hint }` plus the HTTP `status`.
  - Plain `raise exception` gives `P0001`. `23505` maps to 409. `PTxyz` codes set the status directly.
  - Custom codes such as `40001` cause client retries and should be avoided.

  Sources: Context7 `/websites/postgrest_en_v14` (https://docs.postgrest.org/en/v14/references/errors.html); `/supabase/supabase` handling-errors and 40001 troubleshooting.

- **Avoiding an existence oracle.** The S-02 review skipped fixing `create_group`'s existence leak via `23505` (archive `reviews/impl-review-phase-2.md:94-95`). An invite lookup should give one "invalid invite" result for unknown, revoked and expired tokens, unless product wants distinct messages.
- **Supabase's stance on `security definer`.** The docs say "Prefer `security invoker`". Lints 0028 and 0029 flag definer functions that `anon` or `authenticated` can execute in exposed schemas. This repo has deliberately chosen `security definer` in `public` with RLS on and no policies, and both lints are expected by design (`CLAUDE.md`, Database changes; archive `plan.md:387`). That is a settled project decision, not an open issue.

**7. Share UX**

- **Web Share.** `navigator.share` needs a secure context and transient user activation. It rejects with `NotAllowedError` without activation and with `AbortError` on cancel. Desktop Firefox has it only behind a flag (Context7 `/mdn/content`).
- **Clipboard.** Safari and Firefox require `clipboard.writeText` to be called "within user gesture event handlers" (Context7 `/mdn/content`).
- **Design.** Render the link on the server, so no `await` on the network runs before `share`/`writeText`. Feature-detect `share` and fall back to a copy button.
- **QR codes** are optional and not in FR-003: `uqr` (zero-dependency, SVG string) or `qrcode.react` (React 19). These are carried over from the earlier pass and were not re-checked.

### D. Domain fit: where the invite rules live

This section is inference from the repository conventions.

- **The rules.** `CLAUDE.md` (Code Conventions → Domain logic) requires:
  - rules live in TS aggregates
  - only the repository reads and writes the aggregate, and only the service uses the repository
  - DB functions only persist and load, scoped to `auth.uid()`
- **Rules that belong in TS:**
  - is the link active (not revoked, not expired)
  - is the caller already a member
  - joining adds a member with `joinedAt = now`
  - who may create or rotate

  There are two candidate homes:

  | Option | Where                                                                                   | Trade-off                                                                   |
  | ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | (a)    | `Group.join(userId, now)`, plus an invite-link value or entity on the `Group` aggregate | Keeps membership changes beside the "host is a member" invariant            |
  | (b)    | A separate invite aggregate and module, for example `src/lib/invites/`                  | Leaves `GroupErrorCode` closed, but joining still changes `Group`'s members |

  `/10x-plan` decides.

- **What the DB must backstop.** A direct RPC call skips the TS rules, so the join function itself must enforce two things:
  - the presented token hashes to an active link **of that group**
  - the new member comes from `auth.uid()`, never from a parameter

  Duplicating the expiry check in SQL is a backstop choice, like the `p_host_id` check (`settlement_groups.sql:85-89`).

- **Loading for a non-member.**
  - A dedicated function keyed by the plaintext token returns the preview: group name and whether the link is active.
  - It should not return `host_id` or member ids. S-02 exposes members only to members (`settlement_groups.sql:139-144`).
  - It is granted to `authenticated`. Granting it to `anon` is needed only if the preview must show before sign-in.

## Code References

- `supabase/migrations/20261002200553_settlement_groups.sql:14-61` - `groups`, `group_members` (pk `(group_id,user_id)`), `billing_periods`, RLS on, grants revoked
- `supabase/migrations/20261002200553_settlement_groups.sql:85-89` - `p_host_id = auth.uid()` persistence backstop
- `supabase/migrations/20261002200553_settlement_groups.sql:139-144` - `get_my_group` returns null for non-members
- `supabase/migrations/20261002200553_settlement_groups.sql:178-184` - revoke from `public, anon`; grant to `authenticated`
- `src/lib/groups/group.aggregate.ts:26-36,73-79` - "host is a member" invariant; `isHost`/`isMember`; no join method
- `src/lib/groups/types.ts:4` - closed `GroupErrorCode` union
- `src/lib/groups/index.ts:1-2` - the module never imports `@/lib/supabase`
- `src/pages/groups/[id].astro:22` - 404 for non-members
- `src/middleware.ts:4,20,22` - protected routes; segment match; sign-in redirect without return URL
- `src/pages/api/auth/signin.ts:19`, `src/pages/auth/callback.ts:33` - hard-coded `/dashboard`
- `src/pages/api/auth/google.ts:11`, `src/pages/api/auth/signup.ts:16,23` - callback URL without `next`; then `/auth/confirm-email`
- `scripts/smoke.mjs:80` - exact `redirect_to` assertion
- `supabase/config.toml:154,156` - local `site_url` and redirect allow-list
- `src/db/__tests__/two-users.harness.ts:31,54-80` - `createSignedInUser` (internal), `createTwoUsers()`
- `src/db/__tests__/rls-guard.db.test.ts:21-29` - RLS required on every `public` table
- `node_modules/@supabase/ssr/dist/module/createServerClient.js:29-33` - `options.auth` spread into the client
- `node_modules/@supabase/supabase-js/dist/index.mjs:841,859` - `experimental` forwarded to the auth client
- `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:145-170` - `appendPkceFlowIdToRedirects` and the allow-list caveat
- `node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:678-698` - `exchangeCodeForSession(code, { flowId })`
- `wrangler.jsonc:5-6` - `compatibility_date` 2026-05-08, `nodejs_compat`

## Architecture Insights

This is a recommended shape, not a decision; `/10x-plan` owns it.

1. **Data.** A group-scoped invite-link table holds:
   - `token_hash` (unique), `group_id`, `created_by`, `created_at`
   - optional `expires_at`; `revoked_at` / `revoked_by`

   For "one active link per group", add a partial unique index on `group_id where revoked_at is null`. The table gets RLS on with no policies and revoked grants, following S-02 and `CLAUDE.md`.

2. **Persistence functions in `public`:**
   - create or rotate a link
   - load an invite preview by plaintext token
   - join by plaintext token

   Each is `security definer` with `search_path = ''`, the caller is `auth.uid()`, and execute is revoked from `public, anon` and granted to `authenticated`. Join verifies the token for the group and uses `on conflict do nothing returning`.

3. **Domain.** Rules live in TS: either `Group.join` plus an invite-link value on `Group`, or a separate invites module (see D). Error codes extend the `{ error: { code, message, context } }` shape.
4. **Web:**
   - `GET /invite/[token]` (read-only preview, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`)
   - a form-POST join endpoint under `src/pages/api/`, which redirects to `/groups/<id>` on success
   - a validated `next`, or a short-lived HttpOnly Lax cookie, carried through middleware, sign-in, sign-up, Google and the callback
   - a share/copy island on the group page
5. **Tokens:**
   - 32 bytes from `crypto.getRandomValues`
   - base64url via `toBase64` in the Worker, or a small encoder that also runs on Node 22 for unit tests
   - hashed with `sha256()` inside Postgres
6. **Tests:**
   - A `*.db.test.ts` on `createTwoUsers()`. It proves:
     - B cannot preview or join with a wrong, revoked or expired token
     - B joins with a valid one
     - B joining again reports "already a member"
     - direct table access is denied
     - anon is refused
   - Smoke steps:
     - anonymous `/invite/<token>` reaches sign-in with the return target
     - `scripts/smoke.mjs:80` is updated if the Google `redirectTo` gains `next`

## Historical Context (from prior changes)

- **The previous `research.md` for this change (2026-10-02) was removed at the user's request.** Its claims, each with a current verdict:

  | Claim                                                                                                                            | Verdict                                                                                                   |
  | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
  | Membership `unique(user_id)` enforces one group per user                                                                         | **Contradicted.** FR-002 allows many groups (`context/foundation/prd.md:75`; `settlement_groups.sql:28`). |
  | Thin `public` RPCs call `private.*` definer logic                                                                                | **Contradicted.** Persistence functions live in `public` (`CLAUDE.md`; archive `plan.md:387`).            |
  | No domain tables exist                                                                                                           | **Contradicted.** Built in S-02.                                                                          |
  | `PROTECTED_ROUTES = ["/dashboard"]`                                                                                              | **Partial.** It now has three routes, still no return URL.                                                |
  | Post-auth destinations are hard-coded, no `next`                                                                                 | **Supported.**                                                                                            |
  | Query string vs `/**` allow-list unverified                                                                                      | **Resolved.** Same-origin redirects pass whatever the query.                                              |
  | nanoid 5.1.11 current                                                                                                            | **Outdated.** The current version is 6.0.1.                                                               |
  | Admin invite APIs unusable; GET must not consume; hash the token; atomic claim; `checkOrigin` on; Web Share + clipboard fallback | **Supported** and carried into this document.                                                             |

- `context/archive/2026-10-02-create-settlement-group/plan.md`:
  - :45 says S-03 needs a membership table and host marker, and that "already in another group" no longer applies.
  - :53 says there is no `unique(user_id)`.
  - :54 puts invites out of S-02's scope.
  - :56 says there is no member names table.
- `context/archive/2026-10-02-create-settlement-group/reviews/plan-review.md:43` - a double-submitted duplicate group could make an invitee join the wrong one. Fixed in S-02 by disabling the button.
- `context/archive/2026-10-02-create-settlement-group/reviews/impl-review-phase-2.md`:
  - :94-95 - the `create_group` existence leak through `23505` was skipped.
  - :106-107 - the `group_members.user_id` cascade is to be reviewed in S-04.
- `context/archive/2026-09-28-external-identity-sign-in/plan.md:28,37` - the Google consent screen was published so any Google account can sign in, explicitly with invite-by-link (S-03) in mind. Supabase falls back silently to `site_url` when a redirect is not allowed.
- `context/deployment/deploy-plan.md:62,99` - the hosted `site_url` and allow-list were set by hand in the Dashboard, not by `config push`.

## Related Research

Not applicable. No other `research.md` exists under `context/changes/` or `context/archive/`.

## Decisions (2026-10-04)

The user decided the following in conversation on 2026-10-04:

- **Link model:** single-use invites, one per invited person. This replaces the reusable per-group link that the prior-art section (C.2, C.3) favoured.
- **Expiry:** 7 days. This is the Discord / Auth0 / WorkOS / MakerKit default in [C.3](#c-patterns-and-prior-art) and [B](#b-libraries-and-services-verdicts).

What follows for `/10x-plan`. These are inferences from the findings above.

- **"Resending" means generating a new invite.** The app sends no email (FR-003), so an expired invite cannot be re-sent. The member generates a new invite, and the old one stays invalid.
- **Expiry needs no scheduled job.**
  - The aggregate sets `expires_at = created_at + 7 days`. Following the `Dates` convention, the date is computed by the domain module.
  - The join checks expiry at claim time.
- **Single use needs an atomic claim.**
  - Two racing callers must not both use one invite. A conditional `update … set used_at = now(), used_by = auth.uid() where token_hash = … and used_at is null and revoked_at is null and expires_at > now() returning group_id` lets one of them win ([C.6](#c-patterns-and-prior-art)).
  - The claim and the membership insert run in one transaction, inside the same persistence function.
- **The invite is a bearer token.** It is not bound to the invitee's identity, because the app knows no email for them. Whoever claims it first joins.
- **The short-code rate limit matters less.** A 256-bit single-use token with a 7-day expiry needs no Workers rate limiting. That holds unless a short typeable code is also added (Open Question 4).

The user answered the follow-up questions on 2026-10-04:

- **An already-member consumes the invite.**
  - Opening the link (GET) still consumes nothing ([C.5](#c-patterns-and-prior-art)). Consumption happens on the join POST.
  - For an already-member, the claim marks the invite used, the membership insert is a no-op (`on conflict do nothing`), and the user lands on `/groups/<id>`.
  - Inference: the preview page can tell an already-member that they are a member, but the invite is used only if they submit the form.
- **UI: only a "Generate invite" button** on the group page. There is no list of pending, used or expired invites and no "revoke" action. What follows (inference):
  - Only the token's hash is stored, so the link is shown once, right after it is generated. The member copies or shares it there. A member who loses the link generates a new one.
  - There is no revoke action in scope, so a `revoked_at` / `revoked_by` column is not needed for MVP. Expiry plus single use are the only controls.
- **No cap on open invites per group.** Any member may generate as many as they like. Each one still works once and expires after 7 days.

## Open Questions

1. ~~**Link model**~~: resolved 2026-10-04. Single-use invites (see [Decisions](#decisions-2026-10-04)).
2. ~~**Expiry**~~: resolved 2026-10-04. 7 days (see [Decisions](#decisions-2026-10-04)).
3. **Who may create and rotate** (product): any member, matching the PRD's flat model, or the host only?
4. **Typeable code** (product): FR-003 says "link/kod". Is a short code in scope? If yes, use nanoid `customAlphabet` plus expiry plus a per-user rate limit.
5. **Preview before sign-in** (product/security): show the group name to anonymous visitors (grant the preview function to `anon`), or sign in first?
6. **Return-to carrier** (technical): `next` query, HttpOnly cookie, or both? Also: enable `appendPkceFlowIdToRedirects`?
7. **Aggregate boundary** (technical): `Group.join` on the existing aggregate, or a separate invites module?
8. **Unverified:**
   - whether hosted Supabase Auth runs the inspected `IsRedirectURLValid`
   - Workers Rate Limiting on the Free plan
   - whether Splitwise and Tricount links can be reset or expire
   - Oso
