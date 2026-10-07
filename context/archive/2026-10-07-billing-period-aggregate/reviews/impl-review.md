<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: BillingPeriod as the aggregate root for expenses (F-02)

- **Plan**: context/changes/billing-period-aggregate/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria were re-run this session: grep, `npm test` (313), `astro check`, lint, build, `db:types` (no diff), smoke (all pass). Manual items 5.8-5.12 confirmed by the user.

## Findings

### F1 — Unrelated 10x CLI tooling files in the Phase 1 commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `.claude/**` (21 files, ~1100 lines), commit 1e36d76
- **Detail**: The Phase 1 commit carries `.claude/.10x-cli-manifest.json`, `.claude/prompts/*` and skill updates (bootstrapper, tdd, tech-stack-selector, stack-assess) that are unrelated to F-02 and unnamed in the plan.
- **Fix**: Note it in the PR body, or split the files into their own commit/PR.
  - Strength: Keeps the F-02 diff reviewable.
  - Tradeoff: Rewriting pushed history needs a force-push.
  - Confidence: MED — depends on whether they are wanted on main.
  - Blind spot: Whether another branch relies on these files.
- **Decision**: Fixed via Fix A (note in PR body)

### F2 — Expense form hidden when the period fails to load

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/groups/[id].astro (~52-67)
- **Detail**: Plan says only the expenses section is replaced by `EXPENSES_LOAD_FAILED_MESSAGE`; the form is inside it and also disappears, along with a redirected `?expenseError=` message. Forced by the form needing the period's date window.
- **Fix**: Accept and mention in the PR body.
- **Decision**: SKIPPED

### F3 — `42501` mapped to `group_not_found` for payer mismatch too

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/billing-periods/billing-period.repository.ts:98-107
- **Detail**: `save_billing_period` raises `42501` both for a non-member and for "payer must be the caller"; both surface as `group_not_found`. The aggregate checks the payer first, so it is unreachable in normal flow.
- **Fix**: Add a comment on the mapping.
- **Decision**: FIXED (comment added on the 42501 mapping)

### F4 — `open_billing_period` trusts client-supplied `p_version`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007075852_billing_period_aggregate.sql:68-97
- **Detail**: Persistence functions take the version from the aggregate by design; app-key gate blocks direct calls. Forcing 0 is optional hardening.
- **Fix**: Leave as is (consistent with the persistence-only rule).
- **Decision**: FIXED (accepted as is; no change, consistent with the persistence-only rule)

### F5 — Old `add_expense` doesn't bump `version`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261005190331_expenses.sql (`add_expense`)
- **Detail**: Harmless during rollout, but once S-09's close relies on `version`, the old RPCs must be gone.
- **Fix**: Drop `create_group`, `add_expense`, `list_period_expenses` and `open_period` in the contract migration before S-09 ships; add to roadmap.
- **Decision**: FIXED (S-09 prerequisite note added to roadmap)

### F6 — Closed latest period is `unexpected` in `openFor`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/billing-periods/billing-period.service.ts:29-36
- **Detail**: Intended (plan); S-09's close must open the next period in the same write.
- **Fix**: None now; already noted in the roadmap.
- **Decision**: SKIPPED
