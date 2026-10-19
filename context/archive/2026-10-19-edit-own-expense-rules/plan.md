# Edit and Delete Rules for Own Expenses (S-05) Implementation Plan

## Overview

An expense's author can edit (title, amount, purchase date) or delete their own expense while its billing period is open; nobody else can. The rules live in the `BillingPeriod` aggregate, persistence gets an expand-only migration, and the group page gets an edit page with a delete confirmation. This also removes the accepted limitation that a duplicated expense cannot be deleted (`context/deployment/deploy-plan.md`, "Expenses").

## Current State Analysis

- `BillingPeriod` (`src/lib/billing-periods/billing-period.aggregate.ts`) only adds expenses: `addExpense` refuses a closed period, a non-participant payer and a bad date; `newExpenses()` feeds `save`. `Expense` (`expense.entity.ts`) is immutable and "keeps its own id because it will be edited and deleted (S-05)".
- The author of an expense is its `payerId`: the endpoint always sets `payerId: user.id`, and `save_billing_period` rejects any payer other than the caller.
- `save_billing_period` (`supabase/migrations/20261007075852_billing_period_aggregate.sql`) bumps `version` conditionally and inserts only. There is no update or delete path. `expense_shares` cascades from `expenses`.
- `BillingPeriodService` retries a command once on a version conflict, then returns `period_changed`.
- Paid debts do not exist yet (S-08). Netted debts per pair are derived (`PeriodBalances`), so deleting or editing an expense changes balances automatically.
- Closing a period (S-09) is not built, so `closedAt` is never set in practice yet; the rule is still enforced and unit-tested.

## Desired End State

On `/groups/[id]` each expense the viewer paid shows an "Edit" link while the period is open. The edit page changes title, amount and purchase date (same validation and date window as adding) and offers "Delete expense" behind a confirmation. Balances update immediately. A non-author, or anyone on a closed period, is refused with a code-based error. Verified by unit tests, the smoke script and one Playwright test.

### Key Discoveries:

- `src/lib/billing-periods/expense.entity.ts:21` — `Expense` is immutable with invariants in the constructor; an edit must produce a new valid `Expense`.
- `src/lib/billing-periods/billing-period.service.ts:73-94` — the add-and-retry-once pattern to generalise for edit and delete.
- `src/lib/billing-periods/billing-period.repository.ts:48-60` — `save` maps `newExpenses()` through `toRow`; reused for changed expenses.
- `CLAUDE.md` — "Expand/contract": the deployed Worker still calls `save_billing_period`, so it must stay untouched; the new function is added next to it.
- `src/lib/billing-periods/split-policy.ts` — `EqualSplitPolicy.split` takes the participant list, so an edit passes the expense's original sharers.

## What We're NOT Doing

- The paid-debt lock of FR-005 (waits for S-08; the "debt per pair vs. per expense" question stays in S-08).
- Changing the payer or the split policy (payer = author, equal split only).
- Soft delete / audit trail of deleted expenses.
- Inline editing in the list or any client-side JavaScript beyond what the add form already uses.
- The contract migration dropping the old RPCs (`save_billing_period`, `add_expense`, …).
- Period closing (S-09).

## Implementation Approach

Domain first, test-first (TDD, as in F-02): the aggregate gets `editExpense`/`removeExpense` and one `canEdit` rule that S-08 will extend with the paid-debt lock. The aggregate tracks added, changed and removed expenses; the repository persists all three in one version-guarded call via a new `security definer` function. Endpoints and UI follow the existing form-POST + redirect-with-code pattern.

Decisions: on an amount edit the new amount is split equally between the expense's original sharers (payer's share absorbs the remainder), so a member who joined later never gets a retroactive debt. Delete is a hard delete. Edit happens on a separate page.

## Phase 1: Domain rules (TDD)

### Overview

The aggregate, entity, service and error codes, driven by tests written first, against the in-memory fake repository.

### Changes Required:

#### 1. Expense revision

**File**: `src/lib/billing-periods/expense.entity.ts`

**Intent**: Add a way to produce a revised copy of an expense (new title, amount, purchase date, shares) that keeps id, payer and `createdAt` and re-runs the constructor invariants.

