# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-05

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Project rule that shapes every phase: business rules live in TypeScript
aggregates, never in SQL functions; tests therefore target the domain, and
the database gets no tests of its own (interview Q2, Q3, Q5).

Hot-spot scope used for likelihood weighting: `src`, `supabase/migrations`,
`scripts` (excluding docs, archive, fixtures and the generated
`src/db/database.types.ts`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                            | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Someone transfers the wrong amount because a balance or pair debt does not match the expenses to the grosz                         | High   | High       | PRD Guardrails ("suma wydatków = suma przypisanych udziałów"), US-01; roadmap S-04 rounding; interview Q1; hot-spot dir `src/lib` (30 commits/30d) |
| 2   | A person outside the group (or signed out) sees or adds another group's expenses and balances                                      | High   | Medium     | PRD NFR-3; interview Q1; abuse lens (ownership, not just authentication); hot-spot dir `src/pages/api` (10 commits/30d)                            |
| 3   | A duplicated expense (double click or double submit) corrupts the monthly settlement and cannot be removed until S-05              | High   | Medium     | interview Q1, Q4; archive `2026-10-02-create-settlement-group/reviews/plan-review.md` (double submit); roadmap S-05                                |
| 4   | The expense form accepts bad input (amount format, date outside the period, title) or answers with a wrong HTTP status or redirect | Medium | High       | interview Q4; PRD FR-004; hot-spot dirs `src/pages/api` (10 commits/30d), `scripts` (7 commits/30d)                                                |
| 5   | A new migration breaks the previously deployed Worker, because the schema is pushed before the Worker deploys                      | High   | Medium     | interview Q3; CLAUDE.md "Database changes" (expand before contract); `context/deployment/deploy-plan.md`                                           |
| 6   | Business rules leak into SQL functions, where unit tests cannot see them                                                           | Medium | Medium     | interview Q2, Q3; CLAUDE.md "Domain logic"; hot-spot dirs `src/lib/groups`, `src/lib/invites` (15 commits/30d each)                                |

Order rows by impact × likelihood. Out of the map on purpose:
direct RPC calls that bypass the app (interview Q2) are closed by the
app-key gate and probed by the smoke test, which makes it an
observability concern rather than a test phase; expense author-only edits
and period-close locks (PRD Guardrails, FR-005, FR-015) do not exist until
S-05 and S-09 ship and enter the map through `--refresh`.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                 | Must challenge                               | Context `/10x-research` must ground                                                                                          | Likely cheapest layer                               | Anti-pattern to avoid                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| #1   | Shares always sum to the expense, balances sum to zero, and each pair debt agrees with the balances, for any amount and member count        | "400 / 2 works, so the arithmetic works"     | Where the leftover-grosze decision is made; how pair debts are derived; which values come from the PRD, not the code         | unit with an invariant grid                         | Expected value computed with the production formula (oracle problem); round amounts only        |
| #2   | A non-member and an anonymous request get a refusal that does not reveal whether the group exists, for every group-scoped endpoint and page | "Signed in means allowed"                    | Where membership is established in each endpoint and persistence call; what the refusal looks like for another group's id    | smoke with two users and HTTP status checks         | Happy-path-only test; treating a hidden button as proof                                         |
| #3   | Submitting the expense form several times in quick succession stores exactly one expense                                                    | "A disabled button is enough"                | What protects against a duplicate on the client and on the server today; whether returning to the page re-enables the button | to be decided by research (browser or manual smoke) | End-to-end test where a cheaper check would do; a test that never produces a real double submit |
| #4   | Every invalid value yields the right error code and redirect and stores nothing; boundary dates behave on month edges in Europe/Warsaw      | "The HTML input already enforces the format" | Validation order; the date window rule at month boundaries; how codes map to messages and status codes                       | unit (validation) plus smoke (HTTP codes)           | Snapshot of HTML without meaning; re-implementing the validation rule inside the test           |
| #5   | The previous Worker version keeps working against the new schema                                                                            | "Migration applied locally, so it is safe"   | Which functions and columns the deployed Worker calls; how compatibility can be checked without database tests               | to be decided by research (checklist or CI step)    | A SQL test that carries logic; relying on a green smoke run as the only proof                   |
| #6   | SQL functions only persist and load; no rule lives outside an aggregate                                                                     | "A backstop check in SQL is harmless"        | Which checks sit in functions today; where the line between a backstop and a rule falls                                      | review, lint or hook (hypothesis)                   | Testing SQL itself (excluded in §7); judging code style instead of behavior                     |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                    | Risks covered  | Test types                       | Status        | Change folder                                        |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------- | -------------------------------- | ------------- | ---------------------------------------------------- |
| 1   | Money and balance correctness        | Prove amount and balance invariants with an oracle taken from the PRD, not from the code           | #1, part of #4 | unit with invariant grid         | change opened | `context/changes/testing-money-balance-correctness/` |
| 2   | HTTP contract of endpoints and pages | Prove refusals and redirects for non-members, anonymous users and bad input on group-scoped routes | #2, #4         | smoke (two users, HTTP statuses) | not started   | —                                                    |
| 3   | Double submit and form behavior      | Prove one expense is stored per intended submission                                                | #3             | layer chosen by research         | not started   | —                                                    |
| 4   | Quality gates                        | Check migration compatibility with the previous Worker and keep rules out of SQL                   | #5, #6         | CI check or hook                 | not started   | —                                                    |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

Phase 1 overlaps with S-04 phase 1, which shipped the first unit tests for
the expenses module; this phase starts by auditing how independent those
expected values are.

## 4. Stack

The classic test base for this project. Test-base profile: **sparse** —
Vitest is configured with one project (`unit`) and 14 test files, all under
`src/lib` (groups, invites, expenses); endpoints, pages and components have
no tests. The only integration check is `scripts/smoke.mjs`, run in CI.

| Layer         | Tool                                  | Version | Notes                                                                             |
| ------------- | ------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| unit          | Vitest                                | ^5.0.2  | `unit` project over `src/**/__tests__/**/*.test.ts`, no database; in-memory fakes |
| integration   | `scripts/smoke.mjs` (Node, no deps)   | n/a     | HTTP flows against a running dev server and local Supabase; two users in sequence |
| database      | none by decision                      | n/a     | Database tests were removed in the block-direct-data-api change (interview Q2)    |
| e2e / browser | none yet — see Phase 3                | n/a     | Added only if research finds no cheaper layer for double submit                   |
| type drift    | `db:types` check inside the smoke job | n/a     | CI fails when `src/db/database.types.ts` is out of date                           |

**Stack grounding tools (current session):**

- Docs: Context7 — available, not queried while writing this plan; checked: 2026-10-05
- Search: Exa — available, not queried while writing this plan; checked: 2026-10-05
- Runtime/browser: built-in browser pane — available, possible later use for Phase 3, not used here; checked: 2026-10-05
- Provider/platform: `gh` CLI for GitHub; Cloudflare and Linear MCP need authorization and were not available; checked: 2026-10-05

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                   | Where        | Required?                 | Catches                                              |
| -------------------------------------- | ------------ | ------------------------- | ---------------------------------------------------- |
| lint + typecheck                       | local + CI   | required                  | syntactic and type drift                             |
| unit tests                             | local + CI   | required                  | domain rule regressions                              |
| smoke (HTTP flows, app-key gate probe) | CI           | required                  | broken critical flows, gate regressions, types drift |
| invariant grid for money and balances  | local + CI   | required after §3 Phase 1 | grosze and balance errors on unusual inputs          |
| HTTP contract checks in smoke          | CI           | required after §3 Phase 2 | access leaks, wrong status codes and redirects       |
| migration compatibility check          | CI or review | required after §3 Phase 4 | a migration that breaks the previous Worker          |
| rules-in-TypeScript guard              | hook or CI   | required after §3 Phase 4 | business rules drifting into SQL functions           |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: `src/lib/<module>/__tests__/`, next to the module under test.
- **Naming**: `<unit>.<role>.test.ts` mirroring the source file (for example `group.service.test.ts`).
- **Fakes**: an in-memory repository from the module's `<module>.harness.ts`; build groups through the `@/lib/groups` public API.
- **Reference test**: `src/lib/groups/__tests__/group.service.test.ts`.
- **Run locally**: `npm test`.

### 6.2 Adding an integration test

- **Where**: a new step in the declarative list in `scripts/smoke.mjs`; no database tests exist by decision.
- **Run locally**: `npm run smoke` against a running dev server and local Supabase.
- **Reference**: the invite and join steps in `scripts/smoke.mjs`.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 3 (double submit and form behavior).

### 6.4 Adding a test for a new endpoint or page

- TBD — see §3 Phase 2 (refusal and redirect pattern for non-members, anonymous users and bad input).

### 6.5 Adding a test for a money or balance rule

- TBD — see §3 Phase 1 (invariant grid with an oracle from the PRD).

### 6.6 Per-rollout-phase notes

(Empty until the first rollout phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI appearance (snapshots, visual diffs)** — they change often and catch little; flows are covered by the smoke test. Re-evaluate if a visual regression reaches users. (Source: Phase 2 interview Q5.)
- **Generated database types** — the generator is the test, and CI already fails on drift. Re-evaluate if the types are ever edited by hand. (Source: Phase 2 interview Q5.)
- **SQL functions and tables** — business logic lives in TypeScript, so the database gets no tests of its own. Re-evaluate if a rule ever moves into SQL. (Source: Phase 2 interview Q5; Q2.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-05
- Stack versions last verified: 2026-10-05
- AI-native tool references last verified: 2026-10-05 (none recommended)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (S-05 and S-09 will add edit-lock and period-close rules),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
