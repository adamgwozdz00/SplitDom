# Add an Expense and See Balances Implementation Plan

## Overview

Roadmap slice S-04 (north star; PRD US-01, FR-004, FR-005). A group member adds an expense (title, amount, purchase date) to the group's open billing period. It is split equally between the group's members at that moment, with the payer absorbing the leftover grosze. The group page then shows every member's balance and the netted "who owes whom" debt of each pair of members for the period.

## Current State Analysis

From `context/changes/add-expense-see-balances/research.md`:

- **The group already gives the expense everything it depends on.** `Group` holds `members: {userId, joinedAt}[]` and exactly one `openPeriod {id, month: BillingMonth, openedAt}` (`src/lib/groups/types.ts:13-22`, `src/lib/groups/group.aggregate.ts:5-35`). `GroupService.getForMember` returns `group_not_found` both for non-members and for unknown or malformed ids (`src/lib/groups/group.service.ts:53-65`).
- **S-03 shows how one aggregate depends on another.** The endpoint loads the `Group`, then a second aggregate takes it as input: `Invite.create({ group, ... })` (`src/lib/invites/invite.aggregate.ts:48-51`, `src/pages/api/groups/[id]/invites.ts:20-28`).
- **Nothing money-related exists**, neither in `src/` nor in the 6 migrations. This plan sets the precedent: integer grosze, a `Money` value object, Polish formatting.
- **No function exposes member identities.** `get_my_group` returns members as `{user_id, joined_at}` (`supabase/migrations/20261002200553_settlement_groups.sql:126`). Its parser ignores unknown keys (`src/lib/groups/group.repository.ts:89-115`), so adding a key is compatible with the deployed Worker.
- **`group_members.user_id` cascades on user delete** (`settlement_groups.sql:26`). This was flagged for S-04 in `context/deployment/deploy-plan.md:115`.
- **The group page has one `?error=` parameter**, and it is read only as an invite error (`src/pages/groups/[id].astro:34-35`).
- **No database tests exist** (removed in `d4e4668`). Coverage is unit tests on in-memory harnesses plus `scripts/smoke.mjs`.
- **Database conventions** (CLAUDE.md "Database changes"; `settlement_groups.sql`, `group_invites.sql`):
  - Tables: RLS on with no policies, grants revoked, no column defaults.
  - Functions: `public` `security definer` with `search_path = ''`, an `auth.uid()` null check and a membership check. Reads return snake_case jsonb.
  - Errors: SQLSTATE `28000`, `42501`, `22023`, or custom `SD0xx` (only `SD001` exists so far).

## Desired End State

On `/groups/<id>`, a member sees:

- an "Add expense" form: title, amount and purchase date, with the date defaulting sensibly;
- the balance of each member ("You" or an email) for the open period;
- a list of netted pair debts ("b@example.com owes You 200,00 zł");
- the open period's expenses.

After adding "Czynsz" 400,00 zł in a two-member group, the page shows:

- the payer at +200,00 zł;
- the other member at −200,00 zł;
- one debt of 200,00 zł from the other member to the payer.

For 100,00 zł among 3 members, the debtors' shares are 33,33 zł each and the payer's is 33,34 zł. Shares always sum to the expense, and balances always sum to zero.

Verify with `npm test`, `npx astro check`, `npm run lint` and `npm run smoke` (which adds the two-user expense steps), plus a manual pass on a phone-width browser.

### Key Discoveries:

- `GroupName` is the model for a validated text value object: trim, code-point length, visible character, and `fromStored` for lenient restore (`src/lib/groups/group-name.value.ts:7-33`).
- `BillingMonth.of(instant)` maps a moment to its Europe/Warsaw month, and `fromDate("YYYY-MM-01")` parses a stored month (`src/lib/groups/billing-month.value.ts:2-37`). A purchase date's month is compared with the period month through it.
- Repository factories pass `() => crypto.randomUUID()` and `() => new Date()` as arrows, because of workerd's "Illegal invocation" (`src/lib/groups/group.repository.ts:59-69`).
- Under the chosen grosze rule every debtor gets exactly `floor(amount / n)`, so the split does not depend on member order. No tie-break is needed.
- Under pair netting, a member's balance equals the sum of debts owed to them minus the sum they owe. This is a cross-check usable in tests.
- `create or replace function` keeps the existing grants, so redefining `get_my_group` needs no new `grant` statements.

