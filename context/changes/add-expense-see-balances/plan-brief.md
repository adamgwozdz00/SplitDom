# Add an Expense and See Balances — Plan Brief

> Full plan: `context/changes/add-expense-see-balances/plan.md`
> Research: `context/changes/add-expense-see-balances/research.md`

## What & Why

Roadmap slice S-04 is the north star: a group member adds a shared expense, and everyone immediately sees who owes whom. It is the smallest slice that replaces the spreadsheet's core job (PRD US-01, FR-004, FR-005), and it fixes the debt model that S-05, S-06, S-08 and S-09 will act on.

## Starting Point

Groups, members, one open billing period per group and invite links exist (`src/lib/groups/`, `src/lib/invites/`). Nothing money-related exists. No function exposes member emails. Database tests were removed earlier, so coverage comes from unit tests and `scripts/smoke.mjs`.

## Desired End State

On `/groups/<id>`, a member adds an expense (title, amount, purchase date) to the open period and is redirected back to a page that shows:

- each member's balance ("You" or an email);
- the netted debt of each pair ("b@example.com owes You 200,00 zł");
- the period's expenses.

"Czynsz" 400,00 zł in a two-member group shows +200,00 / −200,00 zł and one 200,00 zł debt.

## Key Decisions Made

| Decision           | Choice                                                                                                | Why (1 sentence)                                                                                     | Source         |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------- |
| Debt granularity   | One netted debt per pair of members per period, derived from shares                                   | One transfer per pair per month, like today's spreadsheet; matches FR-006 "MVP rozlicza pary osobno" | Plan (user)    |
| Shares             | Computed and stored when the expense is added, for the members at that moment                         | A member joining later never changes earlier splits; matches US-01 "zapisuje ten dług"               | Plan (user)    |
| Leftover grosze    | Debtors pay `floor(amount / n)`; the payer's share absorbs the remainder                              | A debtor never pays a grosz for the payer; the split is independent of member order                  | Plan (user)    |
| Money unit         | Integer grosze; input 0,01–1 000 000 zł, comma or dot, max 2 decimals                                 | Exact sums (PRD guardrail); the cap catches typos that cannot be deleted until S-05                  | Research, Plan |
| Expense fields     | Title (1–60), amount, purchase date; payer = signed-in author                                         | US-01 example plus real purchase dates; author-only rule stays simple for S-05                       | Plan (user)    |
| Purchase date      | From the period month's day 1 to min(month end, today in Warsaw)                                      | Keeps every expense inside its open period; works when the host closes the month late                | Plan           |
| Member labels      | "You" or email, through `Group.memberLabel` (email added to `get_my_group`)                           | US-01 readable now; S-10 later changes only the label source                                         | Plan (user)    |
| User deletion      | No cascade on any user FK; `group_members.user_id` changed to restrict                                | A member and their debts never disappear outside the aggregate                                       | Research, Plan |
| Logic in SQL       | None: SQL persists and scopes by `auth.uid()`; rules in `Group`/`Expense`; integrity via foreign keys | Rules live in the domain where unit tests see them (user rule, 2026-10-05)                           | Plan (user)    |
| Errors on the page | Separate `?expenseError=<code>`; per-module `Result` copy                                             | No collision with invite errors; follows the invites precedent                                       | Plan           |
| Testing            | Unit tests with PRD oracles + invariant grid; two-user smoke flow; no new dependency                  | Balance correctness is the north star's risk; DB tests no longer exist                               | Research, Plan |

## Scope

**In scope:**

- The `src/lib/expenses/` module: `Money`, `ExpenseTitle`, `PurchaseDate`, the `Expense` aggregate, `PeriodBalances` and `ExpenseService`.
- A migration: `expenses`, `expense_shares`, `add_expense`, `list_period_expenses`; `get_my_group` with email; restrict on `group_members.user_id`.
- An add-expense endpoint and form, the balances and debts panel, and the expense list on the group page.
- Smoke steps and docs (CLAUDE.md, deploy-plan, the roadmap's S-04 unknowns).

**Out of scope:**

- Debt entities, transfer details, sent/paid markers (S-06 to S-08).
- Edit and delete (S-05) and period closing (S-09).
- Display names (S-10).
- Custom split or payer choice (FR-014), group-wide minimal transfers (FR-006) and categories.

## Architecture / Approach

Domain first, as in S-02 and S-03. The endpoint loads the `Group` through `GroupService`. `ExpenseService.add` parses the raw input into value objects, and `Expense.add({ group, ... })` computes the shares. The repository stores the expense and its shares in one RPC. The group page loads the period's expenses through a second RPC, and `PeriodBalances` derives balances and pair debts in TypeScript. The SQL functions only persist and load, filtering on `auth.uid()` membership.

## Phases at a Glance

| Phase                                   | What it delivers                                                         | Key risk                                                                |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1. Expenses domain                      | Value objects, aggregate, split, balances and debts, service, unit tests | A wrong split or netting rule (mitigated by PRD oracles + grid)         |
| 2. Database and repositories            | Migration, generated types, expense repository, member email and label   | Breaking the deployed Worker (mitigated: additive, `create or replace`) |
| 3. Group page, endpoint, smoke and docs | Form, balances panel, list, smoke two-user flow, docs                    | Error routing and date-window UX on mobile                              |

**Prerequisites:** S-03 is done (it is). Local Supabase is running and `nvm use` is set (Node 22.14.0).
**Estimated effort:** about 3 sessions, one per phase.

## Open Risks & Assumptions

- **Pair netting and S-08.** A confirmed pair debt followed by a new expense in the same period must be handled in S-08, and FR-005's "its debt is paid" lock becomes "the pair debt covering this expense is paid" (S-05, S-08).
- **No automated database tests.** The SQL scoping checks (`42501`) and foreign keys are covered only by the non-member smoke step and by review; all rules are covered by domain unit tests.
- **Period closed mid-request.** With no period check in SQL, an expense can be stored for a period closed between loading the group and storing the expense. S-09 must decide how closing guards against it.
- **Emails are visible to co-members.** This is accepted under NFR-3, because it applies within the group only.

## Success Criteria (Summary)

- Two members see the same correct balances and debt right after either one adds an expense (400 zł → 200 zł).
- Shares always sum to the expense and balances always sum to zero, including 100 zł / 3.
- A non-member or anonymous user cannot add or see a group's expenses.
