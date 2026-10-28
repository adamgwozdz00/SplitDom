<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Member Profile with a Display Name (S-10)

- **Plan**: context/changes/member-profile-display-name/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical 1 warnings 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — S-10 commits sit on the S-09 branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: branch `feat/host-closes-period` (commits 3c7191f, e3e63c8, 316dc1a, 3a3ba3e)
- **Detail**: The four S-10 commits were made on the branch of the unmerged S-09 work, so one PR would deliver two roadmap items and `Closes #27` would be mixed with S-09's issue.
- **Fix**: Create a branch from `main` and cherry-pick the four commits (or rebase them after S-09 merges), then open the S-10 PR with `Closes #27`.
- **Decision**: SKIPPED

### F2 — Name input allows 80 characters, the rule is 40

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/profile.astro:47
- **Detail**: The input carries `maxlength="80"`, which the plan does not mention. It lets a slightly-too-long name through to the server so the user sees the real error message, but it is an unplanned magic number that disagrees with the 40-character rule in `DisplayName`.
- **Fix**: Remove the attribute (the server rule and its error message are the single source of truth).
- **Decision**: FIXED (maxlength removed)

### F3 — A display name can imitate another member or an email

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/member-profiles/display-name.value.ts:12
- **Detail**: Names are not unique and may contain any printable character, so a member can name themselves like another member or like an email address, which could confuse who is owed money. This was an explicit planning decision (duplicates allowed, no disambiguation), and account numbers shown for payment still come from the real creditor, so the risk is confusion, not misdirected money.
- **Fix**: No change now; revisit with disambiguation (name plus email when two members of a group share a label) if it shows up in use.
- **Decision**: SKIPPED (accepted risk from the plan decision)

## Evidence

- Plan Adherence: all Changes Required present. Known adaptation: `displayNames` is a required `memberLabel` parameter (plan said optional) to let the type checker find every call site.
- Success criteria re-run: `npm test` 534 passed, `astro check` 0 errors, `npm run lint` clean; `npm run smoke` and `npm run build` passed at implementation time.
- Manual rows 1.5 and 2.5–2.9 were checked after the user's confirmation; 3.3 likewise.
