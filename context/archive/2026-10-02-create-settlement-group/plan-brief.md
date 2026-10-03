# Create a Settlement Group (S-02) — Plan Brief

> Full plan: `context/changes/create-settlement-group/plan.md`
> Research: `context/changes/invite-member-by-link/research.md` (adjacent S-03 research; Supabase function security and error mapping apply here)
> Plan review: `context/changes/create-settlement-group/reviews/plan-review.md`

## What & Why

A signed-in user creates a settlement group ("mieszkanie"), becomes its permanent host, and the group starts with one open billing period for the current month (FR-002, must-have). A user can create and belong to any number of groups; FR-002 was changed on 2026-10-02 to drop the "one group per user" MVP limit. This is SplitDom's first domain model, and every later slice (invites, expenses, settlement, period closing) builds on the group, its host and its open period.

## Starting Point

Only auth exists. The database has no domain tables, just schema `private` plus the F-01 two-user harness and RLS guard. The Worker talks to Supabase with the anon key and the user's session. `/dashboard` is a placeholder.

## Desired End State

`/dashboard` lists the user's groups and always offers a "Create group" form. Creating one lands on `/groups/<id>`, which shows the name, "You are the host" and the open period for the current month in Europe/Warsaw (for example "October 2026"). An invalid name shows an error. Another user sees none of these groups: their dashboard list is empty, someone else's group URL returns 404, and the Supabase API returns nothing. If loading fails, the user sees a friendly message instead of a 500.

## Key Decisions Made

| Decision                  | Choice                                                                                          | Why (1 sentence)                                                                                                  | Source |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| Groups per user           | Any number; no `unique(user_id)`                                                                | The user wants to share costs with several households; PRD FR-002 updated.                                        | Plan review (user) |
| Where rules live          | TypeScript `Group` aggregate and use cases in `src/lib/groups/`                                 | The user works domain-first (DDD): rules must be readable and unit-testable in one place, not split into SQL.     | Plan (user) |
| Role of the database      | Persistence only: `create_group`, `list_my_groups`, `get_my_group`, plus light constraints      | The aggregate saves atomically in one call without an ORM or new infrastructure; constraints are backstops only.  | Plan (user) |
| Identity in DB functions  | Host, member and "my groups" filter always come from `auth.uid()`; `28000` without a session    | Browser clients can call public functions directly, so nobody can write or read as someone else.                  | Plan + review |
| Group privacy (NFR-3)     | Membership-scoped functions + `isMember` in the domain; RLS on with no policies (deny-all)      | Access rules stay in TypeScript, while the Supabase API cannot return domain data to anyone.                      | Plan (user) |
| Stored timestamps         | The aggregate's clock (`p_now`), normalized to ms ISO on read                                   | The aggregate is the source of truth, and round-trip tests become exact.                                          | Plan review |
| Billing month             | Calendar month in **Europe/Warsaw**; timestamps stored in UTC; summer and winter edges tested   | Matches the household's calendar; it also resolves S-09's "when has the month ended" question.                    | Plan (user) + review |
| Group name                | Required, 1–60 characters after trimming                                                         | The PRD names the group; S-03's invite page will show it.                                                         | Plan (user) |
| Date formatting           | `BillingMonth.label()` in the domain module; the `formatDate()` convention is replaced           | Avoids a generic utils module; the domain formats its own dates.                                                  | Plan (user) |
| UI                        | `/dashboard` = group list + create form; `/groups/[id]` = group page (404 for non-members)       | Groups are chosen by URL, with no hidden "current group" state; it is the natural home for S-04 balances.        | Plan review (user) |
| Tests                     | Unit (domain) + DB (persistence, isolation) + smoke (built app)                                  | Proves the privacy guardrail and the end-to-end flow on the Cloudflare build in CI.                               | Plan (user) |

## Scope

**In scope:**

- `src/lib/groups/`:
  - `GroupName`, `BillingMonth` and the `Group` aggregate;
  - the `createGroup`, `listMyGroups` and `getMyGroup` use cases;
  - the error type and messages;
  - the Supabase repository.
- A migration with `groups`, `group_members` and `billing_periods` (constraints, deny-all RLS) and three persistence functions.
- `POST /api/groups`, `/dashboard` (list and create form), `/groups/[id]`, middleware protection, and load-error and 404 states.
- Unit tests, DB tests on `createTwoUsers()`, smoke steps, and CLAUDE.md conventions.

**Out of scope:**

- Invites (S-03), expenses (S-04), period closing (S-09). `closed_at` exists but is never set.
- Rename, delete or leave a group; host transfer; member names; a "current group" switcher; currency.
- An ORM, Hyperdrive, a service-role key, new secrets; RLS policies that encode rules.

## Architecture / Approach

The form POST goes to `/api/groups`, which calls `createGroup`. The use case:
1. validates the name with `GroupName`;
2. builds the aggregate with `Group.create` (the host is a member, plus one open `BillingMonth.of(now)` period);
3. saves it with `repository.create` (`create_group`, three inserts in one transaction, identity from `auth.uid()`, timestamps from `p_now`).

The endpoint then redirects to `/groups/<id>`. On the read side:
- `/dashboard` → `listMyGroups` → `list_my_groups`;
- `/groups/[id]` → `getMyGroup` → `get_my_group`, then the domain `isMember` check, and 404 otherwise.

Build order: domain, then persistence, then web.

## Phases at a Glance

| Phase                                              | What it delivers                                                          | Key risk                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Group domain model (TypeScript)                 | Value objects, aggregate, use cases, unit tests; no database              | Timezone edge cases in `BillingMonth` (covered by summer and winter boundary tests)              |
| 2. Persistence and group isolation                 | Migration, generated types, Supabase repository, two-user isolation test  | Persistence functions callable from the browser; mitigated by `auth.uid()` scoping and grants    |
| 3. Endpoint, dashboard, group page, smoke and docs | `/api/groups`, dashboard list, group page, smoke steps, CLAUDE.md         | Smoke must read response bodies, which `request()` does not do yet                               |

**Prerequisites:** F-01 merged (done); local Supabase running; Node 22.14 (`nvm use`).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- A signed-in user could call `create_group` directly and bypass the TypeScript rules, for example with a different period month. This only ever affects their own new group; length and uniqueness constraints still hold. The risk is accepted in exchange for no new secrets or infrastructure.
- Read isolation relies on the persistence functions filtering by `auth.uid()` membership. The DB tests, deny-all RLS and the domain `isMember` check cover it, but by design there are no RLS read policies as a second line.
- `groups.host_id` has no cascade. Deleting a host's auth account in the Supabase Dashboard fails until their groups are removed, which is deliberate so household data is never wiped. DB tests delete groups before deleting users.

## Success Criteria (Summary)

- A user creates one or more groups on a phone and immediately sees each with themselves as host and the current month's open period.
- Another user cannot see those groups, neither in the app nor through the Supabase API.
- CI is green: unit, DB and smoke tests, the type check, and the generated-types drift check.
