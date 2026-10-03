<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Create a Settlement Group (S-02)

- **Plan**: context/changes/create-settlement-group/plan.md
- **Mode**: Deep (codebase verification done inline; small repository)
- **Date**: 2026-10-02 (round 2, after the FR-002 rewrite)
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
11/11 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Phase 18/18 ✓

## Round 1 summary (earlier the same day)

Round 1 found 0 critical, 4 warnings and 3 observations; verdict REVISE → SOUND after triage. While triaging, the user changed PRD FR-002: a user may create any number of groups and belong to many groups. The plan was rewritten (no `unique(user_id)`, `list_my_groups()` + `get_my_group(id)`, `/dashboard` list + `/groups/[id]` page), and the roadmap and issues #7 and #8 were updated.

- F1 Aggregate timestamps lost on save — FIXED (`p_now`, ms-normalized reads)
- F2 Timezone tests would not catch a hard-coded +1 hour — FIXED (summer boundary cases)
- F3 Missing-session error code undefined in SQL functions — FIXED (`28000` in every function)
- F4 No error path when loading the group — FIXED (load-error message, 404 for non-members)
- F5 `23505` mapped to `already_in_group` — DISMISSED (obsolete after the scope change)
- F6 Module barrel must not import `@/lib/supabase` — FIXED
- F7 Manual criterion hard-coded "October 2026" — FIXED

## Findings

### F1 — Double-tap on "Create" makes a permanent duplicate group

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1–2 — endpoint and `CreateGroupForm.astro`
- **Detail**: The form is a plain POST with no JavaScript, each request gets a fresh `newId()`, and names are not unique. A double tap on a phone, or a retry on a slow connection, sends two POSTs that both succeed. Group deletion is a PRD Non-Goal, so the duplicate stays on the dashboard permanently, and in S-03 an invitee could join the wrong one. The auth forms' `SubmitButton` relies on `useFormStatus`, which only tracks React form actions, so copying it would not help.
- **Fix A ⭐ Recommended**: Disable the submit button on submit with a small inline `<script>` in `CreateGroupForm.astro` (progressive enhancement).
  - Strength: ~5 lines, no domain or database change; the form still works without JS.
  - Tradeoff: Does not cover a retry after a network timeout or a browser with JS off.
  - Confidence: HIGH — standard pattern; covers the realistic case.
  - Blind spot: None significant.
- **Fix B**: Idempotent create — the dashboard renders a hidden `groupId`; a second POST hits `groups_pkey` (`23505`) and the use case redirects to the existing group.
  - Strength: Covers double tap, retries and no-JS.
  - Tradeoff: Client-chosen ids (UUID validation), a new error code, constraint-name mapping, more tests.
  - Confidence: MED — more moving parts than the problem needs.
  - Blind spot: A collision with another user's group id yields 404 instead of an error message.
- **Decision**: FIXED (Fix A)

### F2 — `newId = crypto.randomUUID` passed without its receiver

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 — endpoint contract; Critical Implementation Details
- **Detail**: `deps.newId()` calls the method with `this` undefined. Node 22 tolerates it (verified locally), so unit and DB tests stay green, but workerd enforces the receiver on Web Crypto methods and throws "Illegal invocation" (the same class of error as passing `fetch` unbound). It would first surface in the smoke test on the preview build or in production.
- **Fix**: Write `newId: () => crypto.randomUUID()` in the contract.
- **Decision**: FIXED

### F3 — DB test mixes "no rows" and "permission denied"

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy → Integration Tests
- **Detail**: With grants revoked from `anon` and `authenticated`, PostgREST returns error `42501` with `data = null`, not an empty list. A test asserting `data` equals `[]` would fail.
- **Fix**: Assert `error.code === "42501"` for direct `select` and `insert` on all three tables (A, B, anon) and for anon's RPC calls.
- **Decision**: FIXED

### F4 — Supabase Advisor will flag the design; the docs don't say it's deliberate

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 migration; Phase 3 §5 CLAUDE.md
- **Detail**: `public` `security definer` functions executable by `authenticated` trigger lint 0029, and tables with RLS on and no policies trigger lint 0008; both are deliberate here. The S-03 research (`invite-member-by-link/research.md:36,117`) proposed thin `public` wrappers over `private` definer logic, while this plan makes direct `public` definer persistence functions the convention, so S-03's plan needs to know which pattern applies.
- **Fix**: In the CLAUDE.md "Database changes" bullet, note that lints 0029 and 0008 are expected for these persistence functions and tables, and state that direct `public` definer persistence functions are the pattern (superseding the `private` split from the S-03 research).
- **Decision**: FIXED
