# Confirm or Reject a Payment (S-08) Implementation Plan

## Overview

The recipient of a payment confirms it after the transfer arrives, or rejects it (FR-009). S-07 built the payment ledger and the sender's side. A payment counts in the **pending** balances from the moment it is sent, and the **posted** balances count only confirmed payments. S-08 adds the recipient's two commands:

- **Confirm** makes the payment posted and permanent.
- **Reject** keeps the payment in the ledger with the status "rejected". It drops out of both balances, so the sender's debt comes back, and the Payments list shows the sender why.

The plan also keeps FR-005's paid-debt lock, now defined on confirmed payments: once the recipient has confirmed a payment between an expense's payer and one of its sharers, the expense can no longer be edited or deleted. (Decided 2026-10-22 during Phase 2 manual verification; it replaces the earlier decision to drop the lock.)

Roadmap item S-08, GitHub issue [#13](https://github.com/adamgwozdz00/SplitDom/issues/13).

## Current State Analysis

S-07 left the model ready for S-08 (`context/archive/2026-10-20-mark-transfer-sent/plan.md`):

- `Payment` (`src/lib/billing-periods/payment.entity.ts`):
  - holds `confirmedAt: Date | null` and `isConfirmed()`;
  - its constructor refuses a confirmation earlier than `sentAt`.
- `BillingPeriod` (`src/lib/billing-periods/billing-period.aggregate.ts`):
  - `pendingBalances()` (line 334) counts every payment;
  - `postedBalances()` (line 339) counts confirmed payments only;
  - `sendPayment` (line 246) caps the amount by the pending debt;
  - `withdrawPayment` (line 284) already refuses a confirmed payment (`payment_confirmed`).
- Nothing sets `confirmedAt`, and nothing marks a payment as rejected.
- `BillingPeriodService.change` (`billing-period.service.ts:228`) runs every command and retries it once on the reloaded period after a version conflict, so new commands must be safe to re-run.
- Persistence: `save_billing_period_with_payments` (`supabase/migrations/20261020111415_payments.sql`) inserts sent payments and deletes withdrawn ones, with caller backstops before the version bump. It has no parameter for confirmations.
  - That migration is **pushed to production**, so S-08 adds a new migration and a new save function (expand before contract). The old function stays for the previously deployed Worker.
- UI: `PaymentList.astro` renders each payment as "sender → recipient · amount · date · awaiting confirmation | confirmed" and gives the sender a "Withdraw" form (line 24). `BalancesPanel` shows "Includes payments awaiting confirmation" when `hasUnconfirmedPayments` is set (`src/pages/groups/[id].astro:87`, today computed as "not confirmed").
- FR-005's lock (amended 2026-10-22 to a pair lock on confirmed payments, built in Phase 2): `BillingPeriod.canEdit` (line 141) checks only that the period is open and the user is the author. The roadmap left "is the paid-debt lock still needed?" to this slice (S-05, S-08 and F-02 unknowns; issue #13).

## Desired End State

On the group page, the recipient of an unconfirmed payment sees "Confirm" and "Reject" on its row in the Payments list. Above the list, a note says how many payments await their confirmation.

- **Confirming**: the row reads "confirmed", the sender's Withdraw disappears, and the posted balances include the payment. The pending balances do not change, because the payment already counted there.
- **Rejecting**: the row reads "rejected" (muted), and the payment leaves both balances, so the sender's debt and transfer details come back. Nobody can confirm, reject or withdraw a rejected payment again.
- **Repeats**: confirming an already confirmed payment, or rejecting an already rejected one, is a no-op success. A double submit or a retry never shows an error.
- **Refusals**: only the recipient confirms or rejects. A non-recipient gets `not_payment_recipient`. Confirming a rejected payment, or rejecting a confirmed one, gives `payment_not_pending`.
- **Edits**: an expense is locked (no edit, no delete, no Edit link) once a confirmed payment exists between its payer and any member who holds a share of it, in either direction. Pending and rejected payments never lock. Other expenses stay editable by their author while the period is open. The refusal is `expense_locked`.
- "Includes payments awaiting confirmation" appears only while a pending (neither confirmed nor rejected) payment exists.

Verify with `npm test`, `npm run db:reset && npm run db:types`, `npx astro check`, `npm run lint`, `npm run build`, `npm run smoke`, and a manual two-browser run.

### Key Discoveries:

- `PeriodBalances.of` takes the payments to count as an argument (`period-balances.value.ts:46`), so excluding rejected payments is a filter in `pendingBalances()`. No change to the netting.
- `sendPayment`'s cap reads `pendingBalances()`, so a rejected payment automatically stops reducing the debt the sender may pay.
- `creditorIdsOf` reads the pending balances it is given, so a debt that comes back after a rejection shows the creditor's account number again, with no change.
- The withdraw endpoint treats `payment_not_found` as success (`payments/[paymentId]/withdraw.ts`). For confirm and reject, idempotency belongs in the aggregate instead (the same decision again succeeds), so the endpoints special-case nothing.
- The save-function backstop pattern (checks raise `42501` before the version bump, so a stale version cannot hide them) is in `20261020111415_payments.sql`. The new function copies it.

## What We're NOT Doing

- **Undoing a confirmation or a rejection.** Confirmed is permanent (decided in S-07). Rejected is final too: the sender records a new payment if the money did arrive.
- **Confirming or rejecting in a closed period.** Both commands refuse it like every other command (`billing_period_closed`). What happens to other members' pending payments when the host closes a period is recorded as a new S-09 unknown.
- **A balance check on confirmation.** Confirming states that the money arrived, so it is allowed whatever the balance is now.
- **A confirmation step for Reject.** It is a one-click form, because a wrong rejection is fixed by the sender sending again.
- **Changes to the expand/contract leftovers.** `save_billing_period_with_payments` joins the leftovers awaiting the contract migration, and its backstops are not changed.
- **A lock on pending payments, or on the whole period.** Only a confirmed payment locks, and only the expenses of its pair.
- Notifications, a separate "To confirm" panel, overpayment corrections, FR-006, and a Playwright E2E spec. Coverage stays Vitest plus smoke, as in S-07.

## Implementation Approach

The steps follow S-07:

- **Phase 1** moves the domain and persistence together, so no phase leaves the repository silently dropping confirmations (S-07 v1 review finding F1). The domain is driven test-first.
- **Phase 2** adds the endpoints, the list actions and the smoke steps.
- **Phase 3** aligns the PRD, the roadmap, CLAUDE.md, the deploy plan and the GitHub issue.

Decisions (S-08 planning, 2026-10-22):

1. A rejected payment stays in the ledger as "rejected" (`rejected_at`), outside both balances, and is visible to the group.
2. FR-005's paid-debt lock is kept and defined on confirmed payments: it locks the expenses whose payer and a sharer are the pair of a confirmed payment. The PRD and the roadmap unknowns are updated. (Amended 2026-10-22: the first decision dropped the lock.)
3. The recipient acts inline in the Payments list, and a count note sits above it.
4. Confirmed and rejected are final. Repeating the same decision is a no-op success.
5. Confirm and reject refuse a closed period. The fate of pending payments at closing goes to S-09.
6. Testing is Vitest (test-first) plus smoke.

## Critical Implementation Details

- **Decision timestamp vs `sentAt`.** `Payment` refuses a `confirmedAt` (and, after this change, a `rejectedAt`) earlier than `sentAt`. Clocks of separate Worker isolates can differ by milliseconds, so `confirm(at)` and `reject(at)` record `max(at, sentAt)` instead of throwing.
- **Rollback window.** The previously deployed Worker does not know `rejected_at`. After a `wrangler rollback`, it would count rejected payments as pending until the next deploy. The deploy plan records this. No data is lost, and the new Worker reads the rows correctly again.

## Phase 1: Confirm and reject in the domain and persistence (test-first)

### Overview

Give `Payment` a third state, add the recipient's commands to `BillingPeriod` and the service, exclude rejected payments from the balances, and persist decisions through a new migration and save function. Tests come first.

### Changes Required:

#### 1. Payment states

**File**: `src/lib/billing-periods/payment.entity.ts`

**Intent**: A payment is pending, confirmed or rejected, and the two decisions exclude each other.

**Contract**:

- State and snapshot gain `rejectedAt: Date | null` (`string | null` in `PaymentSnapshot`).
- The constructor also throws when both `confirmedAt` and `rejectedAt` are set, or when `rejectedAt` is earlier than `sentAt`.
- `status(): "pending" | "confirmed" | "rejected"`, `isPending()` and `isRejected()`. `isConfirmed()` stays.
- `confirm(at: Date): Payment` and `reject(at: Date): Payment` return a new instance with the decision at `max(at, sentAt)`. They throw when the payment is not pending (the aggregate checks first).
- The class doc comment drops "(S-08)" and describes the three states.

#### 2. BillingPeriod commands and balances

**File**: `src/lib/billing-periods/billing-period.aggregate.ts`

**Intent**: The recipient confirms or rejects. Rejected payments count nowhere. Withdraw refuses a rejected payment.

**Contract**:

- `confirmPayment({ paymentId, userId, now }): Result<void>` and `rejectPayment({ paymentId, userId, now }): Result<void>`. Each refuses, in this order:
  1. a closed period (`billing_period_closed`);
  2. an unknown payment (`payment_not_found`);
  3. a user who is not the recipient (`not_payment_recipient`).
- After those checks:
  - The same decision already made returns success with no change.
  - The opposite decision already made gives `payment_not_pending`.
  - Otherwise the stored payment is replaced by its confirmed or rejected copy and recorded as a pending write.
- `confirmedPayments(): readonly Payment[]` and `rejectedPayments(): readonly Payment[]` are the loaded payments decided since load, for the repository.
- `withdrawPayment`: after the `payment_confirmed` check, a rejected payment gives `payment_not_pending`.
- `pendingBalances()` counts expenses plus payments that are not rejected. `postedBalances()` is unchanged (confirmed only).
- `canEdit` is amended in Phase 2 (see Phase 2, section 5); Phase 1 left it unchanged.

#### 3. Types, errors and public API

**Files**: `src/lib/billing-periods/types.ts`, `billing-period-error.messages.ts`, `index.ts`

**Intent**: The persistence shape and the error codes of the decisions.

**Contract**:

- `PaymentSnapshot.rejectedAt: string | null`.
- New codes with their messages:
  - `not_payment_recipient`: "Only the member a payment was sent to can confirm or reject it"
  - `payment_not_pending`: "This payment has already been confirmed or rejected"
- `index.ts` needs no new export unless the payment status type is used by components, in which case it exports that type.

#### 4. Service

**File**: `src/lib/billing-periods/billing-period.service.ts`

**Intent**: Entry points for the endpoints, retried like the other commands.

**Contract**: `confirmPayment({ group, userId, paymentId })` and `rejectPayment({ group, userId, paymentId })`, each `Promise<Result<void>>`. Each takes `now` from the clock once and runs the aggregate command through `change`. On a lost race the retry judges the payment as it is then: a payment withdrawn meanwhile gives `payment_not_found`, and one decided meanwhile gives a success or `payment_not_pending`.

#### 5. Migration

**File**: `supabase/migrations/<timestamp>_payment_confirmations.sql` (new; create with `npm run db:new payment_confirmations`)

**Intent**: Store the recipient's decisions with structural backstops. Expand-only.

**Contract**:

- `alter table public.payments`:
  - add `rejected_at timestamptz` (nullable);
  - add `check (confirmed_at is null or rejected_at is null)`;
  - add `check (rejected_at is null or rejected_at >= sent_at)`.
- `get_current_billing_period` (`create or replace`) returns `rejected_at` in each payment object; everything else stays the same.
- New `public.save_billing_period_with_confirmations(p_period_id, p_group_id, p_expected_version, p_added, p_changed, p_removed, p_sent, p_withdrawn, p_confirmed jsonb, p_rejected jsonb) returns boolean`:
  - It keeps every check and write of `save_billing_period_with_payments`. The withdraw backstop also requires `rejected_at is null`.
  - New backstops raise `42501` before the version bump. Every id in `p_confirmed` (`[{id, confirmed_at}]`) and `p_rejected` (`[{id, rejected_at}]`) must be a payment of this period with `recipient_id = auth.uid()`, `confirmed_at is null` and `rejected_at is null`.
  - After the bump it sets `confirmed_at` and `rejected_at` on those rows. The table checks catch an id that appears in both lists.
  - Setup: `security definer`, `set search_path = ''`, a "Persistence only" comment, execute revoked from `public, anon` and granted to `authenticated`.
- `save_billing_period_with_payments` stays untouched (a leftover for the previously deployed Worker).
- Then run `npm run db:reset && npm run db:types`.

#### 6. Repository

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: Map `rejected_at` and save through the new function.

**Contract**:

- `toPaymentSnapshot` maps `rejected_at` (null or an instant).
- `save` calls `save_billing_period_with_confirmations` with:
  - `p_confirmed` from `confirmedPayments()` (`{ id, confirmed_at }`);
  - `p_rejected` from `rejectedPayments()` (`{ id, rejected_at }`).
- The `fromDbError` comment on `42501` mentions the recipient backstop.

#### 7. Tests and harness

**Files**:

- `src/lib/billing-periods/__tests__/payment.entity.test.ts`
- `__tests__/period-balances.value.test.ts` (only if a case is missing)
- `__tests__/billing-period.aggregate.test.ts`
- `__tests__/billing-period.service.test.ts`
- `__tests__/billing-periods.harness.ts`

**Intent**: Drive the rules test-first. The harness applies confirmed and rejected payments on save.

**Contract**: The cases are listed under Testing Strategy.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the confirm, reject and withdraw-after-decision cases: `npm test`
- Migration applies on a fresh database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves no diff
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Existing smoke flows still pass (expenses, transfer details, send and withdraw payments): `npm run smoke`

#### Manual Verification:

- In Supabase Studio, `payments` has the `rejected_at` column and both new checks, and `save_billing_period_with_confirmations` is executable by `authenticated` only
- Test names read as the rules (recipient only, same decision again is a no-op, opposite decision refused, rejected counts nowhere, expenses stay editable after a confirmed payment)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Endpoints, Payments list actions and smoke

### Overview

The recipient confirms or rejects from the Payments list and sees how many payments await them. Everyone sees the three statuses. The smoke test covers both commands and the backstop.

### Changes Required:

#### 1. Endpoints

**Files**: `src/pages/api/groups/[id]/payments/[paymentId]/confirm.ts` and `reject.ts` (new)

**Intent**: Form POSTs following `withdraw.ts`. The acting user is always `locals.user.id`.

**Contract**:

- Each calls `confirmPayment` or `rejectPayment` and redirects to `/groups/<id>`.
- On failure the redirect adds `?paymentError=<code>`, with the code only.
- Unlike `withdraw.ts`, no code is treated as success. A repeated decision already succeeds in the aggregate.

#### 2. Payments list

**File**: `src/components/expenses/PaymentList.astro`

**Intent**: The recipient's actions, the count note and the rejected status.

**Contract**:

- Each row's status reads "awaiting confirmation", "confirmed" or "rejected". A rejected row is muted (and its amount struck through) so it does not read as money that counts.
- A pending payment whose recipient is the viewer, in an open period, gets two inline forms, "Confirm" and "Reject", posting to the new endpoints. They are styled like Withdraw, with Reject in a warning colour.
- Withdraw is shown only for a pending payment the viewer sent (rejected ones excluded).
- Above the list, in an open period, when the viewer is the recipient of at least one pending payment: "1 payment awaits your confirmation" or "N payments await your confirmation" (`data-awaiting-confirmation`).

#### 3. Balances note and page wiring

**File**: `src/pages/groups/[id].astro`

**Intent**: The "awaiting confirmation" note counts pending payments only.

**Contract**: `hasUnconfirmedPayments` becomes `open.payments.some((payment) => payment.isPending())`. Error rendering is unchanged: `paymentError` already goes through `billingPeriodErrorMessage`.

#### 4. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Prove confirm, reject, recipient-only, finality, idempotency and the backstop against a running server. Adjust the later expectations that the new payments change.

**Contract**: A `decidePayment(paymentId, decision)` helper posts to `confirm` or `reject`, next to `withdrawPayment`. New payment ids: `toConfirm` and `toReject`.

1. **Debtor**, after the existing idempotency step: sends `toConfirm` = `50,00` and `toReject` = `25,00`. The page shows "You owe … 125,00".
2. **Creditor**, in the existing creditor section:
   - sees "3 payments await your confirmation", "Confirm" and "Reject";
   - confirms `toConfirm`, then confirms it again (no error);
   - rejects `toReject`. The page shows "confirmed" and "rejected", the debt "owes You 150,00", and the note "1 payment awaits your confirmation" (`part` is still pending);
   - confirming `toReject` is refused with `payment_not_pending`.
3. **Debtor**, after the expense delete:
   - withdrawing `toConfirm` is refused with `payment_confirmed`;
   - withdrawing `toReject` is refused with `payment_not_pending`;
   - confirming `part` (sent by the debtor) is refused with `not_payment_recipient`;
   - a direct `save_billing_period_with_confirmations` call in which the debtor confirms `part` (they are not its recipient) is refused with 403 and `"code":"42501"`, mirroring `creditorSendsInDebtorsNameDirectly`;
   - the existing "creditor now owes the debtor" and "withdraw the payment" steps get their new amounts. With `part` (100, pending) and `toConfirm` (50, confirmed), the creditor owes 150,00, and after withdrawing `part` they owe 50,00. "No payments yet" and "All settled" no longer apply, so they become checks for the remaining confirmed and rejected rows.

#### 5. Expense lock after a confirmed payment (amendment, 2026-10-22)

**Files**: `src/lib/billing-periods/billing-period.aggregate.ts`, `billing-period-error.messages.ts`, `types.ts`, `src/components/expenses/ExpenseList.astro` (and the edit page if it shows its own refusal), `__tests__/billing-period.aggregate.test.ts`, `scripts/smoke.mjs`

**Intent**: A confirmed payment closes the expenses it settled: the author decided consciously, so the expense can no longer change. The lock is judged in the aggregate, tests first.

**Contract**:

- `canEdit(expense, userId)` is true only when the period is open, `userId` paid the expense and `isLocked(expense)` is false.
- `isLocked(expense)`: a confirmed payment exists whose sender and recipient are the expense's payer and one of its `sharerIds()` (either direction). Pending and rejected payments never lock.
- `editableExpense` refuses, in this order: a closed period, an unknown expense, an expense someone else paid (`not_expense_author`), and then a locked one (`expense_locked`). `editExpense` and `removeExpense` inherit it.
- New code `expense_locked`: "This expense can no longer be changed because a payment for it has been confirmed". `types.ts` and the messages map get it.
- The expense list shows no Edit link for a locked expense and says "locked" instead.
- Smoke: after the creditor confirms `toConfirm`, the author's expense of that pair has no Edit link, and posting an edit or delete is refused with `expense_locked`. Adjust the later smoke steps that edit or delete that expense (the expense edit, the "deleted expense" steps and the payment-withdraw steps) so they still exercise their paths, for instance by running them before the confirmation or with a second expense of another pair.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes, including the confirm and reject steps: `npm run smoke`

#### Manual Verification:

- Two browsers: the debtor sends two payments; the creditor sees the count note, confirms one and rejects the other; the debtor sees "confirmed" without Withdraw, "rejected", and their debt grown back by the rejected amount
- After a confirmed payment, the author of an expense of that pair can no longer edit or delete it (no Edit link; opening the edit page or posting is refused with a clear message), while an expense of another pair stays editable
- A third member sees the same statuses and no Confirm or Reject buttons
- The Payments list with the actions and the note reads well at phone width (NFR-1)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Docs, PRD, roadmap and GitHub

### Overview

Align the documents that define the behaviour with the decisions of this slice.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md` (Polish, like the rest of the file)

**Intent**: FR-005 loses the paid-debt lock, and FR-009 describes rejection as a status.

**Contract**:

- **FR-005**: the paid-debt clause is made precise: an expense cannot be edited or deleted when its period is closed, or when the recipient has confirmed a payment between its payer and a member who holds a share of it. Pending and rejected payments do not lock.
- **FR-009**: rejecting removes the payment from the balances and leaves it visible as rejected. Confirmation and rejection are final.

#### 2. Roadmap and GitHub

**Files**: `context/foundation/roadmap.md`; GitHub issue #13 and the project board

**Intent**: Record the decisions and their consequences for S-09.

**Contract**:

- **S-08**: the outcome mentions the rejected status, and the FR-005 unknown is resolved (kept, as a pair lock on confirmed payments, 2026-10-22, pointing to this plan).
- **S-05**: its unknown is resolved in the same way.
- **F-02**: the FR-005 unknown is resolved in the same way.
- **S-09**: a new unknown asks what happens to other members' pending payments when the host closes the period: carried over, blocking, or confirmable after closing. Owner: user. Block: S-09.
- Issue #13's body is edited the same way, **only after the user confirms** (it is public content). The PR delivering this change carries `Closes #13`.

#### 3. CLAUDE.md and deploy plan

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: Describe confirmations and the new database objects.

**Contract**:

- `CLAUDE.md`:
  - Status: the recipient confirms or rejects a payment, and a confirmed payment locks the expenses of its pair. Remove "(the paid-debt lock of FR-005 comes with S-08)" and "Confirming or rejecting a payment (S-08)" from the to-do sentence.
  - Structure: the `confirm.ts` and `reject.ts` endpoints, and the payment states.
  - Database changes, Payments bullet: `rejected_at`, and `save_billing_period_with_confirmations` with the recipient backstops. Also add `save_billing_period_with_payments` to the expand/contract leftovers, and update the billing-period concurrency bullet's function name.
  - Commands: the smoke description includes confirming and rejecting.
- `deploy-plan.md`:
  - a "Payment confirmations (S-08)" section: the migration is expand-only and needs no configuration change;
  - the rollback note from Critical Implementation Details;
  - removal of the sentence "The paid-debt part of FR-005 (no edits once a debt is paid) arrives with S-08" and of "once S-08 exists".

### Success Criteria:

#### Automated Verification:

- Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation/roadmap.md context/deployment/deploy-plan.md`
- Linting passes: `npm run lint`

#### Manual Verification:

- The PRD's FR-005/FR-009 and the roadmap's S-05/S-08/S-09/F-02 read consistently with the decisions
- The user approves the edit to GitHub issue #13 before it is applied

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `Payment`:
  - `restore` refuses both decisions set, and a `rejectedAt` before `sentAt`.
  - `status()` gives pending, confirmed or rejected.
  - `confirm` and `reject` return a decided copy and leave the original unchanged.
  - A decision time earlier than `sentAt` is recorded as `sentAt`.
  - Deciding a non-pending payment throws.
- `BillingPeriod.confirmPayment`:
  - The recipient confirms, so `postedBalances()` now includes the payment and `pendingBalances()` is unchanged.
  - It refuses a closed period, an unknown id and a non-recipient (the sender, a third member).
  - Confirming twice succeeds without a second pending write.
  - Confirming a rejected payment gives `payment_not_pending`.
- `BillingPeriod.rejectPayment`:
  - The recipient rejects, so the payment stays in `payments` and both balances drop it. The sender's debt comes back, and their cap allows the full debt again.
  - The same refusals as confirm, mirrored.
  - Rejecting a confirmed payment gives `payment_not_pending`.
- `withdrawPayment` refuses a rejected payment with `payment_not_pending`.
- FR-005 lock (Phase 2, section 5): `canEdit`, `editExpense` and `removeExpense` refuse an expense whose payer and a sharer are the pair of a confirmed payment (`expense_locked`), in either direction. A pending or rejected payment, or a confirmed payment of another pair, does not lock. The refusal comes after the closed-period, unknown-expense and author checks.
- `BillingPeriodService`:
  - `confirmPayment` and `rejectPayment` are retried after a version conflict.
  - A retry after the sender withdrew the payment meanwhile gives `payment_not_found`.
  - A retry after the same decision landed meanwhile succeeds.

### Integration Tests:

- `npm run smoke`: the steps of Phase 2, section 4.

### Manual Testing Steps:

1. In two browsers, the debtor sends two payments; the creditor confirms one and rejects the other.
2. Check both views: statuses, the count note, Withdraw only on the debtor's pending payments, and the debt grown back by the rejected amount.
3. Edit the expense after the confirmation and check that the payment stays confirmed.
4. As a third member, check the statuses and that no actions are shown.

## Performance Considerations

None. The decisions add one nullable column, two small `jsonb` lists to the save call and one filter over a handful of payments.

## Migration Notes

The new migration only adds a nullable column, two checks that every existing row satisfies, a key in `get_current_billing_period` and a new function. It is compatible with the previously deployed Worker, which keeps calling `save_billing_period_with_payments` and ignores `rejected_at`. The rollback caveat is in Critical Implementation Details. Local databases need `npm run db:reset`.

## References

- S-07 plan and research: `context/archive/2026-10-20-mark-transfer-sent/plan.md`, `external-research.md` (pending vs posted; corrections as new entries)
- PRD: `context/foundation/prd.md` FR-005, FR-009, FR-015
- Roadmap: `context/foundation/roadmap.md` S-05, S-08, S-09, F-02
- Patterns:
  - `src/lib/billing-periods/billing-period.aggregate.ts:284` (`withdrawPayment`, refusal order and pending writes)
  - `src/lib/billing-periods/billing-period.service.ts:228` (`change` retry)
  - `src/pages/api/groups/[id]/payments/[paymentId]/withdraw.ts` (form POST)
  - `supabase/migrations/20261020111415_payments.sql` (backstops before the version bump)
  - `scripts/smoke.mjs` `creditorSendsInDebtorsNameDirectly` (direct-RPC backstop check)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Confirm and reject in the domain and persistence (test-first)

#### Automated

- [x] 1.1 Unit tests pass, including the confirm, reject and withdraw-after-decision cases: `npm test` — b94be20
- [x] 1.2 Migration applies on a fresh database: `npm run db:reset` — b94be20
- [x] 1.3 Generated types are up to date: `npm run db:types` leaves no diff — b94be20
- [x] 1.4 Type checking passes: `npx astro check` — b94be20
- [x] 1.5 Linting passes: `npm run lint` — b94be20
- [x] 1.6 Existing smoke flows still pass (expenses, transfer details, send and withdraw payments): `npm run smoke` — b94be20

#### Manual

- [x] 1.7 In Supabase Studio, `payments` has the `rejected_at` column and both new checks, and `save_billing_period_with_confirmations` is executable by `authenticated` only — b94be20
- [x] 1.8 Test names read as the rules (recipient only, same decision again is a no-op, opposite decision refused, rejected counts nowhere, expenses stay editable after a confirmed payment) — b94be20

### Phase 2: Endpoints, Payments list actions and smoke

#### Automated

- [x] 2.1 Unit tests pass: `npm test`
- [x] 2.2 Type checking passes: `npx astro check`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Production build succeeds: `npm run build`
- [x] 2.5 Smoke test passes, including the confirm and reject steps: `npm run smoke`

#### Manual

- [x] 2.6 Two browsers: the debtor sends two payments; the creditor sees the count note, confirms one and rejects the other; the debtor sees "confirmed" without Withdraw, "rejected", and their debt grown back by the rejected amount
- [x] 2.7 After a confirmed payment, the author of an expense of that pair can no longer edit or delete it (no Edit link; opening the edit page or posting is refused with a clear message), while an expense of another pair stays editable
- [x] 2.8 A third member sees the same statuses and no Confirm or Reject buttons
- [x] 2.9 The Payments list with the actions and the note reads well at phone width (NFR-1)

### Phase 3: Docs, PRD, roadmap and GitHub

#### Automated

- [ ] 3.1 Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation/roadmap.md context/deployment/deploy-plan.md`
- [ ] 3.2 Linting passes: `npm run lint`

#### Manual

- [ ] 3.3 The PRD's FR-005/FR-009 and the roadmap's S-05/S-08/S-09/F-02 read consistently with the decisions
- [ ] 3.4 The user approves the edit to GitHub issue #13 before it is applied
