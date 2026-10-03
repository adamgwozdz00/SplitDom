# Create a Settlement Group (S-02) Implementation Plan

## Overview

A signed-in user creates a settlement group ("mieszkanie"), becomes its permanent host, and the group starts with exactly one open billing period for the current calendar month (FR-002). A user can create any number of groups and belong to many groups at once. FR-002 was changed on 2026-10-02 to drop the earlier "one group per user" MVP limit.

This is SplitDom's first domain model: a `Group` aggregate in TypeScript owns every rule and invariant, and the database only persists and loads it. The slice also ships the first real group-isolation test on the F-01 harness. `/dashboard` becomes the list of the user's groups, and each group gets its own page at `/groups/[id]`.

## Current State Analysis

- No domain tables exist. The only migration creates schema `private` (`supabase/migrations/20260927211445_private_schema.sql:8-15`); `src/db/database.types.ts` has empty `public` tables.
- The server Supabase client uses the anon key with the user's session cookies (`src/lib/supabase.ts:6-21`). There is no service-role key in the Worker, and the user does not want new infrastructure or secrets. Any `public` database function is therefore callable from a browser with the anon key and the user's token, bypassing TypeScript.
- supabase-js has no client-side transactions, so persisting a multi-row aggregate atomically needs one database call.
- `src/lib/supabase.ts:3` imports `astro:env/server`. The plain Vitest config (`vitest.config.ts:4`) cannot resolve that module, so anything a test imports must not import `@/lib/supabase`.
- The test harness:
  - `createTwoUsers()` returns `userA`, `userB`, `anon`, `admin` and `cleanup()` (`src/db/__tests__/two-users.harness.ts:14-23,54-80`);
  - `cleanup()` deletes auth users only;
  - the RLS guard fails on any `public` table without RLS (`src/db/__tests__/rls-guard.db.test.ts:6-29`).
- Existing endpoints are form POSTs that answer with 302 redirects and `?error=` (`src/pages/api/auth/signin.ts:11-19`). `/dashboard` is a placeholder (`src/pages/dashboard.astro:7-25`), protected by prefix match in `src/middleware.ts:4,18-21`.
- CLAUDE.md mandates the `{ error: { code, message, context } }` shape and a `formatDate()` helper. Neither exists in code (`src/lib/utils.ts:4-6` has only `cn()`).
- The smoke test's `request()` returns only status and `Location` (`scripts/smoke.mjs:23-36`). It signs up and signs in a user who is immediately usable, because local confirmations are off (`supabase/config.toml:209`).

## Desired End State

`/dashboard` lists the signed-in user's groups and always offers a "Create group" form with a name field.
- **Valid name:** the group is created and the user lands on `/groups/<id>`. The page shows the group name, a "You are the host" marker, and the open period labelled with its month: the current month in Europe/Warsaw, for example "October 2026". The user can create more groups, and each appears on the dashboard.
- **Invalid name:** the user comes back to the dashboard with a clear error.

Access and failures:
- Another signed-in user sees none of these groups. Opening `/groups/<id>` of someone else's group returns 404, and the Supabase API returns nothing either.
- If loading fails, both pages show "Couldn't load your groups, try again" instead of a raw 500.

Verification: these are all green:
- `npm test` (domain unit tests);
- `npm run test:db` (persistence and isolation);
- `npm run smoke` (end-to-end on the built app);
- `npx astro check`, `npm run lint`;
- CI's generated-types drift check.

### Key Discoveries:

- `auth.uid()` reads the request JWT, including inside a `security definer` function. Deriving the host, the member and the "my groups" filter from it means a direct browser call cannot act or read as someone else (`context/changes/invite-member-by-link/research.md` §2).
- `security definer` functions must set `search_path = ''`, fully qualify names, `revoke execute … from public, anon` and `grant execute … to authenticated` (same research, §2).
- PostgREST returns Postgres errors as `{ code, message, details, hint }`. supabase-js exposes `code`, which the repository maps to domain errors.
- S-03 needs a membership table and a host marker on the group (`research.md`, Architecture Insights 3). With many groups per user, S-03's open question "what if the invitee already belongs to another group" no longer applies.
- Cleanup order matters in DB tests: `groups.host_id` references `auth.users` without cascade, so a test must delete its groups (admin client) before `cleanup()` deletes the users.

