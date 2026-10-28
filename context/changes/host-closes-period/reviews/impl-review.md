<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Host Closes the Billing Period (S-09)

- **Plan**: context/changes/host-closes-period/plan.md
- **Scope**: Full plan (Phases 1-4 of 4)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

Evidence: two read-only reviewers (plan drift; safety, quality and patterns) plus a re-run on the committed state of `npm test` (511 passed), `npx astro check` (0 errors), `npm run lint` (clean) and the leftover-RPC grep (no hits). `db:reset`, `db:types` and `smoke` could not be re-run in this review because the Docker daemon was down; they passed on the same code in Phases 1-3.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Progress SHAs of Phases 1 and 2 point to orphaned commits

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/host-closes-period/plan.md (## Progress, rows 1.1-1.7 and 2.1-2.8)
- **Detail**: Rows 1.x carry `fb11323` and rows 2.x carry `c1e1ee9`. The reflog shows a `filter-branch: rewrite` after those commits were made; both SHAs still exist as objects but are not in HEAD's history. The commits are now `dd97fed` (Phase 1) and `b058c56` (Phase 2). `/10x-archive` and later readers would follow dead references.
- **Fix**: Replace `fb11323` with `dd97fed` and `c1e1ee9` with `b058c56` in the Progress section.
- **Decision**: FIXED — Progress SHAs replaced (fb11323→dd97fed, c1e1ee9→b058c56)

### F2 — A close with any unknown `periodId` reports success

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/billing-periods/billing-period.service.ts (`closeAndStore`, `period.id !== input.periodId` branch)
- **Detail**: The idempotency shortcut runs before the host check. Any member (or the host) posting a random or other-group `periodId` is redirected to the group page without an error, and nothing is closed. There is no write and no leak (a non-host gets `not_group_host` only for the real current period id), so it is not exploitable, but the silent success can mislead. The plan accepted this behaviour; there is no test for a forged id.
- **Fix A ⭐ Recommended**: Keep the behaviour, state it in the `closePeriod` doc comment and add a test that a forged id succeeds without a write.
  - Strength: No new repository method; matches what the plan decided; one test and one comment.
  - Tradeoff: A mistyped or forged id still looks like a successful close.
  - Confidence: HIGH — the forged id can only come from a hand-built POST, since the page always sends the real id.
  - Blind spot: A stale page of a period closed long ago shows the same silent success (intended: that is the repeated-close case).
- **Fix B**: Succeed only when the id is the group's previous period (needs a repository lookup of the group's periods).
  - Strength: A forged id gets an explicit error.
  - Tradeoff: New repository method and persistence function, plus a second read on every repeated close.
  - Confidence: MED — a clean way to identify "previous period of this group" is not in the persistence layer today.
  - Blind spot: Cost against the retry rule in Critical Implementation Details not evaluated.
- **Decision**: FIXED via Fix A — doc comment on closePeriod and a test that a forged id succeeds without a write

### F3 — Repository maps SQL errors in a way that can hide a tripped backstop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/billing-periods/billing-period.repository.ts (`close` and `fromDbError`)
- **Detail**: Every `23505` becomes `"conflict"` (retry, then `period_changed`), so a unique violation on `opening_debts` (a malformed payload) is reported as a harmless race. `42501` becomes `group_not_found`, so the host, next-month and moved-payment backstops all surface as "Group not found". With a correct aggregate this cannot happen; it only matters for debugging a regression or a forged call.
- **Fix A ⭐ Recommended**: Leave the mapping and add a comment in `close` that "Group not found" after a close attempt means a backstop tripped.
  - Strength: Consistent with how the other save functions map `42501`; no behaviour change.
  - Tradeoff: A real bug in the aggregate would still look like a missing group.
  - Confidence: HIGH — same convention as `save` in this repository.
  - Blind spot: No log line records which backstop raised.