**Contract**: `expense.revise({ title, amount, purchasedOn, shares }): Expense`; `expense.sharerIds(): readonly string[]` (original share order).

#### 2. BillingPeriod commands and the editable rule

**File**: `src/lib/billing-periods/billing-period.aggregate.ts`

**Intent**: Add `editExpense` and `removeExpense`, with a single `canEdit(expense, userId)` rule (period open and `userId` is the payer). Track added, changed and removed expenses so the repository can persist them; `expenses`, `balances()` and `expensesNewestFirst()` reflect pending changes.

**Contract**:
- `editExpense({ expenseId, userId, title, amount, purchasedOn, now }): Result<Expense>`; `removeExpense({ expenseId, userId }): Result<void>`.
- Refusal order: closed period → unknown expense → not the author → purchase date outside the window (same `PurchaseDate` window as adding).
- The new shares come from `EqualSplitPolicy` over `expense.sharerIds()` with the same payer.
- `changedExpenses()`, `removedExpenseIds()` alongside `newExpenses()`. An expense added and edited in the same unit of work stays one added expense; one added and removed is dropped.

#### 3. Errors and types

**Files**: `src/lib/billing-periods/types.ts`, `billing-period-error.messages.ts`

**Intent**: New codes `expense_not_found` and `not_expense_author` with messages; reword `billing_period_closed` to "expenses can no longer be changed". Extend the repository contract: `save` stores added, changed and removed expenses if the version is unchanged.

**Contract**: `BillingPeriodErrorCode` gains the two codes; `BillingPeriodRepository.save` doc updated (signature unchanged).

#### 4. Service

**File**: `src/lib/billing-periods/billing-period.service.ts`

**Intent**: `editExpense`, `deleteExpense` and `getEditableExpense` (for the edit page; returns the period and expense only when the viewer may edit). Edit and delete reuse the load → command → save → reload-and-retry-once flow, ending in `period_changed`. Validation order for edit mirrors add: title, then amount, then the aggregate.

**Contract**: `editExpense({ group, userId, expenseId, title, amount, purchasedOn }): Result<{ expenseId }>`; `deleteExpense({ group, userId, expenseId }): Result<void>`; `getEditableExpense({ group, userId, expenseId }): Result<{ period, expense }>`. Update `index.ts` exports.

#### 5. Test fake

**File**: `src/lib/billing-periods/__tests__/billing-periods.harness.ts`

**Intent**: Make `FakeBillingPeriodRepository.save` apply changes and removals under the same version guard as the database.

### Success Criteria:

#### Automated Verification:

- Aggregate tests cover: author edits and deletes; non-author refused; closed period refuses edit and delete; unknown expense; date outside window; amount edit re-splits between original sharers only (3rd member who joined later gets no share) with the remainder on the payer; shares still sum to the amount; edit-after-add in one unit of work; balances reflect edits and deletes.
- Service tests cover: retry once on conflict, `period_changed` after a second conflict, closed-meanwhile refusal on retry, validation order.
- Unit tests pass: `npm test`
- Types pass: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Review the aggregate API: `canEdit` is the only place that decides editability.

**Implementation Note**: After this phase and its automated checks pass, pause for confirmation before Phase 2.

---

## Phase 2: Persistence (expand migration) and repository

### Overview