## What We're NOT Doing

- No debt entity, transfer details, "sent" or "paid" markers. S-06, S-07 and S-08 add these, on the pair-per-period debt this plan derives.
- No edit or delete of expenses (S-05), and no period closing (S-09).
- No display names or profile (S-10, nice-to-have). Labels are "You" or the member's email.
- No custom split or choice of payer (FR-014). The payer is always the signed-in author.
- No group-wide minimal transfer set (FR-006), and no categories (FR-011).
- No shared `Result` or error module. `expenses` declares its own copy, as `invites` did.
- No database tests (they were removed by user decision). No new test dependency: invariants are checked over a fixed grid of inputs.

## Implementation Approach

Domain first, then persistence, then web, following S-02 and S-03.

- **New module `src/lib/expenses/`.**
  - Value objects: `Money`, `ExpenseTitle`, `PurchaseDate`.
  - The `Expense` aggregate computes its shares when it is created.
  - `PeriodBalances` derives member balances and netted pair debts from the period's expenses.
  - `ExpenseService` is the only entry point.
- **Persistence.** Two tables (`expenses`, `expense_shares`) behind two persistence functions. One function writes an expense together with its shares in one transaction; the other loads a period's expenses for a member.
- **Member labels.** `get_my_group` is extended with each member's email, and `Group.memberLabel` becomes the single labelling rule. S-10 will change only its source.
- **Web.** One form-POST endpoint, plus three Astro components on the group page.

## Critical Implementation Details

- **Purchase date window.** Valid dates run from the first day of the open period's month to `min(last day of that month, today in Europe/Warsaw)`. The form default is today when today falls in the period month. Otherwise the default is the period month's last day: this happens when the month has ended but the host has not closed it yet. `PurchaseDate` owns this rule, and the form's `min`, `max` and `value` come from it, so the UI and the aggregate never disagree.
- **Migration compatibility.** The migration ships before the Worker (`deploy` runs `db push` first). The redefined `get_my_group` only adds a key, and the new functions are unused by the old Worker, so the previously deployed Worker keeps working.

## Phase 1: Expenses domain

### Overview

A pure TypeScript module with value objects, the aggregate, balance derivation, the service and the error messages, plus a fake repository and unit tests. There is no database and no UI yet.

### Changes Required:

#### 1. Module scaffolding

**File**: `src/lib/expenses/index.ts`, `src/lib/expenses/types.ts`, `src/lib/expenses/expense-error.messages.ts`

**Intent**: Give the module its public surface, types and error messages, following `src/lib/groups/`.

**Contract**:

- `ExpenseErrorCode = "invalid_expense_title" | "invalid_amount" | "invalid_purchase_date" | "group_not_found" | "not_authenticated" | "unexpected"`.
- `ExpenseError { error: { code, message, context } }` and the module's own `Result<T>`.
- `ExpenseSnapshot`, with amounts as integer grosze and `purchasedOn` as `YYYY-MM-DD`.
- `ExpenseRepository { add(expense): Promise<Result<void>>; listForPeriod(groupId, periodId): Promise<Result<Expense[]>> }`.
- `expenseErrorMessage(code: string)`, which falls back to a generic message for unknown codes, and `expenseError(code, context)`.
- `EXPENSES_LOAD_FAILED_MESSAGE`.
- `index.ts` never imports `@/lib/supabase`.

#### 2. `Money` value object

**File**: `src/lib/expenses/money.value.ts`

**Intent**: Represent an amount as signed integer grosze, parse the form's input, and format amounts for display. Expense amounts and balances share it.

**Contract**:

- `Money.parse(raw): Result<Money>` accepts a trimmed string matching digits with an optional `,` or `.` and 1–2 decimals, with no thousands separators. The range is 0,01–1 000 000,00 zł (1–100 000 000 grosze); anything else gives `invalid_amount`.
- `Money.ofGrosze(n)` requires a safe integer.
- `grosze`, `plus`, `minus`, `isZero`, `isPositive`.
- `label()` formats with `Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })` (e.g. "400,00 zł").
- `signedLabel()` adds `+` or `−` except for zero.

#### 3. `ExpenseTitle` and `PurchaseDate` value objects

**File**: `src/lib/expenses/expense-title.value.ts`, `src/lib/expenses/purchase-date.value.ts`

**Intent**: Validate the title the same way `GroupName` does. Own the purchase-date window rule described in Critical Implementation Details.

**Contract**:

- `ExpenseTitle.create(raw): Result<ExpenseTitle>`: 1–60 code points, at least one visible character; otherwise `invalid_expense_title`. `fromStored(value)` restores leniently.
- `PurchaseDate.create(raw, { month: BillingMonth, now: Date }): Result<PurchaseDate>`: format `YYYY-MM-DD`, a real calendar date, inside the window; otherwise `invalid_purchase_date`.
- `PurchaseDate.window(month, now) → { min, max, default }`, as `YYYY-MM-DD` strings for the form.
- `fromStored(value)`, `value` (`YYYY-MM-DD`), `month(): BillingMonth`, `label()` (English, e.g. "5 Oct 2026", formatted in UTC so it never shifts).
- Today is the Europe/Warsaw calendar date of `now`.

#### 4. `Expense` aggregate

**File**: `src/lib/expenses/expense.aggregate.ts`

**Intent**: Model one expense and its stored equal split, with the payer absorbing the leftover grosze.

**Contract**:

- `Expense.add({ id, group: Group, payerId, title, amount: Money, purchasedOn: PurchaseDate, now }): Result<Expense>`:
  - when the payer is not a group member, returns `group_not_found`;
  - stores `groupId = group.id` and `periodId = group.openPeriod.id`;
  - creates one share per current member: `floor(amount / n)` each, with the remainder (`amount mod n`, fewer than n grosze) added to the payer's share.
- `Expense.restore(snapshot)` throws on an invalid snapshot. The shares must:
  - be non-empty;
  - contain the payer;
  - have non-negative amounts;
  - have unique users;
  - sum to `amount`.
- `toSnapshot()`.
- Read-only fields: `id`, `groupId`, `periodId`, `payerId`, `title`, `amount`, `purchasedOn`, `createdAt`, and `shares: readonly { userId, amount: Money }[]`.

#### 5. `PeriodBalances`

**File**: `src/lib/expenses/period-balances.value.ts`

**Intent**: Derive each member's balance and the netted pair debts from a period's expenses. These pair debts are what S-06 and S-08 will act on.

**Contract**:

- `PeriodBalances.of({ memberIds: readonly string[], expenses: readonly Expense[] })` builds two lists:
  - `members: { userId, balance: Money }[]`: one entry per member id in the given order, where balance = paid − own shares. A member without expenses has a zero balance.
  - `debts: { debtorId, creditorId, amount: Money }[]`: one entry per pair with a non-zero net. A owes B = (A's shares in B-paid expenses) − (B's shares in A-paid expenses), positive direction only. Sort the list by debtor, then creditor, in member order.
- Invariants:
  - balances sum to zero;
  - each member's balance = Σ debts owed to them − Σ debts they owe;
  - no pair appears in both directions.

#### 6. `ExpenseService`

**File**: `src/lib/expenses/expense.service.ts`

**Intent**: The module's only entry point. It parses raw form input into value objects, creates and stores the aggregate, and loads the period summary.

**Contract**:

- Constructor: `(repository, newId: () => string, clock: () => Date)`.
- `add({ group, payerId, title, amount, purchasedOn }: raw strings + Group): Promise<Result<{ expenseId }>>` validates in the order title → amount → date, then calls `Expense.add`, then `repository.add`.
- `summarizeOpenPeriod(group): Promise<Result<{ expenses: Expense[]; balances: PeriodBalances }>>` loads `listForPeriod(group.id, group.openPeriod.id)`. Expenses are sorted by `purchasedOn` desc, then `createdAt` desc. Balances are computed over `group.members` in join order.
- Repository errors pass through unchanged.

#### 7. Unit tests and harness

**File**: `src/lib/expenses/__tests__/expenses.harness.ts`, `money.value.test.ts`, `expense-title.value.test.ts`, `purchase-date.value.test.ts`, `expense.aggregate.test.ts`, `period-balances.value.test.ts`, `expense.service.test.ts`

**Intent**: Prove the split and balance rules with expected values taken from the PRD, and check invariants over a fixed grid of inputs.

**Contract**:

- `FakeExpenseRepository` follows the groups harness: it records calls and has a forced `failure` field.
- Builders `anExpense(...)` and `aGroup(...)` build the group through the `@/lib/groups` public API.
- Cases are listed in Testing Strategy.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Reviewer confirms the test names cover US-01 (400 zł by 2 → 200 zł), the 100 zł / 3 example and the netting example from Testing Strategy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Database and repositories

### Overview

