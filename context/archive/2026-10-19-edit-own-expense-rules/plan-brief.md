# Edit and Delete Rules for Own Expenses (S-05) — Plan Brief

> Full plan: `context/changes/edit-own-expense-rules/plan.md`

## What & Why

An expense's author can edit (title, amount, purchase date) or delete it while the billing period is open; nobody else can (FR-005). It also fixes the known gap that a duplicated expense cannot be removed, and it must land before period closing (S-09).

## Starting Point

`BillingPeriod` only adds expenses; persistence (`save_billing_period`) only inserts. The author of an expense is its payer. Balances are derived from stored shares, so changing expenses updates them automatically. Paid debts (S-08) and period closing (S-09) do not exist yet.

## Desired End State

On the group page the author sees "Edit" on their own expenses while the period is open. The edit page changes the three fields and offers "Delete expense" behind a confirmation. Non-authors and closed periods are refused with a code-based error. Proven by unit tests, the smoke script and one Playwright test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Re-split on amount edit | Equal split between the expense's original sharers, payer absorbs remainder | A member who joined later gets no retroactive debt. |
| Paid-debt lock (FR-005) | Deferred to S-08; S-05 enforces author + open period behind one `canEdit` rule | No paid-debt data exists; the pair-vs-expense question stays with S-08. |
| Edit UI | Separate edit page, form POST + redirect | Matches the add-expense pattern and works without JS. |
| Delete | Hard delete with a confirmation step | Balances are derived, so no audit trail is needed. |
| Persistence | New expand-only function `save_billing_period_changes`; old RPCs untouched | The deployed Worker still calls `save_billing_period`. |
| Concurrency | Same `version` guard, retry once, then `period_changed` | Reuses the F-02 mechanism. |
| Testing | TDD for domain, extended smoke, one E2E (delete a duplicate) | Cheapest level per rule, plus the real roadmap scenario in a browser. |

## Scope

**In scope:** aggregate edit/delete rules, error codes, service, migration, repository, edit page and endpoints, Edit link, smoke and E2E, docs and roadmap sync.

**Out of scope:** paid-debt lock, changing payer or split policy, soft delete, inline editing, contract migration of old RPCs, period closing.

## Architecture / Approach

Domain first: `BillingPeriod.editExpense/removeExpense` and `canEdit` track added, changed and removed expenses; the repository persists all three in one version-guarded RPC. Endpoints redirect with only the error code, rendered through `billingPeriodErrorMessage`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Domain rules (TDD) | Aggregate, entity, service, errors, fake repo | Getting the refusal order and re-split semantics right |
| 2. Persistence | Expand migration + repository switch | Version-guarded update/delete correctness |
| 3. Endpoints and UI | Edit page, POSTs, Edit link | Authorization gaps on hand-sent POSTs |
| 4. Smoke, E2E, docs | Proof and aligned docs/roadmap | Test flakiness |

**Prerequisites:** F-02 (done). **Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Until S-08, FR-005 is enforced only for closed periods; S-08 must extend `canEdit`.
- `closedAt` is never set before S-09, so the closed-period path is covered by unit tests only.
- `save_billing_period` stays as an expand/contract leftover until the contract migration (needed before S-09).

## Success Criteria (Summary)

- The author can fix or delete their own expense (including a duplicate) and balances update immediately.
- Non-authors and closed periods cannot change expenses, at the aggregate and at the endpoint.
- `npm test`, smoke and the E2E test are green.
