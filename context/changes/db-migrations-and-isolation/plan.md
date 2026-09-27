# Database Migrations Pipeline and Two-User Isolation Harness (F-01) Implementation Plan

## Overview

Make Supabase CLI migrations the only way the database schema changes: authored in `supabase/migrations/`, applied automatically to the local database (`supabase start` / `db reset`), to the CI database, and to the hosted production database by `supabase db push` in the `deploy` job, right before `wrangler deploy`. Alongside it, add a Vitest test runner with a reusable **two-user harness** and an **"RLS on every public table" guard**, so every group-scoped slice (S-02, S-03, S-04, S-06) can prove per-group privacy (NFR-3, PRD Guardrails) by adding a test instead of building test infrastructure.

This change deliberately ships **no domain tables**. Tables such as groups and memberships emerge from S-02's domain model; F-01 only provides the pipeline, the harness and the guard. The first real "user B cannot see group A" test is written by S-02 on its own tables.

## Current State Analysis

- `supabase/` holds only `config.toml` (+ gitignored `.branches`/`.temp`). There is no `supabase/migrations/` directory and no schema of any kind. `[db.migrations] enabled = true` (`supabase/config.toml:53-58`) and `[db.seed] sql_paths = ["./seed.sql"]` (`supabase/config.toml:60-65`) point to a seed file that does not exist.
- The local project is linked to the hosted project `rpbroqavksbvezskqhlz` (`supabase/.temp/project-ref`, `context/deployment/deploy-plan.md:326`). Nothing has ever been pushed to the hosted database.
- CI (`.github/workflows/ci.yml`) has three jobs: `ci` (lint, `astro check`, build), `smoke` (starts local Supabase via `supabase/setup-cli@v1` `latest`, builds, runs `scripts/smoke.mjs`) and `deploy` (build + `cloudflare/wrangler-action@v3`, only on push to `main`, `needs: [ci, smoke]`). No job touches the hosted database.
- GitHub secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `SUPABASE_KEY`, `SUPABASE_URL`. There is nothing that allows `supabase link`/`db push` from CI.
- No test runner. The only test is the zero-dependency `scripts/smoke.mjs`, run against a live server.
- `src/lib/supabase.ts:12` creates an untyped `createServerClient(SUPABASE_URL, SUPABASE_KEY, …)`.
- Local auth has `enable_confirmations = false`, and the local CLI is `supabase` 2.117.0 from `devDependencies`. `supabase status -o env` prints `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL` (plus newer `PUBLISHABLE_KEY`/`SECRET_KEY`), interleaved with CLI warnings.

## Desired End State

- A developer adds a schema change with `npm run db:new <name>`, edits the SQL, runs `npm run db:reset` locally and `npm run db:types` to refresh `src/db/database.types.ts`. The server Supabase client is typed with that `Database` type.
- On merge to `main`, pending migrations are pushed to the hosted database **before** the new Worker is deployed. A failed push stops the deploy, so new code never runs against an old schema.
- `npm test` runs unit tests (`src/**/__tests__/**/*.test.ts`) without a database. `npm run test:db` runs database tests (`src/**/__tests__/**/*.db.test.ts`) against local Supabase, picking up its URL and keys automatically.
- The two-user harness gives a test two signed-in users (A and B), an anonymous client and an admin client, and removes the users afterwards.
- The RLS guard fails CI whenever any table in `public` has row-level security disabled. It is proven non-vacuous by a self-test on a throwaway table.
- CI runs unit tests in `ci` and database tests plus a generated-types drift check in a new `db-test` job, and `deploy` depends on all three jobs.

Verify with: `npm test`, `npm run test:db`, a green CI run on the PR, and after merge `npx supabase migration list --linked` showing the baseline migration applied remotely.

### Key Discoveries:

- `smoke` already starts Supabase with most services excluded (`.github/workflows/ci.yml:41`). `db-test` reuses the same idea but starts Supabase through `npx supabase` from `devDependencies`, so CI and local use the same CLI version and `gen types` output stays byte-identical for the drift check.
- `wrangler rollback` does not revert database state (`context/foundation/infrastructure.md` Operational Story). Migrations are therefore forward-only, and a bad migration is fixed with a new corrective migration.
- Supabase recommends that `security definer` helpers used in RLS policies live in a schema that is **not** exposed through the Data API. `api.schemas` in `config.toml` exposes only `public` and `graphql_public`, so a `private` schema is invisible to PostgREST.
- lint-staged runs `eslint --fix` (with the prettier plugin) on staged `*.ts` files (`package.json:253-260`). A generated types file would be reformatted on commit and then fail the drift check unless it is ignored by ESLint and Prettier.

