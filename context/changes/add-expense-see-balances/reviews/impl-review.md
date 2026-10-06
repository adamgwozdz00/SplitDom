<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add an Expense and See Balances

- **Plan**: context/changes/add-expense-see-balances/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Success Criteria Run

Run on 2026-10-06 against commits 01ca55b, 2259053 and d7f63e6 (base e5bf2eb):

| Command | Result |
|---------|--------|
| `npm test` | PASS: 14 files, 305 tests |
| `npx astro check` | PASS: 0 errors, 0 warnings, 0 hints |
| `npm run lint` | PASS: clean |
| `npm run build` | PASS |
| `npm run smoke` | PASS: all steps, including the 7 new expense steps |
| `npm run db:types` freshness | PASS: types generated from the local schema are identical to `src/db/database.types.ts` |
| `npm run db:reset` | NOT RE-RUN, so the developer's local data was not wiped. `supabase migration list --local` shows all 7 migrations applied, including `20261005190331_expenses` |

Manual items 1.4, 2.7 and 3.6–3.9 are all marked `[x]`:

- 1.4 is confirmed by the test names: US-01 400/2, 100/3, 10001/3, netting to 150, and the 3-member example.
- 2.7 (Supabase Advisor) and the browser checks 3.6–3.9 leave no trace in the diff, so this review cannot confirm them.
- The "double tap stores one expense" part of 3.9 holds only when JavaScript runs; see F5.

## Findings

### F1 — Privacy page does not disclose that emails are shown to co-members

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/privacy.astro:19,30 (cause: supabase/migrations/20261005190331_expenses.sql:192-196)
- **Detail**: `get_my_group` now returns each member's email, and the group page shows co-members' emails in Balances, Debts and "Paid by".
  - Anyone who redeems an invite sees every member's email.
  - Non-members never do: the `exists` membership check is in place, and `get_group_invite` returns no emails.
  - The plan intended this (plan.md:71), but the privacy page still says the email is "used for your account" and processed "Only to sign you in and to run SplitDom". It never says other group members can see it.
- **Fix**: Add one sentence to privacy.astro ("What we collect" or "Sharing"): your email address is shown to the members of the groups you belong to.
- **Decision**: FIXED — privacy.astro "What we collect" now says the email is shown to the members of the user's groups.

### F2 — Documented account-deletion path is blocked by the new FKs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: context/deployment/deploy-plan.md:114 (cause: supabase/migrations/20261005190331_expenses.sql:32,48,225-227)
- **Detail**: Making `group_members.user_id` restrict was planned and is documented. But deploy-plan.md:114 says a future deletion flow "has to remove the user from their groups first, through the `Group` aggregate", and that path is now blocked too.
  - `expenses (group_id, payer_id)` and `expense_shares (group_id, user_id)` reference `group_members` with no cascade.
  - So a member who paid an expense or holds a share cannot leave a group, and their `auth.users` row cannot be deleted, without deleting other members' financial records.
  - Meanwhile privacy.astro:49-60 promises that a deletion request on GitHub means the data "will be deleted".
- **Fix**: Correct deploy-plan.md:114, and add a roadmap Open Question on how a member's personal data is erased once they have expenses.
  - Wording: removing a member is also blocked once they have paid an expense or hold a share.
  - Erasure options: for example, pseudonymise the email in `auth.users` and keep the financial rows, or delete only groups where they are the last member.
  - Strength: the docs match the schema again, and the GDPR gap is visible before someone asks for deletion.
  - Tradeoff: a docs-only change, so the privacy promise still cannot be kept by an automated flow until the question is answered.
  - Confidence: HIGH — the FK chain was verified in the migration and in local `pg_constraint`.
  - Blind spot: whether pseudonymisation satisfies the "deleted" wording on the privacy page has not been checked legally.
- **Decision**: FIXED — deploy-plan.md "Known constraints on deleting a user" corrected; roadmap.md Open Roadmap Question 4 added (erasure procedure).

### F3 — "Join order" of members is not guaranteed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261005190331_expenses.sql:190-196; src/lib/groups/group.aggregate.ts:62-66
- **Detail**: The plan computes balances "over `group.members` in join order" and sorts debts "by debtor, then creditor, in member order". Nothing guarantees that order:
  - The `jsonb_agg` in `get_my_group` has no `order by`, before and after this change, and it now also has an inner join to `auth.users`, so the order depends on the query planner.
  - `Group.restore` keeps the snapshot order as it is.
  - The unit test for join order passes only because the harness builds members in order.
  - Only the display order of balances and debts can change; the amounts cannot.
