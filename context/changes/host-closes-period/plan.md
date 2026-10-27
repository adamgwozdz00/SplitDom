# Host Closes the Billing Period (S-09) Implementation Plan

## Overview

The host closes a finished billing period (US-02, FR-015). The close is one write that:

- freezes the old period (no more writes of any kind);
- opens the period for the **month after** the closed one;
- turns every non-zero **posted** pair debt of the old period into an **opening-balance entry** ("opening debt") of the new period;
- moves every still-pending payment to the new period unchanged.

The host may close only once the period's month has ended (Europe/Warsaw) and the host owes nothing on the posted balances. Other members' debts carry over instead of blocking the close, so the PRD rule "the host settles only their own debts" holds and no debt is stranded in a frozen period.

FR-005's lock changes to **oldest-first application**: confirmed payments of a pair first settle the opening debt carried in the same direction, and the pair's expenses lock only once the confirmed payments in one direction exceed it.

The first phase drops the expand/contract leftovers. Two of them (`add_expense`, `save_billing_period`) could write into a closed period, which is a roadmap prerequisite of this slice.

Roadmap item S-09, GitHub issue [#14](https://github.com/adamgwozdz00/SplitDom/issues/14). Research and decisions: `context/changes/host-closes-period/research.md`.

## Current State Analysis

- **`BillingPeriod`** (`src/lib/billing-periods/billing-period.aggregate.ts`):
  - every command refuses a closed period (`:119`, `:166`, `:272`, `:305`, `:356`);
  - `open` takes its month from `BillingMonth.of(now)` (`:65-77`);
  - balances are derived from the period's expenses and payments only (`:415-431`);
  - `isLocked` locks a pair's expenses on any confirmed payment of the pair (`:146-154`).
- **`PeriodBalances.of`** (`period-balances.value.ts`) takes `memberIds`, `expenses` and optional `payments`. Netting is linear per pair.
- **`BillingMonth`** (`billing-month.value.ts`) has `of`, `fromDate`, `toDate`, `label` and `equals`. There is no `next`, no `previous` and no way to tell whether a month has ended.
- **`BillingPeriodService`** (`billing-period.service.ts`):
  - `openFor` (`:32-62`) treats a closed latest period as `unexpected`, so closing must open the next period in the same write.
  - `change` (`:248-258`) retries a lost race once on `reload`, which is the latest period stored (`:279-285`).
- **Persistence:**
  - `get_current_billing_period` returns the latest period by `month desc`, open or closed (`supabase/migrations/20261022182930_payment_confirmations.sql:86-90`).
  - `save_billing_period_with_confirmations` bumps `version` only while `closed_at is null` (`:208-217`).
  - `open_billing_period` inserts whatever month it is given. A second open period or a duplicate `(group_id, month)` raises `23505`, which the repository maps to `"conflict"`.
  - `payments` links to its period through the composite FK `(period_id, group_id)` (`20261020111415_payments.sql`), so re-parenting a payment within its group is a plain `update`.
  - No database function checks the host yet.
- **Host**: `Group.hostId` and `isHost(userId)` (`src/lib/groups/group.aggregate.ts:25`, `:83-85`). The group page uses it only for the GroupCard badge.
- **Leftovers**: nothing has ever been dropped. `add_expense` writes without a version bump or open check (`20261005190331_expenses.sql:83-105`). The old `save_billing_period` bumps the version without `closed_at is null` (`20261007075852_billing_period_aggregate.sql:206-210`). The app does not call any leftover, but `scripts/smoke.mjs` calls three of them directly: `list_my_groups` (`:178`, default of `firstUserCallsDirectly`), `save_billing_period_changes` (`:835`) and `save_billing_period_with_payments` (`:291`).
- **Tests**:
  - Vitest uses `FakeBillingPeriodRepository` in `__tests__/billing-periods.harness.ts`. It keeps only the latest snapshot per group and merges only expense and payment diffs.
  - Smoke runs against the server clock (`createBillingPeriodService` uses `() => new Date()`) and has no service-role key, so it cannot back-date a period today.

## Desired End State

- **The host** sees a "Close <month>" panel on the group page:
  - While the month runs or the host still owes money, the panel shows the reason and no close button.
  - Otherwise it shows a revealed confirmation, "Yes, close <month>", and a note that expenses of the new month can be added once the period is closed.
- **Other members** see no panel. A non-host posting the close is refused with `not_group_host`.
- **After closing**, the page shows the new month:
  - a "Carried over from <previous month>" section listing each opening debt (debtor → creditor, amount);
  - balances and transfer details that include the carried debts;
  - moved payments still pending in the Payments list, marked "carried over from <previous month>", where their recipient can confirm or reject them and their sender can withdraw them.
- **Invariant**: right after the close, every member balance and pair debt, both pending and posted, equals what the old period showed at the moment of close.
- **Double submit**: a repeated close of the same period succeeds without a change.
- **Lock (FR-005)**: the expenses of a pair stay editable while the pair's confirmed payments in the new period only cover the carried debt. They lock once the confirmed payments in one direction exceed it. With no opening debt the lock behaves exactly as in S-08.
- **Leftovers**: none of the unused leftover RPCs exist in the database any more.

Verify with `npm test`, `npm run db:reset && npm run db:types`, `npx astro check`, `npm run lint`, `npm run build`, `npm run smoke` (with the new back-dating steps) and a manual two-browser run.

### Key Discoveries:

- `get_current_billing_period` already picks the latest period by month. Because the next period is the month after the closed one, it sorts last with no change to selection (`20261022182930_payment_confirmations.sql:86-90`).
- Netting is linear (`period-balances.value.ts`). An opening debt X → Y counts like Y paying for X: `owed[X][Y] += amount`, X's balance down and Y's up. With that, "posted opening debts plus moved pending payments" reproduces the old pending balances exactly.
- `service_role` keeps its default table grants: the migrations revoke only from `anon` and `authenticated`. With the local service-role key plus the app key, smoke can back-date `billing_periods.month` over REST. The app-key gate exempts no role, so the app key is still needed.
- The expense delete confirmation (`src/pages/groups/[id]/expenses/[expenseId]/edit.astro:66-75`) is the `<details>` + `data-guard-submit` pattern to reuse for "Yes, close".
- A closing month M always yields a next month M+1 that has already started, because closing requires M to have ended. So the roadmap unknown "new period's month starts after today" (`roadmap.md:248`) cannot occur, and `PurchaseDate.window` stays valid.

## What We're NOT Doing

- **Viewing closed periods.** History of earlier periods is a later slice. After a close, members see only the new period with its carried debts.
- **Adding next-month expenses before the close.** Between the month's end and the close, the purchase-date window allows only the open period's month (`purchase-date.value.ts:68-77`). Accepted and stated in the close panel.
- **Reopening a period**, or posting into a closed one. Corrections are new entries in the open period.
- **Requiring other members' debts to be settled**, or blocking the close on their pending payments. Pending payments move instead (Decision 2).
- **Scheduled or automatic closing** (PRD Non-Goals).
- **Transferring the host role.**
- **A Playwright spec.** Coverage is Vitest plus smoke. Double submit is handled by idempotency, not by a browser risk.
- **A test-only clock in the app.** Smoke back-dates the database instead.

## Implementation Approach

- **Phase 1** removes the leftovers first, so nothing but the guarded save and close functions can write to a period.
- **Phase 2** moves the domain and persistence of the close together, test-first, as in S-07/S-08. No phase leaves the repository unable to store what the aggregate produced.
- **Phase 3** adds the endpoint, the UI and the smoke flow, including back-dating.
- **Phase 4** aligns the documents.

Decisions (research 2026-10-23 – 2026-10-26 and S-09 planning 2026-10-26):

1. Carry forward every non-zero posted pair debt as an opening debt of the new period (research, Decision 1).
2. Move pending payments to the new period unchanged; confirmed and rejected payments stay in the closed period (research, Decision 2).
3. FR-005 lock: oldest-first application against the opening debt in the same direction (research, Decision 3).
4. The next period is the month after the closed one, not the month of `now`.
5. The contract migration is Phase 1 of this plan and drops every unused leftover RPC.
6. A host-only close panel shows the refusal reason up front, or a revealed "Yes, close" confirmation.
7. Smoke back-dates the period through the local service-role key (`SUPABASE_SERVICE_ROLE_KEY`; in CI taken from `supabase status`).
8. New-month expenses wait for the close; the panel says so.
9. Opening debts get their own "Carried over from <month>" section; moved payments are marked in the Payments list.

## Critical Implementation Details

- **A retry after a close lands on the new period.** `change` retries a lost race on the latest stored period, which after a close is the new open one, not the closed one. So a confirm, reject or withdraw of a payment that was pending at close succeeds on its moved copy. A stale send is capped by the new pending debt, which includes the carried debt. An edit or delete of an old expense gets `expense_not_found`, and a stale add with an old-month date gets `invalid_purchase_date`. These outcomes are correct and intended. The doc comments of `change`/`reload` and the resolved roadmap unknown (`roadmap.md:245`, "its retry reloads the closed period") must say so.
- **The close is not a `change` command.** It writes two periods through its own repository method. Its retry rule: on `"conflict"`, reload once. If the latest period is no longer the one being closed, the close already happened, so the result is success. Otherwise run the close again on the reloaded period. A second conflict gives `period_changed`.
- **Moved payments keep `sent_at` earlier than the new period's `opened_at`.** No invariant forbids it. The UI uses exactly this (sent before the period opened) to mark a payment as carried over, so no new column is needed.
- **Rollback window.** After a `wrangler rollback` to the S-08 Worker, `get_current_billing_period` returns an extra `opening_debts` key that the old Worker ignores. That Worker would show balances without the carried debts until the next deploy. No data is lost. Smoke and the leftovers' removal do not affect this. The deploy plan records it.

## Phase 1: Drop the expand/contract leftovers

### Overview

Remove every RPC the app no longer calls, so that only version-guarded functions write billing periods. Retarget the smoke steps that still call leftovers.

### Changes Required:

#### 1. Contract migration

**File**: `supabase/migrations/<timestamp>_drop_leftover_rpcs.sql` (new; `npm run db:new drop_leftover_rpcs`)

**Intent**: Drop the leftover functions now that no deployed Worker calls them (the S-08 Worker calls only the current set).

**Contract**:

- `drop function` with exact signatures, for:
  - `create_group`, `add_expense`, `list_period_expenses`;
  - `save_billing_period`, `save_billing_period_changes`, `save_billing_period_with_payments`;
  - `create_group_invite`, `get_group_invite`, `redeem_group_invite`;
  - `get_my_group`, `list_my_groups`.
- Before writing the migration, confirm that each one is absent from `src/` and from the S-08 Worker's code (the same tree at `main`).
- Never touch `api_gate.check_app_request` or any function the app calls (`add_group`, `get_current_billing_period`, `open_billing_period`, `save_billing_period_with_confirmations`, `list_my_open_billing_months`, `get_group_aggregate`, `list_my_group_aggregates`, `get_group_by_invite_token`, `get_invite_preview`, `save_group`, the member-profile RPCs).
- Then `npm run db:reset && npm run db:types`.

#### 2. Smoke retargeting

**File**: `scripts/smoke.mjs`

**Intent**: Keep the app-key gate and backstop checks while calling only functions that still exist.

**Contract**:

- `firstUserCallsDirectly`'s default RPC becomes a current read-only function (`list_my_group_aggregates`).
- The step at `:835` calls `save_billing_period_with_confirmations` with the same intent.
- `creditorSendsInDebtorsNameDirectly` (`:289-291`) calls `save_billing_period_with_confirmations` with empty confirmation lists.
- Every expected status and code stays as it is.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves no diff
- No source or smoke reference to a dropped function: `grep -rnE "\b(create_group|add_expense|list_period_expenses|save_billing_period|save_billing_period_changes|save_billing_period_with_payments|create_group_invite|get_group_invite|redeem_group_invite|get_my_group|list_my_groups)\b" src scripts` finds nothing
- Type checking passes: `npx astro check`
- Unit tests pass: `npm test`
- Smoke passes, including the app-key gate and backstop steps: `npm run smoke`

#### Manual Verification:

- In Supabase Studio, none of the dropped functions is listed in schema `public`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Closing in the domain and persistence (test-first)

### Overview

Teach `BillingMonth` about month order, add opening debts to the balances, give `BillingPeriod` the close command and the oldest-first lock, add the service entry point, and persist the close in one guarded database call. Tests come first.

### Changes Required:

#### 1. Month order

**File**: `src/lib/billing-periods/billing-month.value.ts`

**Intent**: The domain decides "has the month ended" and "which month comes next" in one place, in Europe/Warsaw.

**Contract**: `next(): BillingMonth` (December rolls over to January of the next year), `previous(): BillingMonth`, and `hasEndedAt(now: Date): boolean` (true when `BillingMonth.of(now)` is a later month).

#### 2. Opening debt and balances

**Files**: `src/lib/billing-periods/opening-debt.value.ts` (new), `period-balances.value.ts`, `types.ts`

**Intent**: A debt carried from the previous period is an immutable value of the new period and counts in both of its balances.

**Contract**:

- `OpeningDebt { debtorId, creditorId, amount: Money }`. It refuses debtor = creditor and a non-positive amount.
- Snapshot: `OpeningDebtSnapshot { debtorId, creditorId, amountGrosze }`, and `BillingPeriodSnapshot.openingDebts`.
- `PeriodBalances.of` takes an optional `openingDebts`. Each one counts like an expense share of the debtor paid by the creditor: it adds to `owed[debtor][creditor]`, lowers the debtor's balance and raises the creditor's.
- The class comment describes the third input.

#### 3. BillingPeriod: close, refusal reason, carried payments and the oldest-first lock

**File**: `src/lib/billing-periods/billing-period.aggregate.ts`

**Intent**: The aggregate judges every close rule and produces the next period. The FR-005 lock settles carried debt first.

**Contract**:

- State, `restore` and `toSnapshot` carry `openingDebts`. `pendingBalances()` and `postedBalances()` both pass them to `PeriodBalances.of`.
- `closeRefusal({ userId, hostId, now }): BillingPeriodErrorCode | null` gives the first refusal, in this order:
  1. a closed period (`billing_period_closed`);
  2. a user who is not the host (`not_group_host`);
  3. a month that has not ended at `now` (`period_not_ended`);
  4. a host who is a debtor in `postedBalances().debts` (`host_has_debts`).
- `close({ userId, hostId, nextPeriodId, now }): Result<BillingPeriod>`:
  - refuses with `closeRefusal`;
  - otherwise marks this period closed at `now` (a pending write the repository reads) and returns the next period, which:
    - takes `month.next()`, `openedAt = now`, `version = 0` and the same participants;
    - gets one `OpeningDebt` per entry of `postedBalances().debts`;
    - gets every payment of this period that is pending, unchanged, as its stored payments;
    - has no expenses.
- `closedNow(): boolean` and `movedPaymentIds(): readonly string[]`, for the repository.
- `isCarried(payment): boolean`: the payment was sent before this period opened.
- `isLocked(expense)`: for each direction between the expense's payer and one of its sharers, the expense is locked when the sum of **confirmed** payments in that direction is greater than the opening debt in that direction (0 when none). Pending and rejected payments never count. The doc comment states the oldest-first rule and FR-005.

#### 4. Errors and types

**Files**: `src/lib/billing-periods/types.ts`, `billing-period-error.messages.ts`, `index.ts`

**Intent**: The close's refusal codes, with messages the page renders.

**Contract**:

- New codes and messages:
  - `not_group_host`: "Only the group's host can close the billing period"
  - `period_not_ended`: "This month has not ended yet; you can close it from the 1st of next month"
  - `host_has_debts`: "Settle your own debts from this month first; they must be confirmed by their recipients"
- The `BillingPeriodRepository` interface gains `close(closed: BillingPeriod, next: BillingPeriod): Promise<Result<"closed" | "conflict">>`.
- `index.ts` exports `OpeningDebt` only if components need the type.

#### 5. Service

**File**: `src/lib/billing-periods/billing-period.service.ts`

**Intent**: The endpoint's entry point. It is idempotent per period and retried once.

**Contract**:

- `closePeriod({ group, userId, periodId }): Promise<Result<void>>`. It takes `now` from the clock once and uses `group.hostId`, then follows the retry rule in Critical Implementation Details:
  - if the open period's id differs from `periodId`, it returns success (the period is already closed);
  - otherwise it runs `period.close`, then `repository.close`;
  - on `"conflict"` it reloads once and repeats the same checks;
  - after a second conflict it returns `period_changed`.
- `summarizeOpen` also returns the opening debts.
- The doc comments of `change`, `reload` and `openFor` say that after a close the latest period is the new open one.

#### 6. Migration

**File**: `supabase/migrations/<timestamp>_close_billing_period.sql` (new; `npm run db:new close_billing_period`)

**Intent**: Store opening debts and perform the close as one guarded write. Expand-only.

**Contract**:

- New table `public.opening_debts`:
  - columns `(group_id, period_id, debtor_id, creditor_id, amount integer check (amount > 0))`, primary key `(period_id, debtor_id, creditor_id)`;
  - `check (debtor_id <> creditor_id)`;
  - FK `(period_id, group_id)` to `billing_periods (id, group_id)` on delete cascade;
  - FKs `(group_id, debtor_id)` and `(group_id, creditor_id)` to `group_members`;
  - in the same migration: RLS enabled with no policies, and all grants revoked from `anon` and `authenticated` (`CLAUDE.md` rule for group-scoped tables).
- `get_current_billing_period` (`create or replace`) adds an `opening_debts` key: `[{debtor_id, creditor_id, amount}]`. Everything else stays.
- New `public.close_billing_period(p_period_id, p_group_id, p_expected_version, p_closed_at, p_next_period_id, p_next_month date, p_next_opened_at, p_opening jsonb, p_moved uuid[]) returns boolean`:
  - Backstops raise `42501` before any write:
    - the caller is the group's host (`groups.host_id = auth.uid()`);
    - `p_next_month` is exactly the closed period's month plus one month;
    - every id in `p_moved` is a payment of this period with `confirmed_at is null and rejected_at is null`;
    - every such pending payment of this period is in `p_moved`, so none is stranded;
    - every opening entry has two distinct members and a positive amount.
  - Version and open check: `update billing_periods set version = version + 1, closed_at = p_closed_at where id = … and group_id = … and version = p_expected_version and closed_at is null`. If no row is updated, return `false`.
  - Then: insert the next period (version 0), insert the opening debts, and `update payments set period_id = p_next_period_id where id = any(p_moved)`.
  - A unique violation (one open period per group, or `(group_id, month)`) surfaces as `23505`.
  - Setup: `security definer`, `set search_path = ''`, a "Persistence only" comment, execute revoked from `public, anon` and granted to `authenticated`.
- Then `npm run db:reset && npm run db:types`.

#### 7. Repository

**File**: `src/lib/billing-periods/billing-period.repository.ts`

**Intent**: Map opening debts and persist the close.

**Contract**:

- The snapshot mapping reads `opening_debts`.
- `close(closed, next)` calls `close_billing_period` with:
  - the closed period's id, group, version and `closedAt`;
  - the next period's id, month, `openedAt` and opening debts;
  - the closed period's `movedPaymentIds()`.
- It maps `false` and `23505` to `"conflict"`, and other errors through `fromDbError`. The `42501` comment mentions the host backstop.

#### 8. Tests and harness

**Files**:

- `__tests__/billing-month.value.test.ts`
- `__tests__/opening-debt.value.test.ts` (new)
- `__tests__/period-balances.value.test.ts`
- `__tests__/billing-period.aggregate.test.ts`
- `__tests__/billing-period.service.test.ts`
- `__tests__/billing-periods.harness.ts`

**Intent**: Drive the rules test-first. The fake repository implements `close`: it guards the version, refuses a second open period, stores the next period as the group's latest, and records the call.

**Contract**: The cases are listed under Testing Strategy.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the close, carry-forward, moved-payment and oldest-first lock cases: `npm test`
- Migration applies on a fresh database: `npm run db:reset`
- Generated types are up to date: `npm run db:types` leaves no diff
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Existing smoke flows still pass: `npm run smoke`

#### Manual Verification:

- In Supabase Studio, `opening_debts` has RLS on, no policies and no grants for `anon`/`authenticated`, and `close_billing_period` is executable by `authenticated` only
- Test names read as the rules (host only, month must have ended, host's posted debts block, balances unchanged across the close, pending payments move, oldest-first lock)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Close endpoint, group page and smoke

### Overview

The host closes the period from the group page. Everyone sees the carried debts and the moved payments. Smoke back-dates a period and walks the whole close.

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/groups/[id]/close.ts` (new)

**Intent**: Form POST following `payments/[paymentId]/confirm.ts`, reading the hidden `periodId`. The acting user is always `locals.user.id`.

**Contract**:

- It calls `closePeriod({ group, userId, periodId })` and redirects to `/groups/<id>`.
- On failure the redirect adds `?closeError=<code>`, with the code only.
- A missing form gives `closeError=unexpected`.

#### 2. Close panel

**File**: `src/components/expenses/ClosePeriodPanel.astro` (new)

**Intent**: The host's close action, with the US-02 refusal shown before any click.

**Contract**:

- Rendered only when `group.isHost(viewerId)` and the period is open.
- Props: `group`, `period`, `refusal: BillingPeriodErrorCode | null` (from `period.closeRefusal`), `error`.
- With a refusal, it shows the refusal's message and no button.
- Without one, it shows a `<details>` revealing a `data-guard-submit` form that posts `periodId` with "Yes, close <month>", plus the note that new-month expenses can be added after closing and that open debts carry over.
- The `closeError` banner renders through `billingPeriodErrorMessage`.

#### 3. Carried debts and moved payments

**Files**: `src/components/expenses/OpeningDebtList.astro` (new), `PaymentList.astro`

**Intent**: Show where a debt comes from when this month's expenses do not explain it.

**Contract**:

- `OpeningDebtList` takes `group`, `openingDebts`, `viewerId` and `previousMonthLabel`. It renders "Carried over from <month>" with one row per debt (labels via `memberLabel`), only when there is at least one.
- `PaymentList` appends "carried over from <month>" to rows where `period.isCarried(payment)`. That needs a `period` (or a carried-ids set) prop. The actions are unchanged.

#### 4. Page wiring

**File**: `src/pages/groups/[id].astro`

**Intent**: Wire the panel, the list and the new error parameter.

**Contract**:

- Read `closeError` like the other error parameters.
- Compute `refusal` with `period.closeRefusal({ userId, hostId: group.hostId, now })`. The page takes `now` from the request time; the service still re-judges it.
- Render `ClosePeriodPanel` near the GroupCard, and `OpeningDebtList` above `ExpenseList`.
- Pass the carried-payment information to `PaymentList`.

#### 5. Smoke: back-dating and the close flow

**Files**: `scripts/smoke.mjs`, `.github/workflows/ci.yml`, `.env.example` (if present)

**Intent**: Prove the close end to end against a running server and local Supabase.

**Contract**:

- New env `SUPABASE_SERVICE_ROLE_KEY`, local only:
  - CI's smoke job adds `SERVICE_ROLE_KEY` to the `supabase status -o env` grep and writes it to `.env`;
  - smoke fails fast with a clear message if the key is missing;
  - the key is never a production secret.
- Helper `backdatePeriod(groupId)`: a `PATCH` on `billing_periods` with the service-role key and the app key, setting the open period's `month` to the first day of the previous month.
- Flow on a new two-member group (host H, member M):
  1. H pays an expense of 100,00 split equally, so M owes H 50,00. M sends a payment of 20,00, which stays pending.
  2. H's close is refused with `period_not_ended`. M's close is refused with `not_group_host`, and M's page has no close panel.
  3. A direct `close_billing_period` call by M is refused with 403 and `"code":"42501"`.
  4. `backdatePeriod`. H's page shows the "Yes, close" confirmation. H closes.
  5. Posting the same `periodId` again redirects without an error.
  6. The page shows the current month, "Carried over from <previous month>" with M → H 50,00, M's pending debt 30,00, and the 20,00 payment marked "carried over".
  7. H confirms the moved payment. H adds a new-month expense of 40,00 split equally, and it keeps its Edit link (confirmed 20,00 ≤ carried 50,00).
  8. M pays 50,00 and H confirms it (confirmed 70,00 > carried 50,00), so H's new expense shows "locked".

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke passes, including the back-dated close flow: `npm run smoke`

#### Manual Verification:

- Two browsers, after back-dating locally:
  - the host closes the period;
  - the member sees the carried debt and the moved payment;
  - balances match what was shown before the close
- Before back-dating, the host's panel shows "This month has not ended yet…", and a host who owes money sees the debts message and no button
- A non-host never sees the panel
- The panel, the carried section and the Payments marker read well at phone width (NFR-1)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Docs, PRD, roadmap and GitHub

### Overview

Align the documents that define the behaviour with the decisions of this slice.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md` (Polish, like the rest of the file)

**Intent**: The close carries debts and pending payments over, and the lock settles carried debt first.

**Contract**:

- **FR-015 and US-02**:
  - closing opens the period of the next calendar month;
  - the non-zero settled (posted) debts between members pass into it as debts carried over from the previous month;
  - payments awaiting confirmation pass into it and can still be confirmed or rejected there;
  - expenses stay in the closed period, which is immutable.
- **FR-005**: a confirmed payment first settles the debt carried over from the previous period. It locks the pair's expenses only once the pair's confirmed payments in the period exceed that carried debt.
- §Business rules (`prd.md:120`): the same in one sentence.

#### 2. Roadmap, test plan and GitHub

**Files**: `context/foundation/roadmap.md`, `context/foundation/test-plan.md`; GitHub issue #14 and the project board

**Intent**: Record the decisions and close the unknowns.

**Contract**:

- **S-09 unknowns**:
  - pending payments: resolved (moved, 2026-10-23);
  - next period month: resolved (cannot start after today, since the next month follows a month that has ended);
  - leftovers prerequisite: resolved by Phase 1;
  - the resolved `add_expense` unknown (`:245`) notes that a retry after a close now lands on the new period.
- S-09 outcome: debts carry over.
- A new proposed slice for viewing closed periods (read-only history). Ask the user before creating its GitHub issue.
- `test-plan.md` risk map: add the period-close risks (balance invariant across the close, host-only, Warsaw month end).
- Issue #14's body is edited **only after the user confirms** (public content). The PR carries `Closes #14`.

#### 3. CLAUDE.md and deploy plan

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: Describe closing, opening debts, the new database objects and the dropped leftovers.

**Contract**:

- `CLAUDE.md`:
  - Status: period closing exists (host-only, carry-forward, moved payments, oldest-first lock); remove "Period closing is still to be built".
  - Structure: `close.ts`, `ClosePeriodPanel`, `OpeningDebtList`, `OpeningDebt`.
  - Database changes: an `opening_debts` bullet; `close_billing_period` with its backstops; the concurrency bullet (closing bumps `version` and opens the next period in the same call; a retry lands on the new period); the expand/contract leftovers bullet reduced to what remains.
  - Commands: smoke covers the close and needs `SUPABASE_SERVICE_ROLE_KEY` (local).
- `deploy-plan.md`:
  - a "Period closing (S-09)" section: expand-only table and function, the leftovers' drop, no production configuration change (the service-role key is local or CI only);
  - the rollback note from Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation/roadmap.md context/foundation/test-plan.md context/deployment/deploy-plan.md`
- Linting passes: `npm run lint`

#### Manual Verification:

- The PRD's FR-005/FR-015/US-02 and the roadmap's S-09 read consistently with the decisions
- The user approves the edit to GitHub issue #14 (and any new history-slice issue) before it is applied

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `BillingMonth`:
  - `next()` rolls December over to January;
  - `previous()` is its inverse;
  - `hasEndedAt` is false on the last day of the month at 23:30 Warsaw time and true at 00:30 on the 1st (UTC instants around the Warsaw midnight, including DST months).
- `OpeningDebt`: refuses the same member on both sides, and zero or negative amounts.
- `PeriodBalances`:
  - an opening debt alone gives the debtor −amount, the creditor +amount and one pair debt;
  - an opening debt combined with an expense in the opposite direction nets;
  - an opening debt plus a payment settles it.
- `BillingPeriod.close`:
  - refusals in order: closed period, not host, month not ended, host owes on posted balances;
  - a host whose only debt is covered by a pending payment is still refused;
  - a host who is only a creditor may close;
  - the next period has `month.next()`, version 0, no expenses, one opening debt per posted pair debt, and exactly the pending payments;
  - confirmed and rejected payments stay behind;
  - **invariant**: for random small ledgers, the next period's pending and posted balances (members and debts) equal the old period's;
  - `closeRefusal` returns the same codes as `close`.
- `isCarried`: true only for a payment sent before the period opened.
- `isLocked` (oldest-first):
  - with no opening debt, behaves as in S-08;
  - confirmed payments up to the carried amount do not lock;
  - one grosz above it locks the pair's expenses, in both directions and including later ones;
  - a confirmed payment in the direction opposite to the opening debt locks;
  - pending and rejected payments never count.
- `BillingPeriodService.closePeriod`:
  - success calls `repository.close` once;
  - a `periodId` that is not the open period succeeds without a write;
  - a conflict reloads, and if the period was closed meanwhile it succeeds;
  - a second conflict gives `period_changed`.
- After a close, `confirmPayment` on a moved payment succeeds in the new period.

### Integration Tests:

- `npm run smoke`: Phase 1's retargeted steps and Phase 3's close flow, including the direct-RPC host backstop.

### Manual Testing Steps:

1. Locally, back-date a group's period in Supabase Studio (or with the smoke helper), with a member owing the host and a pending payment.
2. As the host, close the period. Check the new month, the carried section, the moved payment and unchanged balances.
3. As the member, confirm the payment flow and the lock behaviour around the carried amount.
4. As a non-host, and before back-dating, check the panel's absence or its refusal text.

## Performance Considerations

None. A close writes one period update, one insert, at most n·(n−1)/2 opening rows and a handful of payment updates for a household-size group.

## Migration Notes

- Phase 1's migration only drops functions that no deployed Worker calls. The S-08 Worker calls only current functions.
- Phase 2's migration adds a table, a function and a key in `get_current_billing_period`. It is compatible with the S-08 Worker, which ignores the new key and never closes a period.
- The rollback caveat is in Critical Implementation Details.
- Local databases need `npm run db:reset`.

## References

- Research and decisions: `context/changes/host-closes-period/research.md` (Decisions 1–3, archetype sources)
- S-08 plan: `context/changes/confirm-debt-paid/plan.md` (pattern for phases, backstops and smoke)
- PRD: `context/foundation/prd.md` US-02, FR-005, FR-015; Roadmap: `context/foundation/roadmap.md` S-09
- Patterns:
  - `src/lib/billing-periods/billing-period.aggregate.ts:304-381` (refusal order, pending writes)
  - `src/lib/billing-periods/billing-period.service.ts:248-285` (`change`, `reload`)
  - `src/pages/api/groups/[id]/payments/[paymentId]/confirm.ts` (form POST)
  - `src/pages/groups/[id]/expenses/[expenseId]/edit.astro:66-75` (`<details>` confirmation)
  - `supabase/migrations/20261022182930_payment_confirmations.sql` (backstops before the version bump)
  - `scripts/smoke.mjs` `debtorConfirmsOwnPaymentDirectly` (direct-RPC backstop check)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drop the expand/contract leftovers

#### Automated

- [x] 1.1 Migration applies on a fresh database: `npm run db:reset` — fb11323
- [x] 1.2 Generated types are up to date: `npm run db:types` leaves no diff — fb11323
- [x] 1.3 No source or smoke reference to a dropped function: `grep -rnE "\b(create_group|add_expense|list_period_expenses|save_billing_period|save_billing_period_changes|save_billing_period_with_payments|create_group_invite|get_group_invite|redeem_group_invite|get_my_group|list_my_groups)\b" src scripts` finds nothing — fb11323
- [x] 1.4 Type checking passes: `npx astro check` — fb11323
- [x] 1.5 Unit tests pass: `npm test` — fb11323
- [x] 1.6 Smoke passes, including the app-key gate and backstop steps: `npm run smoke` — fb11323

#### Manual

- [x] 1.7 In Supabase Studio, none of the dropped functions is listed in schema `public` — fb11323

### Phase 2: Closing in the domain and persistence (test-first)

#### Automated

- [x] 2.1 Unit tests pass, including the close, carry-forward, moved-payment and oldest-first lock cases: `npm test` — c1e1ee9
- [x] 2.2 Migration applies on a fresh database: `npm run db:reset` — c1e1ee9
- [x] 2.3 Generated types are up to date: `npm run db:types` leaves no diff — c1e1ee9
- [x] 2.4 Type checking passes: `npx astro check` — c1e1ee9
- [x] 2.5 Linting passes: `npm run lint` — c1e1ee9
- [x] 2.6 Existing smoke flows still pass: `npm run smoke` — c1e1ee9

#### Manual

- [x] 2.7 In Supabase Studio, `opening_debts` has RLS on, no policies and no grants for `anon`/`authenticated`, and `close_billing_period` is executable by `authenticated` only — c1e1ee9
- [x] 2.8 Test names read as the rules (host only, month must have ended, host's posted debts block, balances unchanged across the close, pending payments move, oldest-first lock) — c1e1ee9

### Phase 3: Close endpoint, group page and smoke

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — bfa283a
- [x] 3.2 Type checking passes: `npx astro check` — bfa283a
- [x] 3.3 Linting passes: `npm run lint` — bfa283a
- [x] 3.4 Production build succeeds: `npm run build` — bfa283a
- [x] 3.5 Smoke passes, including the back-dated close flow: `npm run smoke` — bfa283a

#### Manual

- [x] 3.6 Two browsers, after back-dating locally: the host closes the period; the member sees the carried debt and the moved payment; balances match what was shown before the close — bfa283a
- [x] 3.7 Before back-dating, the host's panel shows "This month has not ended yet…", and a host who owes money sees the debts message and no button — bfa283a
- [x] 3.8 A non-host never sees the panel — bfa283a
- [x] 3.9 The panel, the carried section and the Payments marker read well at phone width (NFR-1) — bfa283a

### Phase 4: Docs, PRD, roadmap and GitHub

#### Automated

- [x] 4.1 Formatting passes on the edited documents: `npx prettier --check CLAUDE.md context/foundation/roadmap.md context/foundation/test-plan.md context/deployment/deploy-plan.md` — de7a0d6
- [x] 4.2 Linting passes: `npm run lint` — de7a0d6

#### Manual

- [x] 4.3 The PRD's FR-005/FR-015/US-02 and the roadmap's S-09 read consistently with the decisions — de7a0d6
- [x] 4.4 The user approves the edit to GitHub issue #14 (and any new history-slice issue) before it is applied — de7a0d6
