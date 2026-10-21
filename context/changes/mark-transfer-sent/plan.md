# Mark a Transfer as Sent (S-07) Implementation Plan

## Overview

A debtor marks the transfer for one of their debts as sent (FR-008). The mark is a reminder, not a settlement. It records the amount the debtor sent and when, the debt stays open until the creditor confirms it (S-08), and the debtor can undo the mark. The mark is a new `Transfer` entity inside the `BillingPeriod` aggregate. The debtor and the creditor see it, along with whether it still matches the current debt.

Roadmap item S-07, GitHub issue [#12](https://github.com/adamgwozdz00/SplitDom/issues/12).

## Current State Analysis

- Debts are not stored. `PeriodBalances.of` derives one netted debt per pair of members from the period's expenses, every time it is called (`src/lib/billing-periods/period-balances.value.ts:32`). A "sent" mark therefore cannot hang off a debt row. It needs its own persistent record, and the debt it refers to can change afterwards when someone adds, edits or deletes an expense.
- `BillingPeriod` (`src/lib/billing-periods/billing-period.aggregate.ts`) is the consistency boundary for the period. It holds the expenses and tracks which were added, changed or removed since load (`newExpenses`, `changedExpenses`, `removedExpenseIds`), and it refuses changes to a closed period. The roadmap's F-02 notes leaned towards transfers and paid confirmations living here too, because S-08 locks edits and S-09 gates closing on them.
- `BillingPeriodService.change` (`src/lib/billing-periods/billing-period.service.ts:181`) runs a command on the open period and saves it through the version-guarded repository. A lost race is retried once on the reloaded period. Every new command reuses this.
- The repository loads through `get_current_billing_period` (`supabase/migrations/20261007075852_billing_period_aggregate.sql:105`) and saves through `save_billing_period_changes` (`supabase/migrations/20261019124131_edit_delete_expenses.sql`). The save bumps `version` only while it is unchanged and the period is open. It also has caller-scoping backstops: the caller writes only their own expenses.
- The debtor already sees one block per own debt in `TransferPanel` (`src/components/expenses/TransferPanel.astro`), holding the creditor, the amount and the copyable details. The panel renders nothing when the viewer owes nobody. The creditor sees their incoming debts only as lines in `BalancesPanel`'s "Debts" list.
- Form-POST endpoints follow `src/pages/api/groups/[id]/expenses/[expenseId]/delete.ts`. Each loads the group with `GroupService.getForMember`, calls the service, and redirects with only the error code in a query parameter. A repeated submit whose outcome already holds is not an error.
- `scripts/smoke.mjs` already runs two members of group A (one debtor, one creditor), a stranger, and direct RPC calls through `directRpc`.

## Desired End State

On the group page, under each of the viewer's own debts, the debtor sees one of:

- **Not marked**: a "Mark as sent" button. It records the amount shown on the page.
- **Marked, current**: "Marked as sent: 400,00 zł on Oct 20", with an "Undo" button.
- **Marked, outdated** (the debt changed since): "You marked 400,00 zł as sent on Oct 20 — the debt is now 450,00 zł", with "Mark 450,00 zł as sent" (it replaces the mark) and "Undo".

A mark whose debt is gone or reversed stays visible to the debtor, in the transfer panel even when they owe nobody: "You marked 400,00 zł as sent to B on Oct 20 — you no longer owe them". It keeps its "Undo" button.

The creditor sees a read-only "Marked as sent to you" list with each mark addressed to them: "A marked 400,00 zł as sent on Oct 20". When the mark no longer matches, the line says so: the debt is now X, or they no longer owe you. Members outside the pair see nothing about the mark. This is a page rule, not a data rule: `get_current_billing_period` loads all of the period's marks for every member of the group, like the expenses and debts all members already see. `sentTransfersInvolving` narrows them in TypeScript, and the app-key gate keeps members from reading the Data API directly. S-08 must not assume privacy at the database level. Adding, editing or deleting expenses never removes a mark. Marks can only be changed while the period is open.

Verify with `npm test`, `npm run db:reset && npm run db:types`, `npx astro check`, `npm run lint`, `npm run smoke`, plus a manual two-browser walkthrough of the three states.

### Key Discoveries:

- Netted debts are derived, never stored (`period-balances.value.ts:32-77`). The mark's state ("current", "outdated" or "no debt") is derived the same way, by comparing it to `balances().debts`.
- The service retries a command on the reloaded period after a version conflict (`billing-period.service.ts:181-193`). If the mark took its amount from the debt at save time, a retry after a concurrent expense would record an amount the debtor never saw. So the amount comes from the form.
- `get_current_billing_period` returns jsonb that the repository maps key by key (`billing-period.repository.ts:145`). Adding a `transfers` key through `create or replace` is invisible to the previously deployed Worker, so the migration stays expand-only.
- `save_billing_period_changes` cannot change its signature without breaking the deployed Worker. Overloading it by name with extra parameters risks PostgREST ambiguity. A new function with a new name is the established pattern: `save_billing_period` was replaced by `save_billing_period_changes` in the same way.
- Group tables reference members through `(group_id, user_id) → group_members` without cascades (`supabase/migrations/20261005190331_expenses.sql:30-48`). Periods are referenced through `(period_id, group_id) → billing_periods (id, group_id) on delete cascade`.

## What We're NOT Doing

- Confirming a debt as paid, the paid-debt edit lock, or blocking undo after confirmation. That is S-08, which extends the same `Transfer` entity.
- Partial payments: a mark never reduces the debt or the balances. Balances stay derived from expenses only.
- Marks in a closed period (the aggregate refuses them), and showing leftover debts after closing. Both belong to S-09.
- Notifying the creditor (no email or push). They see the mark on the group page.
- A history of marks: one mark per pair per period, and re-marking replaces it.
- Marking a debt above 1 000 000,00 zł. The posted amount goes through `Money.parse`, which applies the expense limit (`money.value.ts:13`), so such a debt gets `invalid_amount`. This is unrealistic for a household and accepted.
- Display names (S-10). Members are still labelled by `memberLabel`.
- A Playwright E2E spec. Coverage is Vitest plus the smoke test, as in S-05 and S-06.
- The contract migration that drops `save_billing_period_changes` and the other leftovers.

## Implementation Approach

Domain first, test-first. Phase 1 adds the `Transfer` entity, the mark and undo commands, and the state derivation to `BillingPeriod`, plus two service methods. All of it is driven by Vitest against the in-memory harness, with no database involved. Phase 2 adds the table and the two persistence functions and maps them in the repository. Phase 3 adds the endpoints and the UI, extends the smoke test and updates the docs.

Decisions (from planning):

1. The mark lives inside `BillingPeriod` and is saved in the same version-guarded call as expenses.
2. The mark stores the amount sent. It is shown as outdated when the debt differs, and the debtor can re-mark the new amount.
3. The debtor can undo the mark while the period is open.
4. The debtor and the creditor of the pair see the mark. Nobody else does.
5. A mark without a matching debt stays visible, marked as having no debt.
6. Testing is Vitest plus smoke.

## Critical Implementation Details

- **The amount comes from the form, not from the debt at save time.** The form posts the debt amount the page showed. `markTransferSent` checks that the debtor owes the creditor something now, then records the posted amount. On a version-conflict retry the same posted amount is recorded. If the debt moved meanwhile, the mark simply shows as outdated, which is the truth: the debtor sent what they saw.
- **Re-marking keeps the row identity.** A second mark for the same pair replaces the amount and `sentAt` of the existing `Transfer`. The row is upserted on `(period_id, debtor_id, creditor_id)` and keeps its id. A re-mark with the same amount is a no-op, so a repeated submit does not move `sentAt`.
- **`TransferPanel` must render for marks without a debt.** Today it renders nothing when the viewer has no debts. After this change it also renders when the viewer has a mark in the "no debt" state.

## Phase 1: Transfer marks in the BillingPeriod aggregate (test-first)

### Overview

The domain model of the mark: a `Transfer` entity, the commands to mark and undo it, the derived state against the current debts, error codes, and service methods. Tests are written before the code.

### Changes Required:

#### 1. Transfer entity

**File**: `src/lib/billing-periods/transfer.entity.ts` (new)

**Intent**: The debtor's record that they sent `amount` to `creditorId` at `sentAt`. It answers whether it still matches the current debts, and it formats its own date.

**Contract**: `Transfer` with `id`, `debtorId`, `creditorId`, `amount: Money`, `sentAt: Date`, plus `restore(snapshot)` and `toSnapshot()`. `restore` throws when the debtor equals the creditor or the amount is not positive. `replace({ amount, sentAt })` returns a copy with the same id. `stateAgainst(debts: readonly PairDebt[])` returns `{ state: "current" | "outdated" | "no_debt", debt: PairDebt | null }`, where "current" means a debt from `debtorId` to `creditorId` with an equal amount, "outdated" means one with a different amount, and "no_debt" means no debt in that direction. `sentOnLabel()` gives the Warsaw calendar day of `sentAt` as "Oct 20". The entity owns its formatter (`Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", month: "short", day: "numeric" })`). `PurchaseDate.label()` formats a stored day in UTC as "Oct 20, 2026" and cannot take an instant, and its `todayInWarsaw` is private, so neither is reused and no shared date helper is added. S-08 will add the creditor's confirmation to this entity.

#### 2. BillingPeriod commands and queries

**File**: `src/lib/billing-periods/billing-period.aggregate.ts`

**Intent**: The period holds its transfers next to its expenses, applies the mark and undo rules, and tracks what the repository has to store. Expense commands never touch transfers.

**Contract**:

- `BillingPeriodState` and `restore` take `transfers`.
- `markTransferSent({ id, debtorId, creditorId, amount: Money, now }): Result<Transfer>` refuses, in this order: a closed period (`billing_period_closed`), a debtor who is not a participant (`group_not_found`), and no current debt from the debtor to the creditor (`no_debt_to_mark`). That last check covers a creditor marking for their debtor, a reversed debt, a settled pair and self-marking. An existing mark for the pair with the same amount is returned unchanged. With a different amount it is replaced, keeping its id. Otherwise a new mark is created with `id`.
- `undoTransferSent({ debtorId, creditorId }): Result<void>` refuses a closed period (`billing_period_closed`) and returns `transfer_not_found` when there is no mark for the pair.
- `sentTransferOf(debtorId, creditorId)` returns the pair's mark or null.
- `sentTransfersInvolving(userId)` returns `{ transfer, state, debt }[]` for marks where `userId` is the debtor or the creditor, with the state derived against `balances().debts`.
- `markedTransfers()` and `unmarkedTransferIds()` return the pending writes, like `newExpenses()` and `removedExpenseIds()`. Undoing a mark created since load drops it from `markedTransfers()` without adding an unmark.
- `toSnapshot()` includes the transfers.

#### 3. Types, errors and public API

**Files**: `src/lib/billing-periods/types.ts`, `src/lib/billing-periods/billing-period-error.messages.ts`, `src/lib/billing-periods/index.ts`

**Intent**: Persistence shape and error codes for the mark, exported for the page and the endpoints.

**Contract**:

- `TransferSnapshot { id, debtorId, creditorId, amount: number /* grosze */, sentAt: string /* UTC ISO */ }`, and `BillingPeriodSnapshot.transfers: TransferSnapshot[]`.
- New `BillingPeriodErrorCode`s with their messages:
  - `no_debt_to_mark`: "You don't owe this member anything right now, so there is nothing to mark as sent"
  - `transfer_not_found`: "This transfer is not marked as sent"
- `index.ts` exports `Transfer` and the `TransferState` type.

#### 4. Service methods

**File**: `src/lib/billing-periods/billing-period.service.ts`

**Intent**: The entry points for the endpoints, retried on a lost race like the expense commands.

**Contract**:

- `markTransferSent({ group, debtorId, creditorId, amount: string }): Promise<Result<void>>` parses the amount with `Money.parse` (`invalid_amount` on failure), generates the id once, and runs the command through `change`, so a retry records the same posted amount.
- `undoTransferSent({ group, debtorId, creditorId }): Promise<Result<void>>` runs through `change`.

#### 5. Tests and harness

**Files**: `src/lib/billing-periods/__tests__/transfer.entity.test.ts` (new), `__tests__/billing-period.aggregate.test.ts`, `__tests__/billing-period.service.test.ts`, `__tests__/billing-periods.harness.ts`

**Intent**: Drive the rules test-first. The in-memory repository stores and restores transfers and applies `markedTransfers` and `unmarkedTransferIds` on save.

**Contract**: The cases are listed under Testing Strategy. The harness snapshot gains `transfers`, and so does the hand-written `BillingPeriodSnapshot` literal in `billing-period.aggregate.test.ts` (the `BillingPeriod.restore` describe, around line 151).

#### 6. Repository stays compatible until Phase 2

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: Phase 1 makes `transfers` a required part of the snapshot. Until the migration returns them, the repository's `toSnapshot` sets `transfers: []`, so `astro check` passes and group pages keep loading. Phase 2 replaces this line with the real mapping. The repository's `save` is unchanged in this phase, so a mark is not persisted until Phase 2, and no endpoint calls it yet.

**Contract**: `toSnapshot(value)` returns `transfers: []`. Nothing else in the repository changes in Phase 1.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new transfer cases: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Test names read as the rules (current, outdated and no-debt states; a creditor cannot mark; a retry records the posted amount)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Persistence of transfer marks

### Overview

The `transfers` table, a load that returns the period's transfers, and one version-guarded save that stores expenses and transfers together. The repository maps all of it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_transfers.sql` (new, via `npm run db:new transfers`)

**Intent**: Store the marks the aggregate makes, with structural backstops only. The migration is expand-only: the previously deployed Worker keeps working.

**Contract**:

- **Table `public.transfers`**:
  - Columns: `id uuid primary key`, `group_id`, `period_id`, `debtor_id`, `creditor_id`, `amount integer not null check (amount > 0)`, `sent_at timestamptz not null`.
  - Constraints: `check (debtor_id <> creditor_id)`, `unique (period_id, debtor_id, creditor_id)`.
  - Foreign keys: `(period_id, group_id) → billing_periods (id, group_id) on delete cascade`; `(group_id, debtor_id)` and `(group_id, creditor_id) → group_members (group_id, user_id)` with no cascade.
  - Row-level security enabled with no policies; all grants revoked from `anon` and `authenticated`.
- **`get_current_billing_period(uuid)`**: changed with `create or replace` (same signature) to add a `transfers` key, an array of `{id, debtor_id, creditor_id, amount, sent_at}` (`[]` when there are none).
- **New `public.save_billing_period_with_transfers(p_period_id uuid, p_group_id uuid, p_expected_version integer, p_added jsonb, p_changed jsonb, p_removed uuid[], p_marked jsonb, p_unmarked uuid[]) returns boolean`**:
  - It does everything `save_billing_period_changes` does (membership check, payer backstops, the conditional version bump while open, expense writes).
  - It adds a backstop: every marked row has `debtor_id = auth.uid()`, and every unmarked id is a transfer of this period whose debtor is the caller. Otherwise it raises `42501`. Both transfer backstops run after the payer backstops and **before** the version bump, as all backstops do in `save_billing_period_changes`. A caller with a stale or random version therefore still gets `42501`, not `false`.
  - It upserts the marked rows on `(period_id, debtor_id, creditor_id)`, updating `amount` and `sent_at` and keeping the existing id, then deletes the unmarked ids.
  - Setup: `security definer`, `set search_path = ''`, execute revoked from `public, anon` and granted to `authenticated`, with the "Persistence only" comment.
- `save_billing_period_changes` stays untouched for the old Worker.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate after the migration (`npm run db:reset && npm run db:types`). Never edit it by hand.

#### 3. Repository mapping

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: Load transfers into the snapshot, and save through the new function with the marked and unmarked transfers.

**Contract**:

- `toSnapshot` replaces Phase 1's `transfers: []` with the real mapping. It requires `period.transfers` to be an array, and a malformed transfer surfaces as `unexpected`, like a malformed expense.
- `save` calls `save_billing_period_with_transfers`, passing `p_marked` as snake_case rows from `markedTransfers()` and `p_unmarked` from `unmarkedTransferIds()`.
- The `42501` comment in `fromDbError` also mentions the transfer backstop.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh database: `npm run db:reset`
- Generated types are up to date and committed: `npm run db:types` leaves no diff after commit
- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Existing smoke flows still pass (add, edit and delete expense, transfer details): `npm run smoke`

#### Manual Verification:

- In Supabase Studio, `transfers` shows RLS enabled with no policies, and `anon`/`authenticated` have no table grants

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Endpoints, UI, smoke and docs

### Overview

The debtor marks and undoes from the transfer panel, and the creditor sees the marks addressed to them. The smoke test proves the two-user flow and the database backstop. The docs describe the new feature.

### Changes Required:

#### 1. Endpoints

**Files**: `src/pages/api/groups/[id]/transfers/sent.ts` (new), `src/pages/api/groups/[id]/transfers/undo.ts` (new)

**Intent**: Form POSTs following `expenses/[expenseId]/delete.ts`. The caller is always the debtor (`locals.user.id`), so a member can never mark on someone else's behalf.

**Contract**:

- `sent.ts` reads the form fields `creditorId` and `amount` and calls `markTransferSent`.
- `undo.ts` reads `creditorId` and calls `undoTransferSent`. A `transfer_not_found` is treated as success, because a repeated undo already has the outcome the debtor asked for.
- Both redirect to `/groups/<id>`. On failure they add `?transferError=<code>`, with the code only.

#### 2. Debtor's transfer panel

**File**: `src/components/expenses/TransferPanel.astro`

**Intent**: Each own-debt block shows the mark state and its buttons. Marks without a debt get their own blocks. The panel renders when there is a debt or a mark.

**Contract**:

- New props: `marks` (the viewer's marks as debtor, from `period.sentTransfersInvolving(viewerId)`) and `error: string | null`.
- Per debt:
  - With no mark, a "Mark as sent" form posting `creditorId` and `amount = debt.amount.formInput()`.
  - With a current mark, the status line and an "Undo" form.
  - With an outdated mark, the outdated line, a "Mark <new amount> as sent" form and "Undo".
- Each mark in the "no debt" state gets a block with the no-longer-owe line and "Undo".
- The error is shown with `role="alert"`. Buttons are `type="submit"` inside plain forms, so the panel works without JavaScript.

#### 3. Creditor's view

**File**: `src/components/expenses/SentToYouPanel.astro` (new)

**Intent**: A read-only "Marked as sent to you" list for the marks where the viewer is the creditor. It shows nothing when there are none.

**Contract**:

- Props: `group`, `viewerId`, `marks` (the viewer's marks as creditor).
- Each line reads "<debtor> marked <amount> as sent on <date>". An outdated mark adds "— they owe you <debt amount> now", and a mark with no debt adds "— they no longer owe you".

#### 4. Group page wiring

**File**: `src/pages/groups/[id].astro`

**Intent**: Pass the viewer's marks and the `transferError` message to both panels. Caching is unchanged: account numbers already decide `no-store`.

**Contract**:

- Split `open.period.sentTransfersInvolving(user.id)` into debtor marks and creditor marks.
- Render the `transferError` query value only through `billingPeriodErrorMessage(code)`.

#### 5. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Prove the two-user flow and the backstop against a running server.

**Contract**: In group A the first user is the debtor (owes 300,00) and the second user is the creditor. The second user later deletes the only expense (step "the author deletes the expense", around line 508), which removes the debt. The smoke uses one cookie jar, so the new steps fit into the existing sign-in order:

1. Right after "the debtor sees the creditor's transfer details" (around line 468), with the debtor signed in: the debtor marks the transfer as sent, and their group page shows "Marked as sent".
2. After "second user signs in again" (around line 503), before the delete:
   - The creditor's group page shows "Marked as sent to you" with the debtor's mark.
   - The creditor posting `sent` with `creditorId = <debtor's user id>` is redirected with `transferError=no_debt_to_mark`. Take the id from `authSession(email).userId`; the smoke does not capture it yet.
   - A direct `save_billing_period_with_transfers` call by the creditor (`authSession(email2)` + `directRpc` with the valid `x-app-key`) with a marked row whose `debtor_id` is the debtor gets `status: 403` with `bodyContains('"code":"42501"')`.
3. After the delete and "second user signs out again" (around line 528), the debtor signs in again:
   - The group page shows the "you no longer owe them" state with Undo.
   - The debtor undoes the mark, and the page no longer shows it.
   - A repeated undo redirects to the group page without `transferError`.

#### 6. Docs

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: Describe the feature and the new database objects.

**Contract**:

- `CLAUDE.md`:
  - Status paragraph: marking transfers sent exists; confirming paid and closing are still to be built.
  - Structure: the `api/groups/[id]/transfers/` endpoints, the `Transfer` entity and `SentToYouPanel`.
  - Database changes: `save_billing_period_with_transfers` replaces `save_billing_period_changes`, which joins the expand/contract leftovers. Closing a period (S-09) must still bump `version`.
  - Commands: the `npm run smoke` description mentions the sent-mark steps.
- `deploy-plan.md`: a new "Transfer marks (S-07)" section. The migration is expand-only and needs no Supabase or Cloudflare configuration change.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes, including the new sent-mark steps: `npm run smoke`

#### Manual Verification:

- Two browsers (debtor and creditor): the debtor marks, sees "Marked as sent" and the creditor sees "Marked as sent to you"
- The creditor adds an expense: the debtor sees the outdated line and re-marks the new amount, and the creditor's line follows
- The debtor adds an expense that reverses the debt: both see the "no longer owe" state, and the debtor undoes it
- A third member of the group sees no mark of the pair
- The panels read well at phone width (NFR-1)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `Transfer`:
  - `restore` refuses debtor = creditor and a non-positive amount.
  - `stateAgainst` returns current, outdated (debt larger or smaller), and no_debt (no debt, or the debt reversed).
  - `sentOnLabel` uses the Warsaw day: a mark at 23:30 UTC on Oct 20 shows "Oct 21".
- `BillingPeriod.markTransferSent`:
  - It records the posted amount, not the current debt.
  - It refuses a closed period, a debtor who is not a participant, and a creditor marking for their debtor (`no_debt_to_mark`). It also refuses a settled pair and self-marking.
  - A re-mark with a different amount keeps the id and appears in `markedTransfers()`. A re-mark with the same amount changes nothing.
- `BillingPeriod.undoTransferSent`:
  - It removes a loaded mark (listed in `unmarkedTransferIds()`) and a mark added since load (it leaves no pending write).
  - It returns `transfer_not_found` for a missing mark and refuses a closed period.
- `sentTransfersInvolving`:
  - It returns the marks of the debtor and of the creditor, and nothing for a third member.
  - Adding, editing or removing an expense leaves the marks and only changes their state.
- `BillingPeriodService`:
  - `markTransferSent` returns `invalid_amount` for an unparseable amount.
  - After a version conflict with a concurrent expense, the retry records the posted amount and the mark reads as outdated.
  - `undoTransferSent` is retried like the other commands, and `period_changed` comes after two conflicts.

### Integration Tests:

- `npm run smoke`: the steps in Phase 3, section 5, against local Supabase and the running server.

### Manual Testing Steps:

1. As the debtor, mark the transfer sent. Check the status line and the Undo button.
2. As the creditor, check "Marked as sent to you". Add an expense, then check the debtor's outdated line and re-mark.
3. As the debtor, add an expense that reverses the debt. Check the "no longer owe" state on both sides, then undo.
4. As a third member, check that nothing about the pair's mark is shown.

## Performance Considerations

The period load gains one subquery over `transfers`, at most one row per pair of members. That is negligible for household-sized groups.

## Migration Notes

The migration is expand-only. The new table and the new function are additions, and `get_current_billing_period` only gains a jsonb key that the old Worker ignores. The old Worker keeps calling `save_billing_period_changes`, which still works and does not touch transfers. `save_billing_period_changes` joins the expand/contract leftovers awaiting the contract migration.

## References

- Roadmap: `context/foundation/roadmap.md` (S-07, F-02 unknowns), issue [#12](https://github.com/adamgwozdz00/SplitDom/issues/12)
- PRD: `context/foundation/prd.md` FR-008, FR-009, FR-005
- Previous slices: `context/archive/2026-10-19-edit-own-expense-rules/plan.md` (version-guarded save of changes), `context/archive/2026-10-19-generate-transfer-details/plan.md` (`TransferPanel`)
- Patterns: `src/lib/billing-periods/billing-period.service.ts:181` (change and retry), `src/pages/api/groups/[id]/expenses/[expenseId]/delete.ts` (form POST), `supabase/migrations/20261019124131_edit_delete_expenses.sql` (persistence function with backstops)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Transfer marks in the BillingPeriod aggregate (test-first)

#### Automated

- [x] 1.1 Unit tests pass, including the new transfer cases: `npm test` — 6afdcfe
- [x] 1.2 Type checking passes: `npx astro check` — 6afdcfe
- [x] 1.3 Linting passes: `npm run lint` — 6afdcfe

#### Manual

- [x] 1.4 Test names read as the rules (current, outdated and no-debt states; a creditor cannot mark; a retry records the posted amount) — 6afdcfe

### Phase 2: Persistence of transfer marks

#### Automated

- [x] 2.1 Migration applies on a fresh database: `npm run db:reset`
- [x] 2.2 Generated types are up to date and committed: `npm run db:types` leaves no diff after commit
- [x] 2.3 Unit tests still pass: `npm test`
- [x] 2.4 Type checking passes: `npx astro check`
- [x] 2.5 Linting passes: `npm run lint`
- [x] 2.6 Existing smoke flows still pass (add, edit and delete expense, transfer details): `npm run smoke`

#### Manual

- [x] 2.7 In Supabase Studio, `transfers` shows RLS enabled with no policies, and `anon`/`authenticated` have no table grants

### Phase 3: Endpoints, UI, smoke and docs

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Production build succeeds: `npm run build`
- [ ] 3.5 Smoke test passes, including the new sent-mark steps: `npm run smoke`

#### Manual

- [ ] 3.6 Two browsers (debtor and creditor): the debtor marks, sees "Marked as sent" and the creditor sees "Marked as sent to you"
- [ ] 3.7 The creditor adds an expense: the debtor sees the outdated line and re-marks the new amount, and the creditor's line follows
- [ ] 3.8 The debtor adds an expense that reverses the debt: both see the "no longer owe" state, and the debtor undoes it
- [ ] 3.9 A third member of the group sees no mark of the pair
- [ ] 3.10 The panels read well at phone width (NFR-1)
