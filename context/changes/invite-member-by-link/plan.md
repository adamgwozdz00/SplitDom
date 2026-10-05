# Invite a Member by Link (S-03) Implementation Plan

## Overview

A member of a settlement group generates an invite link on the group page. They send it through any channel themselves: SMS, a messenger or email. The app sends nothing (FR-003). The invited person opens the link, signs in or creates an account if needed, confirms with a "Join group" button, and becomes a member of the group.

Each invite works **once** and expires **7 days** after it is generated. The link is shown only once, right after it is generated, because the database stores only a hash of its token.

The slice adds a new `Invite` aggregate in `src/lib/invites/`, which owns the rules: who may invite, expiry, single use, and redeeming. It also adds:

- a `group_invites` table with three persistence functions
- a share/copy panel on the group page
- the `/invite/[token]` page and a join endpoint
- a short-lived cookie that carries a pending invite through sign-in, sign-up and Google OAuth

## Current State Analysis

- **S-02 delivered the group model:**
  - `groups(id, name, host_id, created_at)`.
  - `group_members(group_id, user_id, joined_at)` with `primary key (group_id, user_id)`, so a user may belong to many groups.
  - RLS on with no policies, and table grants revoked.
  - Persistence functions `create_group`, `get_my_group` and `list_my_groups`, each `security definer` in `public` with `search_path = ''`, raising `28000` without a session (`supabase/migrations/20261002200553_settlement_groups.sql:14-61,67-184`).
- **A non-member cannot load a group.** `get_my_group` returns `null` unless the caller is a member (`settlement_groups.sql:139-144`), and `/groups/[id]` answers 404 (`src/pages/groups/[id].astro:20-23`).
- **The `Group` aggregate has no way to add a member.** It enforces "the host is a member" (`src/lib/groups/group.aggregate.ts:26-36`) and offers `isHost`/`isMember` (:73-79). `GroupService.getForMember` returns `group_not_found` for unknown ids and for non-members alike (`src/lib/groups/group.service.ts:53-67`).
- **`GroupErrorCode` is a closed union** of four codes (`src/lib/groups/types.ts:4`). The comment above `GroupError` says the error shape is "owned here until a second module needs it" (:6).
- **The groups module never imports `@/lib/supabase`.** That file pulls in `astro:env/server`, which plain Vitest cannot resolve (`src/lib/groups/index.ts:1-2`). `createGroupService(client)` builds the service with an arrow id generator, because workerd throws "Illegal invocation" for an unbound `crypto.randomUUID` (`src/lib/groups/group.repository.ts:59-69`).
- **Endpoints are form POSTs that redirect.** On error they put only the code in `?error=<code>`, and the page renders the module's message (`src/pages/api/groups/index.ts:5-29`; `CLAUDE.md` Code Conventions). The create-group form disables its button on submit, as a progressive enhancement (`src/components/groups/CreateGroupForm.astro:49-62`).
- **No path returns to where the user came from after sign-in.**
  - The middleware sends anonymous users to plain `/auth/signin` (`src/middleware.ts:4,20-23`).
  - Successful sign-in goes to `/dashboard` (`src/pages/api/auth/signin.ts:19`).
  - The PKCE callback goes to `/dashboard` (`src/pages/auth/callback.ts:33`).
  - Sign-up goes to `/auth/confirm-email` (`src/pages/api/auth/signup.ts:23`).
  - Google and email confirmation both return through `/auth/callback` (`src/pages/api/auth/google.ts:11`; `signup.ts:16`).
- **The smoke test** uses one cookie jar with `redirect: "manual"`, matches `Location` by prefix and can check response bodies (`scripts/smoke.mjs:31-51,156-159`). Local sign-up needs no email confirmation (`supabase/config.toml:209`), so a second smoke user can sign up and sign in immediately.
- **The test harness.** `createTwoUsers()` returns `userA`, `userB`, `anon`, `admin` and `cleanup()` (`src/db/__tests__/two-users.harness.ts:14-23,54-80`). The RLS guard fails on any `public` table without RLS (`src/db/__tests__/rls-guard.db.test.ts:21-29`).
- **Local Postgres is version 17** (`supabase/config.toml:36`), so core `sha256(bytea)` is available without pgcrypto.

## Desired End State

**Generating a link.** On `/groups/<id>`, every member sees a "Generate invite" button. Clicking it reloads the page, which shows:

- the full invite link (`https://…/invite/<43-character token>`) in a read-only field;
- a **Share** button where the browser supports Web Share;
- a **Copy link** button;
- a note: "Works once and expires in 7 days. You won't see this link again."

Reloading the page hides the link. A member can generate as many invites as they like.

**Opening a link while signed out.** The visitor is sent to the sign-in page, which says that they need to sign in or create an account to accept the invite. Signing in leads straight back to the invite page, whichever way the visitor does it:

- email and password;
- Google;
- confirming a new account's email in the same browser.

**Opening a link while signed in.** The invite page shows the group name and a "Join group" button.

- **Joining.** The user lands on `/groups/<id>` as a member, and the group appears on their dashboard.
- **Already a member.** The page says so. Joining still uses up the invite and opens the group.
- **Invalid invite.** A used, expired or unknown invite shows one message: "This invite is no longer valid — ask a group member for a new one." The response is a 404, and the message never tells which of the three it was.

**Verification:**