## What We're NOT Doing

- No business rules in SQL: no domain logic in functions, triggers or RLS policies. SQL functions only persist and load, scoped to the caller's identity.
- No ORM, no Cloudflare Hyperdrive, no direct Postgres connection from the Worker, no service-role key in the Worker, no new secrets or bindings.
- No RLS `SELECT`/`INSERT` policies on domain tables. RLS is on with no policies (deny-all for API clients).
- No limit on the number of groups per user, and no `unique(user_id)` on membership.
- No invites or joining (S-03), no expenses or balances (S-04), no period closing (S-09). `billing_periods.closed_at` exists only so the "one open period" backstop can be expressed; nothing sets it yet.
- No group rename, deletion, leaving a group, or host transfer (PRD Non-Goals).
- No member list with names or emails (no profile table yet). The group page shows only the current user's role.
- No "current group" switcher or remembered selection. The group is chosen by URL (`/groups/[id]`).
- No generic `utils`, `errors` or `dates` modules. The error type and date formatting live in the groups module.
- No currency column (single currency per PRD Non-Goals).

## Implementation Approach

The work goes domain first, then persistence, then the web layer.

1. **Domain.** Build the domain in plain TypeScript with unit tests and no database:
   - value objects `GroupName` and `BillingMonth`;
   - the `Group` aggregate;
   - `GroupService`, the aggregate's service and the only user of the `GroupRepository` interface, with `create`, `listForMember` and `getForMember`.
2. **Persistence.** Add the tables, light constraints and three narrow persistence functions. Implement the Supabase repository against them, and prove isolation with `createTwoUsers()`.
3. **Web layer.** Wire a form-POST endpoint, the dashboard list and the group page. Extend the smoke test, and update docs.

Access is decided by membership in two places, with different jobs:
- The persistence functions only ever return groups whose membership contains `auth.uid()`. That is identity scoping, so a direct browser call cannot read others' data.
- The aggregate exposes `isMember(userId)`, and `GroupService.getForMember` and `listForMember` check it, so the rule is also explicit in the domain.

"Exactly one open period" is an aggregate invariant, backed by a partial unique index.

> **Implementation deviation (2026-10-02, Phase 1 review).** At the user's request the free-standing use cases (`createGroup`, `listMyGroups`, `getMyGroup`) were replaced by `GroupService` (`src/lib/groups/group.service.ts`): only the repository reads and writes the `Group` aggregate, and only `GroupService` uses the repository. There is no command/query layer for now. Also from the Phase 1 review (F2), `create_group` takes `p_host_id` as a safety backstop and refuses it unless it equals `auth.uid()`. The contracts below already reflect both changes; see `change.md` and `reviews/impl-review-phase-1.md`.

## Critical Implementation Details

- **Identity comes from the token, not from parameters.** No persistence function accepts a member or user id for reading, and the host id is only accepted to be checked.
  - `create_group` takes the aggregate's `p_host_id` and raises `42501` unless it equals `auth.uid()`, then writes it as `host_id` and as the member. This is a persistence backstop, not a business rule: the aggregate decides who the host is, and the database refuses to store an identity that is not the caller's, so the domain and the stored host can never silently diverge.
  - `list_my_groups` and `get_my_group` filter on membership of `auth.uid()`.
  - All three raise `not_authenticated` (errcode `28000`) when `auth.uid()` is null, so a missing session is never read as "no groups".
  - Everything else (group id, trimmed name, period id, month, and the creation instant) comes from the aggregate, so a direct browser call can only create the caller's own group. Constraints keep it well-formed.
- **The month is computed in Europe/Warsaw, then formatted in UTC.** `BillingMonth.of(instant)` takes the calendar year and month of the instant in `Europe/Warsaw`; for example `2026-10-31T23:30:00Z` → November 2026. The label is produced from the `YYYY-MM-01` date in UTC, so it never shifts with the server timezone. Workers ship full ICU, so `Intl.DateTimeFormat` with `timeZone: "Europe/Warsaw"` works at the edge.
- **The aggregate's clock is stored.** `create_group` takes `p_now` and uses it for `created_at`, `joined_at` and `opened_at`, instead of the database's `now()`. The repository normalizes timestamps read back from Postgres (`…06.604123+00:00`) with `new Date(value).toISOString()` (`…06.604Z`).
- **The clock and the id generator are injected** into `GroupService`'s constructor, so unit tests are deterministic. The endpoint passes `() => crypto.randomUUID()` and `() => new Date()`. The arrow keeps `crypto` as the receiver: workerd throws "Illegal invocation" for an unbound Web Crypto method, while Node does not, so only the smoke test would catch it.
- **The groups module never imports `@/lib/supabase`.** That file imports `astro:env/server`, which the plain Vitest config cannot resolve. The repository receives a `SupabaseClient<Database>`; pages and the endpoint create it with `createClient(...)` and pass it in.

