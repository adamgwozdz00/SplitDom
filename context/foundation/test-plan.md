# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-04

## 1. Strategy

Every test in this project must follow three principles:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** A risk that comes from the
   team's own worry carries the same weight as a PRD line or hot-spot data.
   Example: "the team is worried about X, and the failure would surface
   somewhere in <area>."
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely*. That belief comes from
   documents, the interview, and codebase *signal*: churn, structure and the
   existing test base. The plan does NOT claim to know which line owns the
   failure. `/10x-research` produces that knowledge during each rollout
   phase. If the plan and research disagree about where the failure lives,
   research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`
and `scripts/`.

- Excluded: `src/app/` (removed Next.js code) and the generated
  `src/db/database.types.ts`.
- The history is thin: 6 squash-merged commits in 30 days. Likelihood
  therefore leans on the roadmap and the interview more than on churn.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user and business
terms, not test names. The Source column cites the *evidence that surfaced
this risk*. It never names a specific file as "where the failure lives" —
that is research's job (see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | A balance or split comes out wrong — shares do not add up to the expense, 100 zł / 3 loses a grosz, or a debt and its matching credit do not cancel out — and someone transfers the wrong amount | High | High | PRD Guardrails ("suma wydatków = suma przypisanych udziałów"), US-01; roadmap S-04 (rounding still open, north star, next slice); interview Q1; interview Q3 (domain code changes most often) |
| 2 | A member of one group, or a stranger, reads another group's balances or expenses: a page or endpoint checks "signed in" instead of "member of this group", or a database function is called directly from the browser | High | Medium | PRD NFR-3 and Guardrails (per-group privacy); interview Q1; roadmap S-04, S-06 (each slice adds persistence functions; S-06 adds account numbers) |
| 3 | A business rule is implemented beside the domain (in a page, endpoint or SQL function): domain tests stay green while user-visible behaviour is wrong, or a path skips the rule | Medium | High | interview Q4, Q3; CLAUDE.md Code Conventions (rules live in TypeScript aggregates); hot-spot dirs `src/lib/groups` (14 file changes/30d), `src/pages/api` (7/30d) |
| 4 | A stranger joins a group without a valid invite: an invite works twice or after it expired, or a messenger's link preview uses it up before the invitee clicks | High | Medium | interview Q1; roadmap S-03 (first flow where a stranger touches a group); `context/changes/invite-member-by-link/plan.md` (single-use 7-day bearer token) |
| 5 | A wrong query silently returns empty or wrong data, so the user sees "no groups" or a stale balance instead of an error | High | Medium | interview Q2; `context/archive/2026-10-02-create-settlement-group/plan.md` (snapshots mapped from database JSON into aggregates) |
| 6 | An expense is changed by someone other than its author, or after its period is closed or its debt confirmed as paid; or a non-host closes a period | High | Medium | PRD Guardrails (author-only edits), FR-005, FR-015, US-02; roadmap S-05, S-09 |

These are abuse scenarios, all scored on the same two axes:

- **#2:** ownership is not checked (IDOR), or a database function is called directly.
- **#4:** a bearer token is replayed or raced.
- **#6:** someone changes another member's expense.

Secret leakage is deferred to a refresh when S-06 introduces account
numbers. Examples are account numbers or invite tokens in logs, URLs or
error bodies.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | For any amounts and member counts, shares sum to the expense and debts plus credits sum to zero; the PRD example (400 zł split by two → 200 zł owed) holds | "The 400/2 example proves the split works" | Where the rounding decision is made; the money unit (minor units or decimals); whether balances are derived or stored | unit + property-based | Expected values computed with the same formula as production (the oracle problem); only round numbers |
| #2 | User B gets nothing of group A through any path (page, endpoint, direct RPC), while A gets their own data in the same test (positive control) | "An empty response means isolation works" | Which persistence functions filter on membership; which pages and endpoints load data through the domain service; what anon and direct table access return | integration (one minimal DB test per persistence function) + one smoke 404 step | Asserting only an empty result with no positive control; testing through the admin client |
| #3 | Pages and endpoints cannot reach a repository or RPC except through the module's service, and breaking that boundary fails lint before review | "Green domain tests mean the rule is enforced" | Current import boundaries (page → service → repository); every place an RPC is called outside a repository | static check (ESLint `no-restricted-imports`) + service-level unit tests | A test that mirrors the folder structure; a file-tree snapshot; rules re-tested inside endpoint tests |
| #4 | An invite adds a member exactly once; used or expired invites are refused even through a direct RPC call; opening the link (GET) consumes nothing | "A second user joining once proves the invite works" | The claim-then-insert order; which clock decides expiry; what GET does | integration (DB) + smoke; mostly delivered inside the S-03 plan | Happy-path-only join; no concurrent-redeem case |
| #5 | Saving through the service and loading back yields the same aggregate; corrupt or unexpected data surfaces as an error, never as "no data" | "No error means the data is right" | snake_case-to-snapshot mapping; `null` versus empty-array handling; error translation | integration (repository round-trip, minimal) | Mocking the Supabase client, which hides mapping bugs |
| #6 | A non-author cannot change an expense; a closed period or a paid debt blocks edits, including through a direct RPC; only the host can close a period | "The UI hides the button, so the rule holds" | Where the lock lives in the aggregate; which SQL backstop exists | unit (aggregate) + minimal integration | Testing only that a button is hidden |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Domain boundary guard | Prove that a rule placed beside the domain is caught by lint before review | #3 | static import-boundary lint + service-level unit | change opened | testing-domain-boundary-guard |
| 2 | Group isolation recipe | Prove, per persistence function, that the owner sees their data, others and anon see nothing, direct table access fails, and data round-trips intact | #2, #5, #4 | integration (minimal DB) + smoke | not started | — |
| 3 | Balance correctness oracle | Prove balance invariants for arbitrary inputs, with oracles taken from the PRD rather than the code (alongside S-04) | #1 | unit + property-based | not started | — |
| 4 | Expense lock and authorship | Prove that only authors edit, locks hold after close or payment, and only the host closes (after S-05 and S-09) | #6 | unit + minimal integration | not started | — |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests and configs,
plus the MCP tools exposed in the current session.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit | Vitest (`unit` project) | 5.0.2 | `src/**/__tests__/**/*.test.ts`; plain config, no Astro or Cloudflare adapter |
| integration (DB) | Vitest (`db` project) + local Supabase | 5.0.2 | `*.db.test.ts`, run one file at a time; two-user harness and RLS guard |
| end-to-end smoke | `scripts/smoke.mjs` (zero-dependency fetch) | n/a | Runs against the built app in CI with a cookie jar and `redirect: "manual"`; no browser |
| static boundaries | ESLint `no-restricted-imports` (core rule) | 10.11.0 | none yet — see Phase 1 |
| property-based | `fast-check` with `@fast-check/vitest` | not installed | none yet — see Phase 3 |
| browser e2e | none | — | Deliberately absent: UI is out of scope (§7) |

**Stack grounding tools (current session):**
- **Docs: Context7.**
  - Confirmed that `@fast-check/vitest` provides `test.prop`/`it.prop` and is the recommended Vitest connector (`/dubzzz/fast-check`).
  - Confirmed that ESLint 10.5 `no-restricted-imports` supports `patterns` with `group` and a custom `message` (`/eslint/eslint/v10.5.0`).
  - checked: 2026-10-04
- **Search: Exa.ai.** Available, but not used for this plan. checked: 2026-10-04
- **Runtime/browser: built-in browser pane.** Available, but not used: UI is out of scope. checked: 2026-10-04
- **Provider/platform:**
  - Cloudflare MCP needs authorization, so it was not used.
  - GitHub is reachable through the `gh` CLI, not an MCP.
  - There is no Supabase MCP.
  - checked: 2026-10-04

## 5. Quality Gates

All of these gates must pass before a change reaches production. A gate
marked "required after §3 Phase N" is enforced once that rollout phase
lands. Before that, it is planned.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck (`npm run lint`, `npx astro check`) | local + CI `ci` job | required | syntactic and type drift |
| unit tests (`npm test`) | local + CI `ci` job | required | domain rule regressions |
| DB tests + generated-types drift (`npm run test:db`, `git diff --exit-code`) | CI `db-test` job | required | isolation, persistence backstops, schema/type drift |
| smoke on the production build (`npm run smoke`) | CI `smoke` job | required | broken critical flows on the Cloudflare build |
| domain import-boundary lint | local + CI `ci` job (inside `npm run lint`) | required after §3 Phase 1 | rules or data access placed beside the domain |
| property-based balance invariants | local + CI `ci` job (inside `npm test`) | required after §3 Phase 3 | balance and rounding errors on unusual inputs |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships. Until then it reads "TBD — see §3 Phase N."
Patterns that already exist from earlier slices are recorded as they are.

### 6.1 Adding a unit test (domain rule)

- **Location**: `src/lib/<module>/__tests__/` next to the module.
- **Naming**: `<file-under-test>.test.ts`, for example
  `group.aggregate.test.ts`.
- **Reference test**: `src/lib/groups/__tests__/group.aggregate.test.ts`.
  The service is tested through the in-memory fake in
  `src/lib/groups/__tests__/groups.harness.ts`.
- **Run locally**: `npm test`.

### 6.2 Adding a persistence / isolation test

- Existing pattern: `src/lib/groups/__tests__/group.repository.db.test.ts`
  on `createTwoUsers()` from `src/db/__tests__/two-users.harness.ts`. Run
  locally with `npm run test:db`, with local Supabase running.
- The reusable per-function recipe (owner sees, stranger and anon do not,
  direct table access denied, round-trip) is TBD — see §3 Phase 2.

### 6.3 Adding a smoke step

- Existing pattern: append a `[name, run, expected]` step to `scripts/smoke.mjs`.
  Use `bodyContains(...)` or a `check` function for body assertions. Run it
  against `npm run build && npm run preview`.
- Smoke is for critical flows on the built app only, never for rules a
  unit test can catch.

### 6.4 Guarding the domain boundary

- TBD — see §3 Phase 1 (lint pattern that fails when a page or endpoint
  bypasses the module's service).

### 6.5 Testing balance and money invariants

- TBD — see §3 Phase 3 (property-based invariants with an oracle drawn
  from the PRD, not from the implementation).

### 6.6 Per-rollout-phase notes

- (Empty until the first rollout phase lands.)

## 7. What We Deliberately Don't Test

These exclusions were agreed in the Phase 2 interview (Q5). Future
contributors should respect them unless the underlying assumption changes.

- **Generated types (`src/db/database.types.ts`)** — the generator is the
  test, and CI already fails on drift. Re-evaluate if the types are ever
  edited by hand. (Source: Phase 2 interview Q5.)
- **UI appearance (snapshots, visual diffs, browser e2e)** — the UI changes
  often and such tests catch little. Critical flows are covered by the
  fetch-based smoke test. Re-evaluate if a UI regression reaches users.
  (Source: Phase 2 interview Q5.)
- **Database beyond the minimum** — for each persistence function, one
  isolation test plus one round-trip, with no exhaustive SQL testing. SQL
  holds no business rules (CLAUDE.md). Re-evaluate if rules ever move into
  SQL. (Source: Phase 2 interview Q5.)
- **Sign-in flow beyond the existing smoke steps** — the interview called it
  stable and unlikely to change. Re-evaluate if auth code changes
  significantly. (Source: Phase 2 interview Q3.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-04
- Stack versions last verified: 2026-10-04
- AI-native tool references last verified: 2026-10-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (expected when S-06
  introduces bank account numbers),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
