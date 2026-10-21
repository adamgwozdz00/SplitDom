# Mark a Transfer as Sent (S-07) Implementation Plan, v2: Payment Ledger

## Overview

A debtor records a bank transfer they sent to a creditor (FR-008). The plan gives this a new model. A transfer becomes a **payment**: an entry in the period's ledger, next to the expenses, and payments count in the balances. The domain derives two balances, following the pending vs posted pattern of money ledgers:

- **Pending balances**: expenses plus every payment not withdrawn. The page shows these, and labels any payment still awaiting confirmation.
- **Posted balances**: expenses plus confirmed payments only. Rules use these: S-08's confirmation and S-09's closing condition.

The displayed debt always matches the money that has actually moved, so the debtor is never offered an amount they have already paid.

Roadmap item S-07, GitHub issue [#12](https://github.com/adamgwozdz00/SplitDom/issues/12). This plan replaces v1 (`plan-v1.md`, `plan-brief-v1.md`). Phases 1–2 of v1 landed on the branch and are reworked by Phase 3. v1's Phase 3 was never committed.

## Current State Analysis

**Why v1 failed.** v1 modelled a "sent" mark as one mutable record per pair, outside the balances: it stored the total sent so far and was replaced on re-marking. Manual testing of v1's Phase 3 broke it:

1. A pays 200 zł, so B owes A 100 zł.
2. B marks 100 zł as sent.
3. A pays 100 zł. The debt shows 150 zł although only 50 zł is left.
4. B marks the rest, so the mark becomes 150 zł.
5. B pays 300 zł. Expense balances net to 0, so the app shows "settled", while in reality **A owes B 150 zł**.

Money that moved disappears from the accounts once the debt changes direction. The external research (`external-research.md`) finds the same archetype everywhere: Fowler's accounting patterns, Square, Stripe and Modern Treasury ledgers, and Splitwise and Tricount settlements. A repayment is an entry in the same ledger as the expenses, and balances are computed over both.

**What exists on the branch** (`feat/mark-transfer-sent`):

- `6afdcfe` (v1 Phase 1): a `Transfer` entity (`src/lib/billing-periods/transfer.entity.ts`), `markTransferSent`, `undoTransferSent` and `sentTransfersInvolving` in `BillingPeriod`, service methods, and the error codes `no_debt_to_mark` and `transfer_not_found`.
- `a649cee` (v1 Phase 2): migration `supabase/migrations/20261020111415_transfers.sql` (table `transfers` with `unique (period_id, debtor_id, creditor_id)`, `get_current_billing_period` returning `transfers`, `save_billing_period_with_transfers`), regenerated types, and the repository mapping.
- Uncommitted (v1 Phase 3, staged): the `transfers/sent.ts` and `undo.ts` endpoints, `TransferPanel` states with a "remaining amount" workaround, `SentToYouPanel`, smoke steps, and doc edits.

**Code facts the plan relies on:**

- `PeriodBalances.of({ memberIds, expenses })` (`src/lib/billing-periods/period-balances.value.ts:32`) builds per-member balances and an `owed[debtor][creditor]` matrix, then nets each pair. A payment from B to A fits as one more term: `balance[B] += X`, `balance[A] -= X`, `owed[A][B] += X`. Netting then gives the right answer without any other change.
- `BillingPeriodService.change` (`billing-period.service.ts`) retries a command once on the reloaded period after a version conflict, so every command must be safe to re-run.
- The migration `20261020111415_transfers.sql` has **not** been pushed to production (it is on an unmerged branch), so it can be rewritten in place. The forward-only rule applies to pushed migrations.
- The group page loads every period row for every member. Expenses and balances are visible to the whole group (`src/pages/groups/[id].astro`).

## Desired End State

- On the group page each member sees **pending** balances and debts, which count every payment not withdrawn. When a debt or balance includes a payment awaiting confirmation, it says so.
- Under each own debt, the debtor sees the transfer details. The amount is the current pending debt, and a "Mark as sent" form holds an amount field prefilled with that debt. A smaller amount is a partial payment. A larger one is refused with `payment_exceeds_debt`.
- After a payment covers the debt, the debt (and its transfer block) disappears, because the debt is now really settled pending confirmation.
- A **Payments** list on the group page shows every payment of the period, newest first, to every member: date, sender → recipient, amount and status ("awaiting confirmation" or "confirmed"). The sender of an unconfirmed payment has a "Withdraw" button.
- Re-running the v1 scenario gives "A owes B 150,00 zł" at the end.
- Confirming or rejecting a payment (the creditor's side) is not built yet. The data model and the posted balances are ready for S-08.

Verify with `npm test` (including the v1 scenario as a unit test), `npm run db:reset && npm run db:types`, `npx astro check`, `npm run lint`, `npm run build`, `npm run smoke`, and a manual two-browser run of the scenario.

### Key Discoveries:

- The netting in `PeriodBalances` stays as it is. Payments enter as one extra loop over the same matrix (`period-balances.value.ts:41-60`).
- The retry in `change` makes "same `paymentId` again" the natural idempotency key. A double submit and a retry after a conflict are the same case.
- `creditorIdsOf` (`transfer-details.value.ts`) reads debts from the balances it is given. Passing the pending balances keeps account-number visibility tied to current debts.
- `TransferDetails.of` takes the amount to show, so the pending debt goes in unchanged.

## What We're NOT Doing

- The creditor confirming or rejecting a payment, and the paid-debt lock of FR-005 (S-08). S-08 also decides whether that lock is still needed now that payments live in the ledger.
- Closing a period (S-09). Its rule "the host's debts are paid" will use the posted balances.
- Recording an overpayment. A payment above the current pending debt is refused. A real bank overpayment would need a correction that S-08 or later can add.
- Editing a payment. A mistake is undone by withdrawing the unconfirmed payment and recording a new one. Confirmed payments are permanent (S-08).
- Payments in a closed period, and payments across periods.
- Notifications, payment methods or rails (cash or bank), and minimal-transfers simplification (FR-006).
- A Playwright E2E spec. Coverage is Vitest plus the smoke test.
- The contract migration that drops the expand/contract leftovers.

## Implementation Approach

Domain and persistence move together in one phase, so no phase leaves a temporary workaround in the repository (the lesson of v1's review finding F1). The domain is driven test-first, and the v1 failure scenario is a named unit test. Phase 4 rebuilds the UI from the stashed v1 Phase 3 work. Phase 5 updates the documents that define the behaviour (PRD, roadmap, CLAUDE.md) and the GitHub issues.

Decisions (v2 planning, 2026-10-21):

1. Payments are ledger entries counted in balances. The page shows **pending** balances; rules use **posted** balances (variant (c) of `external-research.md`).
2. S-07 builds the full payment model (status, `confirmedAt`, posted balances) and the sender's actions (send, withdraw). The creditor's confirm and reject actions stay in S-08.
3. The amount field is prefilled with the current pending debt. Partial payments are allowed, and an amount above the current pending debt is refused.
4. Every member of the group sees payments, like expenses. This reverses v1's "pair only", because payments now change balances that everyone sees.
5. A Payments list replaces v1's creditor panel and "no longer owe" blocks.
6. Testing is Vitest (test-first) plus smoke.

## Critical Implementation Details

- **Idempotency through the form's `paymentId`.** The group page renders a fresh UUID into each "Mark as sent" form. `sendPayment` returns the existing payment unchanged when the period already holds a payment with that id from the same sender, so a double submit or a retry never records twice. A malformed id is refused before the aggregate.
- **The cap is checked against the reloaded period.** On a version-conflict retry, the same payment is judged against the debt as it is now. If a concurrent expense or payment shrank the debt below the amount, the retry is refused with `payment_exceeds_debt` instead of overpaying.
- **Stash v1's Phase 3 first.** Before Phase 3 starts, the staged and uncommitted v1 Phase 3 code goes into `git stash` (the planning documents stay). Phase 3's gates then run on the Phase 2 code plus Phase 3 only, and Phase 4 takes what it needs from the stash.

## Phase 1: Transfer marks in the BillingPeriod aggregate (test-first)

### Overview

Delivered in v1 (`6afdcfe`); see `plan-v1.md`. Its `Transfer` model (one mark per pair, outside the balances) is replaced by Phase 3.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new transfer cases: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Test names read as the rules (current, outdated and no-debt states; a creditor cannot mark; a retry records the posted amount)

---

## Phase 2: Persistence of transfer marks

### Overview

Delivered in v1 (`a649cee`); see `plan-v1.md`. Its migration is rewritten in place by Phase 3. It has not been pushed to production.

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

---

## Phase 3: Payment ledger, domain and persistence (test-first)

### Overview

Replace the per-pair mark with `Payment` entries, count payments in pending and posted balances, add the send and withdraw commands, and persist payments through a rewritten migration and repository. Tests are written first, starting with the v1 failure scenario.

### Changes Required:

#### 0. Set aside v1's Phase 3

**Intent**: Stash the staged and uncommitted v1 Phase 3 code changes (endpoints, components, page, smoke, CLAUDE.md, deploy-plan) so this phase runs on the committed Phase 2 code. The planning documents in `context/changes/mark-transfer-sent/` are not stashed.

**Contract**: The stash is named `mark-transfer-sent v1 phase 3`. Phase 4 reads from it and drops it at the end.

#### 1. Payment entity (replaces Transfer)

**File**: `src/lib/billing-periods/payment.entity.ts` (new; `transfer.entity.ts` and its test are deleted)

**Intent**: One bank transfer the sender reports having made to the recipient. It is an entry in the period's ledger.

**Contract**:

- `Payment` holds `id`, `senderId`, `recipientId`, `amount: Money`, `sentAt: Date` and `confirmedAt: Date | null`.
- `restore(snapshot)` and `toSnapshot()`. `restore` throws when the sender equals the recipient, when the amount is not positive, or when `confirmedAt` is earlier than `sentAt`.
- `isConfirmed()`.
- `sentOnLabel()`: the Warsaw day as "Oct 20", using the entity's own `Intl.DateTimeFormat` (as v1's `Transfer` did).

#### 2. Balances count payments

**File**: `src/lib/billing-periods/period-balances.value.ts`

**Intent**: A payment from B to A moves the pair towards A owing B. Balances and netted debts include it.

**Contract**:

- `PeriodBalances.of({ memberIds, expenses, payments })`, where `payments: readonly { senderId; recipientId; amount }[]` defaults to none.
- For each payment between members: `balance[sender] += amount`, `balance[recipient] -= amount`, and `owed[recipient][sender] += amount`.
- Payments involving a non-member are ignored, like expense shares.
- The existing invariant still holds: each balance equals its incoming debts minus its outgoing debts.

#### 3. BillingPeriod ledger commands and the two balances

**File**: `src/lib/billing-periods/billing-period.aggregate.ts`

**Intent**: The period holds its payments next to its expenses, judges send and withdraw, and derives the pending and posted balances. The v1 transfer methods are removed.

**Contract**:

- State and `restore` take `payments`, and `toSnapshot()` includes them.
- `pendingBalances()` counts expenses plus all payments. `postedBalances()` counts expenses plus confirmed payments only. Both replace `balances()`, and every caller is updated.
- `sendPayment({ id, senderId, recipientId, amount: Money, now }): Result<Payment>`:
  - An existing payment with this `id` from the same sender is returned unchanged (idempotent). One from another sender gives `unexpected`.
  - Otherwise it refuses, in this order:
    1. a closed period (`billing_period_closed`);
    2. a sender who is not a participant (`group_not_found`);
    3. no pending debt from the sender to the recipient (`no_debt_to_pay`), which also covers a non-participant recipient and paying oneself;
    4. an amount above that pending debt (`payment_exceeds_debt`).
  - Several payments per pair are allowed.
- `withdrawPayment({ paymentId, userId }): Result<void>` refuses, in this order:
  1. a closed period (`billing_period_closed`);
  2. an unknown payment (`payment_not_found`);
  3. a payment someone else sent (`not_payment_sender`);
  4. a confirmed payment (`payment_confirmed`).
- `sentPayments()` and `withdrawnPaymentIds()` are the pending writes for the repository. Withdrawing a payment sent since load drops it without a write.
- `paymentsNewestFirst()` orders by `sentAt`, then by id.

#### 4. Types, errors, transfer details and public API

**Files**: `src/lib/billing-periods/types.ts`, `billing-period-error.messages.ts`, `transfer-details.value.ts`, `index.ts`

**Intent**: The persistence shape and error codes of payments. Remove the v1 transfer types and codes.

**Contract**:

- `PaymentSnapshot { id, senderId, recipientId, amount /* grosze */, sentAt, confirmedAt: string | null }`, and `BillingPeriodSnapshot.payments` replaces `transfers`.
- New codes with their messages:
  - `no_debt_to_pay`: "You don't owe this member anything right now"
  - `payment_exceeds_debt`: "The amount is more than you owe this member right now"
  - `payment_not_found`: "Payment not found"
  - `not_payment_sender`: "Only the member who sent a payment can withdraw it"
  - `payment_confirmed`: "A confirmed payment can no longer be withdrawn"
- `no_debt_to_mark` and `transfer_not_found` are removed.
- `index.ts` exports `Payment`. The `Transfer` exports are removed.
- `creditorIdsOf` is unchanged; it is given the pending balances.

#### 5. Service

**File**: `src/lib/billing-periods/billing-period.service.ts`

**Intent**: Entry points for the endpoints and the page, retried like the expense commands.

**Contract**:

- `sendPayment({ group, senderId, recipientId, paymentId: string, amount: string }): Promise<Result<void>>`. It refuses a `paymentId` that is not a UUID (`unexpected`) and parses the amount with `Money.parse` (`invalid_amount`), then runs the command through `change`.
- `withdrawPayment({ group, userId, paymentId })` runs through `change`.
- `summarizeOpen` returns `{ period, expenses, balances /* pending */, postedBalances, payments /* newest first */ }`.
- `markTransferSent` and `undoTransferSent` are removed.

#### 6. Migration, rewritten in place

**File**: `supabase/migrations/20261020111415_transfers.sql`, renamed to `20261020111415_payments.sql`

**Intent**: Store payments with structural backstops. The migration is still expand-only towards production, where it has never run.

**Contract**:

- **Table `public.payments`**:
  - Columns: `id uuid primary key`, `group_id`, `period_id`, `sender_id`, `recipient_id`, `amount integer check (amount > 0)`, `sent_at timestamptz not null`, `confirmed_at timestamptz null`.
  - Constraints: `check (sender_id <> recipient_id)` and `check (confirmed_at is null or confirmed_at >= sent_at)`. There is no per-pair uniqueness.
  - Foreign keys: `(period_id, group_id) → billing_periods on delete cascade`; `(group_id, sender_id)` and `(group_id, recipient_id) → group_members`, with no cascade.
  - Row-level security enabled with no policies; all grants revoked from `anon` and `authenticated`.
- **`get_current_billing_period`** (`create or replace`) returns `payments`: `[{id, sender_id, recipient_id, amount, sent_at, confirmed_at}]`.
- **`save_billing_period_with_payments(p_period_id, p_group_id, p_expected_version, p_added, p_changed, p_removed, p_sent jsonb, p_withdrawn uuid[]) returns boolean`**:
  - It keeps the expense backstops and writes of `save_billing_period_changes`.
  - New backstops raise `42501` **before** the version bump:
    - every sent row has `sender_id = auth.uid()` and `confirmed_at` null;
    - every withdrawn id is an unconfirmed payment of this period sent by the caller.
  - It inserts the sent rows and deletes the withdrawn ones.
  - Setup: `security definer`, `search_path = ''`, execute revoked from `public, anon` and granted to `authenticated`.
- `save_billing_period_changes` stays untouched.
- Then run `npm run db:reset && npm run db:types`.

#### 7. Repository

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: Map `payments` both ways and save through the new function.

**Contract**:

- `toSnapshot` requires `period.payments` to be an array and maps `confirmed_at` (null or an instant). A malformed payment surfaces as `unexpected`.
- `save` calls `save_billing_period_with_payments` with `p_sent` (snake_case rows from `sentPayments()`) and `p_withdrawn`.

#### 8. Tests and harness

**Files**:

- `src/lib/billing-periods/__tests__/payment.entity.test.ts` (new)
- `__tests__/period-balances.value.test.ts`
- `__tests__/billing-period.aggregate.test.ts`
- `__tests__/billing-period.service.test.ts`
- `__tests__/billing-periods.harness.ts`

**Intent**: Drive the rules test-first. The harness stores payments and applies the sent and withdrawn ones on save.

**Contract**: The cases are listed under Testing Strategy. The v1 `Transfer` tests are removed.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the v1 failure scenario ending in "A owes B 150,00 zł": `npm test`
- Migration applies on a fresh database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves no diff
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Existing smoke flows still pass (add, edit and delete expense, transfer details): `npm run smoke`

#### Manual Verification:

- In Supabase Studio, `payments` shows RLS enabled with no policies, and `anon`/`authenticated` have no table grants
- Test names read as the ledger rules (pending vs posted, cap, idempotent send, sender-only withdraw)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Endpoints, payment list and panels, smoke

### Overview

The debtor records a payment with an amount, every member sees the payments and the pending balances, and the sender can withdraw. The smoke test runs the v1 failure scenario end to end.

### Changes Required:

#### 1. Endpoints

**Files**: `src/pages/api/groups/[id]/payments.ts` (new), `src/pages/api/groups/[id]/payments/[paymentId]/withdraw.ts` (new). v1's `transfers/sent.ts` and `undo.ts` are not restored.

**Intent**: Form POSTs following `expenses/[expenseId]/delete.ts`. The sender is always `locals.user.id`.

**Contract**:

- `payments.ts` reads `recipientId`, `paymentId` and `amount` and calls `sendPayment`.
- `withdraw.ts` calls `withdrawPayment`. A `payment_not_found` is treated as success (a repeated withdraw).
- Both redirect to `/groups/<id>`. On failure they add `?paymentError=<code>`, with the code only.

#### 2. Transfer panel

**File**: `src/components/expenses/TransferPanel.astro`

**Intent**: Transfer details for each own pending debt, plus the payment form. v1's mark states and "remaining" logic are dropped.

**Contract**:

- Props: `group`, `balances` (pending), `viewerId`, `monthLabel`, `accountNumbers`, `error`.
- Each own debt shows the details, with the amount equal to the pending debt. Below them is a form posting `recipientId`, a hidden `paymentId` (a fresh `crypto.randomUUID()` per render) and an `amount` text field prefilled with `debt.amount.formInput()`, plus a "Mark as sent" button.
- The panel renders when the viewer has a debt or there is an error.

#### 3. Payments list

**File**: `src/components/expenses/PaymentList.astro` (new); v1's `SentToYouPanel.astro` is not restored.

**Intent**: Every payment of the period, for every member.

**Contract**:

- Props: `group`, `payments` (newest first), `viewerId`, `periodOpen`.
- Each row reads "<sender> → <recipient> · <amount> · <date> · awaiting confirmation" or "… · confirmed", with `memberLabel`.
- An unconfirmed payment sent by the viewer, in an open period, gets a "Withdraw" form.
- An empty period shows "No payments yet".

#### 4. Balances panel

**File**: `src/components/expenses/BalancesPanel.astro`

**Intent**: Show that balances include unconfirmed payments.

**Contract**: When any payment of the period is unconfirmed, a note under "Debts" reads "Includes payments awaiting confirmation". The panel receives the pending balances.

#### 5. Group page wiring

**File**: `src/pages/groups/[id].astro`

**Intent**: Pass the pending balances and payments, request account numbers for the pending creditors, and render the `paymentError` message through `billingPeriodErrorMessage`.

**Contract**: `summarizeOpen` provides `balances`, `payments` and `period.isOpen()`. Caching is unchanged: account numbers still set `no-store`.

#### 6. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Prove sending, the cap, the backstop, withdrawing and that balances include payments, against a running server.

**Contract**: In group A after the expense edit, the debtor (first user) owes 300,00. The steps reuse the sign-in order of v1's Phase 3 (fixed after review finding F2) and v1's `userIdOf`, `checkTransferError`-style helpers:

1. Debtor:
   - posting `amount=400,00` is refused with `paymentError=payment_exceeds_debt`;
   - posting `amount=100,00` succeeds, and the page shows the debt "200,00", "Includes payments awaiting confirmation" and a Payments row with "100,00" and "Withdraw";
   - re-posting the same `paymentId` changes nothing (the debt is still 200,00).
2. Creditor, before the delete:
   - sees the Payments row without "Withdraw";
   - posting a payment to the debtor is refused with `no_debt_to_pay`;
   - a direct `save_billing_period_with_payments` call with `sender_id = debtor` gets 403 with `"code":"42501"`.
3. After the expense is deleted, the debtor:
   - sees that the creditor now owes them 100,00 (the payment counts);
   - withdraws the payment, and the page shows no payment and no debt;
   - withdrawing again redirects without an error.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes, including the payment steps: `npm run smoke`

#### Manual Verification:

- Two browsers, the v1 failure scenario (A pays 200; B pays 100; A pays 100; B pays 50; B pays 300) ends with A owing B 150,00 zł, and every intermediate debt matches the money that moved
- Entering more than the debt is refused with a clear message; a partial amount leaves the rest as the debt
- A third member sees the payments and the same balances
- The sender withdraws an unconfirmed payment and the balances return to the expense-only numbers
- The panels and the Payments list read well at phone width (NFR-1)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs, PRD and roadmap

### Overview

Align the documents that define the behaviour with the ledger model, and drop the v1 stash.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md` (Polish, like the rest of the file)

**Intent**: FR-008 and FR-009 describe the ledger.

**Contract**:

- **FR-008**: the sender records a sent transfer as a payment. It counts in the balances as awaiting confirmation, it cannot exceed the current debt, and the sender can withdraw it until it is confirmed.
- **FR-009**: the recipient's confirmation makes the payment final (posted); a rejection removes it.
- The Socrates note under FR-008 is updated to say why: balances must match the money that moved, and confirmation remains the final word.

#### 2. Roadmap and GitHub

**Files**: `context/foundation/roadmap.md`; GitHub issues #12 and #13

**Intent**: Record the decision and its consequences for later slices.

**Contract**:

- **S-07** outcome: the debtor records payments that count in pending balances.
- **S-08** outcome: the creditor confirms or rejects a payment. A new unknown asks whether FR-005's paid-debt lock is still needed now that payments live in the ledger.
- **S-09** risk note: "the host's debts are paid" uses the posted balances.
- **F-02**: the transfers-inside-`BillingPeriod` resolution now points to payments.
- The issue bodies of #12 and #13 are edited the same way, **only after the user confirms** (it is public content).

#### 3. CLAUDE.md and deploy plan

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: Describe the payment ledger and the new database objects.

**Contract**:

- `CLAUDE.md`:
  - Status: payments exist and balances are pending vs posted.
  - Structure: the `api/groups/[id]/payments` endpoints, `Payment` and `PaymentList`.
  - Database changes: `payments` and `save_billing_period_with_payments` (backstops before the version bump; `save_billing_period_changes` joins the expand/contract leftovers).
  - Commands: the smoke description.
- `deploy-plan.md`: a "Payments (S-07)" section. The migration is expand-only and needs no configuration change.
- Drop the v1 stash.

### Success Criteria:

#### Automated Verification:

- Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation context/deployment`
- Linting passes: `npm run lint`

#### Manual Verification:

- The PRD's FR-008/FR-009 and the roadmap's S-07/S-08/S-09 read consistently with the ledger model
- The user approves the edits to GitHub issues #12 and #13 before they are applied

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `Payment`:
  - `restore` refuses sender = recipient, a non-positive amount, and `confirmedAt` before `sentAt`.
  - `sentOnLabel` uses the Warsaw day.
- `PeriodBalances` with payments:
  - A payment from B to A of the whole debt settles the pair.
  - A partial payment leaves the rest as the debt.
  - A payment larger than the expense debt reverses the pair.
  - A payment to or from a non-member is ignored.
  - The balance invariant still holds.
- The v1 failure scenario as one test:
  1. A pays 200, then B sends 100: settled.
  2. A pays 100: B owes 50.
  3. B sends 50: settled.
  4. B pays 300: A owes B 150 (pending). The posted balances, with nothing confirmed, show expenses only.
- `BillingPeriod.sendPayment`:
  - It refuses a closed period, a non-participant sender, a pair without a debt (the creditor paying the debtor, self-payment) and an amount above the pending debt.
  - It accepts a partial amount and several payments per pair.
  - The same id again changes nothing.
- `BillingPeriod.withdrawPayment`:
  - It removes the sender's unconfirmed payment, whether loaded or new since load.
  - It refuses another member, a confirmed payment (built with `restore`) and a closed period.
  - An unknown id gives `payment_not_found`.
- Expense edits and deletes keep the payments, and only the balances change.
- `BillingPeriodService`:
  - It refuses an invalid amount and a non-UUID `paymentId`.
  - A retry after a concurrent payment is refused with `payment_exceeds_debt` when the debt shrank below the amount.
  - A retry with the same id after a lost race records once.
  - `withdrawPayment` is retried like the other commands.

### Integration Tests:

- `npm run smoke`: the steps of Phase 4, section 6.

### Manual Testing Steps:

1. Run the v1 failure scenario in two browsers and check every intermediate debt and the final "A owes B 150,00 zł".
2. Try an amount above the debt, then a partial amount.
3. As a third member, check the Payments list and the balances.
4. Withdraw an unconfirmed payment as its sender.

## Performance Considerations

The period load gains one subquery over `payments`, a handful of rows per month, and `PeriodBalances` gains one pass over them. Both are negligible.

## Migration Notes

`20261020111415_transfers.sql` is rewritten as `20261020111415_payments.sql`. This is allowed only because it was never pushed; it must land before any deploy of this branch. Towards production the migration is expand-only: a new table, a new function and a new jsonb key. `save_billing_period_changes` stays for the previously deployed Worker. Local databases need `npm run db:reset`.

## References

- External research: `context/changes/mark-transfer-sent/external-research.md` (variant (c), proposals 1–6)
- Plan v1 and its review: `plan-v1.md`, `plan-brief-v1.md`, `reviews/plan-review.md`
- PRD: `context/foundation/prd.md` FR-005, FR-008, FR-009, FR-015
- Patterns:
  - `src/lib/billing-periods/period-balances.value.ts:32` (netting)
  - `billing-period.service.ts` `change` (retry)
  - `src/pages/api/groups/[id]/expenses/[expenseId]/delete.ts` (form POST)
  - `supabase/migrations/20261019124131_edit_delete_expenses.sql` (backstops before the version bump)

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

- [x] 2.1 Migration applies on a fresh database: `npm run db:reset` — a649cee
- [x] 2.2 Generated types are up to date and committed: `npm run db:types` leaves no diff after commit — a649cee
- [x] 2.3 Unit tests still pass: `npm test` — a649cee
- [x] 2.4 Type checking passes: `npx astro check` — a649cee
- [x] 2.5 Linting passes: `npm run lint` — a649cee
- [x] 2.6 Existing smoke flows still pass (add, edit and delete expense, transfer details): `npm run smoke` — a649cee

#### Manual

- [x] 2.7 In Supabase Studio, `transfers` shows RLS enabled with no policies, and `anon`/`authenticated` have no table grants — a649cee

### Phase 3: Payment ledger, domain and persistence (test-first)

#### Automated

- [x] 3.1 Unit tests pass, including the v1 failure scenario ending in "A owes B 150,00 zł": `npm test` — b61e72b
- [x] 3.2 Migration applies on a fresh database: `npm run db:reset` — b61e72b
- [x] 3.3 Generated types are up to date: `npm run db:types` leaves no diff
- [x] 3.4 Type checking passes: `npx astro check` — b61e72b
- [x] 3.5 Linting passes: `npm run lint` — b61e72b
- [x] 3.6 Existing smoke flows still pass (add, edit and delete expense, transfer details): `npm run smoke` — b61e72b

#### Manual

- [x] 3.7 In Supabase Studio, `payments` shows RLS enabled with no policies, and `anon`/`authenticated` have no table grants — b61e72b
- [x] 3.8 Test names read as the ledger rules (pending vs posted, cap, idempotent send, sender-only withdraw) — b61e72b

### Phase 4: Endpoints, payment list and panels, smoke

#### Automated

- [x] 4.1 Unit tests pass: `npm test`
- [x] 4.2 Type checking passes: `npx astro check`
- [x] 4.3 Linting passes: `npm run lint`
- [x] 4.4 Production build succeeds: `npm run build`
- [x] 4.5 Smoke test passes, including the payment steps: `npm run smoke`

#### Manual

- [x] 4.6 Two browsers, the v1 failure scenario (A pays 200; B pays 100; A pays 100; B pays 50; B pays 300) ends with A owing B 150,00 zł, and every intermediate debt matches the money that moved
- [x] 4.7 Entering more than the debt is refused with a clear message; a partial amount leaves the rest as the debt
- [x] 4.8 A third member sees the payments and the same balances
- [x] 4.9 The sender withdraws an unconfirmed payment and the balances return to the expense-only numbers
- [x] 4.10 The panels and the Payments list read well at phone width (NFR-1)

### Phase 5: Docs, PRD and roadmap

#### Automated

- [ ] 5.1 Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation context/deployment`
- [ ] 5.2 Linting passes: `npm run lint`

#### Manual

- [ ] 5.3 The PRD's FR-008/FR-009 and the roadmap's S-07/S-08/S-09 read consistently with the ledger model
- [ ] 5.4 The user approves the edits to GitHub issues #12 and #13 before they are applied