A forward-only migration adds one persistence function; the repository switches to it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_edit_delete_expenses.sql` (via `npm run db:new edit_delete_expenses`)

**Intent**: Add `public.save_billing_period_changes(p_period_id, p_group_id, p_expected_version, p_added jsonb, p_changed jsonb, p_removed uuid[])` returning boolean. It only persists: membership check, conditional version bump (returns false when the version moved), insert added expenses with shares, update changed expenses and replace their shares, delete removed expenses (shares cascade). `save_billing_period` and all old RPCs stay untouched (the deployed Worker still uses them).

**Contract**: `security definer`, `set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`, `comment on function` as the sibling functions. Caller-scoping backstops, not business rules: every added, changed and removed expense must have `payer_id = auth.uid()` (changed and removed matched against the stored row); the version bump also requires `closed_at is null`. Failures raise `42501` like the siblings.

#### 2. Types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate with `npm run db:types` (never hand-edit).

#### 3. Repository

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: `save` calls `save_billing_period_changes` with `newExpenses()`, `changedExpenses()` and `removedExpenseIds()` (reusing `toRow`); `false` → `"conflict"`. Error mapping unchanged (`42501` → `group_not_found`).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- Types regenerated with no diff afterwards: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Unit tests, `npx astro check` and `npm run lint` pass.

#### Manual Verification:

- In local Supabase Studio, `save_billing_period_changes` is executable by `authenticated` only, and a direct call without `x-app-key` is refused (403).

**Implementation Note**: Pause for confirmation before Phase 3.

---

## Phase 3: Endpoints and UI

### Overview

Edit page, edit and delete form POSTs, and the Edit link in the expense list.

### Changes Required:

#### 1. Edit and delete endpoints

**Files**: `src/pages/api/groups/[id]/expenses/[expenseId]/edit.ts`, `src/pages/api/groups/[id]/expenses/[expenseId]/delete.ts`

**Intent**: Form POSTs shaped like `src/pages/api/groups/[id]/expenses.ts`: load the group for the member, call the service, redirect with only the error code. Deleting an expense that is already gone (`expense_not_found`, e.g. a repeated submit) redirects to the group page without an error. The delete confirm button is disabled after the first click, as in the add form. Validation errors (`invalid_*`) go back to the edit page; `expense_not_found`, `not_expense_author` and `billing_period_closed` go to the group page; success redirects to the group page.

**Contract**: `?expenseError=<code>` on the target page; messages from `billingPeriodErrorMessage(code)`.

#### 2. Edit page

**File**: `src/pages/groups/[id]/expenses/[expenseId]/edit.astro`

**Intent**: Server-rendered page (protected like the group page) showing a form prefilled from the expense (same fields, validation attributes and date window as `ExpenseForm.astro`; the submit button is disabled while submitting, as in the add form) and a "Delete expense" disclosure whose confirm button posts to the delete endpoint. If `getEditableExpense` refuses, redirect to the group page with the error code.

#### 3. Expense list

**File**: `src/components/expenses/ExpenseList.astro` (and `src/pages/groups/[id].astro` to pass the period)

**Intent**: Show an "Edit" link on an expense only when `period.canEdit(expense, viewerId)`.

### Success Criteria:

#### Automated Verification:

- `npx astro check`, `npm run lint`, `npm run build` pass.

#### Manual Verification:

- As the author: edit title, amount and date; balances update; delete via confirmation (a repeated delete submit shows no error); the expense and its shares disappear and balances recompute.
- As another member: no Edit link; opening the edit URL redirects to the group page with the "not the author" message; a hand-sent POST is refused.
- Invalid amount on the edit page shows the message and keeps the user on the edit page.
- Two browsers editing the same period: the second save either retries transparently or shows "Someone else just changed this billing period".

**Implementation Note**: Pause for confirmation before Phase 4.

---

## Phase 4: Smoke, E2E and documentation

### Overview

End-to-end proof and keeping the docs and roadmap aligned.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing flow: the author edits their expense (balance changes), the second user's edit and delete POSTs are refused with exactly `?expenseError=not_expense_author` (the database backstop would answer `group_not_found`, so a looser assertion would not notice a removed aggregate check), the author deletes it (balances return to zero). Direct Data API call to `save_billing_period_changes` without the app key is refused.

#### 2. Playwright test

**File**: `tests/e2e/expense-delete-duplicate.spec.ts`

**Intent**: Using the seed and conventions from `tests/e2e/seed.spec.ts` (role/label locators, no `waitForTimeout`, unique ids): create a group, add the same expense twice, delete one through the confirmation, assert exactly one remains and the balance reflects one expense.

#### 3. Docs and roadmap

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`, `context/foundation/roadmap.md`

**Intent**: Update CLAUDE.md status and structure (new endpoints, page, `canEdit`, the new persistence function and the expand/contract leftover `save_billing_period`); replace the "Known limitation (accepted until S-05)" paragraph in deploy-plan with the delivered behaviour and the migration note; in the roadmap mark S-05 progress and record the S-08 handoff (the paid-debt lock extends `canEdit`; pair-vs-expense question still open). Board/issue sync per CLAUDE.md ("Closes #10" in the PR).