## Phase 1: Group domain model (TypeScript)

### Overview

The `groups` module with its value objects, aggregate, use cases and error type, fully unit-tested without a database.

### Changes Required:

#### 1. Module types and errors

**File**: `src/lib/groups/types.ts`

**Intent**: Own the module's public types, including the project-wide error shape for this module. No shared `errors` module is created yet; extract one when a second module needs it.

**Contract**:
- `GroupErrorCode = "invalid_group_name" | "group_not_found" | "not_authenticated" | "unexpected"`.
- `GroupError = { error: { code: GroupErrorCode; message: string; context: Record<string, unknown> } }`.
- `Result<T> = { data: T } | GroupError`.
- `GroupSnapshot` is the persistence shape:
  - `{ id, name, hostId, createdAt, members: { userId, joinedAt }[], openPeriod: { id, month: "YYYY-MM-01", openedAt } }`;
  - timestamps are ISO strings in UTC with millisecond precision.
- `GroupRepository` interface:
  - `listGroupsOfCurrentUser(): Promise<Result<Group[]>>`;
  - `findGroupOfCurrentUser(groupId: string): Promise<Result<Group | null>>`;
  - `create(group: Group): Promise<Result<void>>`.

#### 2. Value objects

**File**: `src/lib/groups/group-name.value.ts`

**Intent**: The name rule.

**Contract**: `GroupName.create(raw: string): Result<GroupName>`. It trims the input and requires 1–60 characters, otherwise it returns `invalid_group_name` with `context: { length }`. It exposes `value`.

**File**: `src/lib/groups/billing-month.value.ts`

**Intent**: The single TypeScript home of "which billing month does a moment belong to" (Europe/Warsaw) and of how a month is shown. It replaces the `formatDate()` convention for this module.

**Contract**:
- `BillingMonth.of(instant: Date): BillingMonth`.
- `BillingMonth.fromDate("YYYY-MM-01"): BillingMonth`; it rejects any other format.
- `toDate(): string` returns `"YYYY-MM-01"`.
- `label(): string` returns `"October 2026"`, using English month names formatted in UTC.
- `equals(other)`.

#### 3. Aggregate

**File**: `src/lib/groups/group.aggregate.ts`

**Intent**: The `Group` aggregate owns the host, members and open billing period, and guards the invariants: the host is a member, the host never changes, and there is exactly one open period.

**Contract**:
- `Group.create({ id, name: GroupName, hostId, now: Date, periodId }): Group`. It sets the host as the only member (`joinedAt = now`) and opens one period for `BillingMonth.of(now)`, with `openedAt = now` and `createdAt = now`.
- `Group.restore(snapshot: GroupSnapshot): Group` throws if an invariant does not hold (corrupt data, which surfaces as `unexpected`). The stored name is restored as it is (`GroupName.fromStored`, non-empty only); the creation rule in `GroupName.create` is not applied again, so a name stored past the aggregate or before a rule changed never makes a user's groups unreadable (Phase 2 review, F1).
- Read-only getters: `id`, `name`, `hostId`, `members`, `openPeriod` (`{ id, month: BillingMonth, openedAt }`).
- `isHost(userId): boolean`, `isMember(userId): boolean`.
- `toSnapshot(): GroupSnapshot`.

#### 4. Aggregate service

**File**: `src/lib/groups/group.service.ts`

**Intent**: The single entry point to the `Group` aggregate. Only the repository reads and writes the aggregate, and only `GroupService` uses the repository; it loads and saves groups and leaves the rules to the aggregate. Any signed-in user may create any number of groups. The membership rule is explicit in the domain.