## What We're NOT Doing

- No domain tables, no RLS policies on domain data, and no membership helper function. Groups, members, periods and expenses are modelled in S-02 onward.
- No "user B cannot see group A" test on real data. S-02 writes the first one using this harness.
- No third-party migration tool (Flyway-style libraries, Drizzle Kit, node-pg-migrate). Supabase CLI covers versioned SQL files, a history table and `db push`.
- No migrations at application startup. Workers have no boot phase, and DDL credentials would have to live in the Worker.
- No down/rollback migrations. The policy is forward-only.
- No `db push --dry-run` on pull requests, because it would need production database secrets in PR jobs on a public repo.
- No seed data (`supabase/seed.sql`) and no change to the existing `smoke` job or `scripts/smoke.mjs`.
- No change to the `SUPABASE_KEY` (anon) used by the Worker. The Worker never gets DDL or service-role credentials.

## Implementation Approach

Build bottom-up and keep production untouched until the last phase. Phase 1 establishes the migration and type-generation loop locally with a purely technical baseline migration. Phase 2 adds the test runner, harness and guard, and runs them against local Supabase. Phase 3 wires both into CI/CD: tests gate the deploy, and `db push` runs before `wrangler deploy`. It also documents the workflow. The production database is first touched after the Phase 3 PR merges.

## Critical Implementation Details

- **Deploy ordering:** in the `deploy` job, `supabase link` + `supabase db push` must run and succeed **before** `wrangler deploy`. If the push fails, the job must stop, leaving the previous Worker live on the unchanged schema. Add a `concurrency` group to `deploy` so two quick merges cannot push migrations in parallel.
- **Generated file vs. formatters:** `src/db/database.types.ts` must be excluded from ESLint (flat config ignores) and Prettier (`.prettierignore`). Otherwise the pre-commit hook rewrites it and the CI drift check (`db:types` + `git diff --exit-code`) fails on every run.
- **Values from globalSetup:** Vitest `globalSetup` runs in the main process, so mutating `process.env` there does not reliably reach test workers. Pass the Supabase URL and keys with Vitest's `provide`/`inject`. When parsing `supabase status -o env`, keep only `KEY="value"` lines, because the CLI prints warnings to the same output.
- **Guard must not pass vacuously:** `public` has no tables after this change, so "no table without RLS" is trivially true. The guard's self-test creates a table without RLS inside a transaction, asserts that the guard query reports it, and rolls back.

## Phase 1: Migration Pipeline and Generated Types

### Overview

Establish the repo → local database migration loop with a technical baseline migration, and generate TypeScript types from the schema into a typed Supabase client.

### Changes Required:

#### 1. Baseline migration

**File**: `supabase/migrations/<timestamp>_private_schema.sql` (created with `npx supabase migration new private_schema`)

**Intent**: Prove the pipeline end to end with a real, domain-free migration, and give later slices a non-exposed home for `security definer` helpers used by RLS policies.

**Contract**: Creates schema `private` (idempotent). Revokes all privileges on it from `public` and `anon`, and grants `usage` to `authenticated` only, so later policy helpers can be executed by signed-in users. `private` is not added to `api.schemas`. A short SQL comment states the schema's purpose.

#### 2. Database scripts

**File**: `package.json`

**Intent**: Give one obvious command for each migration-loop step instead of remembering CLI flags.

**Contract**: New scripts: `db:new` → `supabase migration new`, `db:reset` → `supabase db reset`, `db:types` → `supabase gen types typescript --local --schema public > src/db/database.types.ts`.

#### 3. Database module and generated types

**Files**: `src/db/database.types.ts` (generated), `src/db/types.ts`, `src/db/index.ts`

**Intent**: A single import point (`@/db`) for the `Database` type, following the module convention (`index.ts`, `types.ts`, `__tests__/`).

**Contract**: `database.types.ts` is generated by `npm run db:types` and never hand-edited. `types.ts` re-exports `Database` (and later aliases), and `index.ts` re-exports from `types.ts`.

