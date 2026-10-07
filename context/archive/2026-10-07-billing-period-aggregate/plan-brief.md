# BillingPeriod as the Aggregate Root for Expenses — Plan Brief

> Full plan: `context/changes/billing-period-aggregate/plan.md`
> Roadmap: F-02 in `context/foundation/roadmap.md`, issue [#32](https://github.com/adamgwozdz00/SplitDom/issues/32)

## What & Why

The expenses model is reshaped around behaviour instead of tables. `BillingPeriod` becomes the aggregate root that adds expenses, splits them through a `SplitPolicy` and derives balances, so the rules that span a whole period have one consistency boundary. Today that boundary covers "expenses only in the open period"; later it covers the edit lock (S-05), paid debts (S-08) and closing (S-09). Users see no change.

## Starting Point

- `Expense` is its own aggregate with its own service and repository in `src/lib/expenses/`.
- The period sits inside `Group` as `openPeriod`, with no `closed_at` and no version.
- `create_group` writes the group and its first period together.
- `add_expense` does not know whether the period is open (the S-09 race).

## Desired End State

- A new module `src/lib/billing-periods/` holds `BillingPeriod`, the `Expense` entity, `EqualSplitPolicy`, `PeriodBalances`, the value objects, `BillingPeriodService` and its repository.
- `Group` no longer carries a period.
- Saving a period is guarded by `version`: a conflict triggers one automatic retry, then `period_changed`.
- A group left without a period gets one on its next visit (self-repair).
- Dashboard, group page, adding expenses and smoke work as before.

## Key Decisions Made

| Decision                 | Choice                                                                  | Why (1 sentence)                                                                                   | Source  |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| Aggregate shape          | `BillingPeriod` is the root; `Expense` is an entity; `ExpenseShare` a value object from `SplitPolicy` | One consistency boundary for rules that span a period.                         | Roadmap |
| Group ↔ period           | `Group` keeps membership and the host; the period gets participants at load | `Group` will be reworked in F-03; the period leaves it now.                                    | Roadmap |
| Module                   | New `src/lib/billing-periods/`; `expenses` disappears; `BillingMonth` moves from `groups` | Named after the aggregate root, with one entry point by convention.                   | Plan    |
| First period             | Two writes: `GroupService.create`, then `BillingPeriodService.openFor`  | Clean aggregate boundaries; each aggregate saves through its own repository.                       | Plan    |
| Group without a period   | `openFor` opens the first period itself; a race is settled by the unique index (the loser reloads) | No group stays broken and no separate repair path is needed.            | Plan    |
| Concurrency              | `version` column, conditional UPDATE returning `false`; service retries once, then `period_changed` | Also closes the S-09 race without a business rule in SQL.               | Plan    |
| SQL                      | Persistence only, scoped to `auth.uid()`, no `raise` for business rules | Rules live in the TypeScript aggregate (CLAUDE.md, the user's DDD rules).                          | Plan    |
| Deploy compatibility     | Old RPCs and `open_period` stay (expand before contract)                | The previous Worker keeps working until the new one is live.                                       | Plan    |

## Scope

**In scope:**
- Moving the module.
- `BillingPeriod`, `Expense` as an entity, `SplitPolicy`.
- The `billing_period_closed` and `period_changed` error codes.
- Migration: `version` and 5 RPCs (`add_group`, `open_billing_period`, `get_current_billing_period`, `save_billing_period`, `list_my_open_billing_months`).
- The `BillingPeriod` repository and service.
- `Group` without a period.
- Rewiring the pages, endpoints and components.
- Removing the old `ExpenseService` path.
- Smoke, CLAUDE.md and the roadmap.

**Out of scope:**
- S-05, S-07, S-08 and S-09 functionality.
- The rule for locking expenses once a debt is paid.
- Dropping the old RPCs (a contract step after deploy).
- The future-month `PurchaseDate.window` fix.
- F-03's `Group` rework.
- Custom splits (FR-014).

## Architecture / Approach

Pages load a `Group` through `GroupService`, which checks membership. `BillingPeriodService.openFor(group)` then loads the latest period with its expenses (`get_current_billing_period`), or opens the first one if none exists. Commands such as `addExpense` run on the aggregate. The repository saves the version and the new expenses with `save_billing_period`; a `false` result is a conflict, which leads to a reload and one retry. The dashboard reads only the month labels (`list_my_open_billing_months`).

## Phases at a Glance

| Phase                     | What it delivers                                                      | Key risk                                                       |
| ------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Module move            | `expenses` → `billing-periods`, plus `BillingMonth`; no behaviour change | A missed import (grep and astro check catch it)              |
| 2. BillingPeriod (TDD)    | Aggregate, `Expense` entity, `EqualSplitPolicy`, tests                | Split regression: the US-01 tests and grosze invariants stay   |
| 3. Persistence            | `version` column, 5 RPCs, repository port and Supabase implementation | Bump `version` before inserting; keep `db:types` current       |
| 4. Service (TDD)          | `openFor` with self-repair, `addExpense` with one retry, summary, dashboard read model | Retry semantics: reload, same expense id, only one retry |
| 5. Switch-over            | Slimmer `Group`, pages and endpoints, old path removed, smoke, docs   | The full-stack wiring; smoke and manual checks cover it        |

**Prerequisites:** S-04 merged (done, #31); local Supabase; the `feat/billing-period-aggregate` branch from `main` (`b221953`).
**Estimated effort:** about 3–4 sessions. Phases 2 and 4 go through `/10x-tdd`; phases 1, 3 and 5 through `/10x-implement`.

## Open Risks & Assumptions

- **Participants are the group's current members at load time.** A member who has left (not possible today) would be ignored in balances, as `PeriodBalances` does now. This is Open Roadmap Question 4.
- **S-09 must bump `version` when it closes a period and open the next one in the same write**, or the "closed latest period = unexpected" rule would block the group.
- **During the deploy window the old Worker does not bump `version`.** At worst one concurrent add goes undetected, which is no worse than today.

## Success Criteria (Summary)

- Users see no change: smoke passes, and the dashboard and group page show the same as before.
- Adding an expense to a closed period is refused by the aggregate, and the version guard keeps this true under concurrency.
- S-05, S-07, S-08 and S-09 build on `BillingPeriod` without reworking expenses.
