<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create a Settlement Group (S-02)

- **Plan**: context/changes/create-settlement-group/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Phase 2 was reviewed as a staged, uncommitted diff:
- `supabase/migrations/20261002200553_settlement_groups.sql`
- `src/lib/groups/group.repository.ts`
- `src/lib/groups/index.ts`
- `src/lib/groups/__tests__/group.repository.db.test.ts`
- `src/db/database.types.ts`

The drift check found every planned item implemented as specified: tables, constraints, grants, comments, the three functions with their `28000`/`42501` guards, the snapshot keys, the repository contract and every integration test case. The local catalog confirms the functions' search path, the EXECUTE and table grants, the definer ownership, and that `list_my_groups` → `get_my_group` leaks nothing. Gates 2.1–2.4 are green: `db:reset`, no types drift, `test:db` 16/16, `npm test` 48, `astro check`, `lint`. The break-check of the isolation and the host backstop passed. Manual check 2.5 was confirmed by the user.

## Findings

### F1 — A signed-in client can store a group that `Group.restore` rejects, and that group breaks the whole list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261002200553_settlement_groups.sql:14-17,38-46; src/lib/groups/group.repository.ts:36-45
- **Detail**:
  - Any signed-in user can call `create_group` directly and bypass the aggregate: the anon key is public, `signInWithPassword` gives anyone their own JWT, and the session cookies are not `httpOnly` (`src/lib/supabase.ts` uses the default cookie options).
  - The DB backstops let through values that the domain rejects:
    - a whitespace-only or invisible-only name (`'   '`, `U+200B`) passes `char_length between 1 and 60`;
    - `p_period_month = '2026-10-15'` is a valid `date`, but `BillingMonth.fromDate` requires `YYYY-MM-01`.
  - When the repository reads such a group back, `restore` fails, and by design (Phase 1 review F6) one corrupt group fails the whole list.
  - Today this only breaks the caller's own dashboard. Once S-03 adds members, a host could break the dashboard of every member of that group. The plan's premise that a corrupt group is "a data-integrity bug, not a user error" does not hold while the write path is reachable from the client.
- **Fix A ⭐ Recommended**: Add light CHECK backstops to the (still unpushed) migration so the DB cannot store a snapshot the aggregate cannot restore: `check (extract(day from month) = 1)` on `billing_periods.month`, and `check (name = btrim(name) and name ~ '[[:alnum:][:punct:]]')` on `groups.name`. Add DB tests for both.
  - Strength: The light-validation backstop the user already allows (length, uniqueness, format), applied where data enters. The rules themselves stay in `GroupName`/`BillingMonth`.
  - Tradeoff: These checks duplicate the shape of the domain rules in SQL, and the POSIX classes only approximate `\p{L}\p{N}\p{P}\p{S}`.
  - Confidence: HIGH — the migration is not pushed yet, so it can still be edited in place.
  - Blind spot: Other stored fields that `restore` validates but SQL does not (none found besides these two).
- **Fix B**: Make `listGroupsOfCurrentUser` skip groups that cannot be restored, and report them (log with `groupId`), instead of failing the whole list.
  - Strength: One bad group never hides the user's other groups, whatever its origin.
  - Tradeoff: Reverses the Phase 1 review F6 decision. A corrupt group silently disappears for its members, and the service then needs a logging path.
  - Confidence: MED — this changes what the user sees in a failure case that has not been designed.
  - Blind spot: How a hidden corrupt group would be noticed and repaired.
- **Decision**: FIXED (Fix A, adapted) — `billing_periods.month` has `check (extract(day from month) = 1)`. The name regex CHECK was dropped: Postgres `[[:alnum:][:punct:]]` rejects emoji/symbol names ("🏠", "€") that `GroupName` accepts, and `\p{…}` is unavailable in SQL. At the user's choice, `Group.restore` instead restores the stored name as is (`GroupName.fromStored`, non-empty only), so a name stored past the aggregate cannot make the list unreadable. DB tests: a mid-month period is refused with `23514`, and a group with a stored `"\u200B"` name is still listed. Both were break-checked.