**Contract**: `new GroupService(repository: GroupRepository, newId: () => string, clock: () => Date)`.
- `create(input: { name: string; hostId: string }): Promise<Result<{ groupId: string }>>`. Steps:
  1. Validate the name.
  2. `Group.create` with two `newId()` calls (group, then period) and `clock()`.
  3. `repository.create`, passing its error through unchanged.
- `listForMember(userId: string): Promise<Result<Group[]>>` returns the groups where `isMember(userId)`, sorted by `createdAt`, newest first.
- `getForMember(input: { groupId: string; userId: string }): Promise<Result<Group>>`:
  - if the repository finds nothing, or `!group.isMember(userId)`, it returns `group_not_found` with `context: { groupId }`;
  - a malformed `groupId` (not a UUID) also returns `group_not_found` without calling the repository.

#### 5. Messages and barrel

**File**: `src/lib/groups/group-error.messages.ts`, `src/lib/groups/index.ts`

**Intent**: After a redirect, only the error code survives, so the module owns the user-facing message for each code. The barrel exports the public API (`GroupService`, `Group`, `BillingMonth`, `GroupName`, `groupErrorMessage`, types). The Supabase repository is added to it in Phase 2. The barrel never imports `@/lib/supabase`.

**Contract**: `groupErrorMessage(code: string): string`. It returns English messages:
- `invalid_group_name` → "Group name must be 1–60 characters";
- `unexpected` → "Couldn't load your groups, try again";
- a generic message for unknown codes.

#### 6. Unit tests

**File**: `src/lib/groups/__tests__/group-name.value.test.ts`, `billing-month.value.test.ts`, `group.aggregate.test.ts`, `group.service.test.ts`

**Intent**: Prove every rule without a database. The service tests use an in-memory fake `GroupRepository`.

**Contract**: The cases are listed under Testing Strategy → Unit Tests.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- `BillingMonth.of(new Date("2026-10-31T23:30:00Z")).toDate()` is `"2026-11-01"` and `.label()` is `"November 2026"` (unit test)

#### Manual Verification:

- The module reads as the domain: rules are in `GroupName`, `BillingMonth`, `Group` and the use cases, with no generic helper files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Persistence and group isolation

### Overview