- `npm test` (domain unit tests)
- `npm run test:db` (persistence, isolation, race)
- `npm run smoke` (second user joins through the built app)
- `npx astro check`, `npm run lint`
- CI's generated-types drift check

All of these must be green.

### Key Discoveries:

- **Supabase's admin invite APIs (`inviteUserByEmail`, `generateLink`) do not fit.** They invite a person to the project by email and need the service-role key, which the Worker does not have (`research.md` §B).
- **GET must never consume an invite.** WhatsApp, Slack and Microsoft Safe Links fetch shared URLs before the recipient clicks (`research.md` §C.5). Joining is an explicit POST, and Astro's default `security.checkOrigin` rejects cross-site form POSTs with 403.
- **Under Read Committed, a conditional `UPDATE … RETURNING` is a race-safe claim.** The statement is `… WHERE used_at IS NULL …`. A concurrent `UPDATE` waits for the first one, then re-checks its `WHERE`, so exactly one of two racing callers wins (`research.md` §C.6).
- **`insert … on conflict (group_id, user_id) do nothing` tells "joined" from "already a member"** without raising an exception (`research.md` §C.6).
- **Lookups take the plaintext token and hash it inside Postgres.** If an RPC accepted the hash, a leaked hash would work as a credential (`research.md` §C.1).
- **The return target is carried in a cookie.** A `SameSite=Lax` cookie survives the top-level GET back from Google and from the confirmation email, so neither `redirectTo`/`emailRedirectTo` nor the Supabase allow-list has to change (`research.md` §C.4). A cookie is lost when the email is confirmed in another browser. That is the same limitation the PKCE verifier already has (`CLAUDE.md` Notes).
- **Node 22.14, which runs Vitest, has no `Uint8Array.prototype.toBase64`.** Token encoding must use `btoa`, which exists both there and in workerd (`research.md` Summary 5).

## What We're NOT Doing

- **No short typeable code.** Invites are links only. A short code would need its own rate limiting and is out of scope (2026-10-04 decision).
- **No invite list, no revoke action and no cap on open invites.** The only UI is "Generate invite" (2026-10-04 decision). There are no `revoked_at`/`revoked_by` columns.
- **No preview for anonymous visitors.** The group name is shown only after sign-in, and no function is granted to `anon`.
- **No general `next`/return-URL mechanism.** Only invites return after sign-in. Other protected pages still land on `/dashboard`.
- **No changes to `redirectTo`, `emailRedirectTo`, the Supabase redirect allow-list or the Google smoke assertion** (`scripts/smoke.mjs:80`).
- **No email sending, no Supabase `auth.admin.*` invite APIs, no service-role key, no Astro sessions or KV, and no Workers rate-limiting binding.**
- **No `Group.join` method.** The invitee cannot load the group they are joining (`get_my_group` returns `null` for non-members), so the rule "redeeming an active invite grants membership" lives in `Invite.redeem`.
- **No shared `src/lib/errors/` module.** The invites module declares its own error type with the project's `{ error: { code, message, context } }` shape.
- **No member names on the invite page or group page.** There is no profile table. The page does not say who sent the invite.
- **No fix for confirming sign-up email in another browser.** Google sign-in remains the cross-device path.
- **No QR code** (not in FR-003).
- **No new npm dependency.**

## Implementation Approach

The work goes in the same order as S-02: domain, then persistence, then web. The web part is split into two verifiable halves.

1. **Domain (TypeScript, no database).**
   - `InviteToken` is a 256-bit random token encoded as base64url.
   - The `Invite` aggregate owns creation (the inviter must be a member of the `Group`), the 7-day expiry, `isActive(now)` and `redeem(userId, now)`.
   - `InviteService` is the only user of `InviteRepository`. It offers `create`, `preview` and `redeem`.
2. **Persistence.** The `group_invites` table stores only the SHA-256 hash of the token. It has three `security definer` persistence functions in `public`. Redeeming claims the invite and inserts the membership in **one** function, so one transaction covers both. It is the only function that writes `group_members` outside `create_group`. The user accepted this on 2026-10-04 as an atomicity mechanism.
3. **Generating and sharing.** The group page gets a "Generate invite" form-POST. The endpoint loads the group through `GroupService.getForMember`, then creates the invite through `InviteService`. It hands the token to the next page load in a one-time HttpOnly cookie scoped to that group's path.
4. **Joining.** This part delivers:
   - The `/invite/[token]` page: a read-only preview, a join form, and `Referrer-Policy: no-referrer` with `Cache-Control: no-store`.
   - The join endpoint.
   - The pending-invite cookie, which `/invite/[token]` sets for anonymous visitors. `signin.ts` and `callback.ts` read it and then clear it.
   - The smoke flow.
   - Docs.

**Roadmap sync.** At the start: S-03 → `In progress` on the project board and in `roadmap.md`. The PR body contains `Closes #8`. `Done` and unblocking S-04 belong to the separate closeout PR.

The endpoints orchestrate the two aggregates' services: `GroupService` for "is this user a member", and `InviteService` for invites. Neither service touches the other's repository.

## Critical Implementation Details

