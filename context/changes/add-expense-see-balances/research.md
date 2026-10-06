---
date: 2026-10-05T15:32:36+0200
researcher: Claude Opus 5.5 (session of adamgwozdz00)
git_commit: edad25b128e639e056208cc6a2caff5c72625c77
branch: chore/archive-block-direct-data-api
repository: adamgwozdz00/SplitDom
topic: "S-04 add-expense-see-balances: what the codebase already provides, what conventions bind the slice, and which decisions remain open"
tags: [research, codebase, groups, invites, billing-periods, expenses, balances, money, supabase, smoke]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude Opus 5.5 (session of adamgwozdz00)
---

# Research: S-04 add-expense-see-balances

**Date**: 2026-10-05T15:32:36+0200
**Researcher**: Claude Opus 5.5 (session of adamgwozdz00)
**Git Commit**: edad25b128e639e056208cc6a2caff5c72625c77
**Branch**: chore/archive-block-direct-data-api
**Repository**: adamgwozdz00/SplitDom

## Research Question

Roadmap slice S-04 (`context/foundation/roadmap.md:136-148`, PRD US-01, FR-004, FR-005): a group member adds an expense in the group's open billing period, split equally between all members, and immediately sees each member's debt or credit. Before planning: what does the codebase already provide (domain modules, schema, persistence functions, web layer, tests), which conventions bind a new expenses module, what prior decisions exist in `context/`, and which product decisions are still open?

## Summary

- **Nothing money-related exists yet.** On the inspected paths there is no amount, expense, debt or balance code: a grep of `src/` (excluding generated types) for `amount|money|grosz|cents|PLN|zł|NumberFormat|currency` returned no matches, and none of the 6 migrations has a `numeric` or money column. S-04 sets the precedent for money storage, the amount value object and formatting.
- **The open period and the member list come from the `Group` aggregate.** `Group` holds `members: {userId, joinedAt}[]` and exactly one `openPeriod {id, month: BillingMonth, openedAt}` (`src/lib/groups/types.ts:13-22`, `src/lib/groups/group.aggregate.ts:5-35`). `GroupService.getForMember` loads it and returns `group_not_found` both for non-members and for unknown or malformed ids (`src/lib/groups/group.service.ts:53-65`). The S-03 precedent for a second aggregate that depends on a group is `Invite.create({ group, ... })`. In that precedent the endpoint first loads the `Group` through `GroupService`, then passes it in (`src/pages/api/groups/[id]/invites.ts:20-25`, `src/lib/invites/invite.aggregate.ts:48-51`).
- **The database conventions are fixed and documented.** CLAUDE.md "Database changes" and the two applied migrations (`supabase/migrations/20261002200553_settlement_groups.sql`, `20261005080344_group_invites.sql`) define:
  - tables: RLS on with no policies, all grants revoked, no defaults (the aggregate supplies ids and clock);
  - functions: `public` `security definer` with `search_path = ''` and an `auth.uid()` null check plus membership check; reads return snake_case `jsonb`; errors use SQLSTATE `28000`, `42501`, `22023` or custom `SD0xx`.

  The app-key gate needs nothing per function (`supabase/migrations/20261005114042_app_gate.sql:117`).

- **The roadmap's blocking question is still open.** No file in `context/` decides debt granularity (one debt per expense share vs. one netted debt per pair per period), rounding, or money storage. An earlier S-04 plan existed but was untracked and deleted by the user's decision on 2026-10-05; it cannot be recovered (`context/archive/2026-10-05-block-direct-data-api/plan.md:70-74`).
  - The PRD wording about debts points both ways. Debts tied to an expense: US-01, FR-005 and FR-015 (`context/foundation/prd.md:52,56,83,85`). Pairwise settlement: FR-006 (`prd.md:87-88`).
- **Member identities are not available anywhere.** No function returns emails or names, and the group page shows no member list (`supabase/migrations/20261002200553_settlement_groups.sql:126`, `src/components/groups/GroupCard.astro:12-22`). A balance per member needs a member label, so S-04 must add a way to read co-members' emails. The roadmap asks S-04 to keep the labelling rule in one place so S-10 can swap the source (`roadmap.md:214,223`).
- **Database tests no longer exist.** They were deleted in `d4e4668` (`context/archive/2026-10-05-block-direct-data-api/plan.md:43`). For a new table, coverage is now:
  - unit tests on in-memory harnesses;
  - new `scripts/smoke.mjs` steps;
  - the `db:types` drift check.
