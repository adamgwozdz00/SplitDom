# BillingPeriod as the Aggregate Root for Expenses — Implementation Plan

## Overview

This is roadmap item **F-02** (`context/foundation/roadmap.md`, issue [#32](https://github.com/adamgwozdz00/SplitDom/issues/32)). The expenses model is reshaped around behaviour:

- `BillingPeriod` becomes the aggregate root. It adds expenses, splits them through a `SplitPolicy` and derives the balances, so the rules that span a whole period have one consistency boundary. Today that is "expenses only in the open period"; later it covers the edit lock and closing.
- `Expense` becomes an entity inside the aggregate.
- `ExpenseShare` becomes a value object computed by the split policy.
- `Group` keeps membership and the host. The period references the group by id and receives the participants from it.
- Concurrent writes are guarded by a `version` column (optimistic locking).

Users see no change. Phases 2 and 4 are built test-first.

## Current State Analysis

- **`Expense` is its own aggregate** with its own service and repository (`src/lib/expenses/expense.aggregate.ts`, `expense.service.ts`, `expense.repository.ts`).
  - `Expense.add` takes a `Group` and splits equally: everyone owes `floor(amount / n)` and the payer absorbs the remainder (`expense.aggregate.ts:624-656`).
  - `ExpenseService.add` parses the title, then the amount, then the date (`expense.service.ts:857-896`).
  - `summarizeOpenPeriod` sorts newest first and builds `PeriodBalances` (`expense.service.ts:899-909`).
- **The period lives inside `Group`** as `openPeriod: { id, month, openedAt }` (`src/lib/groups/group.aggregate.ts:138`, `types.ts:472-476`), with no `closed_at` and no version.
  - `Group.create` builds the first period (`group.aggregate.ts:152-162`).
  - `create_group` inserts the group, the host membership and the period in one call (`supabase/migrations/20261002200553_settlement_groups.sql`).
- **`BillingMonth`** lives in `src/lib/groups/billing-month.value.ts`. `PurchaseDate` (expenses) imports it from `@/lib/groups`.
- **Consumers of `group.openPeriod` and of the expenses module:**
  - `src/components/groups/GroupList.astro:30` (dashboard label per group) and `GroupCard.astro:21`;
  - `src/components/expenses/ExpenseForm.astro:11` (purchase-date window), `ExpenseList.astro:17` and `BalancesPanel.astro`;
  - `src/pages/groups/[id].astro:44`, `src/pages/api/groups/[id]/expenses.ts:25-41` and `src/pages/api/groups/index.ts:19-28`.
- **Persistence functions** `add_expense` and `list_period_expenses` (`supabase/migrations/20261005190331_expenses.sql`) scope by the caller's membership via `auth.uid()`. `add_expense` does not know whether the period is open (the S-09 race).
- **Existing unit tests** pin the split rules and their invariants (`src/lib/expenses/__tests__/expense.aggregate.test.ts`), `PeriodBalances`, `Money`, `ExpenseTitle`, `PurchaseDate` and the service ordering (`expense.service.test.ts`).

## Desired End State

- **`src/lib/billing-periods/` is the module of the `BillingPeriod` aggregate.** It holds `BillingMonth`, `Money`, `ExpenseTitle`, `PurchaseDate`, `PeriodBalances`, the `Expense` entity, `SplitPolicy`/`EqualSplitPolicy`, `BillingPeriodService` (its only entry point) and its repository. `src/lib/expenses/` no longer exists.
- **`BillingPeriod`** knows its month, `openedAt`, `closedAt`, `version`, participants and expenses.
  - `addExpense` refuses a closed period, a payer who is not a participant, and a date outside the window.
  - `balances()` derives `PeriodBalances`.
- **`Group` has no period.**
  - Creating a group is two writes: `GroupService.create`, then `BillingPeriodService.openFor(group)`.
  - A group without any period gets its first one opened on the next `openFor` (self-repair).
- **Saving a period bumps `version`** only if it still equals the loaded one. On a conflict the service reloads and retries the command once, then returns `period_changed`.
- **Users see no change.** The dashboard, group page, add-expense flow and smoke behave exactly as before.

Verify with `npm test`, `npm run lint`, `npx astro check`, `npm run build`, `npm run db:reset && npm run db:types` (no diff) and `npm run smoke`, plus the manual checks in phase 5.

### Key Discoveries:

- **Persistence functions only persist and load.** Per CLAUDE.md and the user's DDD rules they are scoped to the caller's membership via `auth.uid()` and carry no business checks. The conditional `version` update is a persistence concurrency mechanism, not a rule: it returns `false` on a mismatch and raises nothing.
- **The `version` guard also closes the S-09 race.** S-09's close will bump `version`, so an expense add that loaded the period before the close fails on save. Its retry reloads the now-closed period, and the aggregate refuses it. No `closed_at` check in SQL is needed.
- **Expand before contract** (CLAUDE.md "Database changes"). The previous Worker keeps calling `create_group`, `add_expense` and `list_period_expenses`, and reading `open_period`, until the new Worker is live. They stay untouched here.
- **`openFor` receives a `Group` already loaded through `GroupService.getForMember`**, so membership is checked before it runs. A missing period then means "no period yet", not "not a member".

## What We're NOT Doing

- Closing a period and opening the next one (S-09), editing or deleting expenses (S-05), transfers and paid debts (S-07/S-08). F-02 only leaves room for them inside the aggregate.
- Deciding how a paid debt locks expenses. This is a roadmap unknown that blocks S-05 and S-08, not F-02.
- Dropping `create_group`, `add_expense`, `list_period_expenses`, or `open_period` in `get_my_group`/`list_my_groups`. That is a contract step after this ships; F-03 reworks the group RPCs.
- Fixing `PurchaseDate.window` for a period whose month starts after today (S-09 unknown).
- Any other `Group` rework (invites, `memberLabel`, the `redeem_group_invite` exception). That is F-03.
- Custom splits (FR-014, parked). Only `EqualSplitPolicy` exists.

## Implementation Approach

The phases are ordered so that `npm test`, `npx astro check` and lint stay green after every one of them:

1. A mechanical module move.
2. The new aggregate, built test-first next to the old `ExpenseService`.
3. Additive persistence: the new column, the new RPCs, the repository port and its Supabase implementation.
4. The new service, built test-first on a fake repository.
5. The switch-over: `Group` is slimmed, the pages are rewired and the old expense-service path is deleted.

Phases 1, 3 and 5 are mechanical or wiring work for `/10x-implement`. Phases 2 and 4 suit `/10x-tdd`.

## Critical Implementation Details

**State sequencing**:
- `save_billing_period` must bump `version` **before** inserting the new expenses, in the same function call, through a conditional `update … where version = p_expected_version`. If the update hits no row, the function returns `false` and inserts nothing.
- The repository sends only the expenses added since the period was opened or restored, so the aggregate must track them (`newExpenses()`).
- A retry reloads the period, so the reloaded aggregate starts with an empty list of new expenses.

**Timing & lifecycle**:
- Two concurrent `openFor` calls on a group without a period (for example two open tabs) both try to insert the first period.
- The existing partial unique index `billing_periods_one_open_per_group_idx` rejects the second insert with `23505`.
- The repository reports that as a conflict, and the service reloads instead of failing.

## Phase 1: Module move

### Overview

Move the expenses module and `BillingMonth` into `src/lib/billing-periods/` with no behaviour change, so the later phases add the aggregate in its final home.

### Changes Required:

#### 1. New module from the expenses module

**File**: `src/lib/expenses/**` → `src/lib/billing-periods/**` (`git mv`); `src/lib/groups/billing-month.value.ts` and its test → `src/lib/billing-periods/`

**Intent**: Rename the module after the aggregate root it will hold.
- The module-level error vocabulary follows the new name:
  - `ExpenseError(Code)` → `BillingPeriodError(Code)`;
  - `expenseError` / `expenseErrorMessage` → `billingPeriodError` / `billingPeriodErrorMessage`;
  - the file becomes `billing-period-error.messages.ts`.
- `EXPENSES_LOAD_FAILED_MESSAGE` keeps its name.
- Class names (`Expense`, `ExpenseService`, …) stay for now.

**Contract**:
- `@/lib/billing-periods` exports everything `@/lib/expenses` exported, plus `BillingMonth`.
- `@/lib/groups` imports `BillingMonth` from `@/lib/billing-periods` and no longer exports it.
- The module's `index.ts` keeps the "never import `@/lib/supabase`" note.

#### 2. Callers

**File**: `src/pages/groups/[id].astro`, `src/pages/api/groups/[id]/expenses.ts`, `src/components/expenses/*.astro`, and every test importing either module

**Intent**: Point the imports at `@/lib/billing-periods`. The `?expenseError=` query parameter and the rendered messages stay the same.

### Success Criteria:

#### Automated Verification:

- No import of the old module remains: `grep -rn "@/lib/expenses" src` prints nothing
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

**Implementation Note**: Pure move; pause for confirmation before proceeding.

---

## Phase 2: BillingPeriod aggregate

### Overview

The new aggregate root, built test-first next to the existing `ExpenseService`, which stays in use until phase 5.

### Changes Required:

#### 1. Split policy

**File**: `src/lib/billing-periods/split-policy.ts` (new)

**Intent**: Extract the rule that turns an amount into shares, so the period asks a policy instead of hard-coding the equal split. Under the equal split:
- every participant owes `floor(amount / n)`;
- the payer also absorbs `amount mod n`;
- shares follow the participants' order and sum to the amount.

**Contract**:
- `interface SplitPolicy { split(input: { amount: Money; participants: readonly string[]; payerId: string }): ExpenseShare[] }`
- `EqualSplitPolicy` implements it.
- `ExpenseShare { userId; amount: Money }` is a value object, moved here from `expense.aggregate.ts`.

#### 2. Expense as an entity

**File**: `src/lib/billing-periods/expense.entity.ts` (new; `expense.aggregate.ts` remains until phase 5)

**Intent**: An expense inside a period.
- It keeps its local id, because S-05 will edit and delete it.
- It keeps the share invariants: non-empty, the payer has a share, unique users, no negative share, shares sum to the amount.
- It drops `groupId` and `periodId`, which the period owns.

**Contract**:
- `Expense { id; payerId; title: ExpenseTitle; amount: Money; purchasedOn: PurchaseDate; createdAt: Date; shares: readonly ExpenseShare[] }`, with `restore(snapshot)` and `toSnapshot()`.
- Only the period constructs a new expense.
- `ExpenseSnapshot` loses `groupId` and `periodId`.

#### 3. BillingPeriod aggregate

**File**: `src/lib/billing-periods/billing-period.aggregate.ts` (new), `types.ts`, `index.ts`

**Intent**: The consistency boundary for one period of one group.

**Contract**:
- **State**: `id`, `groupId`, `month: BillingMonth`, `openedAt`, `closedAt: Date | null`, `version: number`, `participants: readonly string[]` (the group's member ids in join order, given at load) and `expenses: readonly Expense[]`.
- **`static open({ id, groupId, participants, now })`**: takes the month of `now` in Europe/Warsaw; the period is open, at `version` 0, with no expenses.
- **`static restore(snapshot: BillingPeriodSnapshot, participants)`**: throws on invalid stored data — a bad month or timestamp, `closedAt` before `openedAt`, or an invalid expense.
- **Queries**: `isOpen()`, `purchaseDateWindow(now): PurchaseDateWindow`, `expensesNewestFirst()` (by purchase date, then creation time), `balances(): PeriodBalances` over the participants, and `newExpenses(): readonly Expense[]` (added since `open`/`restore`).
- **`addExpense({ id, payerId, title: ExpenseTitle, amount: Money, purchasedOn: string, now }): Result<Expense>`** checks, in this order:
  1. the period is open, else `billing_period_closed`;
  2. the payer is a participant, else `group_not_found` (as today);
  3. the date is inside the window, else `invalid_purchase_date`.

  It then splits the amount with `EqualSplitPolicy` and appends the expense.
- **Persistence shape**: `toSnapshot()` returns `BillingPeriodSnapshot { id; groupId; month; openedAt; closedAt: string | null; version: number; expenses: ExpenseSnapshot[] }`.
- **New error code** `billing_period_closed`, with the message "This billing period is closed, so expenses can no longer be added".

#### 4. Tests

**File**: `src/lib/billing-periods/__tests__/billing-period.aggregate.test.ts`, `split-policy.test.ts` (new)

**Intent**: Lead with the new API; each test comes before its code. The split behaviour already exists in `Expense.add`; the tests pin it through `addExpense` and the policy, and the green step moves the code. Behaviours to pin:
- 400 zł between two participants splits into 200 zł each (US-01).
- When 100 zł is split three ways, the payer absorbs the leftover grosze.
- `open` at `2026-10-31T23:30Z` takes November, the Warsaw month.
- A restored closed period refuses `addExpense` with `billing_period_closed` and keeps no new expense.
- A payer who is not a participant gets `group_not_found`.
- A date outside the window gets `invalid_purchase_date`.
- `newExpenses()` lists only what was added after `restore`.
- `balances()` matches the added expenses.
- The snapshot round-trips.

The property-style split-invariant test moves to `split-policy.test.ts`.

### Success Criteria:

#### Automated Verification:

- Aggregate and policy tests pass: `npx vitest run src/lib/billing-periods/__tests__/billing-period.aggregate.test.ts src/lib/billing-periods/__tests__/split-policy.test.ts`
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

**Implementation Note**: Pause for confirmation before proceeding.

---

## Phase 3: Persistence

### Overview

Additive schema and persistence functions, the repository port and its Supabase implementation. Nothing calls them yet, and the old flows are untouched.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_billing_period_aggregate.sql` (new, via `npm run db:new billing_period_aggregate`)

**Intent**: Store each period's version, and give the `BillingPeriod` and `Group` repositories functions that only persist and load. Like the existing functions, they are scoped to the caller's membership via `auth.uid()`.

**Contract**:
- **New column**: `alter table public.billing_periods add column version integer not null default 0`. The default only backfills existing rows; new rows get `version` from the aggregate.
- **`public.add_group(p_group_id, p_name, p_host_id, p_now)`**: inserts the group and the host's membership, without a period. Caller scoping is the same as in `create_group` (the host is the caller).
- **`public.open_billing_period(p_period_id, p_group_id, p_month, p_opened_at, p_version)`**: inserts one period for a group the caller belongs to. A second open period surfaces as `23505` through the existing partial unique index.
- **`public.get_current_billing_period(p_group_id) returns jsonb`**: the group's latest period by `month`, as `{ id, group_id, month, opened_at, closed_at, version, expenses: [...] }`; the expenses use the `list_period_expenses` shape, shares included. It returns null when the group has no period or the caller is not a member.
- **`public.save_billing_period(p_period_id, p_group_id, p_expected_version, p_expenses jsonb) returns boolean`**:
  1. runs `update … set version = version + 1 where id = p_period_id and group_id = p_group_id and version = p_expected_version`, for a group the caller belongs to;
  2. returns `false` when no row matched;
  3. otherwise inserts the given expenses and their shares, with the payer scoped to the caller as in `add_expense`, and returns `true`.
- **`public.list_my_open_billing_months() returns jsonb`**: `[{ group_id, month }]`, the open period of every group the caller belongs to.
- **All of these functions**: `security definer`, `set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`. The loaders are also `stable`.
- **Table comment**: `comment on table public.billing_periods` becomes "BillingPeriod aggregate (src/lib/billing-periods) … Persistence only."
- **Then run** `npm run db:reset && npm run db:types`.

#### 2. Repository port

**File**: `src/lib/billing-periods/types.ts`

**Intent**: How the service loads and saves periods.

**Contract**:
```ts
interface BillingPeriodRepository {
  findCurrentOfGroup(group: Group): Promise<Result<BillingPeriod | null>>; // participants = the group's member ids
  open(period: BillingPeriod): Promise<Result<"opened" | "conflict">>;
  save(period: BillingPeriod): Promise<Result<"saved" | "conflict">>;      // sends version + newExpenses()
  listOpenMonthsOfCurrentUser(): Promise<Result<{ groupId: string; month: BillingMonth }[]>>;
}
```

#### 3. Supabase implementation

**File**: `src/lib/billing-periods/billing-period.repository.ts` (new; `expense.repository.ts` stays until phase 5)

**Intent**: `createSupabaseBillingPeriodRepository(client)`, following `group.repository.ts`:
- maps snake_case JSON to a snapshot; malformed or invariant-breaking data becomes `unexpected`;
- maps `28000` to `not_authenticated` and `42501` to `group_not_found`;
- in `open`, maps `23505` to `"conflict"`;
- in `save`, maps `false` to `"conflict"`.

#### 4. Group repository: create without a period

**File**: `src/lib/groups/group.repository.ts`

**Intent**: This phase only lands the `add_group` RPC. `createSupabaseGroupRepository.create` switches to it in phase 5, together with `Group` losing its period.

### Success Criteria:

#### Automated Verification:

- Migrations apply and types are current: `npm run db:reset && npm run db:types` leaves `src/db/database.types.ts` unchanged after commit
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Existing flows unaffected: `npm run smoke` against the local dev server

**Implementation Note**: Pause for confirmation before proceeding.

---

## Phase 4: BillingPeriodService

### Overview

The only entry point to `BillingPeriod`, built test-first on a fake repository next to the old `ExpenseService`.

### Changes Required:

#### 1. Service

**File**: `src/lib/billing-periods/billing-period.service.ts` (new), `index.ts`

**Intent**: Load the aggregate, run a command on it and save it. Repair a group that has no period yet, and absorb a single concurrent write.

**Contract**: `new BillingPeriodService(repository, newId, clock)`.

- **`openFor(group): Promise<Result<BillingPeriod>>`**:
  - an open current period is returned as is;
  - with no period at all, it opens one (`BillingPeriod.open({ id: newId(), groupId, participants, now })`, then `repository.open`), and on `"conflict"` reloads once;
  - a closed latest period is `unexpected`, because S-09 opens the next one in the same write.
- **`addExpense({ group, payerId, title, amount, purchasedOn }): Promise<Result<{ expenseId }>>`**:
  1. parses the title, then the amount, as today;
  2. loads with `openFor`, calls `period.addExpense`, then `repository.save`;
  3. on `"conflict"`, reloads and applies the command again once, with the same expense id;
  4. returns `period_changed` on a second conflict, with the message "Someone else just changed this billing period, try again".
- **`summarizeOpen(group): Promise<Result<{ period; expenses; balances }>>`**: `openFor`, then the expenses newest first and `balances()`.
- **`openMonthsOf(): Promise<Result<Map<string, BillingMonth>>>`**: the dashboard's read model.
- **Wiring**: `createBillingPeriodService(client)` builds the service on the Supabase repository. Its generators must be arrow functions (the workerd "Illegal invocation" note).

#### 2. Tests and harness

**File**: `src/lib/billing-periods/__tests__/billing-periods.harness.ts`, `billing-period.service.test.ts` (new)

**Intent**: A `FakeBillingPeriodRepository` that holds periods per group, can answer `"conflict"` N times, and records its `open` and `save` calls. Behaviours to pin:
- `openFor` opens and persists a first period for the clock's Warsaw month when the group has none.
- `openFor` returns the existing open period without writing.
- `openFor` reports `unexpected` when the latest period is closed.
- `addExpense` validates the title, then the amount, without touching the repository.
- `addExpense` saves exactly the new expense.
- One conflict is retried and succeeds.
- Two conflicts end in `period_changed`.
- A period that is closed when reloaded ends in `billing_period_closed`.
- `summarizeOpen` sorts newest first and computes balances over the group's members.

The ordering and balance cases come over from `expense.service.test.ts`.

### Success Criteria:

#### Automated Verification:

- Service tests pass: `npx vitest run src/lib/billing-periods/__tests__/billing-period.service.test.ts`
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`

**Implementation Note**: Pause for confirmation before proceeding.

---

## Phase 5: Switch-over

### Overview

`Group` loses its period, every caller moves to `BillingPeriodService`, the old expense-service path is deleted, and the docs and roadmap catch up.

### Changes Required:

#### 1. Group without a period

**File**: `src/lib/groups/group.aggregate.ts`, `types.ts`, `group.service.ts`, `group.repository.ts`, `__tests__/*`

**Intent**:
- Remove `openPeriod`, `OpenPeriod` and the snapshot field.
- `Group.create` no longer takes a `periodId`.
- `GroupService.create` persists through `add_group` and returns the created `Group`, so the endpoint can open its period.
- The repository stops reading `open_period`.
- The class doc now states two invariants: the host is a member, and the host never changes.
- Adjust the group tests.

**Contract**: `GroupService.create(...): Promise<Result<Group>>`; `GroupRepository.create(group)` calls `add_group`.

#### 2. Endpoints

**File**: `src/pages/api/groups/index.ts`, `src/pages/api/groups/[id]/expenses.ts`

**Intent**:
- **Creating a group**: `GroupService.create`, then `BillingPeriodService.openFor(group)`. If the second write fails, the endpoint still redirects to the group page, which repairs itself.
- **Adding an expense**: `GroupService.getForMember`, then `BillingPeriodService.addExpense`. Error codes go to `?expenseError=` as today.

#### 3. Pages and components

**File**: `src/pages/dashboard.astro`, `src/components/groups/GroupList.astro`, `src/pages/groups/[id].astro`, `src/components/groups/GroupCard.astro`, `src/components/expenses/ExpenseForm.astro`, `ExpenseList.astro`, `BalancesPanel.astro`

**Intent**:
- **Dashboard**: month labels come from `openMonthsOf()`. A group missing from the map shows no label line.
- **Group page**: built on `summarizeOpen(group)`.
  - The card label, the form's date window (`period.purchaseDateWindow(now)`) and the empty-list message come from the period.
  - On failure, only the expenses section is replaced with `EXPENSES_LOAD_FAILED_MESSAGE`, and the card omits the label.

**Contract**:
- `GroupList` receives `months: Map<string, BillingMonth>`.
- `GroupCard` receives `month: BillingMonth | null`.
- `ExpenseForm`, `ExpenseList` and `BalancesPanel` receive the `BillingPeriod` (or its parts) instead of reading `group.openPeriod`.

#### 4. Remove the old path

**File**: `src/lib/billing-periods/expense.aggregate.ts`, `expense.service.ts`, `expense.repository.ts`, their tests and harness parts, `index.ts`

**Intent**: Delete `Expense.add`, `ExpenseService` and `ExpenseRepository` together with their tests; their behaviours were pinned again in phases 2 and 4. `index.ts` exports only the new API.

#### 5. Smoke

**File**: `scripts/smoke.mjs`

**Intent**:
- The existing flows pass unchanged: create group, invite, join, add expense, balances.
- Add a direct Data API check that `get_current_billing_period` is refused without the app key, like the existing `list_my_groups` check.

#### 6. Docs and roadmap

**File**: `CLAUDE.md`, `context/foundation/roadmap.md`, the GitHub board

**Intent**:
- **CLAUDE.md**:
  - the status line;
  - Structure: `src/lib/billing-periods/` replaces `src/lib/expenses/`; `src/components/expenses/` stays;
  - Database changes: the `version` optimistic lock (the persistence function returns `false`, the service retries once), group creation as two writes repaired by `openFor`, and the old RPCs kept for expand/contract.
- **Roadmap F-02**: mark two unknowns resolved — concurrency (`version` plus one retry), and the open period moving out of `Group` into its own repository.
- **Roadmap S-09**: strike the `add_expense` race unknown as resolved by the version guard; S-09's close must bump `version`.
- **Board and PR**: board Status follows the CLAUDE.md sync rules; the PR body carries `Closes #32`.

### Success Criteria:

#### Automated Verification:

- Old path gone: `grep -rn "ExpenseService\|openPeriod" src` prints nothing
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Types are current: `npm run db:types` leaves `src/db/database.types.ts` unchanged
- Smoke passes against the local dev server: `npm run smoke`

#### Manual Verification:

- Dashboard shows "Open period: <month>" for every group, as before
- New group: the group page shows the current month, and adding an expense updates balances and the list as before
- Self-repair: after deleting a fresh group's only period in local SQL, opening the group page shows a new open period for the current month
- Closed period: after setting `closed_at` on the open period in local SQL, adding an expense shows "This billing period is closed…" and stores nothing
- F-02 board item and roadmap entries reflect the change

**Implementation Note**: Pause for confirmation before committing.

---

## Testing Strategy

### Unit Tests:

- **`EqualSplitPolicy`**: the US-01 example, the leftover grosze going to the payer, a single participant, and a property-style sum check.
- **`BillingPeriod`**:
  - open and closed states, and the Warsaw month boundary;
  - the order of the `addExpense` checks (closed → participant → date) and the share split;
  - `newExpenses()`, `balances()` and the ordering;
  - snapshot round-trip and invalid stored data.
- **`BillingPeriodService`**:
  - self-repair open, and the open race (`"conflict"` → reload);
  - the parse order;
  - a single retry, then `period_changed`;
  - a period that is closed when reloaded;
  - the summary's ordering and balances.
- **`Group` / `GroupService`**: create without a period, returning the group.

### Integration Tests:

- `npm run smoke` covers the whole flow: create a group (the endpoint opens its period), invite, join, add an expense, check balances. It also checks the app-key gate on `get_current_billing_period`.

### Manual Testing Steps:

1. `npm run dev`, sign in and create a group: the group page shows the current month.
2. Add an expense: balances and the list update as before.
3. In local SQL, delete the only period of a fresh group without expenses, then reload the group page: a new open period appears.
4. In local SQL, set `closed_at = now()` on a group's open period, then submit the expense form from a page loaded before the change: the closed-period message appears and no row is added. Revert `closed_at` to null afterwards.
5. The dashboard lists every group with its open period's month.

## Performance Considerations

The group page now loads the whole open period with its expenses in one RPC, as `list_period_expenses` did, and the add-expense POST loads the period before saving. At household scale (tens of expenses per month) this is negligible. The dashboard uses a light read model (`list_my_open_billing_months`) rather than loading periods with their expenses.

## Migration Notes

The migration is forward-only and compatible with the previously deployed Worker:
- the new column has a backfill default;
- the new functions are additive;
- the old functions and JSON fields stay as they are.

The old Worker's `add_expense` does not bump `version`. This only matters while both Workers run. At worst one conflict between two simultaneous adds goes undetected, which is no worse than today, when no conflict is detected at all.

A follow-up contract change drops `create_group`, `add_expense`, `list_period_expenses` and `open_period` once the new Worker is live.

## References

- Roadmap F-02 / F-03 / S-09: `context/foundation/roadmap.md`
- PRD FR-004, FR-005, FR-015: `context/foundation/prd.md`
- S-04 plan (debt model, split rule): `context/changes/add-expense-see-balances/plan.md`
- Today's split rule: `src/lib/expenses/expense.aggregate.ts:624-656`
- Repository pattern: `src/lib/groups/group.repository.ts`
- Persistence-function pattern: `supabase/migrations/20261005190331_expenses.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Module move

#### Automated

- [x] 1.1 No import of the old module remains: `grep -rn "@/lib/expenses" src` prints nothing
- [x] 1.2 Unit tests pass: `npm test`
- [x] 1.3 Type check passes: `npx astro check`
- [x] 1.4 Lint passes: `npm run lint`

### Phase 2: BillingPeriod aggregate

#### Automated

- [ ] 2.1 Aggregate and policy tests pass: `npx vitest run src/lib/billing-periods/__tests__/billing-period.aggregate.test.ts src/lib/billing-periods/__tests__/split-policy.test.ts`
- [ ] 2.2 Unit tests pass: `npm test`
- [ ] 2.3 Type check passes: `npx astro check`
- [ ] 2.4 Lint passes: `npm run lint`

### Phase 3: Persistence

#### Automated

- [ ] 3.1 Migrations apply and types are current: `npm run db:reset && npm run db:types` leaves `src/db/database.types.ts` unchanged after commit
- [ ] 3.2 Unit tests pass: `npm test`
- [ ] 3.3 Type check passes: `npx astro check`
- [ ] 3.4 Lint passes: `npm run lint`
- [ ] 3.5 Existing flows unaffected: `npm run smoke` against the local dev server

### Phase 4: BillingPeriodService

#### Automated

- [ ] 4.1 Service tests pass: `npx vitest run src/lib/billing-periods/__tests__/billing-period.service.test.ts`
- [ ] 4.2 Unit tests pass: `npm test`
- [ ] 4.3 Type check passes: `npx astro check`
- [ ] 4.4 Lint passes: `npm run lint`

### Phase 5: Switch-over

#### Automated

- [ ] 5.1 Old path gone: `grep -rn "ExpenseService\|openPeriod" src` prints nothing
- [ ] 5.2 Unit tests pass: `npm test`
- [ ] 5.3 Type check passes: `npx astro check`
- [ ] 5.4 Lint passes: `npm run lint`
- [ ] 5.5 Build passes: `npm run build`
- [ ] 5.6 Types are current: `npm run db:types` leaves `src/db/database.types.ts` unchanged
- [ ] 5.7 Smoke passes against the local dev server: `npm run smoke`

#### Manual

- [ ] 5.8 Dashboard shows "Open period: <month>" for every group, as before
- [ ] 5.9 New group: the group page shows the current month, and adding an expense updates balances and the list as before
- [ ] 5.10 Self-repair: after deleting a fresh group's only period in local SQL, opening the group page shows a new open period for the current month
- [ ] 5.11 Closed period: after setting `closed_at` on the open period in local SQL, adding an expense shows "This billing period is closed…" and stores nothing
- [ ] 5.12 F-02 board item and roadmap entries reflect the change