- **Identity and the backstops in SQL.** Every function takes the caller from `auth.uid()` and raises `28000` without a session. Three backstops apply. Each is a persistence or safety mechanism, not a business rule, and each exists because a signed-in browser can call the RPC directly:
  - **`create_group_invite`** refuses with `42501` when `p_created_by` is not `auth.uid()`, or when the caller is not a member of `p_group_id`. This mirrors `create_group`'s `p_host_id` check (`settlement_groups.sql:85-89`). It also refuses a token shorter than 43 characters with `22023`, so a direct call cannot store a guessable token.
  - **`redeem_group_invite`** checks expiry against the database clock (`expires_at > now()`), **not** against the caller's `p_used_at`. Otherwise a direct call could redeem an expired invite by passing an old timestamp.
  - **The aggregate still makes the decision first.** The `used_at is null` condition in SQL is the race-safety claim.
- **Order inside `redeem_group_invite`.** The steps run in this order:
  1. Claim the invite with the conditional `UPDATE … RETURNING group_id`.
  2. If no row is returned, raise `invite_invalid` with `errcode = 'SD001'` and touch nothing else.
  3. Insert the membership with `on conflict do nothing`.
  4. Return `{ group_id, joined }`, where `joined` is whether a row was inserted.

  An already-member therefore uses up the invite and gets `joined: false`, as decided. Two racing calls produce one success and one `SD001`.

- **Cookies.**
  - **New-invite cookie** (`sd_new_invite`): holds the plaintext token for one page load. Its path is `/groups/<id>`, it is `HttpOnly` and `SameSite=Lax`, has `maxAge` 300 s, and is `Secure` when the request is HTTPS. The group page reads it, deletes it with the same path, and validates it with `InviteToken.parse` before rendering.
  - **Pending-invite cookie** (`sd_pending_invite`): has path `/`, the same flags, and `maxAge` 86 400 s, which allows time to confirm a new account's email. It is consumed only after a successful sign-in or code exchange.
  - **The redirect target is always built by our code** as `/invite/<parsed token>`. A cookie can never cause an open redirect.
- **Token encoding.** `InviteToken.generate()` draws 32 bytes with `crypto.getRandomValues` and encodes them as base64url without padding through `btoa`. The result is exactly 43 characters from `[A-Za-z0-9_-]`. `InviteToken.parse` accepts only that shape, so malformed input never reaches the database. `InviteService` receives a token generator in its constructor, next to `newId` and `clock`. `createInviteService` passes arrows, as `createGroupService` does.
- **Double submit on "Join group".** A second POST of an already-redeemed token returns `invite_invalid`. If the second response wins the navigation, a user who did join would see "no longer valid". The join button must be disabled on submit, using the same pattern as `CreateGroupForm.astro:49-62`.
- **Tokens in URLs.** The token appears only in the GET path `/invite/<token>`, which Workers observability logs. The join POST carries it in the form body, not the URL. The invite page sends `Referrer-Policy: no-referrer`. This is accepted for a single-use 7-day token.

## Phase 1: Invite domain model (TypeScript)

### Overview

The `invites` module: token value object, `Invite` aggregate, `InviteService`, error codes and messages. Everything is unit-tested with a fake repository and no database.

### Changes Required:

#### 1. Module types and errors

**File**: `src/lib/invites/types.ts`, `src/lib/invites/invite-error.messages.ts`

**Intent**: Declare the module's error codes, result type, snapshot, lookup shape and repository port. Keep the user-facing messages next to the codes, as the groups module does.

**Contract**:

- **Error type.**
  - `InviteErrorCode = "invite_invalid" | "group_not_found" | "not_authenticated" | "unexpected"`.
  - `InviteError = { error: { code: InviteErrorCode; message: string; context: Record<string, unknown> } }`.
  - `Result<T> = { data: T } | InviteError`.
- **`InviteSnapshot`.** Fields: `id`, `groupId`, `createdBy`, `createdAt`, `expiresAt`, `usedAt: string | null` and `usedBy: string | null`. Timestamps are UTC ISO strings with milliseconds.
- **`InviteLookup`.** Fields: `invite: Invite`, `groupName: string` and `callerIsMember: boolean`. This is the read data the preview needs beyond the aggregate.
- **`InviteRepository`**, which loads and persists on behalf of the signed-in user:
  - `create(invite, token): Promise<Result<void>>`
  - `findByToken(token): Promise<Result<InviteLookup | null>>`
  - `redeem(invite, token): Promise<Result<{ groupId: string; joined: boolean }>>`
- **Messages:**
  - `inviteErrorMessage(code: string): string`, which falls back to a generic message for unknown codes.
  - `inviteError(code, context?)`.
  - `invite_invalid` → "This invite is no longer valid — ask a group member for a new one".
  - `group_not_found` → "Group not found".
  - `not_authenticated` → "Sign in to continue".
  - `unexpected` → "Something went wrong, try again".

#### 2. Token value object

**File**: `src/lib/invites/invite-token.value.ts`

**Intent**: The invite's bearer secret: generated from a CSPRNG, and validated before anything trusts it.

**Contract**:

- `InviteToken.generate(): InviteToken` returns 32 random bytes as 43-character base64url (see Critical Implementation Details).
- `InviteToken.parse(raw: string): InviteToken | null` accepts only `^[A-Za-z0-9_-]{43}$`.
- `InviteToken.LENGTH = 43`.
- `.value: string`.

#### 3. Aggregate

**File**: `src/lib/invites/invite.aggregate.ts`

**Intent**: Own the invite rules: only a member of the group may create one, it is valid for 7 days, it works once, and redeeming it records who used it and when.

**Contract**:

