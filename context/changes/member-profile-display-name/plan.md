# Member Profile with a Display Name (S-10) Implementation Plan

## Overview

A member sets one display name on `/profile`. Wherever a group labels another member (balances, debts, transfer details, payments, expense list, carried-over debts), the label becomes the display name when the member has one, otherwise the email, as today. The viewer still sees "You" for themselves.

The name belongs to the person, so it joins the `MemberProfile` aggregate and the `member_profiles` table (S-06) rather than `Group`. Roadmap item S-10, GitHub issue [#27](https://github.com/adamgwozdz00/SplitDom/issues/27).

## Current State Analysis

- **Labelling rule is in one place**: `memberLabel(members, userId, viewerId)` in `src/components/expenses/member-label.ts` returns "You", the member's email or "Member". Five components call it: `BalancesPanel`, `ExpenseList`, `TransferPanel`, `PaymentList`, `OpeningDebtList`. Unit-tested in `src/components/expenses/__tests__/member-label.test.ts`.
- **Emails come from the group snapshot**: `GroupMember.email` is filled by the group persistence functions from `auth.users` (`supabase/migrations/20261007093505_group_membership_aggregate.sql`). The `groups` module knows nothing about profiles and must stay that way.
- **`MemberProfile`** (`src/lib/member-profiles/member-profile.aggregate.ts`) holds only the account number plus `version`. Commands take `by` and refuse non-owners (`not_owner`). `MemberProfileService.saveAccountNumber` loads, runs the command, saves, retries a lost race once, then returns `profile_changed`.
- **Visibility pattern to copy**: `get_group_member_account_numbers(p_group_id, p_user_ids)` returns data only for fellow members of a group the caller belongs to, and `MemberProfileService.accountNumbersFor` wraps it (`src/lib/member-profiles/member-profile.service.ts`). The group page calls it for the viewer's creditors (`src/pages/groups/[id].astro:69-73`).
- **Persistence**: `save_my_member_profile(p_expected_version, p_account_number)` overwrites `account_number` on the owner's row; version 0 inserts (`supabase/migrations/20261019151519_member_profiles.sql`). `get_my_member_profile` returns `user_id`, `account_number`, `version`.
- **Profile page**: `src/pages/profile.astro` has one form posting to `src/pages/api/profile/account.ts`; errors come back as `?error=<code>` and are mapped by `memberProfileErrorMessage`.
- **Tests**: `FakeMemberProfileRepository` in `src/lib/member-profiles/__tests__/member-profiles.harness.ts`; smoke (`scripts/smoke.mjs`) already covers the profile and checks that a stranger cannot read account numbers through the Data API.

## Desired End State

- `/profile` has a second, separate form "Display name". Saving a blank value removes the name.
- Fellow group members see that name in every group view instead of the email. A member without a name still appears by email; a member with neither appears as "Member".
- A user outside the group cannot read the name through the Data API.
- Verify with `npm test`, `npm run db:reset && npm run db:types`, `npx astro check`, `npm run lint`, `npm run build`, `npm run smoke`, and a manual two-browser run.

### Key Discoveries:

- The rule "display name first, then email" belongs in `memberLabel`; the five components only need the name map passed in (`src/components/expenses/member-label.ts:4`).
- Saving one field must not clobber the other: both commands run on the loaded aggregate, which then saves the whole profile.
- `save_my_member_profile` cannot gain a parameter by `create or replace`; an overload with the same named arguments would be ambiguous in PostgREST. The new save needs its own name (expand/contract).

## What We're NOT Doing

- Uniqueness or disambiguation of names: two members of a group may share a name and then look alike. Accepted.
- Showing the name in the Topbar, the dashboard "Welcome" line or the invite preview; those keep the signed-in user's email.
- Per-group names.
- Any pattern or character allow-list beyond the length and control-character rules below.
- Dropping the old `save_my_member_profile`; it stays as an expand/contract leftover (see Migration Notes).
- A Playwright spec.

## Implementation Approach

Extend the existing module end to end, following the account-number path: a `DisplayName` value object (trim, 1–40 code points, no control characters), `setDisplayName`/`clearDisplayName` on the aggregate, service commands, and a new persistence function that returns the names of fellow members. The group page loads the names for all members of the open group in one call and passes the map to the five components, which hand it to `memberLabel`. The profile page gets a separate form and endpoint so an invalid account number never blocks the name (and the other way round).

## Phase 1: Domain and persistence

### Overview

The display name exists in the aggregate, the service and the database, fully unit-tested, with no UI yet.

### Changes Required:

#### 1. DisplayName value object

**File**: `src/lib/member-profiles/display-name.value.ts`

**Intent**: Parse raw input into a valid name or an `invalid_display_name` error, like `AccountNumber`.

**Contract**: `DisplayName.parse(raw): Result<DisplayName>` trims, requires 1–40 Unicode code points and no control characters (so no newlines); `DisplayName.fromStored(value)` rebuilds a stored name without applying the rule again; `.value` is the string. Exported from `index.ts`.

#### 2. Aggregate, errors, types

**Files**: `src/lib/member-profiles/member-profile.aggregate.ts`, `member-profile-error.messages.ts`, `types.ts`

**Intent**: Add the name to the profile with owner-only commands and the persistence shape.

**Contract**: `MemberProfile.displayName: DisplayName | null`; `setDisplayName(by, raw)` and `clearDisplayName(by)` mirror the account-number commands (`not_owner` for non-owners). `MemberProfileSnapshot.displayName: string | null`. New error code `invalid_display_name` with a message ("Enter a name of 1–40 characters"). `MemberProfileRepository` gains `displayNames(groupId, userIds): Promise<Result<{userId, displayName}[]>>`. `MemberProfile.restore`/`empty` keep working for profiles stored before this change (name null).

#### 3. Service

**File**: `src/lib/member-profiles/member-profile.service.ts`

**Intent**: One command to save the name and one query for the group page.

**Contract**: `saveDisplayName({ userId, raw }): Promise<Result<void>>` blank clears, same load–change–save–retry-once–`profile_changed` loop as `saveAccountNumber` (share the loop, do not copy it). `displayNamesFor({ groupId, userIds }): Promise<Result<DisplayNames>>` with `DisplayNames = Map<string, DisplayName>`; empty `userIds` returns an empty map without a database call.

#### 4. Repository

**File**: `src/lib/member-profiles/member-profile.repository.ts`

**Intent**: Read `display_name` in `loadOwn`, write it in `save`, add `displayNames`.

**Contract**: `loadOwn` reads the new `display_name` key (absent or null → null). `save` calls the new save function (below) passing both fields. `displayNames` calls `get_group_member_display_names`; malformed rows give `unexpected`.

#### 5. Migration (expand only)

**File**: `supabase/migrations/<timestamp>_member_display_name.sql` (via `npm run db:new member_display_name`)

**Intent**: Add the column and the functions without breaking the previously deployed Worker.

**Contract**:
- `alter table public.member_profiles add column display_name text` with a format backstop check (`display_name is null or char_length(display_name) between 1 and 40`).
- `create or replace function public.get_my_member_profile()` adds a `display_name` key (additive JSON).
- New `public.save_my_member_profile_with_display_name(p_expected_version integer, p_account_number text default null, p_display_name text default null)` with the same version-guard semantics as `save_my_member_profile` (version 0 inserts, otherwise conditional update bumping the version), `security definer`, `set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`.
- New `public.get_group_member_display_names(p_group_id uuid, p_user_ids uuid[])` returning `[{user_id, display_name}]` for members of the group that have a name, only when `auth.uid()` is a member of that group too (empty array otherwise), same shape and grants as `get_group_member_account_numbers`.
- The old `save_my_member_profile` is untouched: a Worker that still calls it keeps updating the account number and leaves the name alone.
- Persistence only; the length and control-character rules stay in TypeScript. Then `npm run db:reset && npm run db:types`.

#### 6. Unit tests

**Files**: `src/lib/member-profiles/__tests__/display-name.value.test.ts`, extended `member-profile.aggregate.test.ts`, `member-profile.service.test.ts`, and `member-profiles.harness.ts` (fake `displayNames`, stored `displayName`)

**Intent**: Cover the rule and the behavior at the boundaries.

**Contract**: trims; accepts 1 and 40 characters (including Polish letters and emoji counted by code point); rejects empty-after-trim, 41 characters and a name with a newline; non-owner gets `not_owner`; saving the name keeps the account number and vice versa; blank input clears; a lost race is retried once and then `profile_changed`; `displayNamesFor` with no ids makes no repository call.

### Success Criteria:

#### Automated Verification:

- Migration applies and types regenerate with no diff left over: `npm run db:reset && npm run db:types`
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- In local Supabase Studio or `psql`, an anonymous call to `get_group_member_display_names` is refused and a non-member's call returns an empty array

**Implementation Note**: After this phase and its automated checks, pause for the manual confirmation before Phase 2.

---

## Phase 2: Profile form and group labels

### Overview

The member can set the name on `/profile`, and the group shows it.

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/profile/display-name.ts`

**Intent**: Form POST that saves or clears the signed-in user's display name, like `account.ts`.

**Contract**: reads `displayName` from the form; calls `saveDisplayName`; redirects to `/profile?saved=name` on success and `/profile?nameError=<code>` on failure (only the code, never a message); anonymous callers go to `/auth/signin`.

#### 2. Profile page

**File**: `src/pages/profile.astro`

**Intent**: Add a separate "Display name" form above the account-number form, prefilled with the current name, with its own error and "Saved" status, and the same double-submit guard.

**Contract**: the existing account-number form, its `?error=` and `?saved=1` handling stay as they are; the new form uses `?nameError=` and `?saved=name` so the two statuses never mix. Copy states who sees the name (members of your groups). The page keeps `Cache-Control: no-store`. The `<script>` guard covers both forms (generalize the `data-account-form` selector).

#### 3. memberLabel

**File**: `src/components/expenses/member-label.ts`

**Intent**: Keep the single labelling rule and put the display name before the email.

**Contract**: `memberLabel(members, userId, viewerId, displayNames?)` order: "You" for the viewer, then `displayNames.get(userId)?.value`, then the member's email, then "Member". `displayNames` is optional so existing callers compile until they are updated; update all five components in the same phase.

#### 4. Group page and the five components

**Files**: `src/pages/groups/[id].astro`, `BalancesPanel.astro`, `ExpenseList.astro`, `TransferPanel.astro`, `PaymentList.astro`, `OpeningDebtList.astro` (all in `src/components/expenses/`)

**Intent**: Load the names once per request and pass them through.

**Contract**: after the group loads, call `displayNamesFor({ groupId, userIds: group.members.map(m => m.userId) })`; a failed lookup falls back to an empty map (labels fall back to emails, the page does not break). Each component takes a `displayNames` prop and passes it to every `memberLabel` call. The page sets no extra cache header beyond what it already sets (names are not as sensitive as account numbers, and the page is behind sign-in); the edit page (`src/pages/groups/[id]/expenses/[expenseId]/edit.astro`) does not label other members and is untouched unless it calls `memberLabel`.

#### 5. memberLabel tests

**File**: `src/components/expenses/__tests__/member-label.test.ts`

**Intent**: Pin the precedence.

**Contract**: the viewer is "You" even with a display name; another member with a name is shown by name, not email; a member without a name is shown by email; a member without either is "Member"; a name for a user not in `members` is ignored (unknown user stays "Member").

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- User A sets the name "Ania" on `/profile`; after reload the field shows "Ania" and "Saved" appears
- User B, in the same group, sees "Ania" (not A's email) in the balances, the debt sentence, the expense list ("Paid by Ania"), the Payments list and the transfer details
- A sees themselves as "You"
- Clearing the name makes B see A's email again
- An invalid name (41 characters, or only spaces with an existing name → clears) shows the error on the name form only and leaves the account number untouched

**Implementation Note**: After this phase and its automated checks, pause for the manual confirmation before Phase 3.

---

## Phase 3: Smoke test and documentation

### Overview

The flow is covered end to end and the project documents match reality.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing profile steps with the display name.

**Contract**: the group's creditor saves a display name through `/api/profile/display-name`; the debtor's group page contains that name; an invalid name redirects with `nameError=invalid_display_name`; anonymous POST redirects to sign-in; a direct Data API call to `get_group_member_display_names` by the stranger (not in the group) returns an empty list; clearing the name makes the page show the email again.

#### 2. Documentation

**Files**: `CLAUDE.md`, `context/foundation/roadmap.md` (and the GitHub issue/board per the repository's roadmap-sync rules), `context/deployment/deploy-plan.md` if it lists database functions

**Intent**: Record what now exists.

**Contract**: CLAUDE.md status paragraph, `src/lib/member-profiles/` and `memberLabel` descriptions, the new endpoint and the `member_profiles` note (display name added; `get_group_member_display_names`); an "Expand/contract leftovers" entry for the old `save_my_member_profile`. Roadmap S-10 status per the lifecycle (the PR closes #27).

### Success Criteria:

#### Automated Verification:

- Smoke passes against local Supabase and a running dev server: `npm run smoke`
- Full check passes: `npm test && npx astro check && npm run lint && npm run build`

#### Manual Verification:

- CLAUDE.md and the roadmap describe the display name and the leftover accurately

---

## Testing Strategy

### Unit Tests:

- `DisplayName`: trim, 1 and 40 characters, 41 rejected, empty, newline, Polish letters, emoji by code point
- Aggregate: owner-only, set/clear, the other field untouched
- Service: save, clear on blank, retry once on conflict, `profile_changed` after two conflicts, `displayNamesFor` with no ids
- `memberLabel`: precedence You → name → email → "Member"

### Integration Tests:

- Smoke: name saved, visible to a co-member, hidden from a stranger at the Data API, invalid name rejected, cleared name falls back to email

### Manual Testing Steps:

1. Two browsers, two users in one group; set a name in one, check all group views in the other
2. Clear the name, reload, check the email is back
3. Open `/profile` with `?nameError=invalid_display_name` and check the message appears only under the name form

## Performance Considerations

One extra RPC per group-page request (one call for all members). No caching; it is a small indexed lookup by primary key.

## Migration Notes

Expand only: a new nullable column, one additive key in `get_my_member_profile`, two new functions. A previously deployed Worker keeps working: it calls the old save (which leaves `display_name` untouched) and ignores the extra JSON key. The old `save_my_member_profile` becomes an expand/contract leftover, to be dropped by a later contract migration once no deployed Worker calls it (note it in CLAUDE.md). The migration is pushed by the `deploy` job before `wrangler deploy`.

## References

- Roadmap: `context/foundation/roadmap.md` (S-10), issue #27
- Account-number path to mirror: `supabase/migrations/20261019151519_member_profiles.sql`, `src/lib/member-profiles/member-profile.service.ts`
- Labelling rule: `src/components/expenses/member-label.ts:4`
- Group page wiring: `src/pages/groups/[id].astro:69-73`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain and persistence

#### Automated

- [x] 1.1 Migration applies and types regenerate with no diff left over: `npm run db:reset && npm run db:types` — 3c7191f
- [x] 1.2 Unit tests pass: `npm test` — 3c7191f
- [x] 1.3 Type check passes: `npx astro check` — 3c7191f
- [x] 1.4 Lint passes: `npm run lint` — 3c7191f

#### Manual

- [x] 1.5 In local Supabase Studio or `psql`, an anonymous call to `get_group_member_display_names` is refused and a non-member's call returns an empty array — 3c7191f

### Phase 2: Profile form and group labels

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — e3e63c8
- [x] 2.2 Type check passes: `npx astro check` — e3e63c8
- [x] 2.3 Lint passes: `npm run lint` — e3e63c8
- [x] 2.4 Build passes: `npm run build` — e3e63c8

#### Manual

- [x] 2.5 User A sets the name "Ania" on `/profile`; after reload the field shows "Ania" and "Saved" appears — e3e63c8
- [x] 2.6 User B, in the same group, sees "Ania" (not A's email) in the balances, the debt sentence, the expense list ("Paid by Ania"), the Payments list and the transfer details — e3e63c8
- [x] 2.7 A sees themselves as "You" — e3e63c8
- [x] 2.8 Clearing the name makes B see A's email again — e3e63c8
- [x] 2.9 An invalid name shows the error on the name form only and leaves the account number untouched

### Phase 3: Smoke test and documentation

#### Automated

- [x] 3.1 Smoke passes against local Supabase and a running dev server: `npm run smoke` — 316dc1a
- [x] 3.2 Full check passes: `npm test && npx astro check && npm run lint && npm run build` — 316dc1a

#### Manual

- [x] 3.3 CLAUDE.md and the roadmap describe the display name and the leftover accurately — 316dc1a