- **Fix B**: Map `23505` to `"conflict"` only for `billing_periods_one_open_per_group_idx` and the `(group_id, month)` key (check the constraint name in the error), and everything else to `unexpected`.
  - Strength: A malformed opening payload is no longer retried and then hidden as `period_changed`.
  - Tradeoff: Depends on the constraint name appearing in the error message; a rename would silently turn races into `unexpected`.
  - Confidence: MED — the Supabase error exposes the constraint in its message but this repository has no precedent for matching on it.
  - Blind spot: Not tested against the real Data API error shape.
- **Decision**: FIXED via Fix A — comment in the repository `close` explaining that "group not found" means a backstop tripped

### F4 — `close_billing_period` trusts the Worker for debt amounts and timestamps

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261026091646_close_billing_period.sql (`close_billing_period`)
- **Detail**: The function checks the host, the next month, the shape of the opening entries and that both parties are members. It does not check that the opening debts equal the posted debts (that rule lives in the aggregate, by repo convention), nor that `p_closed_at >= opened_at` and `p_next_opened_at >= p_closed_at`. A host calling the RPC directly could forge debts between any two members or set a `closed_at` earlier than `opened_at`, which makes `BillingPeriod.restore` throw for that period. The app-key gate keeps direct callers out (smoke-tested), so this is defence in depth only. The migration is not pushed yet, so it can still be edited.
- **Fix**: Add two backstops before the version bump: `p_closed_at >= opened_at` of the period, and `p_next_opened_at >= p_closed_at`; leave the debt amounts to the aggregate.
- **Decision**: FIXED — two timestamp backstops in close_billing_period before the version bump; aggregate opens the next period at the closing time; db:reset and smoke re-run green

### F5 — Closing time clamp is untested and the carried marker is skew-sensitive

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/billing-periods/billing-period.aggregate.ts (`close`, `isCarried`)
- **Detail**: `close` records `closedAt = max(now, openedAt)` to absorb clock skew between Worker isolates (an addition to the plan, explained in a comment). No test targets it. With a few milliseconds of skew the next period's `openedAt` can precede the old `closedAt`, so `isCarried` (`sentAt < openedAt`) can mark a moved payment as not carried; cosmetic only.
- **Fix**: Add one test that a close at a time before `openedAt` records `closedAt = openedAt`.
- **Decision**: FIXED — test that a skewed close is recorded at openedAt and the next period opens then (and the aggregate now opens the next period at the closing time)

### F6 — Unplanned changes: `.gitignore` and smoke scaffolding

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore (commit 847488f); scripts/smoke.mjs
- **Detail**: Commit `847488f` ("chore: ignore 10xDevs course skills and lesson prompts") adds six `.gitignore` lines and is not part of this plan; it does not affect behaviour. In `smoke.mjs`, the sign-in and sign-out helpers and the extra steps around each actor in the close flow are scaffolding the plan did not list, and two refusal steps run in a different order than the plan's step 2.
- **Fix**: Mention both in the PR description; no code change.
- **Decision**: FIXED — to be mentioned in the PR description (no code change)

### F7 — Payment backstops run after the version bump (documented deviation)

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261026091646_close_billing_period.sql (payment backstops, lines ~194-224)
- **Detail**: The plan said every backstop raises `42501` before any write. The two payment-set checks (only pending payments move; none is left behind) run right after the version-guarded update, so a payment sent or withdrawn concurrently returns `false` (conflict, retry) instead of raising. A raise rolls back the whole function including the bump, so nothing is stored. The reason is in the migration; the plan text still says otherwise.
- **Fix**: Add a one-line addendum to the plan's `close_billing_period` contract recording the order.
- **Decision**: FIXED — addendum in the plan's close_billing_period contract

### F8 — Rolling back past S-08 would call dropped functions

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/deployment/deploy-plan.md (section "Period closing (S-09)")
- **Detail**: The drop migration is safe for the S-08 Worker, but a `wrangler rollback` to a Worker older than S-08 would call functions that no longer exist. The deploy-plan section covers rollback to S-08 only. Also: a malformed `p_opening` (invalid uuid, overflowing amount) raises a non-`42501` error and becomes `unexpected` (hygiene only, behind the app-key gate; accepted).
- **Fix**: Add one sentence to the deploy-plan section: a rollback past S-08 is not supported after this migration.
- **Decision**: FIXED — sentence added to the deploy plan