One migration adds the expense tables and functions, exposes member emails through `get_my_group`, and makes `group_members.user_id` restrict. Then the generated types are regenerated, the Supabase expense repository is added, and the group repository and aggregate learn member emails and labels.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_expenses.sql` (created with `npm run db:new expenses`)

**Intent**: Persist expenses and their shares under the group-scoped table recipe. Expose member emails to co-members only. Stop user deletion from silently removing a member.

**Contract**:

Tables. Each one has `comment on table` naming the `Expense` aggregate, RLS enabled with no policies, and `revoke all ... from anon, authenticated`. There are no column defaults.

- `public.expenses`:
  - `id uuid primary key`
  - `group_id uuid not null references public.groups (id) on delete cascade`
  - `period_id uuid not null`, with `foreign key (period_id, group_id) references public.billing_periods (id, group_id) on delete cascade` (needs `unique (id, group_id)` on `billing_periods`, added in this migration), so a period always belongs to the expense's group
  - `payer_id uuid not null`, with `foreign key (group_id, payer_id) references public.group_members (group_id, user_id)`, so the payer is always a member of that group
  - `title text not null check (char_length(title) between 1 and 60)`
  - `amount integer not null check (amount between 1 and 100000000)`, in grosze
  - `purchased_on date not null`
  - `created_at timestamptz not null`
  - `unique (id, group_id)`
  - index on `(period_id)`
- `public.expense_shares`:
  - `expense_id uuid not null`, `group_id uuid not null`, with `foreign key (expense_id, group_id) references public.expenses (id, group_id) on delete cascade`
  - `user_id uuid not null`, with `foreign key (group_id, user_id) references public.group_members (group_id, user_id)`, so every share belongs to a member of the expense's group
  - `amount integer not null check (amount >= 0)`
  - `primary key (expense_id, user_id)`

No business rule lives in SQL (user decision, 2026-10-05): "the period is open", "shares go to current members" and "shares sum to the amount" are enforced by `Group` and `Expense` in TypeScript. The database keeps only structural integrity (foreign keys, `not null`, single-column `check` backstops) and the `auth.uid()` scoping that CLAUDE.md requires of every persistence function. A period closed between loading the group and storing the expense is a concurrency question for S-09, not for SQL here.

Functions:

- `public.add_expense(p_expense_id uuid, p_group_id uuid, p_period_id uuid, p_payer_id uuid, p_title text, p_amount integer, p_purchased_on date, p_created_at timestamptz, p_shares jsonb) returns void`. It only persists: after the three `auth.uid()` scoping checks below, it inserts the expense and its shares (from `[{user_id, amount}]`, with `group_id` taken from `p_group_id`) in one transaction, with no `on conflict`:
  1. `28000` when not signed in.
  2. `42501` when `p_payer_id` is not `auth.uid()`.
  3. `42501` when the caller is not a member of `p_group_id`.

  There is no custom SQLSTATE and no period or share validation; a violated foreign key surfaces as `23503`.

- `public.list_period_expenses(p_group_id uuid, p_period_id uuid) returns jsonb`, `stable`:
  - null for a non-member;
  - otherwise an array (`[]` when empty) of `{id, group_id, period_id, payer_id, title, amount, purchased_on, created_at, shares: [{user_id, amount}]}`.

Both functions:

- `security definer`, `set search_path = ''`;
- `comment on function` saying "Persistence only — business rules live in src/lib/expenses";
- `revoke execute ... from public, anon` and `grant execute ... to authenticated`.

Other statements:

- `create or replace function public.get_my_group(p_group_id uuid)` with the same body, plus `'email', u.email` per member through a join on `auth.users`. This also changes `list_my_groups`, which calls it.
- `alter table public.group_members drop constraint group_members_user_id_fkey, add constraint group_members_user_id_fkey foreign key (user_id) references auth.users (id);`, which is restrict, like `groups.host_id`.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate after `npm run db:reset`.

**Contract**: Produced by `npm run db:types`, never edited by hand.

#### 3. Supabase expense repository and factory

**File**: `src/lib/expenses/expense.repository.ts`

**Intent**: Map the aggregate to and from the two RPCs, following `group.repository.ts` and `invite.repository.ts`.

**Contract**:

- `createSupabaseExpenseRepository(client: SupabaseClient<Database>)`: `add` calls `add_expense`, with shares as jsonb. `listForPeriod` calls `list_period_expenses`; a null result maps to `group_not_found`.
- `fromDbError`:
  - `28000` → `not_authenticated`
  - `42501` → `group_not_found`
  - anything else (including `23503`) → `unexpected {dbCode}`
- Snapshot parsing uses throwing helpers inside try/catch, mapping failures to `unexpected`.
- `createExpenseService(client)` passes `() => crypto.randomUUID()` and `() => new Date()` as arrows.
- Exported from `index.ts`.

#### 4. Member email and the labelling rule in `groups`

**File**: `src/lib/groups/types.ts`, `src/lib/groups/group.aggregate.ts`, `src/lib/groups/group.repository.ts`, `src/lib/groups/__tests__/*`

**Intent**: Carry each member's email from `get_my_group`, and put the single member-labelling rule on `Group`. S-10 will change only the source of the label.

**Contract**:

- `GroupMember` gains `email: string | null`, and so does the snapshot member.
- `Group.create` sets the host's email to `null`, because the email is not persisted by `create_group`.
- The repository parses `email` as a string or null.
- `Group.memberLabel(userId, viewerId): string` returns:
  - `"You"` when `userId === viewerId`;
  - otherwise the member's email;
  - `"Member"` when the email is null or the user is not a member.
- Tests are updated for the new field and the label cases.

### Success Criteria:

#### Automated Verification:

- Local database rebuilds from all migrations: `npm run db:reset`
- Generated types are current: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean after the commit
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Existing smoke flows still pass: `npm run smoke`

#### Manual Verification:

- Supabase Advisor shows no new warnings beyond the expected lints 0029/0008 for the new functions and tables

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Group page, endpoint, smoke and docs

### Overview

Wire the add-expense form and the balances view into `/groups/[id]`, extend the smoke test with a two-user expense flow, and update the docs.

### Changes Required:

#### 1. Add-expense endpoint

**File**: `src/pages/api/groups/[id]/expenses.ts`

**Intent**: Form POST that adds an expense for the signed-in member, following `api/groups/[id]/invites.ts`.

**Contract**:

1. Redirect to `/auth/signin` when there is no user.
2. `formData().catch(() => null)`. A null body redirects with `expenseError=unexpected`.
3. Call `createClient`.
4. Load the group with `GroupService.getForMember`, then call `ExpenseService.add({ group, payerId: user.id, title, amount, purchasedOn })`.
5. On error, redirect to `/groups/<id>?expenseError=<code>`. On success, redirect to `/groups/<id>`.

The route is already protected by the `/api/groups` prefix (`src/middleware.ts:4`).

#### 2. Group page and expense components

**File**: `src/pages/groups/[id].astro`, `src/components/expenses/ExpenseForm.astro`, `src/components/expenses/BalancesPanel.astro`, `src/components/expenses/ExpenseList.astro`

**Intent**: Show the add form, the balances, the pair debts and the open period's expenses for a member. A failure to load expenses must not hide the rest of the page.

**Contract**:

- **Page.** After loading the group, the page calls `createExpenseService(supabase).summarizeOpenPeriod(group)`. On error it shows `EXPENSES_LOAD_FAILED_MESSAGE` in the expenses section only. `?expenseError=` is rendered through `expenseErrorMessage(code)` in the form, separately from `?error=`, which is still used for invites.
- **`ExpenseForm`** contains:
  - a title field, `maxlength=60`;
  - an amount field, `inputmode="decimal"` with a "zł" suffix;
  - a date input whose `min`, `max` and `value` come from `PurchaseDate.window(group.openPeriod.month, now)`;
  - a submit button that is disabled on submit and re-enabled on `pageshow`, as in `CreateGroupForm.astro`;
  - an error shown as `<p role="alert">`, with `aria-invalid` and `aria-describedby` on the inputs.
- **`BalancesPanel`** lists each member as `group.memberLabel(id, viewerId)` with `balance.signedLabel()`. Debts are written "<debtor> owes <creditor> <amount>", using the same label rule; when the debtor is the viewer the verb is "owe" ("You owe b@example.com 200,00 zł"). When there are no debts, it shows "All settled".
- **`ExpenseList`** shows title, `amount.label()`, payer label and `purchasedOn.label()`, newest first. When empty, it shows "No expenses in <period label> yet".
- The page stays usable at phone width (NFR-1).

#### 3. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove the US-01 flow end to end with two users, plus the isolation and anonymous checks.

**Contract**: New steps in the existing declarative list. Every step that depends on a group id fails explicitly when the id was not captured.

After the second user joins group A (after `"new member sees the group"`):

- The second user posts "Czynsz" 400,00 to group A, with today's date in Warsaw: expect a 302 to `/groups/<A>`.
- Group A shows "Czynsz" and "200,00".
- An invalid amount `abc` gives a 302 with `expenseError=invalid_amount`.
- Posting an expense to group B, where the second user is not a member, gives a 302 with `expenseError=group_not_found`.

After the second user signs out:

- Posting an expense redirects to `/auth/signin`.

Then:

- The first user signs in again and sees "200,00" on group A, owed by them.
- The first user signs out.

#### 4. Docs

**File**: `CLAUDE.md`, `context/deployment/deploy-plan.md`, `context/foundation/roadmap.md`

**Intent**: Record the new module, the money convention, the restrict change and the resolved roadmap unknowns.

**Contract**:

- **`CLAUDE.md`:**
  - Status: expenses and balances exist.
  - Structure: `src/lib/expenses/`, `src/components/expenses/`, `api/groups/[id]/expenses.ts`.
  - Database changes: money is stored as integer grosze; no user FK cascades.
  - The `npm run smoke` description covers the expense flow.
- **`deploy-plan.md`:** the "Known constraints on deleting a user" section says a member's account can no longer be deleted while they belong to a group, the same as the host.
- **`roadmap.md`, S-04 Unknowns:**
  - Debt granularity is resolved: a netted debt per pair of members per period, derived from shares stored per expense.
  - Rounding is resolved: integer grosze; debtors pay `floor(amount / n)` and the payer absorbs the remainder.
  - Both are dated 2026-10-05, with a pointer to this plan.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes with the new expense steps: `npm run smoke`

#### Manual Verification:

- In two browsers (two users in one group), adding "Czynsz" 400,00 zł shows +200,00 zł / −200,00 zł and "… owes … 200,00 zł" to both users immediately after the redirect
- Adding 100,00 zł in a three-member group shows the payer's share absorbing the extra grosz (debtors owe 33,33 zł each)
- The form shows a readable error for an empty title, `0`, `1000000,01` and a date outside the window; the date picker offers only days in the window
- The group page is usable at phone width (375 px), and a double tap on "Add expense" stores one expense

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **`Money`:**
  - accepts `"400"` → 40000, `"400,5"` → 40050, `"400.50"` → 40050, `"0,01"` → 1, `" 12 "` → 1200, `"1000000"` → 100000000;
  - rejects `""`, `"0"`, `"0,00"`, `"-5"`, `"12,345"`, `"1.234,50"`, `"1 234"`, `"1000000,01"`, `"abc"`;
  - `label()` of 40000 contains "400,00" and "zł", and `signedLabel()` covers +, − and zero.
- **`ExpenseTitle`:** trims; rejects empty input, invisible-only input and 61 code points; accepts 60 code points, including emoji counted as code points.
- **`PurchaseDate`:**
  - rejects a bad format, `2026-02-30`, a date outside the period month and a future date;
  - Warsaw boundary: `now = 2026-10-31T23:30:00Z` is 1 November in Warsaw, so for an October period `max` is `2026-10-31`, and for a November period `2026-11-01` is valid;
  - `window()` defaults to today inside the month, and to the last day of the month when the month has ended.
- **`Expense.add` and the split:**
  - 40000 / 2 → payer 20000, other 20000 (US-01);
  - 10000 / 3 → payer 3334, others 3333;
  - 10001 / 3 → payer 3335, others 3333;
  - 1 / 2 → payer 1, other 0;
  - 1 member → payer takes the whole amount;
  - a non-member payer → `group_not_found`;
  - the period id is the group's open period.
- **Split invariant grid:** amounts {1, 2, 3, 99, 100, 101, 9999, 10000, 10001, 99999999, 100000000} × member counts 1–6 × every payer position. Shares sum to the amount, each debtor gets `floor(amount / n)`, and the payer gets `floor + amount mod n`.
- **`Expense.restore`:** rejects shares that do not sum to the amount, a missing payer share, a duplicate user and a negative share.
- **`PeriodBalances`:**
  - US-01: A pays 400 between A and B gives A +200, B −200, and one debt B → A of 200.
  - Netting: A pays 400 and B pays 100, both between A and B, gives one debt B → A of 150.
  - Three members: A pays 300, B pays 90, all among A, B and C. Expected:
    - C → A 100 and C → B 30;
    - B → A 70 (B owes A 100, A owes B 30);
    - balances A +170, B −40, C −130.
  - A member without expenses has a zero balance; an empty period gives all zeros and no debts.
  - Over the grid of generated expenses: balances sum to zero; each balance equals incoming minus outgoing debts; no pair appears in both directions.
- **`ExpenseService`:**
  - validation order: title → amount → date;
  - it stores through the repository with the injected id and clock;
  - repository failures pass through unchanged;
  - `summarizeOpenPeriod` sorts expenses and computes balances over members in join order.
- **`Group.memberLabel`:** "You" for the viewer, an email for others, "Member" when the email is null or the user is unknown.

### Integration Tests:

- `npm run smoke` covers these scenarios:
  - two-user add and balance;
  - invalid amount;
  - a non-member posting to another group;
  - an anonymous redirect;
  - the first user's view after the second user adds an expense.
- There are no database tests (removed by user decision). The SQL scoping checks (`42501`) and the foreign keys are exercised only through the non-member smoke step and by review; the rules themselves are covered by the domain unit tests.

### Manual Testing Steps:

1. Sign in as user 1, create a group, invite user 2 and join as user 2 in another browser.
2. As user 2, add "Czynsz" 400,00 zł dated today. Both users see user 2 at +200,00 zł, user 1 at −200,00 zł, and "You owe … 200,00 zł" / "… owes You 200,00 zł" from each side.
3. Invite user 3. Add 100,00 zł as user 1: debtors owe 33,33 zł each, and user 1's share is 33,34 zł.
4. Try an empty title, `0`, `1000000,01`, `12,345` and a manually typed date outside the window. Each shows the matching error, and no expense is stored.
5. At 375 px width, check the form, balances and list layout; double-tap submit and confirm only one expense appears.

## Performance Considerations

The group page makes two RPC calls (`get_my_group`, `list_period_expenses`) after the middleware's `auth.getUser()`. Balances are computed in TypeScript over a household-sized period. This keeps the page within the Workers CPU risk named in `context/foundation/infrastructure.md:64,70`. No caching is needed.

## Migration Notes

The migration is forward-only and additive for the deployed Worker:

- new tables and functions;
- `get_my_group` gains a key that the old parser ignores;
- the FK change alters only delete behavior.

`deploy` pushes the migration before `wrangler deploy`. If the Worker is rolled back, the schema stays and remains compatible.

## References

- Related research: `context/changes/add-expense-see-balances/research.md`
- Cross-aggregate precedent: `src/lib/invites/invite.aggregate.ts:48-51`, `src/pages/api/groups/[id]/invites.ts:20-28`
- Table and function recipe: `supabase/migrations/20261002200553_settlement_groups.sql:14-184`, `supabase/migrations/20261005080344_group_invites.sql:36-171`
- Value object pattern: `src/lib/groups/group-name.value.ts`, `src/lib/groups/billing-month.value.ts`
- Smoke structure: `scripts/smoke.mjs:44-57,175-304`
- Rounding evidence: Betterment penny-precise allocation, Dinero.js `allocate`, Fowler `Money.allocate` (links in research.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Expenses domain

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 01ca55b
- [x] 1.2 Type check passes: `npx astro check` — 01ca55b
- [x] 1.3 Lint passes: `npm run lint` — 01ca55b

#### Manual

- [x] 1.4 Reviewer confirms the test names cover US-01 (400 zł by 2 → 200 zł), the 100 zł / 3 example and the netting example from Testing Strategy — 01ca55b

### Phase 2: Database and repositories

#### Automated

- [x] 2.1 Local database rebuilds from all migrations: `npm run db:reset` — 2259053
- [x] 2.2 Generated types are current: `npm run db:types` leaves `git diff --exit-code src/db/database.types.ts` clean after the commit — 2259053
- [x] 2.3 Unit tests pass: `npm test` — 2259053
- [x] 2.4 Type check passes: `npx astro check` — 2259053
- [x] 2.5 Lint passes: `npm run lint` — 2259053
- [x] 2.6 Existing smoke flows still pass: `npm run smoke` — 2259053

#### Manual

- [x] 2.7 Supabase Advisor shows no new warnings beyond the expected lints 0029/0008 for the new functions and tables — 2259053

### Phase 3: Group page, endpoint, smoke and docs

#### Automated

- [x] 3.1 Unit tests pass: `npm test`
- [x] 3.2 Type check passes: `npx astro check`
- [x] 3.3 Lint passes: `npm run lint`
- [x] 3.4 Production build succeeds: `npm run build`
- [x] 3.5 Smoke test passes with the new expense steps: `npm run smoke`

#### Manual

- [x] 3.6 In two browsers (two users in one group), adding "Czynsz" 400,00 zł shows +200,00 zł / −200,00 zł and "… owes … 200,00 zł" to both users immediately after the redirect
- [x] 3.7 Adding 100,00 zł in a three-member group shows the payer's share absorbing the extra grosz (debtors owe 33,33 zł each)
- [x] 3.8 The form shows a readable error for an empty title, `0`, `1000000,01` and a date outside the window; the date picker offers only days in the window
- [x] 3.9 The group page is usable at phone width (375 px), and a double tap on "Add expense" stores one expense