Tables with light constraints and deny-all RLS, three narrow persistence functions, the Supabase repository, and the first two-user isolation test.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_settlement_groups.sql` (created with `npm run db:new settlement_groups`)

**Intent**: Persist the `Group` aggregate and lock the tables away from direct API access. Constraints are backstops only. The rules themselves stay in TypeScript.

**Contract**:
- `public.groups`:
  - `id uuid primary key`;
  - `name text not null check (char_length(name) between 1 and 60)`;
  - `host_id uuid not null references auth.users(id)` (no cascade);
  - `created_at timestamptz not null`.
- `public.group_members`:
  - `group_id uuid not null references public.groups(id) on delete cascade`;
  - `user_id uuid not null references auth.users(id) on delete cascade`;
  - `joined_at timestamptz not null`;
  - `primary key (group_id, user_id)`, plus an index on `user_id` for "my groups" lookups.
- `public.billing_periods`:
  - `id uuid primary key`;
  - `group_id uuid not null references public.groups(id) on delete cascade`;
  - `month date not null check (extract(day from month) = 1)` (format backstop added in the Phase 2 review, F1: `create_group` is callable past the aggregate, and `BillingMonth` only restores `YYYY-MM-01`);
  - `opened_at timestamptz not null`;
  - `closed_at timestamptz` (null means open);
  - `unique (group_id, month)`, plus a partial unique index on `(group_id) where closed_at is null`.
- All three tables:
  - `enable row level security`, with no policies;
  - `revoke all … from anon, authenticated`;
  - a `comment on table` naming the aggregate they persist.
- `public.create_group(p_group_id uuid, p_name text, p_host_id uuid, p_period_id uuid, p_period_month date, p_now timestamptz) returns void`:
  - `security definer`, `set search_path = ''`;
  - raises `not_authenticated` with `errcode = '28000'` if `auth.uid()` is null;
  - raises with `errcode = '42501'` if `p_host_id` is distinct from `auth.uid()` (persistence backstop: it only stores the caller's own identity);
  - inserts the group (host `p_host_id`), the membership (`p_host_id`) and the period in one statement block, so it runs in one transaction;
  - uses `p_now` for `created_at`, `joined_at` and `opened_at`;
  - does nothing else.
- `public.list_my_groups() returns jsonb`:
  - `security definer`, `stable`, `set search_path = ''`;
  - raises `not_authenticated` with `errcode = '28000'` if `auth.uid()` is null;
  - returns a JSON array (empty array when none) of group snapshots for every group whose membership contains `auth.uid()`.
  - Snapshot keys are snake_case: `id, name, host_id, created_at, members[] {user_id, joined_at}, open_period {id, month, opened_at}`.
- `public.get_my_group(p_group_id uuid) returns jsonb`:
  - same security settings and `28000` guard;
  - returns that group's snapshot only if its membership contains `auth.uid()`, otherwise `null`. A non-member cannot tell "exists" from "does not exist".
- Grants for all three functions: `revoke execute … from public, anon`, then `grant execute … to authenticated`.
- A comment on each function stating "persistence only — business rules live in `src/lib/groups`".

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate after the migration, never by hand.

**Contract**: Run `npm run db:reset && npm run db:types`. The three tables and three functions appear under `public`.

#### 3. Supabase repository

**File**: `src/lib/groups/group.repository.ts` (exported from `src/lib/groups/index.ts`)

**Intent**: Implement `GroupRepository` on the user's Supabase client: map the aggregate to the function parameters and back, and translate database errors into domain errors.

**Contract**:
- `createSupabaseGroupRepository(client: SupabaseClient<Database>): GroupRepository`. It imports only `@supabase/supabase-js` types and `@/db`, never `@/lib/supabase`.
- `create` calls `rpc("create_group", …)` with values taken from `group.toSnapshot()` (`p_host_id` = `hostId`, `p_now` = `createdAt`).
- `listGroupsOfCurrentUser` calls `rpc("list_my_groups")`.
- `findGroupOfCurrentUser(groupId)` calls `rpc("get_my_group", { p_group_id })` and maps `null` to `{ data: null }`.
- Both readers map snake_case JSON to `GroupSnapshot`, normalize timestamps with `new Date(value).toISOString()`, and call `Group.restore`.
- Error mapping:
  - `28000` → `not_authenticated`;
  - anything else → `unexpected`, with `context: { dbCode }`;
  - any value thrown while mapping or restoring a snapshot (`Group.restore` throws `Error`, `BillingMonth.fromDate` throws `RangeError`, malformed JSON can throw `TypeError`) is caught inside the repository and returned as `unexpected` with `context: { groupId }`, never left to escape as a raw 500. One corrupt group fails the whole list by design (it is a data-integrity bug, not a user error); the `(group_id, user_id)` primary key keeps duplicate members out.

#### 4. Persistence and isolation tests

**File**: `src/lib/groups/__tests__/group.repository.db.test.ts`

**Intent**: The first real "user B cannot see user A's group" test on the F-01 harness. It also proves the persistence functions cannot be abused and the backstops hold.

**Contract**: It uses `createTwoUsers()`. `afterAll` deletes the users' groups with `admin` before `cleanup()`. The cases are listed under Testing Strategy → Integration Tests.

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean
- Database tests pass, including the RLS guard and the new isolation test: `npm run test:db`
- Unit tests, type check and lint pass: `npm test`, `npx astro check`, `npm run lint`

#### Manual Verification:

- The migration contains no business rules: functions only insert or select, and identity comes from `auth.uid()`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Endpoint, dashboard, group page, smoke and docs

### Overview

The user-facing flow (a dashboard list with a create form, and a group page), a form-POST endpoint, smoke coverage on the built app, and documentation of the new conventions.

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/groups/index.ts`

**Intent**: Form POST that runs the use case for the signed-in user, in the same redirect style as the auth routes.

**Contract**:
- `POST` reads the `name` form field and calls `service.create({ name, hostId: locals.user.id })` on `new GroupService(repository, () => crypto.randomUUID(), () => new Date())`:
  - the id generator is the arrow, never the bare method reference (see Critical Implementation Details);
  - the repository is the Supabase repository built from `createClient(...)`.
- On success it redirects 302 to `/groups/<groupId>`. On error it redirects 302 to `/dashboard?error=<code>`. If Supabase is not configured, it redirects to `/dashboard?error=unexpected`.

