<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create a Settlement Group (S-02)

- **Plan**: context/changes/create-settlement-group/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Phase 1 landed in commit 3b7818d. `npm test` (46 tests), `npx astro check` and `npm run lint` pass. Criterion 1.4 is covered by `billing-month.value.test.ts:19`. Manual check 1.5 was confirmed by the user after the `GroupService` refactor.

## Findings

### F1 — plan.md still describes the replaced handlers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/create-settlement-group/plan.md:68,74,84,150-167,182,322,337,352,430-439
- **Detail**: At the user's request, `GroupService` replaced `createGroup`, `listMyGroups` and `getMyGroup`, and change.md records the deviation. plan.md still names the old free functions and their test files in several places:
  - Implementation Approach;
  - Critical Implementation Details;
  - Phase 1 §4 and §6;
  - the Phase 3 endpoint, dashboard and group page contracts;
  - Testing Strategy.

  Phase 3 is implemented from plan.md, so it could bring the handler functions back.
- **Fix A ⭐ Recommended**: Update the stale contract lines in plan.md so they name `GroupService` (`create`, `listForMember`, `getForMember`) and `group.service.test.ts`. Also add a dated note under Implementation Approach that points to change.md.
  - Strength: The plan stays the single source of truth for Phases 2–3 and for later reviews.
  - Tradeoff: It edits Phase blocks after the plan was reviewed.
  - Confidence: HIGH — every stale line is identified.
  - Blind spot: None significant.
- **Fix B**: Add only a short "Implementation deviations" note at the top of plan.md that points to change.md, and leave the rest unchanged.
  - Strength: The smallest possible edit; the reviewed plan text is preserved.
  - Tradeoff: Phase 3's contracts still name the old functions, so readers must apply the mapping themselves.
  - Confidence: MED — this works only if the note is read.
  - Blind spot: A delegated Phase 3 subagent might receive only the Phase block and miss the note.
- **Decision**: FIXED (Fix A) — plan.md contracts (Implementation Approach, Critical Implementation Details, Phase 1 §4–§6, Phase 3 endpoint/dashboard/group page, Phase 3 CLAUDE.md bullet, Testing Strategy) now name `GroupService`; dated deviation note added under Implementation Approach.

### F2 — Host identity is split between the service and the database

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/group.service.ts:21-33 (and plan Phase 2 `create_group`)
- **Detail**: `GroupService.create` builds the aggregate with the `hostId` it is given. The planned `create_group` RPC has no host parameter and writes `auth.uid()` as both host and member. Today the endpoint passes `locals.user.id`, which comes from the same session, so the two agree. If they ever differed after a refactor, the domain would say "host = X" while the database stored "host = session user", and nothing would detect it. Reads are fail-closed: the service filters by `isMember(userId)`, so a mismatch only hides groups.
- **Fix A ⭐ Recommended**: In Phase 2, `create_group` takes `p_host_id` and raises `28000`/`42501` when `p_host_id <> auth.uid()`. The repository passes `group.hostId`. This is a safety backstop, not a business rule: the aggregate still decides who the host is, and the database only refuses to store an identity that is not the caller's.
  - Strength: A mismatch fails loudly at write time, and the stored host always equals the aggregate's host.
  - Tradeoff: It changes the Phase 2 contract ("no persistence function accepts a host id"); the identity still comes from the token.
  - Confidence: HIGH — one comparison in the function, and one more DB test case.
  - Blind spot: None significant.
- **Fix B**: Keep the RPC as planned. Document on `GroupService` and on the repository contract that `hostId`/`userId` must be the session user of the repository's Supabase client.
  - Strength: No change to the reviewed Phase 2 contract.
  - Tradeoff: The invariant is only a comment, and a mismatch stays silent.
  - Confidence: MED — this relies on future code following the comment.
  - Blind spot: Future callers such as background jobs or an admin client.
- **Decision**: FIXED (Fix A) — plan.md Phase 2 now specifies `create_group(..., p_host_id, ...)` raising `42501` when `p_host_id` is distinct from `auth.uid()`, the repository passing `hostId`, and a DB test for B passing A's id. Implemented in Phase 2.

### F3 — Group shares one mutable `Date` across its timestamps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/group.aggregate.ts:34-46
- **Detail**: `Group.create` stores the same `input.now` object as `createdAt`, as the host's `joinedAt` and as `openPeriod.openedAt`. `Object.freeze({ ...member })` is shallow, so calling `setTime` on the caller's `now`, or on any of the three getters, mutates all of them at once. `restore` has the same exposure.
- **Fix**: Copy each instant in the constructor with `new Date(value.getTime())`, so the aggregate owns its timestamps.
- **Decision**: SKIPPED

### F4 — The `unexpected` message misdescribes a failed create

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/group-error.messages.ts:8
- **Detail**: The plan maps `unexpected` to "Couldn't load your groups, try again". Phase 3 redirects a failed create to `/dashboard?error=unexpected`, so a user whose group was not created would read that loading failed.
- **Fix**: Make the `unexpected` message neutral ("Something went wrong, try again"). The Phase 3 pages render their own load-failure sentence, "Couldn't load your groups, try again", in place of the list.
- **Decision**: SKIPPED

### F5 — A name made only of invisible characters is accepted

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/group-name.value.ts:10-13
- **Detail**: `String#trim` does not remove zero-width characters such as U+200B and U+2060, so a name like `"​"` passes as 1 character and shows up as a blank link on the dashboard.
- **Fix**: In `GroupName.create`, also require at least one visible character (`/[\p{L}\p{N}\p{P}\p{S}]/u`), returning `invalid_group_name` otherwise, and add a test case for it.
- **Decision**: FIXED — `GroupName.create` also requires at least one visible character (`/[\p{L}\p{N}\p{P}\p{S}]/u`); tests for `"\u200B"` and `"\u200B\u2060\uFEFF"` added (break-checked).

### F6 — One corrupt group fails the whole dashboard (Phase 2 note)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/group.aggregate.ts:50-75
- **Detail**: `restore` throws by design, and the Phase 2 repository maps a throw to `unexpected`. Because `listGroupsOfCurrentUser` restores every group, one corrupt row makes the whole list fail. Different value objects throw different error types (`Error`, `RangeError`, and a `TypeError` for missing `members`).
- **Fix**: No change in Phase 1. In Phase 2, the repository catches any thrown value while mapping and returns `unexpected` with `context: { groupId }`. Keep the composite primary key on `group_members`, which also prevents duplicate members.
- **Decision**: FIXED — plan.md Phase 2 repository contract now requires catching any value thrown while mapping/restoring and returning `unexpected` with `context: { groupId }`.

### F7 — Small additions to the plan are not recorded

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/groups/group-error.messages.ts:21, src/lib/groups/__tests__/groups.harness.ts, src/lib/groups/group.aggregate.ts:22, src/lib/groups/types.ts:13-22
- **Detail**: Several benign additions are not in the plan or in change.md:
  - the `groupError(code, context)` factory;
  - messages for `group_not_found` and `not_authenticated`;
  - the shared test harness (`FakeGroupRepository`, `aGroup`, `groupName`);
  - the `Group.createdAt` getter;
  - the exported `GroupMember` and `OpenPeriod` view types.
- **Fix**: Add one line listing these additions under the change.md deviation note.
- **Decision**: SKIPPED