- `Invite.VALIDITY_MS = 7 * 24 * 60 * 60 * 1000`.
- **`Invite.create({ id, group: Group, createdBy, now }): Result<Invite>`.** It returns `group_not_found` when `!group.isMember(createdBy)`. Otherwise `expiresAt = now + VALIDITY_MS`, and the invite starts unused.
- **`Invite.restore(snapshot): Invite`.** It throws when the snapshot breaks an invariant:
  - `expiresAt <= createdAt`
  - `usedBy` set while `usedAt` is null
  - an unparseable timestamp
- **`isActive(now)`** is `usedAt === null && now < expiresAt`. At exactly `expiresAt` the invite is already inactive.
- **`redeem(userId, now): Result<Invite>`.** It returns `invite_invalid` when the invite is not active. Otherwise it returns a new `Invite` with `usedAt = now` and `usedBy = userId`.
- `toSnapshot()`.
- Read-only fields `id`, `groupId`, `createdBy`, `createdAt`, `expiresAt`, `usedAt` and `usedBy`.

#### 4. Aggregate service

**File**: `src/lib/invites/invite.service.ts`

**Intent**: The only entry point to the `Invite` aggregate. It generates tokens and ids, loads and saves through the repository, and leaves the rules to the aggregate.

**Contract**:

- The constructor is `new InviteService(repository, newId: () => string, clock: () => Date, newToken: () => InviteToken)`.
- **`create({ group, createdBy }): Promise<Result<{ token: InviteToken; expiresAt: Date }>>`.** It builds the invite with `Invite.create` and saves it with `repository.create(invite, token)`.
- **`preview({ token: string }): Promise<Result<{ groupId; groupName; callerIsMember; expiresAt }>>`.** It returns `invite_invalid` in three cases:
  - the token does not parse; the repository is not called;
  - the lookup is `null`;
  - `!invite.isActive(clock())`.
- **`redeem({ token: string; userId }): Promise<Result<{ groupId: string; joined: boolean }>>`.** It fails in three ways:
  - **Malformed token:** `invite_invalid`, without calling the repository.
  - **Lookup is `null` or `invite.redeem(userId, clock())` fails:** `invite_invalid`.
  - **Anything else:** `repository.redeem(redeemedInvite, token)`, with repository errors passed through.

#### 5. Barrel and test fakes

**File**: `src/lib/invites/index.ts`, `src/lib/invites/__tests__/invites.harness.ts`

**Intent**: The module's public API, which never imports `@/lib/supabase`, and an in-memory repository for unit tests.

**Contract**:

- `index.ts` exports:
  - the types
  - `Invite`, `InviteToken`, `InviteService`
  - `inviteErrorMessage`
- Later phases add their exports here.
- **`FakeInviteRepository`:**
  - holds invites by token value, plus each invite's group name and member flag;
  - records its calls;
  - has a `failure` switch, like `FakeGroupRepository` (`src/lib/groups/__tests__/groups.harness.ts`).

#### 6. Unit tests

**File**: `src/lib/invites/__tests__/invite-token.value.test.ts`, `invite.aggregate.test.ts`, `invite.service.test.ts`

**Intent**: Prove every invite rule without a database. Cases are listed under Testing Strategy → Unit Tests.

**Contract**: Tests use a fixed clock and id or token generators. A `Group` comes from `Group.create`, through the groups module's public API.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- The rules (member-only creation, 7-day expiry, single use) are readable in `invite.aggregate.ts` alone, and `src/lib/invites/` imports nothing from `@/lib/supabase`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Persistence and isolation

### Overview

This phase adds:

