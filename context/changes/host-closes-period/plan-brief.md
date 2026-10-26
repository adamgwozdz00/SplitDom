# Host Closes the Billing Period (S-09) — Plan Brief

> Full plan: `context/changes/host-closes-period/plan.md`
> Research: `context/changes/host-closes-period/research.md`

## What & Why

The host closes a finished month (US-02, FR-015): the period freezes and the next month opens. External research on the accounting archetype showed that the original S-09 guidelines would strand every non-host debt in a frozen period, where it could never be paid or confirmed. Accounting carries balance-sheet balances forward as opening balances, and this plan does the same.

## Starting Point

`BillingPeriod` is a ledger of expenses and payments with pending and posted balances (S-07/S-08), and every command refuses a closed period. Nothing closes a period yet. There is no notion of month order and no opening balance. Leftover RPCs from earlier slices are still in the database, and two of them can write into a closed period.

## Desired End State

The host sees a "Close <month>" panel: either the reason they cannot close yet, or a "Yes, close" confirmation. After the close, everyone sees the next month with a "Carried over from <month>" section, the pending payments carried over (still confirmable), and balances identical to the moment of close. The FR-005 lock lets a pair settle last month's debt without freezing this month's expenses.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Open debts at close | Carry every non-zero posted pair debt as an opening debt | Accounting archetype (GnuCash, OpenStax); keeps "host settles only their own debts" | Research |
| Pending payments at close | Move them unchanged to the new period | Recipient keeps the final say, nobody but the host can block, balances unchanged | Research |
| FR-005 lock | Oldest-first: confirmed payments settle the carried debt first | Payment application in QuickBooks/NetSuite; otherwise settling old debt locks the new month | Research |
| Next period's month | The month after the closed one | Periods stay contiguous; a late close never skips a month | Plan |
| Leftover RPCs | Dropped in Phase 1 of this plan | Roadmap prerequisite; no deployed Worker calls them | Plan |
| Close UI | Host-only panel: refusal reason up front, or revealed "Yes, close" | US-02 messages visible before a click; reuses the delete-confirmation pattern | Plan |
| Testing the close | Smoke back-dates the period with the local service-role key | Real end-to-end signal for the cross-period write, no test clock in the app | Plan |
| New-month expenses before close | Accepted, stated in the panel | Fits one open period and "close first, then the new period" | Plan |
| Carried-debt display | Own "Carried over from <month>" section; moved payments marked | Explains debts this month's expenses do not | Plan |

## Scope

**In scope:**

- Dropping the leftover RPCs (and retargeting smoke)
- `BillingMonth.next/previous/hasEndedAt`, `OpeningDebt`, balances with opening debts
- `BillingPeriod.close`, `closeRefusal`, `isCarried`, the oldest-first lock
- `closePeriod` service (idempotent per period); `opening_debts` table; `close_billing_period` RPC with host and completeness backstops
- Close endpoint, close panel, carried section, Payments marker
- Smoke back-dating flow and CI env
- PRD (FR-005, FR-015, US-02), roadmap, test-plan risks, CLAUDE.md, deploy plan, issue #14 (after approval)

**Out of scope:**

- Viewing closed periods (proposed as a later slice)
- Next-month expenses before the close, reopening a period, automatic closing
- Host role transfer, a Playwright spec, a test clock in the app

## Architecture / Approach

The aggregate judges everything. `close` refuses (closed, not host, month not ended, host owes on posted balances) or returns the next period, built from the old one: `month.next()`, one opening debt per posted pair debt, and the pending payments. `closePeriod` in the service persists both periods through one `close_billing_period` call. That call guards the old period's `version`, re-checks the host and that no pending payment is left behind, inserts the next period and opening debts, and re-parents the pending payments. `PeriodBalances` counts an opening debt like an expense share paid by the creditor, so balances are provably unchanged across the close.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Drop leftovers | Only guarded functions write periods; smoke retargeted | Dropping a function something still calls (checked against `src/`, smoke and the S-08 Worker) |
| 2. Close in domain + DB (test-first) | Close rules, carry-forward, moved payments, oldest-first lock, `close_billing_period` | Cross-period write correctness; balance invariant |
| 3. Endpoint, page, smoke | Host panel, carried section, marker, back-dated smoke flow | Service-role key handling in smoke/CI (local only) |
| 4. Docs | PRD, roadmap, test plan, CLAUDE.md, deploy plan, issue #14 | Public GitHub edits need approval |

**Prerequisites:** S-05 and S-08 merged (S-08 is on `feat/confirm-debt-paid`); local Supabase; `nvm use`.
**Estimated effort:** ~3–4 sessions across 4 phases (Phase 2 is the largest).

## Open Risks & Assumptions

- A retry after a close now lands on the new period. Outcomes are intended (a moved payment can be confirmed; an old expense edit gets `expense_not_found`), but the roadmap note claiming otherwise must be corrected.
- After a rollback to the S-08 Worker, balances omit carried debts until the next deploy. No data is lost.
- Assumes no deployed Worker still calls a leftover RPC; Phase 1 verifies this before dropping.

## Success Criteria (Summary)

- The host can close a finished month only when their own posted debts are settled, and nobody else can.
- After the close, every balance and debt is exactly what it was, now in the new month, with carried debts and moved payments visible and payable.
- Settling last month's carried debt does not lock this month's expenses.