### F2 — No test proves that `create_group` cannot reuse another group's ids

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/groups/__tests__/group.repository.db.test.ts
- **Detail**: Reusing A's `p_group_id` fails today on the `groups` primary key (23505). Reusing A's open-period id with a fresh group id fails on the `billing_periods` primary key and rolls back the whole call. That holds only because the function has no `on conflict`. Nothing in the tests locks it in, so a future upsert refactor would let B overwrite or join A's group without any test failing.
- **Fix**: Add two DB tests:
  - B calls `create_group` with A's group id. Expect an error, A's group unchanged, and B still not a member.
  - B calls it with a new group id and A's open-period id. Expect an error and no group row for B.
- **Decision**: FIXED — DB tests: B reusing A's group id, and B reusing A's period id, both fail, write nothing for B and leave A's group unchanged.

### F3 — The DB tests miss part of the "read or change" pattern, depend on test order, and hide errors in teardown

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/groups/__tests__/group.repository.db.test.ts:45-52,74-108
- **Detail**:
  - CLAUDE.md asks DB tests to prove that user B cannot read **or change** A's rows. The test covers `select` on all three tables and `insert` into `group_members`, but no `update` or `delete` on `groups` or `billing_periods`; only the `revoke all` keeps them out today.
  - "shows user B none of user A's groups" expects B's list to be `[]`, which only holds because it runs before the test that creates B's group.
  - `afterAll` calls `cleanup()` before it throws the admin delete error. If that delete failed, the FK error from `cleanup()` hides it. If `createTwoUsers()` throws, `users` is undefined and the `TypeError` masks the real failure.
  - The repository's `28000` → `not_authenticated` mapping is not exercised: the guard test calls the raw RPC.
- **Fix**:
  - Add `update` and `delete` attempts by B on A's `groups`/`billing_periods` rows (expect `42501`).
  - Assert that none of A's ids appear in B's list, rather than that the list is empty.
  - In `afterAll`, guard against a missing `users`, and throw the delete error before calling `cleanup()`.
  - Assert the repository (not the raw RPC) maps the admin client's `28000` to `not_authenticated`.
- **Decision**: FIXED — B's `update`/`delete` on A's `groups` and `billing_periods` get `42501`; B's list is asserted not to contain A's id; `afterAll` guards a failed `createTwoUsers()` and throws the delete error before `cleanup()`; the repository maps the service-role caller's `28000` to `not_authenticated`.

### F4 — `create_group` reveals whether a group id exists

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261002200553_settlement_groups.sql:90-91
- **Detail**: Calling `create_group` with someone else's group id fails with 23505, while an unknown id succeeds. This weakens the "a non-member cannot tell exists from does not exist" goal of `get_my_group`. It can only be exploited with a leaked group UUID (v4 ids are unguessable), and it reveals existence only.
- **Fix**: Accept it, and note it next to the `create_group` comment in the migration.
- **Decision**: SKIPPED

### F5 — User-deletion constraints are not recorded anywhere

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261002200553_settlement_groups.sql:17,25
- **Detail**:
  - `groups.host_id` has no cascade, so a user who hosts a group cannot be deleted: the delete fails with 23503, which GoTrue reports as "Database error deleting user". This is intentional, but it will block any future account-deletion or GDPR flow.
  - `group_members.user_id` cascades, so deleting a non-host member silently drops their membership. That is a domain change made outside the aggregate, and it will matter once expenses reference members.
- **Fix**: Record both as known constraints in `context/deployment/deploy-plan.md` (Known limitations), and flag `user_id … on delete cascade` for review in S-04.
- **Decision**: FIXED — constraints recorded in `context/deployment/deploy-plan.md` ("Settlement groups"), with `user_id … on delete cascade` flagged for review in S-04.

### F6 — `list_my_groups` calls a function once per membership

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261002200553_settlement_groups.sql:161
- **Detail**: plpgsql `get_my_group` is never inlined, so each membership costs about four indexed lookups. This is trivial at household scale (a few groups per user) and matches the plan's Performance Considerations. Keeping the snapshot JSON in one place is a deliberate choice.
- **Fix**: Accept for now; rewrite as one set-based query if memberships per user ever grow.
- **Decision**: ACCEPTED — trivial at household scale; rewrite set-based if memberships per user grow.

### F7 — A non-array `list_my_groups` result reports `{ groupId: null }`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/groups/group.repository.ts:33-35
- **Detail**: The guard for a non-array result is sensible and not covered by the plan, but the `{ groupId: null }` context does not describe the failure.
- **Fix**: Return `groupError("unexpected")` with empty context for a non-array result.
- **Decision**: FIXED — a non-array result returns `groupError("unexpected")` with empty context.