- the `group_invites` table, with deny-all RLS and only the token hash stored;
- three persistence functions;
- generated types;
- the Supabase repository;
- a two-user DB test that proves isolation, single use, expiry, the race and the backstops.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_group_invites.sql` (created with `npm run db:new group_invites`)

**Intent**: Persist the `Invite` aggregate, keep the plaintext token out of storage, and make "claim the invite + add the member" atomic. Constraints and checks are backstops only.

**Contract**:

- **Table `public.group_invites`:**
  - `id uuid primary key`
  - `group_id uuid not null references public.groups(id) on delete cascade`, plus an index on `group_id`
  - `token_hash bytea not null unique check (octet_length(token_hash) = 32)`
  - `created_by uuid not null references auth.users(id) on delete cascade`
  - `created_at timestamptz not null`
  - `expires_at timestamptz not null`
  - `used_at timestamptz`
  - `used_by uuid references auth.users(id) on delete set null`
  - No `check` constraints on the relations between columns (`expires_at` after `created_at`, `used_by` only with `used_at`). These are invariants of the `Invite` aggregate, enforced by `Invite.restore`, not by the database.
- **Access to the table:**
  - `enable row level security`, with no policies;
  - `revoke all … from anon, authenticated`;
  - `comment on table` naming the `Invite` aggregate (`src/lib/invites`).
- **Hashing.** The hash is always `sha256(convert_to(p_token, 'UTF8'))`. This is core Postgres and resolves under `search_path = ''`.
- **Settings shared by all three functions:**
  - `security definer`, `set search_path = ''`;
  - raise `not_authenticated` with `errcode = '28000'` when `auth.uid()` is null;
  - `comment on function` says "persistence only — business rules live in `src/lib/invites`";
  - `revoke execute … from public, anon`, then `grant execute … to authenticated`.
- **`public.create_group_invite(p_invite_id uuid, p_group_id uuid, p_token text, p_created_by uuid, p_created_at timestamptz, p_expires_at timestamptz) returns void`.** It inserts one row with the token hash and applies the backstops from Critical Implementation Details:
  - `42501` when `p_created_by` is not the caller;
  - `42501` when the caller is not a member of `p_group_id`;
  - `22023` when the token is shorter than 43 characters.
- **`public.get_group_invite(p_token text) returns jsonb`** (`stable`). It returns one of two results:
  - When the token hash matches, a snake_case snapshot: `id`, `group_id`, `group_name`, `created_by`, `created_at`, `expires_at`, `used_at`, `used_by` and `caller_is_member`. This covers used and expired invites too; the aggregate decides what they mean.
  - Otherwise `null`.

  This is the only path that shows a group's name to a non-member, and only to a signed-in holder of the token.

- **`public.redeem_group_invite(p_token text, p_used_at timestamptz) returns jsonb`.** It runs in the order given in Critical Implementation Details:
  - It returns `{ group_id, joined }`.
  - On a failed claim it raises `invite_invalid` with `errcode = 'SD001'`.
  - It uses `p_used_at` for `used_at` and `joined_at`.
  - Expiry is checked against `now()`.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate after the migration, never by hand.

**Contract**: Run `npm run db:reset && npm run db:types`. `group_invites` and the three functions appear under `public`.

#### 3. Supabase repository

**File**: `src/lib/invites/invite.repository.ts` (exported from `src/lib/invites/index.ts`)

**Intent**: Implement `InviteRepository` on the user's Supabase client. It maps the aggregate to function parameters and back, and translates database errors into domain errors.

**Contract**:

- **`createSupabaseInviteRepository(client: SupabaseClient<Database>): InviteRepository`.** It imports only `@supabase/supabase-js` types and `@/db`.
- **`create`** calls `rpc("create_group_invite", …)` with values from `invite.toSnapshot()` and `token.value`.
- **`findByToken`** calls `rpc("get_group_invite", { p_token })`.
  - It maps `null` to `{ data: null }`.
  - Otherwise it maps the snake_case JSON to an `InviteSnapshot`, normalizing timestamps with `new Date(value).toISOString()`. It then calls `Invite.restore` and returns `{ invite, groupName, callerIsMember }`.
  - A malformed shape or a restore failure becomes `unexpected`, never a raw throw.
- **`redeem`** calls `rpc("redeem_group_invite", { p_token, p_used_at })`, with `p_used_at` taken from the redeemed invite's `usedAt`.
- **Error mapping:**
  - `28000` → `not_authenticated`
  - `SD001` → `invite_invalid`
  - `42501` → `group_not_found`
  - anything else → `unexpected`, with `context: { dbCode }`
- **`createInviteService(client): InviteService`** wires the Supabase repository with arrow generators:
  - `() => crypto.randomUUID()`
  - `() => new Date()`
  - `() => InviteToken.generate()`

#### 4. Persistence and isolation tests

**File**: `src/lib/invites/__tests__/invite.repository.db.test.ts`

**Intent**: Prove that a stranger can join only by redeeming a valid invite, exactly once, and cannot read or write invites any other way.

**Contract**:

- The test uses `createTwoUsers()`. User A owns the group, and B is the invitee.
- `afterAll` deletes the groups with `admin` before `cleanup()`, because `groups.host_id` has no cascade. The invites cascade with the groups.
- The cases are listed under Testing Strategy → Integration Tests.

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean
- Database tests pass, including the RLS guard and the new invite test: `npm run test:db`
- Unit tests, type check and lint pass: `npm test`, `npx astro check`, `npm run lint`

#### Manual Verification:

- The migration encodes no business rules beyond the documented backstops: identity from `auth.uid()`, member-only creation, minimum token length, the `used_at is null` claim, and the expiry check on `now()`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generate and share on the group page

### Overview

Every member can generate an invite on `/groups/<id>`. The link is shown once, with Share and Copy buttons.

### Changes Required:

#### 1. New-invite cookie

**File**: `src/lib/invites/invite.cookies.ts` (exported from `src/lib/invites/index.ts`)

**Intent**: Hand the freshly generated token from the POST to the next page load, without putting it in a URL or the browser history.

**Contract**:

- **`stashNewInvite(cookies: AstroCookies, url: URL, groupId: string, token: InviteToken)`** sets `sd_new_invite` with the flags from Critical Implementation Details. Its path is `/groups/<groupId>`.
- **`takeNewInvite(cookies, groupId): InviteToken | null`** reads, deletes and parses the cookie. A malformed value returns `null`.
- Only `import type { AstroCookies } from "astro"` is used, so unit tests can pass a fake.

#### 2. Endpoint

**File**: `src/pages/api/groups/[id]/invites.ts`

**Intent**: A form POST that creates an invite for the signed-in member, in the same redirect style as `src/pages/api/groups/index.ts`.

**Contract**:

- **Success.** `POST` loads the group with `createGroupService(supabase).getForMember({ groupId, userId })`, then calls `createInviteService(supabase).create({ group, createdBy: user.id })`. It then calls `stashNewInvite` and redirects 302 to `/groups/<id>`.
- **Errors** from either service redirect 302 to `/groups/<id>?error=<code>`.
- **Supabase not configured:** redirect to `/groups/<id>?error=unexpected`.
- The id in redirects is URL-encoded.
- It is protected by the existing `/api/groups` middleware prefix (`src/middleware.ts:4`).

#### 3. Group page panel

**File**: `src/components/invites/InvitePanel.astro`, `src/pages/groups/[id].astro`

**Intent**: Show the "Generate invite" button to every member. After generating, show the one-time link with Share and Copy, which work on mobile Safari and Chrome and on desktop.

**Contract**:

- **`InvitePanel` props:** `groupId`, `inviteUrl: string | null` and `error: string | null`.
- **The form.** `method="POST"`, `action="/api/groups/<id>/invites"`, with a submit button that is disabled on submit (the `CreateGroupForm` pattern).
- **When `inviteUrl` is set**, the panel shows:
  - a read-only input with the URL;
  - a "Copy link" button that calls `navigator.clipboard.writeText` synchronously inside the click handler;
  - a "Share" button, hidden unless `navigator.share` exists, that calls it with the URL;
  - the note "Works once and expires in 7 days. You won't see this link again.";
  - an inline confirmation after a copy.
- **Without JavaScript**, the URL is still visible for manual copying.
- **`[id].astro`, for a loaded group:**
  - calls `takeNewInvite`;
  - builds `inviteUrl` as `${Astro.url.origin}/invite/<token>`;
  - sets `Cache-Control: no-store` whenever a link is rendered;
  - maps `?error=` with `inviteErrorMessage`, rendering the mapped message and never the raw value;
  - renders the panel below `GroupCard`.

#### 4. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove on the built app that a member can generate an invite and that the link is shown once.

**Contract**:

- **New steps** run after "group A page shows its name":
  1. "generate invite redirects to the group page": `POST /api/groups/<A>/invites` → 302 to `/groups/<A>`.
  2. "group page shows the invite link once": the body contains `/invite/<43 chars>`, and the step saves the token for Phase 4.
  3. "invite link is not shown again": the body has no `/invite/<token>`.
- **Changed steps:** the anonymous step "generate invite redirects after signout" sits next to the existing post-signout steps.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (including the cookie helpers): `npm test`
- Type check and lint pass: `npx astro check`, `npm run lint`
- Smoke passes, including the new generate steps: `npm run build && npm run preview` then `npm run smoke`

#### Manual Verification:

- On a phone (iOS Safari or Android Chrome), "Generate invite" shows the link, and Share opens the system share sheet
- On desktop, Copy puts the exact link on the clipboard (Safari included), and Share is hidden where it is unsupported (Firefox)
- Reloading the group page hides the link

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Invite page, joining, sign-in return, smoke and docs

### Overview

The invitee's side: the invite page, the join endpoint, returning to the invite after any sign-in path, end-to-end smoke with a second user, and documentation.

### Changes Required:

#### 1. Pending-invite cookie

**File**: `src/lib/invites/invite.cookies.ts`

**Intent**: Remember which invite an anonymous visitor opened, and send them back to it after sign-in. The redirect target is built only by our code.

**Contract**:

- **`rememberPendingInvite(cookies, url, token)`** sets `sd_pending_invite` with path `/` and the flags from Critical Implementation Details.
- **`hasPendingInvite(cookies): boolean`.**
- **`takePendingInvitePath(cookies): string | null`.** It returns `/invite/<token>` when the cookie parses as an `InviteToken`, and deletes the cookie in every case.

#### 2. Invite page

**File**: `src/pages/invite/[token].astro`

**Intent**: A read-only preview. GET never consumes anything. The page leads to an explicit "Join group" POST.

**Contract**:

- **Every response** sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- **Malformed token:** the "no longer valid" message, status 404, for everyone.
- **Anonymous visitor with a well-formed token:** `rememberPendingInvite`, then redirect 302 to `/auth/signin`.
- **Signed in:** call `createInviteService(supabase).preview({ token })`.
  - **`invite_invalid`:** the 404 message, plus a "Go to dashboard" link.
  - **Any other error:** a load-failed message with status 200, never a 500.
  - **Success:** the group name, plus "You're already a member of this group" when `callerIsMember`. Below that, a `POST /api/invites/redeem` form with a hidden `token` field and a "Join group" button that is disabled on submit.
- **`?error=<code>`** is rendered through `inviteErrorMessage`.
- **The page is not in `PROTECTED_ROUTES`**, because it has to set the cookie for anonymous visitors.

#### 3. Join endpoint

**File**: `src/pages/api/invites/redeem.ts`, `src/middleware.ts`

**Intent**: Redeem the invite for the signed-in user and open the group.

**Contract**:

- `POST` reads the `token` form field and calls `createInviteService(supabase).redeem({ token, userId: user.id })`.
- **Success:** redirect 302 to `/groups/<groupId>`.
- **Error:** redirect 302 to `/invite/<URL-encoded submitted token>?error=<code>`.
- **Missing token:** redirect to `/dashboard`.
- **Middleware:** `PROTECTED_ROUTES` gains `"/api/invites"`, so an anonymous POST goes to `/auth/signin`.

#### 4. Sign-in return

**File**: `src/pages/api/auth/signin.ts`, `src/pages/auth/callback.ts`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: After any successful sign-in, a visitor with a pending invite lands back on it. The sign-in paths are email and password, Google, and confirming a new account's email.

**Contract**:

- **Success targets** become `takePendingInvitePath(context.cookies) ?? "/dashboard"`:
  - in `signin.ts`, replacing `signin.ts:19`
  - in `callback.ts`, after a successful `exchangeCodeForSession`, replacing `callback.ts:33`
- **Error paths do not consume the cookie.**
- **Notice on the auth pages:** when `hasPendingInvite`, `signin.astro` and `signup.astro` show "Sign in or create an account to accept your invite."
- **Not changed:** `signup.ts`, `google.ts` and `GoogleSignInButton.astro`.

#### 5. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: End-to-end proof on the built app that a second user can join through the link, exactly once.

**Contract**:

- **Placement.** The new steps run after the existing post-signout steps, using the token saved in Phase 3, and before user 2 signs out at the end.
- **The steps, in order:**
  1. "anonymous invite link leads to sign-in": `GET /invite/<token>` → 302 to `/auth/signin`, with `sd_pending_invite` in the jar.
  2. "sign-in page mentions the invite": the body contains the notice.
  3. "second user signs up": sign up with a fresh email.
  4. "second user signs in back to the invite": `POST /api/auth/signin` → 302 to `/invite/<token>`.
  5. "invite page shows the group name": 200, and the body contains group A's name.
  6. "joining lands on the group page": `POST /api/invites/redeem` → 302 to `/groups/<A>`.
  7. "new member sees the group": 200.
  8. "used invite is rejected": a second redeem → 302 to `/invite/<token>?error=invite_invalid`.
  9. "used invite page returns 404".
  10. "unknown invite returns 404": a random 43-character token.
  11. "anonymous join redirects to sign-in", after user 2 signs out.

#### 6. Documentation

**File**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: The next slice finds the invite flow, its conventions and its accepted limitations without reading this plan.

**Contract**:

- **`CLAUDE.md` Status:** invites exist (link, single use, 7 days).
- **`CLAUDE.md` Structure:**
  - `src/lib/invites/`
  - `src/components/invites/`
  - `src/pages/invite/[token].astro`
  - `src/pages/api/invites/redeem.ts`
  - `src/pages/api/groups/[id]/invites.ts`
- **`CLAUDE.md` Commands:** the smoke description mentions the invite flow.
- **`CLAUDE.md` Database changes:** `redeem_group_invite` is the documented exception that writes `group_members` outside the `Group` repository, for atomicity.
- **`deploy-plan.md`:** a short note that invites need no Supabase or Cloudflare configuration change, and that confirming sign-up email in another browser also loses the pending invite.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Database tests pass: `npm run test:db`
- Type check and lint pass: `npx astro check`, `npm run lint`
- Smoke passes, including the full second-user join flow: `npm run build && npm run preview` then `npm run smoke`

#### Manual Verification:

- Signed out on a phone: opening an invite link → sign in with Google → lands on the invite page → Join → the group page shows the group, and it appears on the dashboard
- Signed out on desktop: opening an invite link → sign up with email → confirm the email in the same browser → lands on the invite page → Join works
- Opening a used link and an expired link (`created_at` and `expires_at` both moved into the past with SQL on local Supabase) shows the same "no longer valid" message
- The group's existing member opens a fresh invite and sees "You're already a member"; Join opens the group, and the link is used up afterwards
- Pasting an invite link into WhatsApp or Slack, then letting the preview load, does not use up the invite

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **`InviteToken`:**
  - `generate` yields 43 characters from `[A-Za-z0-9_-]`;
  - two generations differ;
  - `parse` accepts a generated value and rejects 42 or 44 characters, `+`, `/`, `=` and an empty string.
- **`Invite`:**
  - `create` by a member sets `expiresAt` exactly 7 days after `now` and starts unused;
  - `create` by a non-member returns `group_not_found`;
  - `isActive` is true 1 ms before `expiresAt`, false at `expiresAt` and false after `redeem`;
  - `redeem` sets `usedAt` and `usedBy`;
  - `redeem` of an expired or used invite returns `invite_invalid`;
  - `restore(toSnapshot())` round-trips;
  - `restore` throws when `expiresAt <= createdAt` or when `usedBy` is set without `usedAt`.
- **`InviteService`:**
  - `create` passes the generated token and the invite to the repository, and returns the token and expiry;
  - `create` passes repository errors through;
  - `preview` and `redeem` with a malformed token return `invite_invalid` without calling the repository;
  - an unknown token returns `invite_invalid`;
  - an expired invite returns `invite_invalid` from both `preview` and `redeem`, with no `repository.redeem` call;
  - a valid invite gives the group name and member flag from `preview`;
  - `redeem` passes the redeemed invite (`usedAt` = clock) to the repository and returns `{ groupId, joined }`;
  - `redeem` passes through the repository's `invite_invalid`, which happens when the invite was taken by a concurrent call.
- **Cookie helpers**, with a fake `AstroCookies`:
  - stash and take round-trip, and take deletes;
  - a malformed cookie value gives `null`, or no path from `takePendingInvitePath`;
  - `Secure` is set only for an `https:` URL.

### Integration Tests:

These run in `invite.repository.db.test.ts` against local Supabase, with `createTwoUsers()`.

**Setup:**

- User A creates a group through `GroupService` and the Supabase repositories, then creates invite T.

**Storage and preview:**

- The stored `token_hash` equals `sha256(T)`, and no column contains T (checked with `withDb`).
- B's `findByToken(T)` returns the group name, `callerIsMember: false` and an active invite.
- An unknown token returns `null`.

**Creation backstops:**

- B cannot create an invite for A's group (`group_not_found` / `42501`).
- A cannot store `p_created_by` = B (`42501`).
- A direct RPC call with a 10-character token is refused (`22023`).

**Redeeming:**

- B redeems T and gets `joined: true`. B's `findGroupOfCurrentUser` now returns the group, with B as a member.
- Redeeming T again gives `invite_invalid`.
- A redeems a fresh invite of their own group and gets `joined: false`. The invite is then used.
- An invite moved into the past (with `admin`: `created_at = now() - 8 days`, `expires_at = now() - 1 day`, so that the snapshot still satisfies `Invite.restore`) gives `invite_invalid`, even through a direct RPC call with an old `p_used_at`.

**Race:**

- Two parallel `redeem` calls on one fresh invite end with exactly one success and one `invite_invalid`.

**Access control:**

- `anon` cannot execute any of the three functions.
- A and B get `42501` on a direct `select` or `insert` on `group_invites`.

### Manual Testing Steps:

1. Generate an invite on a phone and share it to a messenger chat. Open the chat's link preview, then confirm the link still works.
2. Open the link signed out in another browser. Sign in with Google and join. Check the group page and the dashboard.
3. Open the same link again and see "no longer valid".
4. Generate an invite on desktop, then copy it in Safari and in Firefox, where Share is hidden.
5. Sign up a new account through an invite link and confirm the email in the same browser. You land on the invite.

## Performance Considerations

Each operation is one or two RPCs on indexed columns: the unique `token_hash` and the membership primary key. Generating a token costs one `getRandomValues` call. The group page does one extra cookie read. Nothing needs tuning.

## Migration Notes

The migration is forward-only and additive: one new table, three new functions, nothing changed. A previously deployed Worker ignores them, so `wrangler rollback` stays safe. No backfill is needed. No Supabase Auth, redirect allow-list or Cloudflare configuration changes. The production deploy pushes the migration with `supabase db push` before `wrangler deploy`, as usual.

## References

- Research: `context/changes/invite-member-by-link/research.md` (Decisions 2026-10-04; §A codebase after S-02; §C.1 tokens; §C.4 sign-in return; §C.5 safe GET; §C.6 join semantics)
- Similar implementation:
  - `src/lib/groups/group.service.ts:13-68` (service shape)
  - `src/lib/groups/group.repository.ts:14-73` (repository and error mapping)
  - `supabase/migrations/20261002200553_settlement_groups.sql:67-184` (persistence functions and grants)
  - `src/pages/api/groups/index.ts:5-29` (form-POST endpoint)
  - `src/components/groups/CreateGroupForm.astro:49-62` (disable on submit)
- Prior plan: `context/archive/2026-10-02-create-settlement-group/plan.md`
- Roadmap: `context/foundation/roadmap.md` S-03 (FR-003, GitHub issue #8)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Invite domain model (TypeScript)

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 9ad3838
- [x] 1.2 Type check passes: `npx astro check` — 9ad3838
- [x] 1.3 Lint passes: `npm run lint` — 9ad3838

#### Manual

- [x] 1.4 The rules (member-only creation, 7-day expiry, single use) are readable in `invite.aggregate.ts` alone, and `src/lib/invites/` imports nothing from `@/lib/supabase` — 9ad3838

### Phase 2: Persistence and isolation

#### Automated

- [x] 2.1 Migration applies on a clean database: `npm run db:reset`
- [x] 2.2 Generated types are up to date: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean
- [x] 2.3 Database tests pass, including the RLS guard and the new invite test: `npm run test:db`
- [x] 2.4 Unit tests, type check and lint pass: `npm test`, `npx astro check`, `npm run lint`

#### Manual

- [x] 2.5 The migration encodes no business rules beyond the documented backstops: identity from `auth.uid()`, member-only creation, minimum token length, the `used_at is null` claim, and the expiry check on `now()`

### Phase 3: Generate and share on the group page

#### Automated

- [ ] 3.1 Unit tests pass (including the cookie helpers): `npm test`
- [ ] 3.2 Type check and lint pass: `npx astro check`, `npm run lint`
- [ ] 3.3 Smoke passes, including the new generate steps: `npm run build && npm run preview` then `npm run smoke`

#### Manual

- [ ] 3.4 On a phone (iOS Safari or Android Chrome), "Generate invite" shows the link, and Share opens the system share sheet
- [ ] 3.5 On desktop, Copy puts the exact link on the clipboard (Safari included), and Share is hidden where it is unsupported (Firefox)
- [ ] 3.6 Reloading the group page hides the link

### Phase 4: Invite page, joining, sign-in return, smoke and docs

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Database tests pass: `npm run test:db`
- [ ] 4.3 Type check and lint pass: `npx astro check`, `npm run lint`
- [ ] 4.4 Smoke passes, including the full second-user join flow: `npm run build && npm run preview` then `npm run smoke`

#### Manual

- [ ] 4.5 Signed out on a phone: opening an invite link → sign in with Google → lands on the invite page → Join → the group page shows the group, and it appears on the dashboard
- [ ] 4.6 Signed out on desktop: opening an invite link → sign up with email → confirm the email in the same browser → lands on the invite page → Join works
- [ ] 4.7 Opening a used link and an expired link (`created_at` and `expires_at` both moved into the past with SQL on local Supabase) shows the same "no longer valid" message
- [ ] 4.8 The group's existing member opens a fresh invite and sees "You're already a member"; Join opens the group, and the link is used up afterwards
- [ ] 4.9 Pasting an invite link into WhatsApp or Slack, then letting the preview load, does not use up the invite