**File**: `src/middleware.ts`

**Intent**: Anonymous requests never reach the use cases or group pages.

**Contract**: `PROTECTED_ROUTES` gains `"/groups"` and `"/api/groups"`; anonymous requests are redirected to `/auth/signin`.

#### 2. Dashboard: the user's groups

**File**: `src/pages/dashboard.astro`, `src/components/groups/CreateGroupForm.astro`, `src/components/groups/GroupList.astro`

**Intent**: `/dashboard` calls `GroupService.listForMember(user.id)` and shows:
- the list of groups, each a link to `/groups/<id>` with its name, "Host" when `isHost(user.id)`, and the open period label; or "You don't belong to any group yet" when there are none;
- below it, always, the create form (name input with `required`, `maxlength="60"`, submit to `/api/groups`), with the error from `?error=` shown through `groupErrorMessage`.

If loading fails (no Supabase client, or `unexpected`/`not_authenticated`), the page shows "Couldn't load your groups, try again" in place of the list and still returns 200, never a raw 500. Sign out stays available, and the styling follows the existing glass-card look.

**Contract**: The page works without client JavaScript (plain form and links). Group names are visible link text; the smoke test asserts on them. `CreateGroupForm.astro` has a small inline `<script>` that disables the submit button on `submit`, so a double tap on a phone cannot create a duplicate group (groups cannot be deleted). This is progressive enhancement: without JS the form still submits. The auth forms' `SubmitButton` is not reused, because its `useFormStatus` does not track native form POSTs.

#### 3. Group page

**File**: `src/pages/groups/[id].astro`, `src/components/groups/GroupCard.astro`

**Intent**: The home of one group: name as the heading, "You are the host" when `isHost(user.id)`, "Open period: <BillingMonth label>", and a link back to `/dashboard`.

**Contract**:
- It calls `GroupService.getForMember({ groupId: params.id, userId: locals.user.id })`.
- `group_not_found` → 404 (Astro `Astro.response.status = 404` with a "Group not found" message), the same for a non-member and a non-existent id.
- `unexpected` or `not_authenticated`, or no Supabase client → "Couldn't load your groups, try again" with status 200.

#### 4. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Prove the create-group flow on the built Cloudflare app in CI.

**Contract**:
- `request()` also returns the response body text.
- New steps after "dashboard renders for signed-in user":
  - the dashboard shows the create form (body contains `action="/api/groups"`);
  - a blank name redirects to `/dashboard?error=invalid_group_name`;
  - `Smoke household A <timestamp>` redirects to `/groups/<uuid>`;
  - that group page returns 200 and its body contains the name;
  - `Smoke household B <timestamp>` redirects to a different `/groups/<uuid>`;
  - the dashboard body contains both names;
  - `/groups/<random uuid>` returns 404.
- After sign-out:
  - anonymous `/groups/<first id>` redirects to `/auth/signin`;
  - anonymous `POST /api/groups` redirects to `/auth/signin`.

#### 5. Documentation

**File**: `CLAUDE.md`

**Intent**: Record the domain-first conventions this slice establishes, so S-03 onward follow them.

**Contract**:
- **Status:** groups exist (create, list, group page).
- **Structure:** add `src/lib/groups/` (domain module), `src/pages/api/groups/`, `src/pages/groups/`, `src/components/groups/`.
- **Code Conventions:**
  - a new bullet: "Domain logic — business rules and invariants live in TypeScript aggregates in `src/lib/<module>/`; only the repository reads and writes an aggregate, and only the aggregate's service (e.g. `GroupService`) uses the repository; database functions only persist and load, scoped to `auth.uid()`, and constraints are backstops only";
  - the Dates bullet becomes "stored in UTC; a domain module formats its own dates (e.g. `BillingMonth.label()`); no ad-hoc `new Date().toISOString()`".
- **Database changes:** a group-scoped table gets RLS on with no policies and revoked `anon`/`authenticated` grants. Access goes through narrow `security definer` persistence functions (`search_path = ''`, execute granted to `authenticated` only) that filter on the caller's membership. Its `*.db.test.ts` proves user B cannot read A's data through those functions and that direct table access is denied. These persistence functions live directly in `public` (superseding the thin-`public`-wrapper-over-`private` split proposed in `invite-member-by-link/research.md`), and the Supabase Advisor lints 0029 (`authenticated_security_definer_function_executable`) and 0008 (`rls_enabled_no_policy`) are expected for them and their tables by design.

