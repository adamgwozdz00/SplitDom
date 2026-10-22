# Confirm or Reject a Payment (S-08) — Plan Brief

> Full plan: `context/changes/confirm-debt-paid/plan.md`
> Upstream: S-07 plan and research, `context/archive/2026-10-20-mark-transfer-sent/plan.md`, `external-research.md`

## What & Why

The recipient of a payment confirms it once the transfer arrives, or rejects it (FR-009). S-07 made each transfer a ledger entry that counts in the pending balances at once. Confirmation is what makes it final (posted), and S-09's closing rule judges the posted balances. Without S-08 nothing is ever settled for certain, and the milestone cannot close.

## Starting Point

`Payment` already has `confirmedAt` and `isConfirmed()`. `BillingPeriod` already derives `pendingBalances()` and `postedBalances()`, and `withdrawPayment` already refuses a confirmed payment. Nothing sets a confirmation, and there is no rejected state. The save function from S-07 is in production, so S-08 adds a new migration and a new save function rather than changing the old one.

## Desired End State

- **The recipient's actions**: the recipient sees "Confirm" and "Reject" on their pending payments in the Payments list, under a note "N payments await your confirmation".
- **Confirm**: the payment is permanent and counts in the posted balances.
- **Reject**: the payment stays visible as "rejected", drops out of both balances, and the sender's debt and transfer details come back.
- **Repeats and refusals**: deciding the same way twice is harmless. Anyone other than the recipient is refused.
- **Expenses**: once the recipient confirms a payment, the expenses of that pair (payer and a sharer) can no longer be edited or deleted (FR-005 made precise); pending and rejected payments never lock.

## Key Decisions Made

| Decision         | Choice                                                                                          | Why (1 sentence)                                                                                                    | Source                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Rejected payment | Kept in the ledger as "rejected" (`rejected_at`), outside both balances                         | The sender sees why their debt came back, and the ledger keeps its history (corrections as new entries).            | Plan                      |
| FR-005 lock      | Kept: a confirmed payment locks the expenses of its pair (payer and a sharer, either direction) | The author consciously confirmed, so what the payment settled is closed; pending and rejected payments do not lock. | Plan (amended in Phase 2) |
| Where to act     | Inline Confirm/Reject in the Payments list, plus a count note above it                          | Reuses the Withdraw row-action pattern and stays noticeable without a new panel.                                    | Plan                      |
| Finality         | Confirmed and rejected are both final; the same decision again is a no-op                       | Confirmed was already permanent in S-07; a wrong rejection is fixed by sending again.                               | Research                  |
| Idempotency      | In the aggregate, not the endpoint                                                              | A double submit and a retry after a version conflict are the same case, as with `sendPayment`.                      | Plan                      |
| Balance check    | None on confirmation                                                                            | Confirming states that money arrived, whatever the balance is now.                                                  | Plan                      |
| Closed period    | Confirm and reject refuse it; pending payments at closing become an S-09 unknown                | Every command refuses a closed period today, and closing does not exist yet.                                        | Plan                      |
| Persistence      | New migration plus `save_billing_period_with_confirmations`; old function kept                  | The S-07 migration is pushed, so expand before contract.                                                            | Plan                      |
| Testing          | Vitest test-first plus smoke; no E2E                                                            | Same pattern as S-05 to S-07.                                                                                       | Research                  |

## Scope

**In scope:**

- `Payment`'s three states, and the recipient's confirm and reject commands in `BillingPeriod` and the service.
- Rejected payments excluded from both balances, and withdraw refusing them.
- The `rejected_at` column, `get_current_billing_period`, and the new save function with recipient backstops.
- The confirm and reject endpoints, the list actions, the count note and the statuses.
- Smoke steps.
- PRD FR-005/FR-009, the roadmap (S-05, S-08, S-09, F-02), CLAUDE.md and the deploy plan.
- Issue #13, after the user's approval.

**Out of scope:** undoing a decision, deciding in a closed period, a lock on pending payments or on the whole period, notifications, a separate "To confirm" panel, overpayment corrections, the contract migration, and E2E.

## Architecture / Approach

`Payment.confirm(at)` and `reject(at)` return decided copies, and their timestamp is never earlier than `sentAt`. `BillingPeriod.confirmPayment` and `rejectPayment` check, in this order: the period is open, the payment exists, the user is its recipient, and the payment is pending (the same decision already made succeeds). They then record the decision as a pending write. `pendingBalances()` filters out rejected payments, and `postedBalances()` stays confirmed-only.

The service runs both commands through the existing change-and-retry path. The repository passes `p_confirmed` and `p_rejected` to the new SQL function, which checks "recipient only, pending only" before the version bump.

## Phases at a Glance

| Phase                                  | What it delivers                                                                 | Key risk                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Domain and persistence (test-first) | Payment states, confirm/reject, balances without rejected, migration, repository | A rejected payment still counting somewhere in the balances |
| 2. Endpoints, list actions, smoke      | Confirm/Reject forms, count note, statuses, smoke steps                          | Later smoke expectations shift with the new payments        |
| 3. Docs, PRD, roadmap, GitHub          | FR-005/FR-009, roadmap unknowns, CLAUDE.md, deploy plan, issue #13               | Public issue edit needs the user's approval                 |

**Prerequisites:** local Supabase and Docker running; S-07 merged (it is, `613c2ec`).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- After a `wrangler rollback`, the previous Worker counts rejected payments as pending until the next deploy. This is documented in the deploy plan, and no data is lost.
- Pending payments of other members when the host closes a period are left to S-09 (new unknown).
- One confirmation freezes all of that pair's expenses in the period, including ones added later; a typo in them can no longer be fixed.

## Success Criteria (Summary)

- A recipient confirms a payment and it counts in the posted balances. A rejected payment is visible as rejected and counts nowhere.
- Only the recipient decides, decisions are final, and a double submit never shows an error.
- Every member sees the same statuses and balances.