- **Fix A ⭐ Recommended**: Sort members in `Group.restore` by `joinedAt` (ties by `userId`), and add a unit test with shuffled snapshot members.
  - Strength: the ordering rule lives in the aggregate, where this project keeps domain rules, and a unit test can prove it without a database.
  - Tradeoff: the change touches the `groups` module from an expenses change (a few lines).
  - Confidence: HIGH — restore already maps every member, so a sort fits in naturally.
  - Blind spot: no other consumer of `group.members` order was found, but the dashboard and invite pages were not checked for an order assumption.
- **Fix B**: Add `order by m.joined_at, m.user_id` inside the `jsonb_agg` in the (still unpushed) migration.
  - Strength: a one-line change, and the source returns a stable order.
  - Tradeoff: the rule lives in SQL, and with no database tests nothing would catch a regression.
  - Confidence: HIGH — standard Postgres aggregate ordering.
  - Blind spot: none significant.
- **Decision**: SKIPPED

### F4 — Smoke step does not check the debt direction and is misnamed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:338
- **Detail**: The step "first user sees the amount owed to them" has the direction backwards: the second user paid, so the first user owes. The plan says "owed by them".
  - It checks only `bodyContains("200,00")`, which matches "+200,00", "−200,00" and the debt line alike.
  - So a reversed debt would still pass, and the step does not prove the plan's criterion.
- **Fix**: Rename the step to "first user sees the amount they owe" and check `bodyContains("You owe", "200,00")`.
- **Decision**: FIXED — step renamed and asserts `"You owe"` + `"200,00"`; `npm run smoke` passes.

### F5 — Duplicate expenses are prevented only by client-side JavaScript

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/ExpenseForm.astro:89-101; src/lib/expenses/expense.service.ts:44
- **Detail**: Each POST gets a new server-generated UUID. A double tap is blocked only by disabling the button in JavaScript.
  - A no-JS submit, a network retry or a second tab stores a duplicate.
  - The duplicate skews balances, and it cannot be deleted until S-05.
  - Manual criterion 3.9 ("a double tap stores one expense") therefore holds only with JavaScript.
- **Fix A ⭐ Recommended**: Accept the risk until S-05 ships delete, and record it as a known limitation in deploy-plan.md and in the S-05 roadmap entry.
  - Strength: no code change; S-05 is next on the critical path and provides the remedy; the JS guard covers the common double tap.
  - Tradeoff: a retried or no-JS POST leaves a duplicate in the balances until S-05 ships.
  - Confidence: MED — depends on how soon S-05 lands.
  - Blind spot: how often mobile browsers retry a POST on a flaky connection.
- **Fix B**: Make the add idempotent.
  - How: the form renders a hidden UUID, the service validates it and uses it as the expense id, and the repository treats a 23505 on `expenses_pkey` as success.
  - Strength: a server-side guarantee that makes criterion 3.9 hold without JavaScript.
  - Tradeoff: changes the service and aggregate input contract and the repository's error mapping; a key reused with different content is silently ignored.
  - Confidence: MED — a standard idempotency-key pattern, but new to this codebase.
  - Blind spot: workerd/PostgREST behaviour on a 23505 raised inside `add_expense` has not been tested.
- **Decision**: FIXED via Fix A — accepted until S-05; recorded in deploy-plan.md (new "Expenses" section, known limitation) and in the S-05 Risk in roadmap.md.

### F6 — Migration takes an ACCESS EXCLUSIVE lock on auth.users without lock_timeout

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261005190331_expenses.sql:225-227 (also :15 on billing_periods)
- **Detail**: Dropping and re-adding `group_members_user_id_fkey` holds AccessExclusiveLock on `auth.users` and `group_members` until the migration commits. This was confirmed in a rolled-back local transaction.
  - The tables are tiny, so the lock itself lasts milliseconds.
  - Without `lock_timeout`, however, a long-held lock on `auth.users` would make `db push` wait, and sign-ins and token refreshes would queue behind it.
  - The migration has not been pushed yet (the branch has no remote), so it may still be edited.
- **Fix**: Add `set lock_timeout = '5s';` at the top of 20261005190331_expenses.sql.
- **Decision**: SKIPPED