#### 4. Formatter exclusions

**Files**: `eslint.config.js` (or the existing flat config file), `.prettierignore` (create if absent)

**Intent**: Keep the generated file byte-identical to CLI output so the CI drift check is meaningful.

**Contract**: `src/db/database.types.ts` is ignored by both ESLint and Prettier.

#### 5. Typed server client

**File**: `src/lib/supabase.ts`

**Intent**: Queries written by later slices are type-checked against the real schema.

**Contract**: `createServerClient<Database>(…)`, with `Database` imported from `@/db`. Otherwise the behaviour is unchanged.

### Success Criteria:

#### Automated Verification:

- Local database rebuilds from migrations without errors: `npm run db:reset`
- Types regenerate with no diff: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Production build passes: `npm run build`

#### Manual Verification:

- `private` schema exists locally and is absent from the REST API: visible in Studio's schema list, not listed in `api.schemas`
- Existing auth flow still works locally: `npm run dev` + `npm run smoke` passes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Vitest Runner and Two-User Isolation Harness

### Overview

Add Vitest with separate `unit` and `db` projects, a globalSetup that discovers local Supabase, the two-user harness, and the RLS guard with its self-test.

### Changes Required:

#### 1. Dependencies and scripts

**File**: `package.json`

**Intent**: A test runner for the whole project, plus a direct Postgres client for catalog-level checks that PostgREST cannot express.

