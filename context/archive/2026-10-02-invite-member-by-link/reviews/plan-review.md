<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Invite a Member by Link (S-03)

- **Plan**: context/changes/invite-member-by-link/plan.md
- **Mode**: Deep
- **Date**: 2026-10-05
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓; 7/7 symbols ✓ (`getForMember`, `findGroupOfCurrentUser`, `isMember`, `createTwoUsers`, `signin.ts:19`, `callback.ts:33`, `security.checkOrigin` default `true` in Astro 7.3.3); brief↔plan ✓; Progress↔Phase ✓ (4 phases, 23/23 criteria). No `context/foundation/lessons.md` or `docs/reference/contract-surfaces.md`.

## Findings

### F1 — The expired-invite setup breaks a check constraint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1 (table) vs Testing Strategy → Redeeming; Phase 4 manual 4.7
- **Detail**: The table had `check (expires_at > created_at)`, while the DB test and manual step 4.7 moved only `expires_at` into the past, so the setup UPDATE would fail with 23514.
- **Fix**: Move `created_at` and `expires_at` into the past together.
- **Decision**: FIXED (differently) — the user rejected cross-column `check` constraints as aggregate invariants that belong in TypeScript: `check (expires_at > created_at)` and `check (used_by is null or used_at is not null)` were removed from the table contract (`Invite.restore` enforces them). The test setup and 4.7 still move both timestamps, so the snapshot satisfies `Invite.restore` and the result is `invite_invalid`, not `unexpected`.

### F2 — `p_used_at` lets a direct call set any `joined_at`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details → backstops; Phase 2 §1 `redeem_group_invite`
- **Detail**: `used_at` and `joined_at` are written from the caller's `p_used_at`, so a signed-in user calling the RPC directly (own JWT + the `anon` key, which Supabase treats as public) could write any join date.
- **Fix A**: SQL backstop refusing `p_used_at` far from `now()`.
- **Fix B**: Drop `p_used_at` and write `now()` in SQL.
- **Decision**: ACCEPTED — the user's rule: timestamps are set only by TypeScript application code, never by the database, and no DB-side timestamp validation. The plan already does this; no plan change.

### F3 — The smoke cookie jar does not recognise Astro's cookie deletion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4 and Phase 4 §5 (smoke)
- **Detail**: Astro 7.3.3 `cookies.delete` sends `name=deleted; Expires=<1970>` without `Max-Age=0` (`node_modules/astro/dist/core/cookies/cookies.js:46-58`); `storeCookies` in `scripts/smoke.mjs:24-26` removes only on `max-age=0`. The "consumed" steps pass only because `"deleted"` does not parse as a token.
- **Fix**: Treat a past `Expires` as deletion in `storeCookies`; assert `sd_pending_invite` is gone after the sign-in return.
- **Decision**: SKIPPED

### F4 — A stale pending-invite cookie takes over a later sign-in

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1–§2
- **Detail**: `sd_pending_invite` (24 h) is cleared only by a successful sign-in; a signed-in visit to an invite leaves it, so a later ordinary sign-in in that browser lands on the invite.
- **Fix**: Clear the cookie on the signed-in branch of `/invite/[token]`.
- **Decision**: SKIPPED

### F5 — The plan omits the roadmap and GitHub board sync

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach
- **Detail**: CLAUDE.md requires `In progress` on the board and in `roadmap.md` at the start, and `Closes #8` in the PR body.
- **Fix**: Add a "Roadmap sync" line to Implementation Approach.
- **Decision**: FIXED
