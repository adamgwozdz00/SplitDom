# Group as the Membership Aggregate — Implementation Plan

## Overview

This is roadmap item **F-03** (`context/foundation/roadmap.md`, issue [#34](https://github.com/adamgwozdz00/SplitDom/issues/34)). `Group` becomes the aggregate root of a household's membership:

- `Group.invite(...)` lets only a member create an invite; `Group.join(...)` uses up an active invite and adds the user as a member. Both are one write of one aggregate.
- `Invite` becomes an entity inside `Group`; only active invites are loaded.
- `Group` owns the invariants: the host is a member and never changes, an invite is used at most once, a user is a member at most once, nobody removes members.
- Concurrent writes are guarded by a `groups.version` column (optimistic locking), the same pattern as `billing_periods.version` in F-02.
- The documented exception in CLAUDE.md (`redeem_group_invite` writing `group_members` outside the `Group` repository) disappears.
- `memberLabel` moves from the domain to presentation.

Users see no change. Phases 2 and 3 are built test-first.

## Current State Analysis

- **`Invite` is its own aggregate** with its own module, service and repository (`src/lib/invites/`).
  - `Invite.create` takes a `Group` and checks membership (`invite.aggregate.ts:55-69`); `Invite.redeem` checks `isActive` and returns a used copy (`invite.aggregate.ts:93-107`).
  - `InviteService.redeem` loads the invite by token, calls `Invite.redeem`, then hands over to the repository (`invite.service.ts:75-92`).
- **The membership write is in SQL.** `redeem_group_invite` claims the invite with a conditional UPDATE and inserts the member in one function (`supabase/migrations/20261005080344_group_invites.sql:133-170`). It checks expiry against the database clock. A member who redeems their own link still consumes the invite and gets `joined: false`.
- **`get_group_invite`** is the only path that shows a group's name to a non-member; it returns the invite snapshot, the group name and `caller_is_member`.
- **`Group`** has members (with emails), host and `createdAt`, and no version or invites (`src/lib/groups/group.aggregate.ts`). `get_my_group` and `list_my_groups` return no version.
- **Persistence conventions** (CLAUDE.md "Database changes"): `security definer` functions in `public`, scoped to `auth.uid()`, no business rules; migrations are forward-only and expand before contract. F-02's `save_billing_period` is the model for a version-guarded save (`supabase/migrations/20261007075852_billing_period_aggregate.sql`).
- **Consumers:** `src/pages/invite/[token].astro`, `src/pages/api/invites/redeem.ts`, `src/pages/api/groups/[id]/invites.ts`, `src/lib/invites/invite.cookies.ts` (used by the auth pages/callback and sign-in endpoint), and `group.memberLabel` in `src/components/expenses/ExpenseList.astro:28` and `BalancesPanel.astro:19,42-43`.
- **Existing tests:** `src/lib/groups/__tests__/` and `src/lib/invites/__tests__/` (aggregate, service, token, cookies, fakes), plus `npm run smoke`.

## Desired End State

- **`Group` carries `version` and its active invites.**
  - `invite({ by, tokenHash, id, now })` refuses a non-member (`group_not_found`) and returns the new invite on the aggregate.
  - `join({ tokenHash, userId, now })` finds the active invite by hash, marks it used and adds the member. An already-member joins with `joined = false`: the invite is still used up, no second membership is added (same as today).
  - An unknown, used or expired invite gives `invite_invalid`.
- **`src/lib/invites/` no longer exists.** `Invite`, `InviteToken`, `InviteTokenHash` and the one-time cookie helpers live in `src/lib/groups/`; `GroupService` is the only entry point.
- **`GroupService`** gains `invite`, `join` and `previewInvite`. Saving a group bumps `version` only if it still equals the loaded one; on a conflict the service reloads and retries the command once, then returns `group_changed`.
- **The token lookup loads a `Group` without member emails** (only the invite matching the token is loaded). The invite preview stays a narrow read model (group name, whether the caller is a member, expiry), not the aggregate.
- **`redeem_group_invite` is no longer called by the app**; it stays until a contract migration. The CLAUDE.md "Documented exception" bullet is removed.
- **Users see no change:** invite generation, the invite page, joining and the smoke test behave as before.

Verify with `npm test`, `npm run lint`, `npx astro check`, `npm run build`, `npm run db:reset && npm run db:types` (no diff) and `npm run smoke`, plus the manual checks in phase 4.

### Key Discoveries:

- **Hashing moves to TypeScript.** The aggregate must find the invite by token, so it needs the token's hash. Web Crypto's `digest` is async, so the service hashes the token (`InviteTokenHash`) and passes the hash into the pure aggregate. The new persistence functions store and look up by hash; the SQL `sha256(convert_to(...))` of the old functions stays untouched.
- **The version guard replaces the SQL claim.** Of two concurrent joins with the same token, one fails the conditional version update; its retry reloads the group, sees the invite used and gets `invite_invalid`. A conditional `used_at is null` update inside `save_group` stays as a backstop.
- **A joining user is not yet a member**, so the token lookup is scoped by possession of the token, not by `group_members`, and is exposed only to signed-in callers.
- **`save_group` has one caller-scoping rule per write:** a new invite's `created_by` must be the caller, a new member's `user_id` must be the caller. A join is allowed for a non-member only when it claims an invite in the same call.

## What We're NOT Doing

- Dropping `redeem_group_invite`, `create_group_invite`, `get_group_invite`, `get_my_group`, `list_my_groups`, `create_group`, `add_expense`, `list_period_expenses` or the `open_period` field. That is a contract migration after this ships.
- Leaving a group, removing members or erasing a member's data (PRD: nobody removes members).
- New invite features (revoking, listing invites, changing the 7-day validity).
- Any change to `BillingPeriod` or the expenses UI beyond the `memberLabel` import.
- Changing the behaviour of a member redeeming their own link (the invite is still used up).

## Implementation Approach

Ordered so that `npm test`, `npx astro check` and lint stay green after every phase:

1. Additive persistence: the column, the new functions, the repository port and its Supabase implementation, next to the old ones.
2. The new aggregate behaviour, built test-first next to the old `Invite` aggregate.
3. The service, built test-first on a fake repository.
4. The switch-over: endpoints and pages are rewired, the module is folded, the old invite service path is deleted.

Phase 1 and 4 are mechanical or wiring work for `/10x-implement`. Phases 2 and 3 suit `/10x-tdd`.

## Critical Implementation Details

**State sequencing**:
- `save_group` must bump `version` before storing invites and members, through a conditional `update … where version = p_expected_version`; if no row matches it returns `false` and stores nothing.
- The repository sends only what is new since the group was loaded (new invites, invites used since load, new members), so the aggregate tracks them. A retry reloads the group, so the reloaded aggregate starts with nothing pending.

## Phase 1: Persistence (expand)

### Overview

Add the version column and the persistence functions the new aggregate needs, and extend the repository port, without changing any behaviour the deployed Worker relies on.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_group_membership_aggregate.sql` (create with `npm run db:new group_membership_aggregate`)

**Intent**: Add `groups.version` and the functions that load and save the `Group` aggregate with its active invites.

**Contract**:
- `alter table public.groups add column version integer not null default 0`.
- `get_group_aggregate(p_group_id uuid) returns jsonb`: null unless the caller is a member; same snapshot keys as `get_my_group` (members with emails) plus `version` and `invites` (active ones only: `{ id, created_by, created_at, expires_at, token_hash }`, hash as hex).
- `list_my_group_aggregates() returns jsonb`: the caller's groups with `version`, no invites.
- `get_group_by_invite_token(p_token_hash text) returns jsonb`: null when no active invite matches; the group snapshot with members **without emails** (`email: null`), `version`, and `invites` holding only the matching invite. Callable by any signed-in user.
- `get_invite_preview(p_token_hash text) returns jsonb`: null when none matches; `{ group_id, group_name, expires_at, used_at, caller_is_member }`.
- `save_group(p_group_id uuid, p_expected_version integer, p_new_invites jsonb, p_used_invites jsonb, p_new_members jsonb) returns boolean`: bumps the version conditionally (false on a miss), stores new invites, marks used invites with a conditional `used_at is null` update, inserts members. Backstops: a new invite's `created_by` and a new member's `user_id` must equal `auth.uid()`, a new invite requires the caller to be a member, a new member who is not yet a member requires a used invite in the same call.
- Standard grants: `security definer`, `set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`, comment "Persistence only — business rules live in src/lib/groups".

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate with `npm run db:types`; never hand-edit.

#### 3. Repository port and Supabase implementation

**Files**: `src/lib/groups/types.ts`, `src/lib/groups/group.repository.ts`

**Intent**: Add the port methods the service needs and implement them over the new functions, mapping snake_case JSON to snapshots and errors to `GroupError` as the existing code does.

**Contract**: `GroupRepository` gains `findByInviteToken(tokenHash)`, `previewInvite(tokenHash)` and `save(group)` returning `Result<"saved" | "conflict">`; `findGroupOfCurrentUser`/`listGroupsOfCurrentUser` switch to the new load functions. `GroupSnapshot` gains `version` and `invites`. `Group.restore` consumers are updated in phase 2.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly and types are in sync: `npm run db:reset && npm run db:types && git diff --exit-code src/db/database.types.ts` (after committing the regenerated file)
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- The old functions (`redeem_group_invite`, `get_my_group`, …) are untouched in the migration diff.

**Implementation Note**: After this phase and its automated checks pass, pause for manual confirmation before phase 2.

---

## Phase 2: Group aggregate (test-first)

### Overview

Give `Group` its version, its invites and the two behaviours, driven by tests written first.

### Changes Required:

#### 1. Invite entity and token hash

**Files**: `src/lib/groups/invite.entity.ts`, `src/lib/groups/invite-token.value.ts` (moved), `src/lib/groups/invite-token-hash.value.ts`, `src/lib/groups/types.ts`

**Intent**: Move `Invite` into the groups module as an entity inside `Group` (id, creator, created/expires times, token hash, used-at/used-by) and add the `InviteTokenHash` value object.

**Contract**: `InviteTokenHash` wraps a 64-char lowercase hex SHA-256 and is built from a token by a static async `of(token)`; `Invite.isActive(now)` keeps "unused and strictly before `expiresAt`"; validity stays 7 days.

#### 2. Group behaviour

**File**: `src/lib/groups/group.aggregate.ts`

**Intent**: Add `version`, the loaded active invites and the tracking of pending changes; implement `invite` and `join`.

**Contract**:
- `invite({ id, by, tokenHash, now }): Result<Invite>` — non-member → `group_not_found`.
- `join({ tokenHash, userId, now }): Result<{ joined: boolean }>` — no active invite with that hash → `invite_invalid`; otherwise the invite is marked used by `userId` and, if `userId` is not a member, added as one (`joined = true`), else `joined = false`.
- Pending changes exposed for the repository: `newInvites()`, `usedInvites()`, `newMembers()`, empty after `restore`.
- Invariants: the host is a member and never changes; no member can be removed (there is no method); a user appears at most once.

#### 3. Tests first

**File**: `src/lib/groups/__tests__/group.aggregate.test.ts` (extend), `invite.entity.test.ts`, `invite-token-hash.value.test.ts`

**Intent**: Write the failing tests for each rule before implementing it (red → green → refactor).

### Success Criteria:

#### Automated Verification:

- Aggregate and entity tests pass, including: a non-member cannot invite; a used invite cannot be used again; an invite is inactive at exactly `expiresAt`; a member who joins gets `joined = false`, uses up the invite and is not added twice; `join` on an unknown hash gives `invite_invalid`; restore rejects a group whose host is not a member: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- None beyond review of the test list against the rules above.

---

## Phase 3: GroupService (test-first)

### Overview

Expose the behaviour through the single entry point, with version-conflict handling, driven by tests on a fake repository.

### Changes Required:

#### 1. Service

**File**: `src/lib/groups/group.service.ts`

**Intent**: Add `invite`, `join` and `previewInvite`; load, run the aggregate command, save, and on `conflict` reload and retry once, then return `group_changed`.

**Contract**:
- `invite({ groupId, userId })` → `{ token, expiresAt }` (the plaintext token is returned once and never stored).
- `join({ token, userId })` → `{ groupId, joined }`; a malformed token gives `invite_invalid` without a database call.
- `previewInvite({ token })` → `{ groupId, groupName, callerIsMember, expiresAt }`; unknown, used, expired and malformed tokens all give the same `invite_invalid`.
- Error codes join `GroupErrorCode`: `invite_invalid`, `group_changed`; messages in `group-error.messages.ts` reuse the existing invite wording.
- The id, clock and token generators are injected arrows (workerd "Illegal invocation" rule).

#### 2. Fake repository

**File**: `src/lib/groups/__tests__/groups.harness.ts`

**Intent**: Extend `FakeGroupRepository` with a version-guarded `save` and token lookups so the retry and the concurrent-join race are testable.

### Success Criteria:

#### Automated Verification:

- Service tests pass, including: two joins with the same token — one succeeds, the other (after its retry) gets `invite_invalid`; a conflict on `invite` is retried once and then returns `group_changed`; a non-member's `invite` returns `group_not_found`: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- None beyond review of the test list.

---

## Phase 4: Switch-over

### Overview

Rewire every consumer to `GroupService`, fold the invites module into groups and delete the old path.

### Changes Required:

#### 1. Endpoints and pages

**Files**: `src/pages/api/invites/redeem.ts`, `src/pages/api/groups/[id]/invites.ts`, `src/pages/invite/[token].astro`, `src/pages/groups/[id].astro`, `src/pages/api/groups/index.ts`, `src/pages/dashboard.astro`

**Intent**: Use `createGroupService` for join, invite and preview; error redirects carry the new codes through `groupErrorMessage`.

**Contract**: `/api/groups/[id]/invites` still stashes the token in the one-time cookie; `/api/invites/redeem` still redirects to `/groups/<id>`; the invite page keeps status 404 for `invite_invalid` and status 200 with a load-failed message for other errors.

#### 2. Cookies and module fold

**Files**: `src/lib/invites/invite.cookies.ts` (moved to `src/lib/groups/invite.cookies.ts`), `src/lib/groups/index.ts`, auth pages and endpoints that import the cookie helpers; delete `src/lib/invites/`

**Intent**: Move the remaining helpers and tests, update imports (`@/lib/groups`), and delete the old service, repository, aggregate and error messages.

#### 3. memberLabel to presentation

**Files**: `src/components/expenses/ExpenseList.astro`, `BalancesPanel.astro`, a new `src/components/expenses/member-label.ts`, `src/lib/groups/group.aggregate.ts`

**Intent**: Remove `memberLabel` from `Group`; the components build the label from `group.members` and `viewerId` ("You", the email, or "Member" when unknown).

#### 4. Docs and smoke

**Files**: `CLAUDE.md`, `context/foundation/roadmap.md`, `scripts/smoke.mjs`

**Intent**: Remove the "Documented exception" bullet and update the structure and invites descriptions in CLAUDE.md; note that `redeem_group_invite` and friends await a contract migration; update the roadmap status and the GitHub issue/board. The smoke flow is unchanged and must pass; add a check that a second redeem of the same link fails.

### Success Criteria:

#### Automated Verification:

- No imports of `@/lib/invites` remain: `grep -rn "@/lib/invites" src scripts | wc -l` prints 0
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Types in sync: `npm run db:reset && npm run db:types` leaves no diff
- Smoke passes against local Supabase: `npm run smoke`

#### Manual Verification:

- A member creates an invite link, a second user opens it signed out, signs in and joins with the button; both see the group.
- The same link shown to a member says "You're already a member" and joining it does not add a duplicate.
- A used or expired link shows "no longer valid" with status 404.
- Balances and the expense list still label members as before ("You", email, "Member").

---

## Testing Strategy

### Unit Tests:

- Aggregate: invite and join rules, expiry boundary, host invariant, no duplicate member, pending-change tracking.
- Service: retry once on conflict then `group_changed`, concurrent joins on one token, uniform `invite_invalid`, malformed token without a repository call.
- Value objects: `InviteTokenHash` format and determinism, token parsing (moved tests).

### Integration Tests:

- `npm run smoke` covers the invite flow end to end and the app-key gate; add a second-redeem check.

### Manual Testing Steps:

1. Create a group, generate an invite, open it in a second browser profile and join.
2. Re-open the same link as the second user (already a member) and as a third user (used link).
3. Open an expense page and confirm the member labels.

## Performance Considerations

The token lookup and the group load are each one function call, as before. `save_group` is one call per command, the same as `save_billing_period`.

## Migration Notes

Expand only: new column with a default and new functions, nothing dropped. The previously deployed Worker keeps using `redeem_group_invite`, `get_group_invite`, `get_my_group` and `list_my_groups`, which are untouched; a contract migration drops them after this ships. A join and an old-path redeem can race on one invite for a short window during deploy; the conditional `used_at is null` claim on both paths keeps it single-use.

## References

- Roadmap: `context/foundation/roadmap.md` (F-03)
- Prior pattern: `context/changes/billing-period-aggregate/plan.md`, `supabase/migrations/20261007075852_billing_period_aggregate.sql`
- Current invite code: `src/lib/invites/`, `supabase/migrations/20261005080344_group_invites.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence (expand)

#### Automated

- [x] 1.1 Migration applies cleanly and types are in sync — be9e625
- [x] 1.2 Unit tests pass — be9e625
- [x] 1.3 Type check passes — be9e625
- [x] 1.4 Lint passes — be9e625

#### Manual

- [x] 1.5 The old functions are untouched in the migration diff — be9e625

### Phase 2: Group aggregate (test-first)

#### Automated

- [x] 2.1 Aggregate and entity tests pass — 734b8a8
- [x] 2.2 Type check passes — 734b8a8
- [x] 2.3 Lint passes — 734b8a8

#### Manual

- [x] 2.4 Test list reviewed against the rules — 734b8a8

### Phase 3: GroupService (test-first)

#### Automated

- [x] 3.1 Service tests pass
- [x] 3.2 Type check passes
- [x] 3.3 Lint passes

#### Manual

- [ ] 3.4 Test list reviewed

### Phase 4: Switch-over

#### Automated

- [ ] 4.1 No imports of `@/lib/invites` remain
- [ ] 4.2 Unit tests pass
- [ ] 4.3 Type check passes
- [ ] 4.4 Lint passes
- [ ] 4.5 Production build passes
- [ ] 4.6 Types in sync
- [ ] 4.7 Smoke passes against local Supabase

#### Manual

- [ ] 4.8 Invite, sign-in and join flow works for a second user
- [ ] 4.9 A member opening the link sees "already a member" and is not duplicated
- [ ] 4.10 A used or expired link shows "no longer valid" with status 404
- [ ] 4.11 Member labels in balances and the expense list are unchanged