### Success Criteria:

#### Automated Verification:

- Smoke test passes against a local production build: `npm run build && npm run preview`, then `npm run smoke`
- Unit and database tests pass: `npm test`, `npm run test:db`
- Type check, lint and build pass: `npx astro check`, `npm run lint`, `npm run build`

#### Manual Verification:

- On a phone-width browser, a new user creates a group on `/dashboard`, lands on its page and sees its name, "You are the host" and "Open period: <the current month in Europe/Warsaw>" (e.g. "October 2026")
- The same user creates a second group and sees both on `/dashboard`, each opening its own page
- A second browser signed in as another user sees an empty list on `/dashboard`, and gets 404 on the first user's `/groups/<id>` URL
- An empty name and a 61-character name (with `maxlength` removed via devtools) both come back with the name error
- After merge, the same flow works on production (https://10x-astro-starter.adamgwozdz.workers.dev)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `GroupName`:
  - `"  Mokotów  "` → `"Mokotów"`;
  - `""` and `"   "` → `invalid_group_name`;
  - 60 characters → ok, 61 → `invalid_group_name`.
- `BillingMonth`:
  - `2026-10-15T12:00:00Z` → `2026-10-01`;
  - `2026-10-31T23:30:00Z` → `2026-11-01` (Warsaw is already 1 November);
  - `2026-11-30T22:59:59Z` → `2026-11-01`, `2026-11-30T23:00:00Z` → `2026-12-01` (winter offset +01:00);
  - `2026-07-31T21:59:59Z` → `2026-07-01`, `2026-07-31T22:00:00Z` → `2026-08-01` (summer offset +02:00, so an implementation that hard-codes +1 hour fails);
  - `label()` of `2026-10-01` is `"October 2026"`;
  - `fromDate` rejects `"2026-10-15"`.
- `Group`:
  - `create` makes the host the only member with exactly one open period for the Warsaw month of `now`;
  - `isHost`, `isMember`;
  - `toSnapshot` → `restore` round-trips;
  - `restore` throws when the host is not a member or the open period is missing.
- `GroupService.create`:
  - success saves one aggregate with the injected ids and clock;
  - a user who already has a group can create another;
  - an invalid name → `invalid_group_name` and no repository call;
  - a repository error passes through.
- `GroupService.listForMember` / `getForMember`:
  - the list is sorted newest first, and leaves out groups where `isMember(userId)` is false;
  - an unknown id → `group_not_found`;
  - a group the repository returns but where `isMember(userId)` is false → `group_not_found`;
  - a malformed id → `group_not_found` without a repository call.

### Integration Tests:

`group.repository.db.test.ts`, on `createTwoUsers()`:

- A's repository `create` followed by `findGroupOfCurrentUser(id)` returns an equal snapshot, timestamps included (millisecond precision, normalized), proving the aggregate's clock is what gets stored.
- A creates two groups; A's `listGroupsOfCurrentUser` returns both.
- B's `listGroupsOfCurrentUser` returns an empty list, and B's `findGroupOfCurrentUser(A's id)` returns `null` (isolation).
- A, B and anon are refused direct access: `select` on `groups`, `group_members` and `billing_periods` returns an error with code `42501` and `data` null (grants are revoked, so it is an error, not an empty list). A direct `insert` into `group_members` for A's group by B also fails with `42501`.
- `anon` cannot execute `create_group`, `list_my_groups` or `get_my_group`: each RPC fails with code `42501`.
- `create_group` with the caller's own `p_host_id` records the caller as host and member; with another user's id (B passing A's id) it fails with `42501` and writes nothing.
- The RLS guard (`rls-guard.db.test.ts`) stays green with the three new tables.
- Added in the Phase 2 review:
  - B cannot `update` or `delete` A's `groups` or `billing_periods` rows (`42501`), and A's group is unchanged;
  - the repository maps a caller without `auth.uid()` (service role) to `not_authenticated`;
  - `create_group` cannot take over A's group by reusing its id, and cannot reuse A's period id (error, nothing written for B, A unchanged);
  - a billing month that is not the first day of a month is refused (`23514`);
  - a group whose name was stored past the aggregate (e.g. `"\u200B"`) is still listed for its member.

### Manual Testing Steps:

1. Sign in locally, open `/dashboard` and create "Mieszkanie Mokotów". Check that you land on its page with the name, the host marker and the period label.
2. Go back to `/dashboard`, create "Wakacje 2026", and check that both groups are listed and each opens its own page.
3. Sign in as a different user in another browser. Check that the list is empty and that the first user's group URL returns 404.
4. Repeat steps 1–3 on production after merge.

## Performance Considerations

The dashboard makes one `list_my_groups` call per load, which returns full snapshots for each group. A group page makes one `get_my_group` call, and creating a group makes one `create_group` call. At household scale (a few groups, a few members each) these are trivial indexed lookups; nothing further is needed.

## Migration Notes

The migration only adds new tables and functions, so it is compatible with the previously deployed Worker. The `deploy` job pushes it before `wrangler deploy` (`.github/workflows/ci.yml:94-97`). It is forward-only: fixes go in a new migration.

## References

- Roadmap item: `context/foundation/roadmap.md` S-02; GitHub issue [#7](https://github.com/adamgwozdz00/SplitDom/issues/7)
- PRD: `context/foundation/prd.md` FR-002 (changed 2026-10-02: many groups per user), Access Control, Guardrails, NFR-3
- Plan review: `context/changes/create-settlement-group/reviews/plan-review.md`
- Adjacent research (Supabase function security, error mapping, S-03 needs): `context/changes/invite-member-by-link/research.md`
- Harness and guard: `src/db/__tests__/two-users.harness.ts:54-80`, `src/db/__tests__/rls-guard.db.test.ts:6-29`
- Form-POST redirect pattern: `src/pages/api/auth/signin.ts:4-20`
- Smoke test: `scripts/smoke.mjs:23-36,58-90`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Group domain model (TypeScript)

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 3b7818d
- [x] 1.2 Type check passes: `npx astro check` — 3b7818d
- [x] 1.3 Lint passes: `npm run lint` — 3b7818d
- [x] 1.4 `BillingMonth.of(new Date("2026-10-31T23:30:00Z")).toDate()` is `"2026-11-01"` and `.label()` is `"November 2026"` (unit test) — 3b7818d

#### Manual

- [x] 1.5 The module reads as the domain: rules are in `GroupName`, `BillingMonth`, `Group` and the use cases, with no generic helper files — 3b7818d

### Phase 2: Persistence and group isolation

#### Automated

- [x] 2.1 Migration applies on a clean database: `npm run db:reset` — 285ce43
- [x] 2.2 Generated types are up to date: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean — 285ce43
- [x] 2.3 Database tests pass, including the RLS guard and the new isolation test: `npm run test:db` — 285ce43
- [x] 2.4 Unit tests, type check and lint pass: `npm test`, `npx astro check`, `npm run lint` — 285ce43

#### Manual

- [x] 2.5 The migration contains no business rules: functions only insert or select, and identity comes from `auth.uid()` — 285ce43

### Phase 3: Endpoint, dashboard, group page, smoke and docs

#### Automated

- [x] 3.1 Smoke test passes against a local production build: `npm run build && npm run preview`, then `npm run smoke` — a12eaed
- [x] 3.2 Unit and database tests pass: `npm test`, `npm run test:db` — a12eaed
- [x] 3.3 Type check, lint and build pass: `npx astro check`, `npm run lint`, `npm run build` — a12eaed

#### Manual

- [x] 3.4 On a phone-width browser, a new user creates a group on `/dashboard`, lands on its page and sees its name, "You are the host" and "Open period: <the current month in Europe/Warsaw>" (e.g. "October 2026") — a12eaed
- [x] 3.5 The same user creates a second group and sees both on `/dashboard`, each opening its own page — a12eaed
- [x] 3.6 A second browser signed in as another user sees an empty list on `/dashboard`, and gets 404 on the first user's `/groups/<id>` URL — a12eaed
- [x] 3.7 An empty name and a 61-character name (with `maxlength` removed via devtools) both come back with the name error — a12eaed
- [ ] 3.8 After merge, the same flow works on production (https://10x-astro-starter.adamgwozdz.workers.dev)