### Success Criteria:

#### Automated Verification:

- Smoke passes: `npm run smoke` (dev server + local Supabase running)
- E2E passes: `npx playwright test tests/e2e/expense-delete-duplicate.spec.ts`
- Deliberate break: removing the author check in the aggregate makes a unit test and the smoke step (which expects `not_expense_author`) fail.
- `npm test`, `npx astro check`, `npm run lint`, `npm run build` pass.

#### Manual Verification:

- Docs read correctly; roadmap and board statuses aligned.

---

## Testing Strategy

### Unit Tests:

- Aggregate and service rules listed in Phase 1, written before the code.
- Money: re-split of an odd amount keeps `sum(shares) = amount`.

### Integration Tests:

- `npm run smoke` against local Supabase (author/non-author, app-key gate).
- One Playwright test for the duplicate-removal scenario.

### Manual Testing Steps:

1. Add a 100,00 zł expense in a 3-member group, edit to 90,00 zł, check shares and balances.
2. Delete it and check balances return to zero.
3. Try edit and delete as the second member.

## Migration Notes

Expand only: the new function sits beside `save_billing_period`; the previously deployed Worker keeps working, and `wrangler rollback` is safe. `save_billing_period` joins the contract-migration backlog (with `add_expense` etc.), which still must land before S-09.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-05), PRD FR-005
- Prior change: `context/archive/2026-10-07-billing-period-aggregate/plan.md`
- Add pattern: `src/pages/api/groups/[id]/expenses.ts`, `src/lib/billing-periods/billing-period.service.ts:73`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain rules (TDD)

#### Automated

- [x] 1.1 Aggregate tests cover author edit/delete, non-author, closed period, unknown expense, date window, re-split between original sharers, share sum, edit-after-add and balances — 2153638
- [x] 1.2 Service tests cover retry once, period_changed, closed-meanwhile refusal and validation order — 2153638
- [x] 1.3 Unit tests pass: `npm test` — 2153638
- [x] 1.4 Types pass: `npx astro check` — 2153638
- [x] 1.5 Lint passes: `npm run lint` — 2153638

#### Manual

- [x] 1.6 Review the aggregate API: `canEdit` is the only place that decides editability — 2153638

### Phase 2: Persistence (expand migration) and repository

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:reset` — 2153638
- [x] 2.2 Types regenerated with no diff afterwards: `npm run db:types && git diff --exit-code src/db/database.types.ts` — 2153638
- [x] 2.3 Unit tests, `npx astro check` and `npm run lint` pass — 2153638

#### Manual

- [x] 2.4 `save_billing_period_changes` is executable by `authenticated` only and a direct call without `x-app-key` is refused (403) — 2153638

### Phase 3: Endpoints and UI

#### Automated

- [x] 3.1 `npx astro check`, `npm run lint`, `npm run build` pass — 2153638

#### Manual

- [x] 3.2 As the author: edit title, amount and date; balances update; delete via confirmation (a repeated delete submit shows no error); balances recompute — 2153638
- [x] 3.3 As another member: no Edit link, edit URL redirects with the not-the-author message, a hand-sent POST is refused — 2153638
- [x] 3.4 Invalid amount on the edit page shows the message and keeps the user on the edit page — 2153638
- [x] 3.5 Two browsers editing the same period: retry transparently or show "Someone else just changed this billing period" — 2153638

### Phase 4: Smoke, E2E and documentation

#### Automated

- [x] 4.1 Smoke passes: `npm run smoke` — 2153638
- [x] 4.2 E2E passes: `npx playwright test tests/e2e/expense-delete-duplicate.spec.ts` — 2153638
- [x] 4.3 Deliberate break: removing the author check in the aggregate makes a unit test and the smoke step (which expects `not_expense_author`) fail — 2153638
- [x] 4.4 `npm test`, `npx astro check`, `npm run lint`, `npm run build` pass — 2153638

#### Manual

- [x] 4.5 Docs read correctly; roadmap and board statuses aligned — 2153638
