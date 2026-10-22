# Mark a Transfer as Sent (S-07) — Plan Brief

> Full plan: `context/changes/mark-transfer-sent/plan.md`

## What & Why

A debtor marks the transfer for one of their debts as sent (FR-008). It is a reminder, not a settlement: the debt stays open until the creditor confirms it (S-08). This slice also creates the record that S-08 confirms and S-09 checks before closing a period.

## Starting Point

Debts are not stored. `PeriodBalances` derives one netted debt per pair of members from the period's expenses, so a debt can change whenever an expense is added, edited or deleted. The debtor already sees each own debt with copyable transfer details in `TransferPanel` (S-06). All period writes go through the `BillingPeriod` aggregate and one version-guarded save.

## Desired End State

Under each own debt, the debtor sees "Mark as sent". After marking, they see one of:

- the mark (amount and date) with "Undo";
- "you marked 400,00 zł — the debt is now 450,00 zł", with a button to re-mark the new amount;
- "you no longer owe them", when the debt is gone or reversed.

The creditor sees a read-only "Marked as sent to you" list with the same states. Other members see nothing about the pair's mark.

## Key Decisions Made

| Decision             | Choice                                                                                | Why (1 sentence)                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Aggregate boundary   | `Transfer` entity inside `BillingPeriod`, same versioned save                         | S-08's paid-debt lock and S-09's closing check need one consistency boundary with the expenses.                  |
| Debt changes later   | The mark stores the amount; shown as outdated, can be re-marked                       | An honest reminder: the debtor still sees what they sent, and S-08 gets a concrete amount to confirm.            |
| Amount source        | The amount the page showed (posted by the form)                                       | A retry after a concurrent expense must not record an amount the debtor never saw.                               |
| Undo                 | Yes, while the period is open                                                         | Fixes a misclick; S-08 will block undo once the creditor confirms.                                               |
| Visibility           | The debtor and the creditor of the pair                                               | Prepares S-08, where the creditor confirms; a page rule, since the data is loaded for all members like expenses. |
| Mark without debt    | Stays visible as "you no longer owe them"                                             | Money really left the account; hiding or deleting the mark would lose that fact.                                 |
| Double-payment guard | Details show only the remaining amount; nothing to copy when the mark covers the debt | After a mark, copying the full debt again (or a grown one) would pay the same money twice.                       |
| Re-mark              | Replaces the pair's mark (one per pair per period)                                    | Keeps the model small; no history of marks.                                                                      |
| Testing              | Vitest (test-first) + smoke, no E2E                                                   | Same pattern as S-05/S-06; the smoke test already has two members and direct RPC calls.                          |

## Scope

**In scope:**

- The `Transfer` entity and the mark/undo commands with their state derivation.
- The `transfers` table, a load that includes it, and `save_billing_period_with_transfers` with a debtor backstop.
- Two form-POST endpoints, the debtor's panel states and the creditor's "Marked as sent to you" list.
- New smoke steps and doc updates.

**Out of scope:**

- Confirming a debt as paid, the paid-debt lock and blocking undo after confirmation (S-08).
- Partial payments: a mark never reduces the debt or the balances.
- Closed periods and leftover debts after closing (S-09).
- Notifications, a history of marks, display names (S-10), Playwright E2E, the contract migration.

## Architecture / Approach

`BillingPeriod` gains `transfers` and two commands:

- `markTransferSent` requires a current debt from the caller to the creditor, then records the posted amount. It replaces the pair's earlier mark and keeps its id.
- `undoTransferSent` removes the pair's mark.

A mark's state ("current", "outdated" or "no debt") is derived against `balances().debts`, like the debts themselves. `BillingPeriodService` runs both commands through the existing change-and-retry path. The repository loads transfers from `get_current_billing_period`, which gains a jsonb key, and saves through a new version-guarded function that also upserts and deletes transfers. The page splits the viewer's marks into debtor marks for `TransferPanel` and creditor marks for the new `SentToYouPanel`.

## Phases at a Glance

| Phase                              | What it delivers                                                                | Key risk                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Transfer marks in the aggregate | `Transfer`, mark/undo, state derivation, service methods, tests written first   | Getting the retry semantics wrong: the posted amount must survive a conflict. |
| 2. Persistence                     | `transfers` table, extended load, `save_billing_period_with_transfers`, mapping | Breaking the deployed Worker; mitigated by an expand-only migration.          |
| 3. Endpoints, UI, smoke and docs   | Mark/undo POSTs, debtor and creditor views, two-user smoke steps, docs          | Three UI states on a phone-width page staying readable.                       |

**Prerequisites:** F-02 and S-06 are done. Local Supabase is running for Phases 2 and 3.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- A netted debt above 1 000 000,00 zł cannot be marked, because `Money.parse` caps the posted amount. This is unrealistic for a household.
- A hand-crafted POST can mark any valid amount for a debt the caller really has. The mark is only the debtor's own claim, shown to the pair; S-08 decides what confirming it means.
- `save_billing_period_changes` becomes another expand/contract leftover that the contract migration before S-09 should drop.

## Success Criteria (Summary)

- A debtor marks a debt's transfer as sent and later sees whether the mark still matches the debt; they can undo it.
- The creditor sees the marks addressed to them. Nobody else sees them, and nobody can mark on another member's behalf.
- Expense changes never lose a mark. Balances and debts are unchanged by marking.
