<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Mark a Transfer as Sent (S-07), v2: Payment Ledger

- **Plan**: context/changes/mark-transfer-sent/plan.md
- **Scope**: Full plan (Phases 1–5 of 5; Phases 1–2 are v1 and were superseded by Phase 3)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-22
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run on the final tree: `npm test` 406/406, `npx astro check` 0 errors 0 warnings, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run db:types` (no diff), `npm run smoke` (all steps). Manual rows are all confirmed by the user in the conversation.

## Findings

### F1 — Concurrent withdraw (double click or two tabs) reports "Group not found"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261020111415_payments.sql:188-198; src/lib/billing-periods/billing-period.repository.ts:110
- **Detail**: The withdraw backstop raises 42501 when the payment row is not found, and it runs before the version guard. Two requests loaded at the same version both pass the aggregate; the first deletes the row, the second finds no row and raises 42501, which the repository maps to `group_not_found`. The conflict, reload and retry path is bypassed, where the aggregate would have answered `payment_not_found`, which `withdraw.ts` treats as success. S-08's confirmation will hit the same path. The same pattern already exists for changed and removed expenses (migration 20261019124131), which this review does not touch.
- **Fix**: Make the backstop fail only for rows that exist and are not the caller's, are confirmed or belong to another period (test with `exists (… where id = target.id and (not (…own, unconfirmed, this period)))`). A missing row then falls through to the version guard and returns `false`, which the retry handles.
  - Strength: Keeps the backstop for foreign and confirmed rows and restores the retry semantics.
  - Tradeoff: A migration edit (still unpushed, so allowed) and a small SQL change.
  - Confidence: HIGH — the smoke test already covers the foreign-row 42501 case.
  - Blind spot: The same pattern for expenses stays as it is.
- **Decision**: SKIPPED

### F2 — `payments.ts` does not catch an unreadable form body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/groups/[id]/payments.ts:25
- **Detail**: `await context.request.formData()` is not guarded, while `expenses.ts:15`, `edit.ts:21` and `groups/index.ts:13` use `.catch(() => null)`. A POST with a non-form body rejects and the endpoint returns a 500 instead of a redirect with `?paymentError=unexpected`.
- **Fix**: Add `.catch(() => null)` and treat a null form as empty fields, like the siblings.
- **Decision**: SKIPPED

### F3 — "Billing period is closed" message mentions only expenses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/billing-periods/billing-period-error.messages.ts:8
- **Detail**: `billing_period_closed` reads "expenses can no longer be changed", but it now also refuses payments.
- **Fix**: Reword to "expenses and payments can no longer be changed".
- **Decision**: SKIPPED

### F4 — The database does not bound `sent_at` or the amount, and the cap lives only in TypeScript

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261020111415_payments.sql (insert from `p_sent`)
- **Detail**: `sent_at` comes from the caller's JSON and there is no ceiling on `amount` or cap against the debt in SQL. By design (rules in the aggregate, constraints are backstops), and only a caller holding the Worker's app key can reach the function. Sender scoping, recipient membership (FK), `sender <> recipient`, `amount > 0` and "never inserted as confirmed" are all enforced.
- **Fix**: Accept; no change.
- **Decision**: SKIPPED

### F5 — A stale form can re-record a withdrawn payment

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/payments.ts; src/components/expenses/TransferPanel.astro
- **Detail**: Idempotency holds while the payment exists. After send then withdraw, resubmitting the old form (browser back) with the same `paymentId` records it again. The page is `no-store` and the cap re-check still applies, so the effect is bounded by the current debt.
- **Fix**: Accept; no change.
- **Decision**: SKIPPED

### F6 — Small deviations from the plan text

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Phase 3 §6; scripts/smoke.mjs; src/lib/billing-periods/period-balances.value.ts:77
- **Detail**: (1) The plan says the sent-row backstop checks `confirmed_at` is null; the function checks only `sender_id`, but `p_sent` carries no `confirmed_at` and the insert never sets it, so the outcome is the same. (2) Two existing smoke assertions changed from "300,00" to "600,00" because the partial payment lowers the debt. (3) `PeriodBalances` skips a payment whose sender equals its recipient.
- **Fix**: Add a one-line addendum to the plan, or leave as is.
- **Decision**: SKIPPED
