# Generate Transfer Details (S-06) Implementation Plan

## Overview

A member stores their Polish bank account number (NRB) on a profile page. A debtor sees, next to each of their own debts, plain text transfer details they can copy into any online banking: the creditor's account number, the amount and a transfer title. This delivers FR-007 and introduces the per-user `MemberProfile` aggregate (account number only; S-10 later adds the display name).

## Current State Analysis

- The group page loads no bank data. Debts are netted pairs `PairDebt {debtorId, creditorId, amount: Money}` (`src/lib/billing-periods/period-balances.value.ts:16`), rendered in `src/components/expenses/BalancesPanel.astro` (debts list ~L36-49, already checks `debt.debtorId === viewerId`).
- `Money.formInput()` gives "400,50" (`money.value.ts:59`); `BillingMonth.label()` gives "October 2026" (`billing-month.value.ts:44`).
- The only copy-to-clipboard code is the vanilla `<script>` in `src/components/invites/InvitePanel.astro:60-110` (progressive enhancement, synchronous `writeText` for Safari, select fallback).
- No `MemberProfile`, account number, IBAN/NRB validation or related dependency exists anywhere (no zod/validator in `package.json`).
- DB conventions: group-scoped tables have RLS enabled without policies, all grants revoked from `anon`/`authenticated`, access only through `security definer` functions in `public` (`set search_path = ''`, `revoke ... from public, anon`, `grant ... to authenticated`, `auth.uid()` filtering). Example: `supabase/migrations/20261007093505_group_membership_aggregate.sql`. CI only checks that `src/db/database.types.ts` is current (`.github/workflows/ci.yml:42-45`); RLS-on is by convention.
- Form-POST endpoint pattern: `src/pages/api/groups/[id]/expenses.ts:6-46`; module layout: `index.ts`, `types.ts`, `__tests__/` with `*.harness.ts` fakes (`src/lib/groups`, `src/lib/billing-periods`).

## Desired End State

- `/profile` lets a signed-in user set or clear their account number; invalid numbers are rejected with a message.
- On a group page, each debt where the viewer is the debtor shows a transfer panel: account number (grouped for reading, copied as 26 digits), amount (`400,50`) and title (`SplitDom <group name> <month label>`, max 140 chars), each copyable. If the creditor has no number, the panel says so and still offers amount and title.
- Only the creditors of the viewer's own debts have their numbers requested; no number appears in HTML for anyone else. A stranger (not in a shared group) can never read a number.
- Verified by unit tests, `npm run smoke` (two users plus a stranger) and a manual check.

### Key Discoveries:

- Debt netting is already derived in `PeriodBalances`; the transfer panel needs no new balance logic.
- Rules live in TypeScript; SQL only persists and scopes to `auth.uid()` (CLAUDE.md "Domain logic").
- The roadmap design note (S-06 Risk, S-10) says the account number belongs to the person, in a separate per-user aggregate.

## What We're NOT Doing

- Display name or any other profile field (S-10).
- Marking a transfer as sent (S-07) or confirming it paid (S-08).
- QR codes (FR-010), minimal-transfer set (FR-006), foreign IBANs, multiple currencies.
- Account numbers shown on the member list or to non-debtors.
- Encrypting the column at rest beyond what Supabase provides.
- A Playwright E2E test (only one E2E user exists; the two-user flow is covered by smoke).
- Polish month names in the title (title uses `BillingMonth.label()` as is).
- Dropping any legacy RPC (no contract migration here).

## Implementation Approach

Domain first (TDD), then persistence, then endpoint and UI, then smoke and docs. A new module `src/lib/member-profiles/` owns `AccountNumber` and the `MemberProfile` aggregate with `MemberProfileService` as the only entry point (never imports `@/lib/supabase`). `billing-periods` gains a pure `TransferDetails` builder that takes primitives (account number string or null, group name, month label) so the two modules stay decoupled; the page composes them. The visibility rule ("a debtor sees only their creditors' numbers") is enforced in TypeScript by deriving the creditor ids from the viewer's debts and asking the profile service only for those; SQL additionally limits the read to members of a group the caller belongs to.