**Contract**: devDependencies `vitest` (a version that supports `test.projects` and the project's Vite major), `pg`, `@types/pg`. Scripts `test` → `vitest run --project unit` and `test:db` → `vitest run --project db`.

#### 2. Vitest configuration

**File**: `vitest.config.ts`

**Intent**: Unit tests stay fast and database-free, and database tests run serially against local Supabase.

**Contract**: A plain Vitest config (not Astro's `getViteConfig`, to avoid loading the Cloudflare adapter), with an alias `@` → `./src`. Project `unit`: include `src/**/__tests__/**/*.test.ts`, exclude `**/*.db.test.ts`, `passWithNoTests: true`. Project `db`: include `src/**/__tests__/**/*.db.test.ts`, globalSetup `src/db/__tests__/global.setup.ts`, no file parallelism, and a generous test timeout (~30 s).

#### 3. Global setup

**File**: `src/db/__tests__/global.setup.ts`

**Intent**: Zero manual configuration locally and in CI. The tests find the running local Supabase themselves.

**Contract**: Runs `npx supabase status -o env`, parses `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` and `DB_URL`, and `provide`s them as `supabaseUrl`, `anonKey`, `serviceRoleKey` and `dbUrl` (with an `inject` type declaration). If the CLI fails or a value is missing, it throws `Local Supabase is not running — start it with: npx supabase start`.

#### 4. Two-user harness

**Files**: `src/db/__tests__/two-users.harness.ts`, `src/db/__tests__/pg.harness.ts`

**Intent**: The reusable building block every group-scoped slice uses to prove isolation.

**Contract**:
- `createTwoUsers()` returns `{ userA, userB, anon, admin, cleanup }`, where each user is `{ id, email, client }`. Users are created through the admin API with confirmed email and unique addresses (e.g. `isolation-a-<uuid>@example.com`). Each `client` is a `Database`-typed supabase-js client signed in with that user's password, with session persistence and auto-refresh disabled. `anon` is an unauthenticated client and `admin` a service-role client (which bypasses RLS and is meant for fixtures only). `cleanup()` deletes both users.
- `withDb(fn)` opens a `pg` client on `dbUrl`, runs `fn`, and always closes the client.

#### 5. Harness self-test

**File**: `src/db/__tests__/two-users.db.test.ts`

**Intent**: Prove the harness produces two genuinely separate sessions before any slice relies on it.

**Contract**: Asserts that A and B have different ids, that each client's `auth.getUser()` returns its own id, that `anon` has no user, and that after `cleanup()` neither user exists (checked through the admin API).

#### 6. RLS guard

**File**: `src/db/__tests__/rls-guard.db.test.ts`

**Intent**: Forgetting `enable row level security` on any future table fails CI immediately, which is the cheapest structural protection for NFR-3.

**Contract**: The guard query lists tables in schema `public` with `relkind` in (`r`, `p`) and `relrowsecurity = false`. The test expects an empty list and names the offending tables when it fails. The self-test runs in a `pg` transaction: it creates a table without RLS, asserts the guard reports it, then rolls back. A further assertion checks that role `anon` has no `USAGE` on schema `private`.

### Success Criteria:

#### Automated Verification:

- Unit project runs (no tests yet) and exits 0: `npm test`
- Database tests pass against local Supabase: `npm run test:db`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- With local Supabase stopped, `npm run test:db` fails fast with the "Local Supabase is not running" message
- Temporarily adding a migration with a table without RLS makes `npm run test:db` fail and name that table (then revert the migration and `npm run db:reset`)
- No leftover `isolation-*@example.com` users in local Studio after a test run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI/CD Wiring and Documentation

### Overview

Run the tests in CI, gate deploys on them, push migrations to the hosted database before each Worker deploy, and document the workflow.

### Changes Required:

#### 1. Unit tests in `ci`

**File**: `.github/workflows/ci.yml`

**Intent**: Unit tests run on every PR and push without a database.

**Contract**: A `npm test` step in job `ci` after lint.

#### 2. New `db-test` job

**File**: `.github/workflows/ci.yml`

**Intent**: Migrations, the isolation harness, the RLS guard and generated types are verified on every PR.

**Contract**: Job `db-test`: checkout, Node 22 with npm cache, `npm ci`, `npx supabase start` (excluding unneeded services like the `smoke` job does, but keeping whatever `gen types --local` needs), `npm run test:db`, then `npm run db:types` followed by `git diff --exit-code src/db/database.types.ts`, and finally `npx supabase stop --no-backup` under `if: always()`. It uses the CLI from `devDependencies`, not `supabase/setup-cli`.

#### 3. Migrations in `deploy`

**File**: `.github/workflows/ci.yml`

**Intent**: Schema changes ship together with the code, on the same merge, with the database first.

**Contract**: `deploy.needs: [ci, smoke, db-test]` and `concurrency: { group: deploy-production, cancel-in-progress: false }`. After `npm ci` and before the build and `wrangler deploy`, it runs `npx supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}` and `npx supabase db push --yes`, with env `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` from secrets.

#### 4. New GitHub secrets (owner, manual)

**Intent**: Give CI the minimum credentials to push migrations, without exposing them to the Worker or to PR jobs.

**Contract**: `SUPABASE_ACCESS_TOKEN` (Supabase personal access token), `SUPABASE_DB_PASSWORD` (hosted database password), `SUPABASE_PROJECT_ID` = `rpbroqavksbvezskqhlz`. They are used only by the `deploy` job, which runs only on push to `main`. They must be set **before** the PR merges, or the first deploy after merge fails.

#### 5. Documentation

**Files**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: The next slice finds the migration workflow and the isolation-test recipe without reading this plan.

**Contract**: The `CLAUDE.md` Commands section gains `test`, `test:db`, `db:new`, `db:reset` and `db:types`. The Structure section gains `supabase/migrations/`, `src/db/` and `vitest.config.ts`, and drops "no migrations exist yet" and "No unit test runner is configured yet". A short "Adding a group-scoped table" note says to enable RLS in the same migration, regenerate types, and add a `*.db.test.ts` using `createTwoUsers()` that proves user B cannot read user A's rows. `deploy-plan.md` gains a section on migrations in the deploy job, the three new secrets, the forward-only rollback policy (`wrangler rollback` does not revert the database; fix forward with a new migration), and the `private` schema convention.

### Success Criteria:

#### Automated Verification:

- Workflow file is valid and lint passes: `npm run lint`
- PR CI run is green for `ci`, `smoke` and `db-test`: `gh pr checks`
- After merge, the `deploy` job succeeds including the `db push` step: `gh run list --workflow CI --branch main --limit 1`
- Hosted database lists the baseline migration as applied: `npx supabase migration list --linked`

#### Manual Verification:

- Before merge: the three new secrets are set (`gh secret list`), and `npx supabase migration list --linked` shows no remote migrations yet
- After merge: the production app still signs in and reaches `/dashboard` at https://10x-astro-starter.adamgwozdz.workers.dev
- `CLAUDE.md` and `deploy-plan.md` read correctly as the guide for S-02's first group-scoped table

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None in this change. The `unit` project exists and passes with no tests, ready for slice logic (e.g. S-04 balance calculation).

### Integration Tests:

- Harness self-test: two distinct signed-in users, an anonymous client without a user, and cleanup that really removes both users.
- RLS guard: no `public` table without RLS, with a self-test proving the guard detects an unprotected table, and `anon` has no access to schema `private`.
- Generated types drift check in CI.

### Manual Testing Steps:

1. Stop local Supabase and run `npm run test:db`. It should fail fast with the start-Supabase message.
2. Add a temporary migration with a table without RLS, run `npm run db:reset && npm run test:db`, and confirm the guard names the table. Revert.
3. After merge, confirm `npx supabase migration list --linked` and a production sign-in.

## Performance Considerations

`db-test` adds one Supabase start (~1–2 min) per CI run, running in parallel with `smoke`. The Worker's runtime is unaffected, and no new code runs per request.

## Migration Notes

- The first `db push` applies only the `private` schema baseline to a hosted database that has no application schema, which is safe and non-destructive.
- Policy: migrations are forward-only. Never edit a migration that has been pushed. Correct it with a new migration. A Worker rollback (`wrangler rollback`) leaves the database as is, so migrations must stay compatible with the previously deployed Worker (expand before contract).

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01 (GitHub issue #5)
- PRD: `context/foundation/prd.md` — NFR-3, Success Criteria § Guardrails
- Infrastructure risks: `context/foundation/infrastructure.md` — Operational Story, Risk Register (rollback vs. migrations)
- Deploy state and secrets: `context/deployment/deploy-plan.md`
- CI pipeline: `.github/workflows/ci.yml:27-76`
- Existing test pattern: `scripts/smoke.mjs`
- Supabase client: `src/lib/supabase.ts:12`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration Pipeline and Generated Types

#### Automated

- [x] 1.1 Local database rebuilds from migrations without errors: `npm run db:reset` — b61913a
- [x] 1.2 Types regenerate with no diff: `npm run db:types && git diff --exit-code src/db/database.types.ts` — b61913a
- [x] 1.3 Lint passes: `npm run lint` — b61913a
- [x] 1.4 Type check passes: `npx astro check` — b61913a
- [x] 1.5 Production build passes: `npm run build` — b61913a

#### Manual

- [x] 1.6 `private` schema exists locally and is absent from the REST API: visible in Studio's schema list, not listed in `api.schemas` — b61913a
- [x] 1.7 Existing auth flow still works locally: `npm run dev` + `npm run smoke` passes — b61913a

### Phase 2: Vitest Runner and Two-User Isolation Harness

#### Automated

- [x] 2.1 Unit project runs (no tests yet) and exits 0: `npm test` — c7a0443
- [x] 2.2 Database tests pass against local Supabase: `npm run test:db` — c7a0443
- [x] 2.3 Lint passes: `npm run lint` — c7a0443
- [x] 2.4 Type check passes: `npx astro check` — c7a0443

#### Manual

- [x] 2.5 With local Supabase stopped, `npm run test:db` fails fast with the "Local Supabase is not running" message — c7a0443
- [x] 2.6 Temporarily adding a migration with a table without RLS makes `npm run test:db` fail and name that table (then revert the migration and `npm run db:reset`) — c7a0443
- [x] 2.7 No leftover `isolation-*@example.com` users in local Studio after a test run — c7a0443

### Phase 3: CI/CD Wiring and Documentation

#### Automated

- [x] 3.1 Workflow file is valid and lint passes: `npm run lint`
- [ ] 3.2 PR CI run is green for `ci`, `smoke` and `db-test`: `gh pr checks`
- [ ] 3.3 After merge, the `deploy` job succeeds including the `db push` step: `gh run list --workflow CI --branch main --limit 1`
- [ ] 3.4 Hosted database lists the baseline migration as applied: `npx supabase migration list --linked`

#### Manual

- [ ] 3.5 Before merge: the three new secrets are set (`gh secret list`), and `npx supabase migration list --linked` shows no remote migrations yet
- [ ] 3.6 After merge: the production app still signs in and reaches `/dashboard` at https://10x-astro-starter.adamgwozdz.workers.dev
- [ ] 3.7 `CLAUDE.md` and `deploy-plan.md` read correctly as the guide for S-02's first group-scoped table