### F7 — SQL scoping checks in add_expense have no automated coverage; the plan overstates it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs (no step); plan.md:485
- **Detail**: The plan says the `42501` scoping checks are "exercised … through the non-member smoke step". They are not reached.
  - The endpoint's `GroupService.getForMember` returns `group_not_found` before `add_expense` is ever called.
  - So nothing automated proves that `add_expense` refuses a non-member, refuses a payer other than the caller, or that `list_period_expenses` returns null for a non-member.
  - The app-key gate makes these checks defence in depth, but they are still the authorization boundary for writes.
- **Fix**: Add smoke steps that use the existing `directRpc` helper with the local app key, and correct the plan's Integration Tests line.
  - The second user calls `add_expense` on group B and with `p_payer_id` set to the first user, expecting 403 with code `42501`.
  - They call `list_period_expenses` on group B, expecting `null`.
- **Decision**: SKIPPED

### F8 — Latent assumptions that S-05 and S-09 must revisit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261005190331_expenses.sql:98-99; src/lib/expenses/purchase-date.value.ts:68-80; src/lib/expenses/period-balances.value.ts:37-46
- **Detail**: Three behaviours are correct today but will break once periods close or members leave:
  - (a) `add_expense` does not check that the period is open. An expense posted while the host closes the period lands in the closed period. plan.md:244 explicitly defers this to S-09, where a race-safe guard needs `for share` / `for update` on the period row.
  - (b) `PurchaseDate.window(Nov 2026, now = 2026-10-31T12Z)` gives min 2026-11-01, max 2026-10-31 and default 2026-11-30, so every date is rejected. This happens if S-09 opens next month's period before that month starts.
  - (c) `PeriodBalances` skips a whole expense whose payer is not in `memberIds`, and skips shares of non-members. This is documented in the class comment but has no test. It matters once a member can leave.
- **Fix**: Record (a) and (b) as Unknowns in the S-09 roadmap entry and (c) in S-05/S-09, so their plans pick them up.
- **Decision**: FIXED — (a) and (b) added as S-09 Unknowns in roadmap.md; (c) added to Open Roadmap Question 4 instead of S-05/S-09, because no slice removes members yet.

### F9 — Unplanned test-plan.md has a dangling pointer, and the roadmap still shows S-04 as blocked

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md:81; context/foundation/roadmap.md:147,236,246
- **Detail**: Two docs are out of step with this change:
  - `context/foundation/test-plan.md` (+195 lines, from `/10x-test-plan`) is not in the plan but was committed in the phase 1 commit, which names it. Its rollout Phase 1 row says `change opened` for `context/changes/testing-money-balance-correctness/`, but that folder does not exist; by the file's own vocabulary the status should be `not started`.
  - The S-04 Unknowns in `roadmap.md` were resolved, but three other lines still say S-04 is blocked: the S-04 Risk ("…which is why the debt-granularity question blocks planning"), the issue table row ("Ready: no · Needs S-03 and the debt-granularity decision") and Open Roadmap Question #1 ("Block: S-04").
- **Fix**: Set the test-plan Phase 1 status to `not started` (or open the change with `/10x-new testing-money-balance-correctness`), and mark the three roadmap lines as resolved on 2026-10-05.
- **Decision**: SKIPPED

### F10 — CLAUDE.md conventions lag behind the new patterns

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md "Code Conventions" / "Database changes"; src/pages/api/groups/[id]/expenses.ts:17,22,27,42; src/components/expenses/ExpenseForm.astro:11
- **Detail**: Three small mismatches between CLAUDE.md and the code:
  - The endpoint redirects with `?expenseError=<code>` because the invite panel already owns `?error=` on the same page. This is sound, but CLAUDE.md's Error format describes only `?error=`.
  - CLAUDE.md calls the user FKs "restrict", but they are created without an action, so they are NO ACTION. That behaves the same here.
  - `ExpenseForm` computes the date window with its own `new Date()`, while the service uses its injected clock. This is minor, and the frontmatter variable is named `window`.
- **Fix**: In CLAUDE.md, note that a page with several forms uses one error parameter per section (e.g. `?expenseError=<code>`), and say "no action (no cascade)" instead of "restrict".
- **Decision**: SKIPPED

## Triage Summary (2026-10-06)

- Fixed: F1, F2, F4, F5 (Fix A), F8 — 5
- Skipped: F3, F6, F7, F9, F10 — 5
- Checks after the fixes: `npm run smoke` passes (privacy page renders; the renamed step "first user sees the amount they owe" passes); `prettier --check` is clean on the edited files.