## Phase 1: Domain (test-first)

### Overview

Account number validation, the profile aggregate and the transfer-details builder, all with unit tests and in-memory fakes.

### Changes Required:

#### 1. AccountNumber value object

**File**: `src/lib/member-profiles/account-number.value.ts`

**Intent**: Parse and validate a Polish NRB so a typo cannot send money to the wrong place.

**Contract**: `AccountNumber.parse(raw): Result<AccountNumber>`; accepts 26 digits with optional `PL` prefix and any spaces/dashes, verifies the mod-97 checksum (move first 4 chars to the end, prefix `2521` for PL country code, integer remainder 1 — compute with chunked arithmetic, no BigInt requirement). `digits` (26 chars, normalized) and `label()` (`NN NNNN NNNN NNNN NNNN NNNN NNNN`). Error code `invalid_account_number`. Tests include a known-valid NRB, a one-digit change, wrong length, letters, `PL` prefix and spaces.

#### 2. MemberProfile aggregate and service

**File**: `src/lib/member-profiles/member-profile.aggregate.ts`, `member-profile.service.ts`, `types.ts`, `index.ts`, `member-profile-error.messages.ts`, `__tests__/` (with `member-profiles.harness.ts` fake repository)

**Intent**: A per-user aggregate keyed by user id holding an optional account number; only its owner changes it.

**Contract**: `MemberProfile.of({userId, accountNumber | null, version})`, `setAccountNumber(by, raw)` / `clearAccountNumber(by)` refuse `by !== userId` (`not_owner`). `MemberProfileService`: `getOwn(userId)`, `saveAccountNumber({userId, raw})` (empty input clears), `accountNumbersFor({viewerId, groupId, userIds})` returning a map userId → `AccountNumber | null`. Concurrent writes: version guard with reload-and-retry-once like `BillingPeriodService`, then `profile_changed`. Error shape `{ error: { code, message, context } }` with `memberProfileErrorMessage(code)`. Repository interface in `types.ts`: `load(userId)`, `save(profile)` (boolean false on version conflict), `accountNumbers(groupId, userIds)`.

#### 3. TransferDetails builder

**File**: `src/lib/billing-periods/transfer-details.value.ts`, test in `__tests__/`

**Intent**: Turn one of the viewer's debts into copyable text, and name which creditors' numbers are needed.

**Contract**: `creditorIdsOf(balances: PeriodBalances, debtorId): string[]` (debts where the viewer is the debtor only) and `TransferDetails.of({amount: Money, accountDigits: string | null, groupName: string, monthLabel: string})` exposing `amount` (`Money.formInput()`), `title` (`SplitDom <group> <month>` truncated to 140 chars), `account` (digits or null). Tests: title truncation, no number, creditors only for the viewer's debts, a viewer with no debts gets an empty list.

### Success Criteria:

#### Automated Verification:

- AccountNumber tests cover valid, checksum-failing, wrong length, non-digit, `PL` prefix and spacing inputs
- MemberProfile tests cover owner-only change, clear, version conflict retry and `profile_changed`
- TransferDetails tests cover title truncation, missing number and creditor selection
- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Module layout matches `src/lib/groups` (index.ts, types.ts, `__tests__/`, `feature.role.ts` naming)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Persistence and repository

### Overview

