# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: SplitDom

An Astro web app for splitting shared household expenses among roommates/partners: track expenses, compute per-member balances, generate payment info between debtors and creditors, and let the group's host manually close monthly settlement periods. See `context/foundation/prd.md` (Polish) for functional requirements and user stories, and `context/foundation/tech-stack.md` for the stack rationale — the 10x Astro Starter (Astro + Supabase + Cloudflare) was chosen once period closing (FR-015) became a manual host action, removing the earlier need for scheduled jobs that had pushed the stack to Next.js/Vercel.

**Status**: bootstrapped from the 10x Astro Starter and deployed to Cloudflare Workers (https://10x-astro-starter.adamgwozdz.workers.dev), auto-deployed on every merge to `main`. Auth exists: Google sign-in (OAuth through Supabase) and email + password sign-up/sign-in, sharing one PKCE callback, plus route protection. Settlement groups exist: a signed-in user creates any number of groups (becoming their host; creating a group is two writes, the group and then its first open billing period for the current month, and the group page opens a missing period on first visit), `/dashboard` lists the user's groups, and each group has its page at `/groups/[id]`. Invites exist: any member generates an invite link on the group page (shown once, single use, valid 7 days); the invitee opens `/invite/[token]`, signs in or up if needed (the pending invite survives sign-in, sign-up and Google through a cookie) and joins with an explicit button. The Data API refuses every request without the Worker's secret `x-app-key` (403), so a user holding their session token cannot call the database functions directly. Expenses exist: a member adds an expense to the group's open billing period (the `BillingPeriod` aggregate; split equally among all members) and sees every member's balance and the netted debt per pair of members for that period. Concurrent writes to a period are guarded by its `version`. Transfer details, marking transfers sent or paid, editing or deleting expenses and period closing are still to be built — see `context/foundation/roadmap.md` for the milestone, slice order and the next change to plan.

### Commands

Run `nvm use` first — Node is pinned to 22.14.0 in `.nvmrc` (wrangler needs Node ≥ 22; the system default is older).

- `npm run dev` — start the dev server (http://localhost:4321)
- `npm run build` — production build (Cloudflare adapter)
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint (flat config: astro, react, jsx-a11y, typescript-eslint, prettier)
- `npm run format` — Prettier
- `npx astro check` — type check (runs in CI)
- `npm run smoke` — end-to-end smoke test of the auth, create-group, invite and add-expense flows (a second user joins through the link and adds an expense), plus direct Data API calls that check the app-key gate, against a running server (`BASE_URL`, default http://localhost:4321) and local Supabase; reads `.env`
- `npx supabase start` / `npx supabase stop` — local Supabase (needed by `dev` and `smoke`)
- `npm test` — Vitest unit tests (`src/**/__tests__/**/*.test.ts`), no database
- `npm run db:new <name>` — create a new migration in `supabase/migrations/`
- `npm run db:reset` — rebuild the local database from all migrations
- `npm run db:types` — regenerate `src/db/database.types.ts` from the local schema (CI fails if it is out of date)

A husky pre-commit hook runs lint-staged (eslint --fix / prettier).

### Structure

- `src/pages/` — Astro routes; `src/pages/api/` — API endpoints (`api/auth/*`: sign-up, sign-in, sign-out and `google`, which starts Google OAuth; `api/groups/` — form POST that creates a group; `api/groups/[id]/invites.ts` — form POST that generates an invite; `api/groups/[id]/expenses.ts` — form POST that adds an expense; `api/invites/redeem.ts` — form POST that joins a group with an invite token); `src/pages/auth/callback.ts` — PKCE code exchange for email confirmation and the Google OAuth return; `src/pages/groups/` — the group page (`[id].astro`); `src/pages/invite/[token].astro` — the invite page (public: it remembers the invite for anonymous visitors, previews it for signed-in users)
- `src/components/` — Astro and React components (`ui/` is shadcn/ui, `auth/` holds the auth forms, `groups/` the group list, create form and group card, `invites/` the invite panel on the group page)
- `src/lib/groups/` — the groups domain module: value objects (`GroupName`, `InviteToken`, `InviteTokenHash`), the `Group` aggregate (membership, the permanent host and the group's active invites; `Group.invite` creates an invite, member-only, valid 7 days, and `Group.join` uses it up once and adds the member), the `Invite` entity inside it, `GroupService` (its only entry point: create, list, get, invite, join, previewInvite), the Supabase repository, the error messages and the one-time cookie helpers (`sd_new_invite`, `sd_pending_invite`); it has no billing period and never imports `@/lib/supabase` (callers pass the client in)
- `src/lib/billing-periods/` — the billing-periods domain module: value objects `BillingMonth`, `Money` (integer grosze), `ExpenseTitle`, `PurchaseDate`, `PeriodBalances` (member balances and netted pair debts) and `SplitPolicy`/`EqualSplitPolicy` (equal shares, the payer's share absorbs the remainder), the `Expense` entity, the `BillingPeriod` aggregate root (adds expenses, refuses a closed period, derives balances), `BillingPeriodService` (its only entry point), the Supabase repository and the error messages; it never imports `@/lib/supabase` either
- `src/components/expenses/` — the add-expense form, the balances panel and the expense list on the group page
- `src/lib/supabase.ts` — server-side Supabase client, typed with `Database`; `src/middleware.ts` — sets `locals.user` and guards protected routes
- `src/db/` — `Database` type (`@/db`); `database.types.ts` is generated by `db:types`, never hand-edited, and ignored by ESLint/Prettier
- `supabase/config.toml` — local Supabase config; `supabase/migrations/` — versioned SQL migrations, the only way the schema changes (pushed to production by the `deploy` job before `wrangler deploy`); `supabase/seed.sql` — local/CI seed (the local app key), never pushed
- `vitest.config.ts` — the Vitest project `unit`
- `wrangler.jsonc` — Cloudflare Workers config; `.github/workflows/ci.yml` — `ci` + `smoke` + `deploy` jobs (`smoke` also fails if `src/db/database.types.ts` is out of date)
- `@/*` path alias resolves to `src/*`
- `context/foundation/` — `prd.md` (source of truth for FR-xxx / US-xx), `tech-stack.md`, `infrastructure.md`, `roadmap.md`
- `context/deployment/deploy-plan.md` — what is deployed, which secrets are wired, and known auth limitations
- `context/changes/` — per-change folders

### Database changes

- Migrations are forward-only: never edit a migration that has been pushed; fix it with a new one. `wrangler rollback` does not revert the database, so each migration must stay compatible with the previously deployed Worker (expand before contract).
- `security definer` helpers used by RLS policies go in schema `private`, which is not exposed through the API. (Persistence functions for group-scoped tables are different: they live in `public`, see below.)
- **Adding a group-scoped table**: in the same migration, enable row-level security with no policies and revoke all grants from `anon` and `authenticated`. Access goes through narrow `security definer` persistence functions (`set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`) that only persist and load, and filter on the caller's membership via `auth.uid()`. These persistence functions live directly in `public` (superseding the thin-`public`-wrapper-over-`private` split proposed in `context/changes/invite-member-by-link/research.md`); Supabase Advisor lints 0029 (`authenticated_security_definer_function_executable`) and 0008 (`rls_enabled_no_policy`) are expected for them and their tables by design. Then run `npm run db:reset && npm run db:types`.
- **App-key gate**: every Data API request passes the PostgREST pre-request function `api_gate.check_app_request()`, which judges the `x-app-key` header against sha256 hashes in `private.app_keys` (the Worker sends `SUPABASE_APP_KEY`). It lives in schema `api_gate` (not exposed, usable by `anon`, `authenticated` and `service_role`, because the hook runs as the request role); no role is exempt. Enforced: a request without a valid key gets 403 with code `APPGATE` (emergency off-switch in `context/deployment/deploy-plan.md`, "App key gate"). New persistence functions need nothing extra — the gate runs before every request. It covers PostgREST only (REST, RPC, `/graphql/v1`); Storage, Realtime and Auth reach Postgres on their own connections, so a future bucket or channel needs its own RLS-based controls. Never drop or rename the registered function — every REST request would fail; change it only with `create or replace`.
- **Money** is stored as integer grosze (never floats or numerics); `Money` in `src/lib/billing-periods/` is the only place that parses and formats it. Persistence functions for expenses hold no business rules (the split, validation and balances live in the aggregate).
- **Billing period concurrency**: `billing_periods.version` is an optimistic lock. `save_billing_period` bumps it with a conditional update and returns `false` when the version moved; the repository reports `"conflict"` and `BillingPeriodService` reloads and retries the command once, then returns `period_changed`. Closing a period (S-09) must bump `version` too.
- **Group creation is two writes**: `add_group` (group and host membership), then `open_billing_period`. If the second fails, `BillingPeriodService.openFor` opens the first period on the next visit (self-repair); the partial unique index `billing_periods_one_open_per_group_idx` makes a concurrent second open a conflict, and the service reloads.
- **Expand/contract leftovers**: the old RPCs `create_group`, `add_expense`, `list_period_expenses` and the `open_period` field of `get_my_group`/`list_my_groups` are no longer called by the app but stay until a follow-up contract migration drops them (the previously deployed Worker may still use them). Likewise `redeem_group_invite` and the old invite RPCs (`create_group_invite`, `get_group_invite`) are no longer called by the app and await a contract migration.
- **No user FK cascades**: `group_members.user_id` references `auth.users` with `restrict`, like `groups.host_id`, so a user who belongs to a group cannot be deleted (see `context/deployment/deploy-plan.md`).

### Code Conventions

- **Error format** — errors are shaped `{ error: { code, message, context } }`, never `{ error: string }`. A form-POST endpoint that redirects on failure puts only the error **code** in `?error=<code>`, and the page renders the module's message for it (e.g. `groupErrorMessage(code)`), never the raw query value. (The older auth endpoints still pass a message in `?error=`.)
- **File naming** — feature files are named `feature.handler.ts` (dot-suffixed by role), not `featureHandler.ts`.
- **Imports** — use absolute imports via `@/...`; relative parent-traversal imports (`../../...`) are not allowed.
- **Module structure** — every module has its own `index.ts`, `types.ts`, and `__tests__/` directory.
- **Domain logic** — business rules and invariants live in TypeScript aggregates in `src/lib/<module>/`; only the repository reads and writes an aggregate, and only the aggregate's service (e.g. `GroupService`) uses the repository; database functions only persist and load, scoped to `auth.uid()`, and constraints are backstops only.
- **Dates** — stored in UTC; a domain module formats its own dates (e.g. `BillingMonth.label()`); no ad-hoc `new Date().toISOString()`.

### Notes

- Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`) live in GitHub Actions secrets and Cloudflare Worker secrets; `SUPABASE_APP_KEY` is a Worker secret only (its hash is inserted by hand into the hosted `private.app_keys`). Local values go in `.env` / `.dev.vars` (both gitignored); the local app key is `local-dev-app-key`.
- Known accepted limitation: confirming the sign-up email in a different browser/device than the one used to sign up fails (PKCE code verifier missing) — see `context/deployment/deploy-plan.md`.
- `package.json`'s `name` is still the starter placeholder `10x-astro-starter`, not `splitdom`.

### Public roadmap on GitHub

`context/foundation/roadmap.md` is mirrored as GitHub issues (one per F-NN / S-NN, labels `slice` / `foundation` / `north-star`, a GitHub milestone per roadmap milestone, native "blocked by" links) and on the public project board [SplitDom Roadmap](https://github.com/users/adamgwozdz00/projects/6) (fields Status, Roadmap ID, Stream). The board does not sync with the file, so keep them aligned on every change:

- Starting an item → board Status `In progress`, same status in `roadmap.md`.
- PR delivering an item → `Closes #N` in the PR body, linking it to the roadmap issue.
- After merge → board Status `Done` and `roadmap.md` updated; move downstream items whose prerequisites are all done from `Proposed` to `Ready` in both places.
- Roadmap decisions that block/unblock an item, or new slices/milestones → update or create the matching issues, dependencies and board items.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill                                                            | Use it when                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Internal research (lesson focus)**                             |                                                                                                                                                                                                                                                |
| `/10x-research <change-id>`                                      | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`.                                 |
| **External research (lesson focus)**                             |                                                                                                                                                                                                                                                |
| exa.ai                                                           | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer.                                                                                                                   |
| Context7 (`resolve-library-id` → `get-library-docs`)             | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages.                                                                                                        |
| **Framing spare wheel**                                          |                                                                                                                                                                                                                                                |
| `/10x-frame <change-id>`                                         | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution**                                       |                                                                                                                                                                                                                                                |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan.                                                                                                                                 |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:

1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the two M3L4 skills in this order:**

1. **`/10x-e2e-setup`** — one-time setup: Playwright config (`webServer`,
   auth `setup` project, `storageState`), a green seed test, and `context/foundation/test-stack.md`.
2. **`/10x-e2e`** — the per-risk loop: risk → explore the running app with
   `playwright-cli` → generate → review against the five anti-patterns →
   re-prompt by name → verify with a deliberate break.

The skills' `references/` carry the full rules, anti-patterns, seed pattern, and
prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toHaveScreenshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **A red test is a signal, not a chore.** A changed selector → update the
  locator in a reviewed diff. A changed business behavior → the test caught a
  bug; never edit the assertion to match it. Fixing failing tests is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
