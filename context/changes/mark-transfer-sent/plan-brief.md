# Mark a Transfer as Sent (S-07) — Plan Brief, v2: Payment Ledger

> Full plan: `context/changes/mark-transfer-sent/plan.md`
> Research: `context/changes/mark-transfer-sent/external-research.md`
> Previous version: `plan-brief-v1.md` (superseded)

## What & Why

A debtor records a bank transfer to a creditor (FR-008). v1 treated it as a "sent" mark per pair that never touched the balances. Manual testing broke that model. The debt kept showing money already paid, and after a later expense reversed the pair, the app said "settled" when the creditor actually owed the debtor 150 zł. v2 makes each transfer a **payment**: an entry in the period's ledger that counts in the balances, as money ledgers and Splitwise or Tricount settlements do.

## Starting Point

Debts are derived from expenses in `PeriodBalances`. On the branch, v1's Phases 1–2 (a `Transfer` entity unique per pair, and its migration and repository) are committed but not deployed, so the migration can still be rewritten. v1's Phase 3 UI is uncommitted and gets stashed.

## Desired End State

Every member sees **pending** balances and debts, which count every payment not withdrawn and are labelled when a payment awaits confirmation.

- **The debtor** pays from the transfer details. A "Mark as sent" form is prefilled with the current debt; a partial amount is allowed, and more than the debt is refused.
- **The ledger** shows every payment of the period in a Payments list. The sender can withdraw a payment while it is unconfirmed.
- **The v1 scenario** now ends with "A owes B 150,00 zł".
- **Posted balances** (confirmed payments only) are ready for S-08 and S-09.

## Key Decisions Made

| Decision          | Choice                                                                  | Why (1 sentence)                                                                                    | Source   |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| Model             | A payment is a ledger entry counted in balances                         | The archetype everywhere (Fowler, Stripe, Square, Splitwise); a pair state outside balances drifts. | Research |
| Pending vs posted | Page shows pending (incl. unconfirmed); rules use posted                | One true number for people; confirmation keeps the final word for S-08 and S-09 (variant (c)).      | Plan     |
| Scope vs S-08     | Full model and sender actions now; creditor confirm/reject in S-08      | S-07 is shippable on its own, and S-08 shrinks to two commands.                                     | Plan     |
| Amount            | Prefilled with the current debt; partial OK; more than the debt refused | Prevents overpaying, and a stale page is harmless.                                                  | Plan     |
| Double submit     | A `paymentId` rendered into the form makes sending idempotent           | A retry after a conflict and a double tap are the same case.                                        | Plan     |
| Visibility        | Every member sees payments, like expenses                               | Payments change balances everyone sees; reverses v1's "pair only".                                  | Plan     |
| History           | A Payments list with "Withdraw" for the sender's unconfirmed payments   | One place for transparency and undo, also after a debt reverses.                                    | Plan     |
| Corrections       | Withdraw and record anew; no editing; confirmed is permanent            | A ledger corrects by entries, not edits.                                                            | Research |
| Migration         | Rewrite the unpushed `transfers` migration in place as `payments`       | Never ran in production; avoids a create-then-drop pair.                                            | Plan     |
| Testing           | Vitest test-first (v1 scenario as a test) + smoke; no E2E               | Same pattern as S-05/S-06; the failure becomes a regression test.                                   | Plan     |

## Scope

**In scope:**

- The `Payment` entity and the two balances.
- Sending (with its cap and idempotency) and withdrawing.
- The `payments` table and `save_billing_period_with_payments`.
- Endpoints, the transfer panel form, the Payments list and the balances note.
- Smoke steps, plus PRD FR-008/FR-009, roadmap and CLAUDE.md updates.
- GitHub issues #12/#13, after the user's approval.

**Out of scope:** the creditor's confirm and reject actions and the FR-005 lock (S-08), closing (S-09), recording overpayments, editing payments, notifications, FR-006, E2E, and the contract migration.

## Architecture / Approach

`PeriodBalances.of` gains `payments`. A payment from B to A adds to B's balance, subtracts from A's, and enters the pair matrix as "A owes B", so the existing netting stays as it is. `BillingPeriod` holds payments next to expenses:

- `sendPayment` (idempotent by id, capped by the pending debt) and `withdrawPayment` (sender only, unconfirmed only);
- `pendingBalances()` and `postedBalances()`.

The service runs both commands through the existing change-and-retry path. A new version-guarded SQL function stores the expense changes and the payments together, with sender backstops placed before the version bump.

## Phases at a Glance

| Phase                                     | What it delivers                                                      | Key risk                                                        |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1–2. v1 marks and persistence             | Done (`6afdcfe`, `a649cee`); reworked by Phase 3                      | —                                                               |
| 3. Payment ledger, domain and persistence | `Payment`, balances with payments, send/withdraw, rewritten migration | Regressing balance correctness; guarded by the v1 scenario test |
| 4. Endpoints, payment list, panels, smoke | Form with amount, Payments list, balances note, smoke steps           | Readability of the group page at phone width                    |
| 5. Docs, PRD, roadmap                     | FR-008/FR-009, S-07/S-08/S-09, CLAUDE.md, deploy plan, issues         | Public issue edits need the user's approval                     |

**Prerequisites:** local Supabase and Docker running; the v1 Phase 3 work stashed before Phase 3.
**Estimated effort:** ~2–3 sessions across Phases 3–5.

## Open Risks & Assumptions

- A real bank overpayment cannot be recorded (the amount is capped). A correction path is left to S-08 or later.
- Until S-08, no payment is ever confirmed, so the posted balances equal the expense-only balances. Nothing uses them yet.
- S-08 must decide whether FR-005's paid-debt lock is still needed, since editing an expense after a payment now just shifts the balance.
- Rewriting the migration in place is safe only while this branch is unmerged and undeployed.

## Success Criteria (Summary)

- The v1 failure scenario ends with A owing B 150,00 zł, and every intermediate debt matches the money that moved.
- A debtor cannot pay more than they owe, and a double submit never records twice.
- Every member sees the same balances and the payments behind them.
