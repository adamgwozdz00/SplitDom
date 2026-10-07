<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Group as the Membership Aggregate

- **Plan**: context/changes/group-membership-aggregate/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical 1 warnings 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run during review: `npm test` (306 passed), `npm run lint` (0 problems), `npx astro check` (0 errors), `npm run build`, `npm run db:reset && npm run db:types` (no diff), `npm run smoke` (all passed), `grep @/lib/invites` → 0.

## Findings

### F1 — save_group lets a non-member bump any group's version

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007093505_group_membership_aggregate.sql (save_group, the version `update`)
- **Detail**: The backstops only reject a non-member when `p_new_invites`, `p_new_members` need one. With all three arrays empty a non-member passes every check and the conditional `update … set version = version + 1` runs. Versions are small integers, so a signed-in user who knows a group id can call `save_group(id, 0, '[]', '[]', '[]')` (then 1, 2, …) and make that group's members' writes fail with `group_changed`.
- **Fix**: Right after computing `v_is_member`, raise 42501 unless `v_is_member or jsonb_array_length(p_used_invites) > 0`. Needs a new migration (forward-only; this one is not yet pushed, so editing is also possible if the branch is unmerged).
- **Decision**: SKIPPED

### F2 — Join backstop is not bound to the token or the expiry

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007093505_group_membership_aggregate.sql (save_group, used-invite claim)
- **Detail**: A non-member is allowed to add themselves when they claim *any* unused invite id of the group; the function checks neither the token hash nor `expires_at`. Invite ids are visible only to members and token holders, so exploitation needs a leaked id, and expiry is enforced in the aggregate (app clock) and in the loaders (DB clock). Defence in depth is weaker than the old `redeem_group_invite`, which checked both in SQL.
- **Fix**: Optionally add `and gi.expires_at > now()` to the claim and compare `token_hash` for non-member claims (pass it in `p_used_invites`).
  - Strength: Restores the old function's database-side guarantee.
  - Tradeoff: Puts an expiry rule in SQL, which CLAUDE.md says should live in the aggregate; "constraints are backstops only" allows it.
  - Confidence: MED — depends on whether a leaked invite id is a realistic threat.
  - Blind spot: Clock skew between Worker and database could make a just-valid join fail at the boundary.
- **Decision**: SKIPPED (accepted: needs a leaked invite id)

### F3 — Roadmap status still "in-progress" for F-03

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md (F-03 row and Status)
- **Detail**: Plan phase 4 mentions updating the roadmap status and the GitHub issue/board. The file says `in-progress`, which is right until merge; after merge CLAUDE.md requires `done`, board `Done` and unblocking downstream items. The PR body must carry `Closes #34`. Also: the plan asked for a second-redeem smoke check; none was added, but the existing "used invite is rejected" step already covers it.
- **Fix**: After merge, set F-03 to done in `roadmap.md` and the board, and make sure the PR body has `Closes #34`.
- **Decision**: FIXED — F-03 set to done in roadmap.md (board/issue #34 still to update after merge, PR needs `Closes #34`)
