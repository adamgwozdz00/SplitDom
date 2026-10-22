<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Mark a Transfer as Sent (S-07)

- **Plan**: context/changes/mark-transfer-sent/plan.md
- **Mode**: Deep
- **Date**: 2026-10-20
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

11/11 paths ✓, 6/6 symbols ✓ (formInput, equals, change, newExpenses, removedExpenseIds, summarizeOpen), brief↔plan ~ (the 1 000 000,00 zł cap was only in the brief).

## Findings

### F1 — Phase 1 does not pass `astro check` and breaks the group page

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, §3 Types; Phase 2, §3 Repository
- **Detail**: Phase 1 makes `transfers` required in `BillingPeriodSnapshot`, but two places build that snapshot without it: the repository's `toSnapshot` (billing-period.repository.ts:142), which only changes in Phase 2, and a hand-written literal in billing-period.aggregate.test.ts:151. `astro check` covers src/lib (tsconfig `**/*`, CI ci.yml:22). At runtime `restore` would read `undefined.map`, and every group page would show `unexpected` until Phase 2.
- **Fix**: Phase 1 sets `transfers: []` in the repository's `toSnapshot` (Phase 2 replaces it with the real mapping) and adds `transfers` to the test literal.
- **Decision**: FIXED (Phase 1 §5 and new §6; Phase 2 §3)

### F2 — Smoke steps "after transfer details" will hit a debt that no longer exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, §5 Smoke test
- **Detail**: The creditor deletes the only expense around smoke.mjs:508, so steps appended at the end would all get `no_debt_to_mark`. The smoke has one cookie jar, so every role switch needs a sign-out and sign-in. The steps also need the debtor's user id, which the smoke does not capture yet. The 42501 assertion follows the APPGATE pattern (403 + code in the body).
- **Fix**: Pin the steps to the existing sign-in order (debtor after ~l.468, creditor after ~l.503 before the delete, debtor again after ~l.528 to see the no_debt state, undo, and undo again).
- **Decision**: FIXED

### F3 — Order of backstops vs the version bump in the new SQL function is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, §1 Migration
- **Detail**: In `save_billing_period_changes` every 42501 check runs before the version update. If the transfer backstop ran after it, a call with a stale version would return `false` (200) instead of 42501.
- **Fix**: Both transfer backstops run after the payer backstops and before the version bump.
- **Decision**: FIXED

### F4 — `sentOnLabel` has nothing to reuse, and the "Oct 20" format is not PurchaseDate's

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, §1 Transfer entity
- **Detail**: `PurchaseDate.label()` formats a stored day in UTC as "Oct 20, 2026" and takes no instant; `todayInWarsaw` is private.
- **Fix**: `Transfer` owns its Warsaw formatter (`month: "short", day: "numeric"`), with no shared helper.
- **Decision**: FIXED

### F5 — The 1 000 000,00 zł cap on a mark is only in the brief

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing
- **Detail**: `Money.parse` applies the single-expense limit, while a netted debt sums several expenses.
- **Fix**: State the accepted limitation in "What We're NOT Doing".
- **Decision**: FIXED

### F6 — "Nobody else sees the mark" is a presentation rule, not a data rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State
- **Detail**: `get_current_billing_period` loads every mark of the period for every member; only `sentTransfersInvolving` narrows them. That is consistent with expenses and debts, but the plan read like a data-level guarantee.
- **Fix**: State in Desired End State that it is a page rule, so S-08 does not assume privacy at the database level.
- **Decision**: FIXED