- **External evidence on rounding** (Betterment engineering, Dinero.js `allocate`, Fowler's `Money.allocate`; links in Historical Context): store amounts as integer minor units, allocate shares by floor + largest remainder, and make the leftover-unit order deterministic. Then the parts always sum to the total, which is exactly the PRD guardrail (`prd.md:43`).

## Detailed Findings

### A. Groups domain module (the parent the expense depends on)

- **Files** in `src/lib/groups/`:
  - `types.ts`, `index.ts`
  - `group-name.value.ts`, `billing-month.value.ts`
  - `group.aggregate.ts`, `group.service.ts`, `group.repository.ts`
  - `group-error.messages.ts`
  - `__tests__/` with `groups.harness.ts` and 4 test files
- **Error shape.** `GroupError = { error: { code, message, context } }` and `Result<T> = { data: T } | GroupError` (`src/lib/groups/types.ts:6-11`). The comment says the error shape is "owned here until a second module needs it". `src/lib/invites/types.ts:4-11` declares its own copy, so an expenses module would add a third.
- **`Group` aggregate.**
  - Invariant: the host is a member (`group.aggregate.ts:27-29`).
  - Members and the open period are frozen (`:34-35`).
  - Methods: `create` (`:38-47`), `restore(snapshot)` (throws on invalid data, `:50-71`), `isHost` (`:73`), `isMember` (`:77`) and `toSnapshot` (`:81-94`).
  - Only the open period is modelled; closed periods are not loaded.
- **`GroupService`.**
  - Constructor: `(repository, newId, clock)` (`group.service.ts:14-18`).
  - Methods: `create`, `listForMember`, `getForMember`. They return `Result` values and never throw (`:21-65`).
  - A malformed UUID short-circuits to `group_not_found` without a database call (`:7,53-57`).
- **Repository.**
  - RPC calls: `create_group`, `list_my_groups`, `get_my_group` (`group.repository.ts:18-50`).
  - `fromDbError` maps `28000` to `not_authenticated` and everything else to `unexpected {dbCode}` (`:71-73`).
  - Snapshot parsing uses throwing helpers (`asObject`, `asString`, `asInstant`) wrapped in try/catch, so bad data becomes `unexpected` (`:76-139`).
  - `createGroupService(client)` wires `() => crypto.randomUUID()` as an arrow because of workerd's "Illegal invocation" (`:59-69`).
- **`BillingMonth`.**
  - `of(instant)` uses the Europe/Warsaw calendar (`billing-month.value.ts:2-3,20-28`).
  - `label()` formats in UTC with `en-US` (`:8-9,44-46`).
  - It is the single place that maps a moment to its billing month (`roadmap.md:208`).
- **`index.ts`.** It never imports `@/lib/supabase`, because Vitest cannot resolve `astro:env/server` (`index.ts:1-2`).

### B. Invites module: the cross-aggregate precedent

- **`Invite.create({ id, group, createdBy, now })`** takes a loaded `Group`. When `group.isMember(createdBy)` is false, it returns `group_not_found` (`src/lib/invites/invite.aggregate.ts:48-51`). The endpoint orchestrates the two services (`src/pages/api/groups/[id]/invites.ts:20-28`). The S-03 plan records that neither service touches the other's repository (`context/archive/2026-10-02-invite-member-by-link/plan.md:115`).
- **Read-model data next to the aggregate.** `InviteLookup { invite, groupName, callerIsMember }` (`src/lib/invites/types.ts:25-30`) is the precedent for returning data that is not aggregate state. A per-member balance view with member labels fits this shape.
- **Error mapping.** `fromDbError` maps `SD001` to `invite_invalid` and `42501` to `group_not_found` (`src/lib/invites/invite.repository.ts:68-79`). `SD001` is raised at `supabase/migrations/20261005080344_group_invites.sql:148`.
- **Documented exception.** `redeem_group_invite` writes `group_members` outside the `Group` repository for atomicity (CLAUDE.md "Database changes"; `group_invites.sql:121-159`).

### C. Schema and persistence conventions

- **Migrations.** There are 6, named `<YYYYMMDDHHMMSS>_<snake>.sql`:
  - `20260927211445_private_schema`
  - `20261002200553_settlement_groups`
  - `20261005080344_group_invites`
  - `20261005114042_app_gate`
  - `20261005122316_app_gate_enforce`
  - `20261005130810_app_gate_tighten_grants`

  The `deploy` job pushes them with `supabase db push` (`.github/workflows/ci.yml:78-79`).

- **`billing_periods`** (`settlement_groups.sql:36-49`):
  - columns: `id`, `group_id` (cascade), `month date check (extract(day from month) = 1)`, `opened_at`, and `closed_at` (null means open);
  - `unique (group_id, month)`;
  - the partial unique index `billing_periods_one_open_per_group_idx`.

  There is no status column.

- **`group_members`.** Columns `(group_id, user_id, joined_at)` with PK `(group_id, user_id)`. `user_id` references `auth.users` `on delete cascade` (`settlement_groups.sql:24-32`). That cascade was flagged for review in S-04 (`context/archive/2026-10-02-create-settlement-group/reviews/impl-review-phase-2.md:104-110`; `context/deployment/deploy-plan.md:112-116`): deleting a member drops their membership outside the aggregate, which matters once expenses reference members.
- **Table pattern**, as applied at `settlement_groups.sql:14-61` and `group_invites.sql:11-29`:
  - no column defaults; `id uuid primary key` and `created_at timestamptz not null` come from the aggregate;
  - `group_id` FK `on delete cascade`, plus an index on it;
  - `comment on table` naming the aggregate;
  - `enable row level security` with no policies;
  - `revoke all ... from anon, authenticated`.
- **Function pattern**, as applied at `settlement_groups.sql:67-184` and `group_invites.sql:36-171`:
  - `language plpgsql security definer set search_path = ''`;
  - first statement raises `28000` when `auth.uid()` is null;
  - writes raise `42501` when the passed identity is not `auth.uid()` or the caller is not a member (`group_invites.sql:54-65`);
  - reads are `stable`, return a `jsonb` snapshot with snake_case keys, and return null for non-members (`settlement_groups.sql:107-147`);
  - `revoke execute ... from public, anon`, then `grant execute ... to authenticated`.
- **Rules the user set in earlier changes:**
  - Timestamps come from TypeScript only, with no DB-side timestamp validation (`context/archive/2026-10-02-invite-member-by-link/reviews/plan-review.md:45`).
  - No cross-column `check` constraints: they are aggregate invariants enforced in `restore()` (`plan-review.md:34`).
  - Single-column format checks are fine (`impl-review-phase-2.md:33-56`).
  - No `on conflict` or upsert in create functions, so a reused id cannot take over rows (`impl-review-phase-2.md:58-68`).
- **App-key gate.** `alter role authenticator set pgrst.db_pre_request = 'api_gate.check_app_request'` (`app_gate.sql:117`). It applies to every PostgREST request, and the Worker client sends `x-app-key` (`src/lib/supabase.ts:12`).
- **Superseded conflict.** The deleted S-04 plan had persistence functions with no `auth.uid()` membership filter (`context/archive/2026-10-05-block-direct-data-api/research.md:36,143,156`). Current CLAUDE.md requires functions that "filter on the caller's membership via `auth.uid()`", and the block-direct-data-api change kept those checks. Verdict: that historical approach is contradicted by the current rule; S-04 functions follow CLAUDE.md.

### D. Web layer

- **Group page** (`src/pages/groups/[id].astro`):
  - It creates its own client with `createClient(Astro.request.headers, Astro.cookies)` (`:15`). `App.Locals` has only `user`.
  - It loads the group through `createGroupService(supabase).getForMember` (`:16-18`).
  - `group_not_found` returns 404 (`:22-25`). Any other failure renders `GROUPS_LOAD_FAILED_MESSAGE` with status 200 (`:53-60`).
  - It renders `GroupCard` and `InvitePanel` (`:43-44`), and S-02 named this page "the natural home for S-04 balances" (`context/archive/2026-10-02-create-settlement-group/plan-brief.md:32`).
- **`?error=` is not namespaced.** It is read once and interpreted only as an invite error (`src/pages/groups/[id].astro:34-35`). An expense form that redirects back to the same page with `?error=<code>` would be rendered through `inviteErrorMessage`. The plan needs either a second parameter or per-section code routing.
- **Form-POST endpoint pattern** (`src/pages/api/groups/index.ts`, `src/pages/api/groups/[id]/invites.ts`):
  1. Redirect to `/auth/signin` when there is no user.
  2. `formData().catch(() => null)`.
  3. Create the client; when it is null, redirect with `?error=unexpected`.
  4. Call the service; on error, redirect with `?error=<code>`, otherwise redirect to the resource.

  `src/pages/api/invites/redeem.ts:11` lacks the `.catch`.

- **Components.** Group and invite UI is `.astro` with small inline scripts that disable the submit button on submit and re-enable it on `pageshow` (`src/components/groups/CreateGroupForm.astro:49-62`, `src/components/invites/InvitePanel.astro:61-72`). React islands are used only for the auth forms. Double-submit protection matters more for expenses: until S-05 adds deletion, a duplicate expense cannot be removed (`context/archive/2026-10-02-create-settlement-group/reviews/plan-review.md:37-54`).
- **Middleware.** `PROTECTED_ROUTES = ["/dashboard", "/groups", "/api/groups", "/api/invites"]` with whole-segment matching (`src/middleware.ts:4,18-24`). An endpoint under `/api/groups/[id]/...` is already protected; a new top-level `/api/expenses` would need adding to that list.

### E. Member identity

- The member snapshot is `{user_id, joined_at}` only (`settlement_groups.sql:126`, `src/lib/groups/types.ts:13-16`). There is no profiles table, and no migration reads `auth.users` beyond foreign keys (inspected: all 6 migrations).
- The UI shows only the current user's email, on the dashboard (`src/pages/dashboard.astro:30`). On the group page it shows the host badge and the period label (`src/components/groups/GroupCard.astro:12-22`).
- **Earlier decisions:**
  - S-02 and S-03 explicitly left member names out (`context/archive/2026-10-02-create-settlement-group/plan.md:56`, `context/archive/2026-10-02-invite-member-by-link/plan.md:91`).
  - S-10 plans display name first, falling back to email (`roadmap.md:214`).
  - The deleted plan's `Group.memberLabel` decision was removed from the roadmap as not made (`context/archive/2026-10-05-block-direct-data-api/plan.md:82`).
- **Inference:** a readable US-01 view ("Użytkownik B owes 200 zł") needs co-members' emails, for example from a `security definer` read that joins `auth.users.email` for members of the caller's groups. Labels such as "You / Member 2" are the alternative. This choice is the user's.

### F. Tests and smoke

- **Vitest.** One project, `unit`, over `src/**/__tests__/**/*.test.ts` with no database (`vitest.config.ts:4-20`).
- **In-memory fakes.**
  - `FakeGroupRepository` records calls and supports a forced `failure` (`src/lib/groups/__tests__/groups.harness.ts:6-33`).
  - `FakeInviteRepository` imitates the conditional claim (`src/lib/invites/__tests__/invites.harness.ts:18-73`).
  - Service tests inject `sequentialIds(...)` and a fixed clock (`src/lib/groups/__tests__/group.service.test.ts:12-25`).
- **Database tests were removed** in commit `d4e4668`:
  - removed: the `test:db` suite, `two-users.harness.ts`, the RLS guard, and the CI `db-test` job;
  - recorded as an accepted loss (`context/archive/2026-10-05-block-direct-data-api/plan.md:43`).

  The roadmap row for F-01 still describes the harness (`roadmap.md:44`).

- **`scripts/smoke.mjs`** is 323 lines with zero dependencies.
  - It defines steps declaratively as `[name, run, {status, location?, check?}]` (`:175-304`).
  - It uses a single cookie jar and runs two users in sequence: user 1 creates group A and an invite, then user 2 signs up and joins (`:189-282`).
  - Group ids are captured into `groupIds` (`:66-73`).

  Where expense steps can attach:
  - after user 2 joins (`:274`), for a two-member split;
  - after the anonymous-redirect steps (`:237-243`), for an anonymous add-expense check.

  An earlier review asked for dependent steps to fail explicitly when an earlier step did not capture its id (`context/archive/2026-10-02-create-settlement-group/reviews/impl-review-phase-3.md:110-118`).

### G. Runtime constraint

The infrastructure pre-mortem names "the balance-calculation page with a few Supabase queries per request" as the scenario that hits Workers CPU limits (`1015`). It also notes that `Promise.all` does not reduce CPU time (`context/foundation/infrastructure.md:64,70`). Inference: loading the group, its expenses and the member labels in as few RPC calls as possible, and computing balances in TS, keeps the page light. At household scale the arithmetic itself is negligible.

## Code References

- `src/lib/groups/types.ts:6-22` — error shape, `Result`, `GroupMember`, `OpenPeriod`
- `src/lib/groups/group.aggregate.ts:27-94` — `Group` invariants, `restore`, `isMember`, `toSnapshot`
- `src/lib/groups/group.service.ts:7,53-65` — `getForMember`, UUID short-circuit, non-member → `group_not_found`
- `src/lib/groups/group.repository.ts:59-139` — factory with arrow generators, error mapping, snapshot parsing
- `src/lib/groups/billing-month.value.ts:2-46` — Warsaw month, UTC label
- `src/lib/invites/invite.aggregate.ts:48-51` — aggregate that takes a loaded `Group`
- `src/lib/invites/types.ts:25-30` — read-model projection next to an aggregate
- `src/lib/invites/invite.repository.ts:68-79` — `SD001` and `42501` mapping
- `supabase/migrations/20261002200553_settlement_groups.sql:14-184` — tables, `billing_periods`, `get_my_group`, grants
- `supabase/migrations/20261005080344_group_invites.sql:36-171` — membership check on writes, custom SQLSTATE
- `supabase/migrations/20261005114042_app_gate.sql:117` — pre-request hook registration
- `src/pages/groups/[id].astro:15-44` — group page load, 404, single `?error=` param
- `src/pages/api/groups/[id]/invites.ts:13-28` — endpoint orchestrating two services
- `src/middleware.ts:4,18-24` — protected route prefixes
- `scripts/smoke.mjs:44-57,175-304` — request helper and step list
- `vitest.config.ts:4-20` — unit project only

## Architecture Insights

- **Domain-first layering** (CLAUDE.md "Domain logic"): the expense split and balance rules belong in TS. Database functions only persist and load, scoped to `auth.uid()` membership. A multi-row write, such as an expense plus its stored shares, goes through one RPC, because supabase-js has no client transactions (`context/archive/2026-10-02-create-settlement-group/plan.md:13`).
- **The expense depends on `Group` without owning it.** Following S-03, the endpoint loads the `Group` (open period id and member ids), and the expense aggregate takes it as input. The membership check runs in TS and again in SQL as a backstop.
- **Money becomes a value object.** By the module conventions, an amount type owned by the expenses module (integer grosze, parsing, `label()`-style formatting) mirrors how `BillingMonth` owns date formatting (CLAUDE.md "Dates"). The user dislikes generic utils modules, so the formatter lives with its value object.
- **The member-label rule belongs in one place** (`roadmap.md:223`), so that S-10 changes only the label source.
- **Error codes per module.** Each module has a closed `...ErrorCode` union and its own messages file. A third copy of `Result` is the point at which the "owned here until a second module needs it" comment (`src/lib/groups/types.ts:6`) invites extracting the shared shape. Whether to extract it is a plan decision.

## Historical Context (from prior changes)

- `context/archive/2026-10-05-block-direct-data-api/plan.md:42,70-82` — **supported:** an earlier S-04 change folder existed, was untracked, and was deleted by the user's decision on 2026-10-05. The user will recreate the S-04 plan; S-04 was reset to `blocked` because debt granularity is still `Block: yes`.
- `context/archive/2026-10-05-block-direct-data-api/research.md:36,143,156` — **contradicted by the current rule:** the deleted plan's persistence functions without a membership filter. CLAUDE.md now requires `auth.uid()` membership filtering.
- `context/archive/2026-10-02-create-settlement-group/plan.md:54` — **supported:** "no expenses or balances (S-04)". `closed_at` exists only for the one-open-period backstop, and nothing sets it yet.
- `context/archive/2026-10-02-create-settlement-group/reviews/impl-review-phase-2.md:104-110` and `context/deployment/deploy-plan.md:115` — **open:** the `group_members.user_id` cascade was flagged to revisit in S-04.
- `context/foundation/roadmap.md:44` — **partial:** F-01 is listed as delivering a "two-user test harness + RLS guard". F-01 did deliver it, but commit `d4e4668` removed it, so it no longer exists.
- Deleted `context/foundation/test-plan.md` (recoverable as `git show d4e4668^:context/foundation/test-plan.md`), lines 49 and 70 — historical risk #1: "100 zł / 3 loses a grosz" or a debt and its credit do not cancel. It planned property-based balance invariants with an oracle taken from the PRD rather than from the code. The user deleted the test plan and will recreate it.
- External sources on rounding (lesson-required external evidence):
  - Betterment, "A Functional Approach to Penny-Precise Allocation" (https://www.betterment.com/engineering/penny-precise-allocation-functions): work in integer cents and use the largest remainder method, so the parts sum exactly to the total.
  - Dinero.js `allocate` (https://www.dinerojs.com/api/mutations/allocate; v1 docs: `1003` allocated `[50, 50]` gives `502, 501`).
  - Fowler's `Money.allocate` (https://stackoverflow.com/questions/1679292): `$100` by `(1,1,1)` gives `34, 33, 33`. The leftover goes to the first entries in list order.
  - CodeDecoders, "Allocating money across parties without losing a cent" (https://codedecoders.io/blog/splitting-money-across-parties-remainder): break ties on a stable id, not on the order a query returns rows, so the split is deterministic.

  For an equal split of `T` grosze among `n` members, each share is `floor(T / n)`. The leftover `T mod n` (strictly less than `n`) goes 1 grosz each to `T mod n` members chosen by a stable order.

## Related Research

- `context/archive/2026-10-02-create-settlement-group/research.md` — groups, periods and the domain-first layering.
- `context/archive/2026-10-02-invite-member-by-link/research.md` — persistence functions in `public`, cross-aggregate orchestration.
- `context/archive/2026-10-05-block-direct-data-api/research.md` — app-key gate, removal of DB tests, the deleted S-04 plan.

## Open Questions

These are product and design choices for the user. Each needs a decision before or during `/10x-plan`.

1. **Debt granularity (roadmap `Block: yes`, `roadmap.md:145`).** The two options are one debt per expense share (expense × non-payer member) or one netted debt per pair of members per period.
   - Evidence for per-expense:
     - US-01 says the app "zapisuje ten dług" for the expense (`prd.md:52`).
     - Debt and credit are "kwotami przeciwnymi wynikającymi z tego samego wydatku" (`prd.md:56`).
     - FR-005 locks an expense when "dotyczący go dług" is paid (`prd.md:83`).
     - FR-015 counts the host's debts "za wydatki z tego okresu" (`prd.md:85`).
   - Evidence for pairwise: FR-006 says "MVP rozlicza pary osobno" (`prd.md:88`).
   - Consequences for later slices:
     - S-06 generates one transfer per debt.
     - S-08 confirms per debt.
     - S-05 locks per expense.
     - S-09 checks the host's debts.
     - Under netting, the FR-005 "its debt is paid" lock has no single debt per expense to point at.
2. **Stored vs derived balances.** Are the per-member shares stored with each expense when it is created, or recomputed from current members on each read? If they are recomputed, a member who joins mid-period changes the split of earlier expenses. Storing shares also matches US-01's "zapisuje ten dług". Related question: "all members" means members at the moment the expense is added.
3. **Rounding and money unit** (`roadmap.md:146`, `Block: no`). Proposed by the external evidence: integer grosze plus largest remainder. Still open: who gets the leftover grosz. Options are the payer (their own share absorbs it), members in a stable order (e.g. by user id or join time), or another rule.
4. **Member labels.** Should S-04 show co-members' emails (a new membership-scoped read of `auth.users.email`), or only "You" and neutral labels until S-10?
5. **Expense fields.** The US-01 example has a title ("Czynsz") and an amount (`prd.md:51`). Also to decide:
   - Is a date or description required?
   - Is the payer always the signed-in author?
   - Maximum amount and input format: Polish decimal comma, e.g. "12,50"?
6. **`group_members.user_id` cascade** (flagged for S-04). Should it be changed now that expenses will reference members (e.g. `restrict` like `groups.host_id`), or left with an explicit note?
7. **Error routing on the group page.** Use a second query parameter, or route per section, so expense errors do not render through `inviteErrorMessage` (`src/pages/groups/[id].astro:34-35`)?
8. **Shared `Result`/error type.** Extract it now that a third module needs it, or keep a per-module copy as invites did?