Expand-only migration for the profile table and persistence functions, plus the Supabase repository.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_member_profiles.sql` (via `npm run db:new member_profiles`)

**Intent**: Store one row per user with the account number; access only through narrow functions.

**Contract**: table `public.member_profiles(user_id uuid primary key references auth.users(id) on delete restrict, account_number text, version integer not null default 1, updated_at timestamptz)`; a `check` that `account_number ~ '^[0-9]{26}$'` as a format backstop only; RLS enabled with no policies; `revoke all` from `anon`, `authenticated`. Functions in `public` (`security definer`, `set search_path = ''`, `not_authenticated` for null `auth.uid()`, `revoke execute ... from public, anon`, `grant execute ... to authenticated`, `comment on function` "Persistence only"): `get_my_member_profile()`, `save_my_member_profile(p_account_number, p_expected_version)` (upsert scoped to `auth.uid()`, conditional version bump, returns boolean), `get_group_member_account_numbers(p_group_id uuid, p_user_ids uuid[])` (returns rows only when `auth.uid()` is a member of the group and the requested users are members of the same group; otherwise empty). Then `npm run db:reset && npm run db:types`.

#### 2. Repository

**File**: `src/lib/member-profiles/member-profile.repository.ts`

**Intent**: Map the three functions to the repository interface, following `src/lib/groups/group.repository.ts`.

**Contract**: `createSupabaseMemberProfileRepository(client: SupabaseClient<Database>)`; error 28000 → `not_authenticated`, anything else `unexpected` with `dbCode`; malformed rows → `unexpected`. Exported with `createMemberProfileService(supabase)` from `index.ts`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- Generated types are current: `npm run db:types` leaves `git diff src/db/database.types.ts` showing only the new functions/table
- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- In local Supabase Studio the table has RLS on and no `anon`/`authenticated` grants
- Calling the functions without the app key returns 403 `APPGATE`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Profile page, endpoint and transfer panel

### Overview

User-facing flow: set the account number, see and copy transfer details at a debt.

### Changes Required:

#### 1. Profile page and endpoint

**File**: `src/pages/profile.astro`, `src/pages/api/profile/account.ts`, link from `src/pages/dashboard.astro`, route protection in `src/middleware.ts`

**Intent**: A form to set or clear the account number, redirecting on error with only the error code.

**Contract**: `POST /api/profile/account` with field `account_number`; unauthenticated → `/auth/signin`; failure → `/profile?error=<code>` rendered via `memberProfileErrorMessage`; success → `/profile?saved=1`. `/profile` shows the stored number in grouped form; empty input clears it. Add `/profile` to the protected routes.

#### 2. Transfer panel on the group page

**File**: `src/pages/groups/[id].astro`, `src/components/expenses/BalancesPanel.astro` (or a sibling `TransferDetails.astro`), copy script reused from `src/components/invites/InvitePanel.astro`

**Intent**: For every debt where the viewer is the debtor show account, amount and title with copy buttons; when the creditor has no number show a message naming them and keep amount and title.

**Contract**: the page calls `creditorIdsOf(open.balances, user.id)`, then `memberProfileService.accountNumbersFor({viewerId, groupId, userIds})`, and passes a `Map` into the panel; nothing is requested or rendered when the viewer owes nothing. The group name and `open.period.month.label()` feed the title. Copy buttons use `data-copy`/`data-copy-status` with the synchronous `navigator.clipboard.writeText` pattern and a select fallback; no-JS keeps the text visible. A failed profile lookup degrades to the "no number" state and never breaks the page.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- `/profile` rejects a number with a bad checksum with a readable message and saves a valid one; clearing works
- A debtor sees the panel; the creditor sees no panel for the same debt
- Copy buttons put the 26 digits, `400,50` style amount and title on the clipboard
- A creditor without a number shows the "no number yet" message
- Mobile width layout is usable

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Smoke test and documentation

### Overview

Prove privacy end to end with two users plus a stranger, and update the project docs.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing two-user flow.

**Contract**: the member who paid an expense sets a valid account number via `POST /api/profile/account`; the debtor's group page contains the digits, amount and title; the creditor's own page contains no transfer panel; a third user outside the group cannot read the number through a direct Data API call to `get_group_member_account_numbers` (empty result); an invalid number is rejected.

#### 2. Documentation and roadmap

**File**: `CLAUDE.md`, `context/foundation/roadmap.md`, `context/deployment/deploy-plan.md`

**Intent**: Record the new module, route, endpoint and persistence functions; mark S-06 progress; note the new sensitive-data table and the S-10 follow-up (display name extends `member_profiles`).

**Contract**: CLAUDE.md Structure and smoke command description updated; roadmap S-06 status and Backlog Handoff entry; keep the GitHub board aligned per the roadmap-sync rules (PR body `Closes #11`).

### Success Criteria:

#### Automated Verification:

- Smoke passes against local Supabase and the dev server: `npm run smoke`
- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Documentation changes read correctly and the roadmap row matches the issue state

---

## Testing Strategy

### Unit Tests:

- `AccountNumber`: valid, bad checksum, wrong length, letters, `PL` prefix, separators
- `MemberProfile`: owner-only, clear, version conflict
- `TransferDetails`: title, truncation, missing number, creditor selection

### Integration Tests:

- Smoke: debtor sees creditor's number; creditor and stranger do not; invalid number rejected; direct RPC without the app key gives 403

### Manual Testing Steps:

1. Set an account number on `/profile`, then sign in as the debtor and open the group page.
2. Copy each field into a text editor and compare to the displayed values.
3. Clear the number and confirm the debtor sees the "no number yet" message.

## Performance Considerations

One extra RPC per group page load, only when the viewer has debts; negligible at household scale.

## Migration Notes

Expand-only: a new table and three new functions, nothing existing changes, so the previously deployed Worker keeps working. The `deploy` job pushes the migration before `wrangler deploy`.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-06, S-10); PRD FR-007 in `context/foundation/prd.md`
- Similar plan: `context/archive/2026-10-19-edit-own-expense-rules/plan.md`
- Persistence pattern: `supabase/migrations/20261007093505_group_membership_aggregate.sql`
- Repository pattern: `src/lib/groups/group.repository.ts`
- Copy pattern: `src/components/invites/InvitePanel.astro:60-110`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain (test-first)

#### Automated

- [x] 1.1 AccountNumber tests cover valid, checksum-failing, wrong length, non-digit, `PL` prefix and spacing inputs — 08482f5
- [x] 1.2 MemberProfile tests cover owner-only change, clear, version conflict retry and `profile_changed` — 08482f5
- [x] 1.3 TransferDetails tests cover title truncation, missing number and creditor selection — 08482f5
- [x] 1.4 Unit tests pass: `npm test` — 08482f5
- [x] 1.5 Type checking passes: `npx astro check` — 08482f5
- [x] 1.6 Linting passes: `npm run lint` — 08482f5

#### Manual

- [ ] 1.7 Module layout matches `src/lib/groups` (index.ts, types.ts, `__tests__/`, `feature.role.ts` naming)

### Phase 2: Persistence and repository

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:reset` — 23963f8
- [x] 2.2 Generated types are current: `npm run db:types` leaves `git diff src/db/database.types.ts` showing only the new functions/table — 23963f8
- [x] 2.3 Unit tests pass: `npm test` — 23963f8
- [x] 2.4 Type checking passes: `npx astro check` — 23963f8
- [x] 2.5 Linting passes: `npm run lint` — 23963f8

#### Manual

- [ ] 2.6 In local Supabase Studio the table has RLS on and no `anon`/`authenticated` grants
- [ ] 2.7 Calling the functions without the app key returns 403 `APPGATE`

### Phase 3: Profile page, endpoint and transfer panel

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — a78e9bc
- [x] 3.2 Type checking passes: `npx astro check` — a78e9bc
- [x] 3.3 Linting passes: `npm run lint` — a78e9bc
- [x] 3.4 Production build succeeds: `npm run build` — a78e9bc

#### Manual

- [ ] 3.5 `/profile` rejects a number with a bad checksum with a readable message and saves a valid one; clearing works
- [ ] 3.6 A debtor sees the panel; the creditor sees no panel for the same debt
- [ ] 3.7 Copy buttons put the 26 digits, `400,50` style amount and title on the clipboard
- [ ] 3.8 A creditor without a number shows the "no number yet" message
- [ ] 3.9 Mobile width layout is usable

### Phase 4: Smoke test and documentation

#### Automated

- [x] 4.1 Smoke passes against local Supabase and the dev server: `npm run smoke`
- [x] 4.2 Unit tests pass: `npm test`
- [x] 4.3 Type checking passes: `npx astro check`
- [x] 4.4 Linting passes: `npm run lint`

#### Manual

- [ ] 4.5 Documentation changes read correctly and the roadmap row matches the issue state
