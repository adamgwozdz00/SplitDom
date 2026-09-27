# Database Migrations Pipeline and Two-User Isolation Harness (F-01) — Plan Brief

> Full plan: `context/changes/db-migrations-and-isolation/plan.md`

## What & Why

SplitDom has no schema and no way to change one. F-01 makes Supabase CLI migrations the single path for schema changes (repo → local → CI → hosted production), and gives every group-scoped slice a ready-made way to prove per-group privacy (NFR-3, PRD Guardrails): a two-user test harness and a guard that fails CI when any public table lacks row-level security.

## Starting Point

`supabase/` contains only `config.toml`. There are no migrations, and the hosted project `rpbroqavksbvezskqhlz` has never been pushed to. CI builds and deploys the Worker but never touches the database. The only test is `scripts/smoke.mjs`, and the Supabase client in `src/lib/supabase.ts` is untyped.

## Desired End State

A developer writes a migration (`npm run db:new`), rebuilds locally (`db:reset`) and regenerates types (`db:types`). On merge to `main`, CI pushes pending migrations to production **before** deploying the Worker. `npm test` runs unit tests, and `npm run test:db` runs database tests against local Supabase. S-02 can add its first "user B cannot see group A" test by calling `createTwoUsers()`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Migration tool | Supabase CLI (no Flyway-style library) | It already provides versioned SQL files, a history table and `db push`, and it integrates with `supabase start`, type generation and local testing. |
| When migrations reach production | `supabase db push` in the `deploy` job, before `wrangler deploy` | Schema ships with the code on the same merge; Workers have no startup phase to migrate from. |
| Isolation test form | Vitest + supabase-js | It exercises the real client path and sets up the project's test runner at the same time. |
| Domain tables in F-01 | None (harness + guard only) | Domain-first: tables emerge from S-02's domain model, and S-02 writes the first real isolation test. |
| Vitest scope | Projects `unit` (`__tests__/*.test.ts`) and `db` (`*.db.test.ts`) | The `__tests__/` convention works from day one, and DB tests never slow unit tests. |
| CI placement | New `db-test` job, which `deploy` depends on | A clear separation from `smoke`; a broken isolation guarantee blocks deployment. |
| Extras | RLS-on-every-table guard + generated DB types | The cheapest structural NFR-3 protection, and typed queries for every later slice. |
| Rollback | Forward-only migrations | `wrangler rollback` never reverts the database, so fixes are new migrations. |

## Scope

**In scope:** baseline `private` schema migration; `db:*` scripts; generated `src/db/database.types.ts` + typed server client; Vitest with `unit`/`db` projects; globalSetup that discovers local Supabase; `createTwoUsers()` harness; RLS guard with a self-test; `db-test` CI job with a types drift check; `db push` in `deploy`; three new GitHub secrets; `CLAUDE.md` and `deploy-plan.md` updates.

**Out of scope:** any domain table or policy (groups, members, periods, expenses); third-party migration tools; migrations at app startup; down migrations; PR dry-run against production; seed data; changes to `smoke`.

## Architecture / Approach

Migrations live in `supabase/migrations/`. `supabase start`/`db reset` apply them locally and in CI, and `supabase link` + `db push` (with an access token and DB password available only to the `deploy` job) apply them to production ahead of `wrangler deploy`, under a concurrency lock. Database tests use a Vitest `db` project whose globalSetup reads `supabase status -o env`. The harness creates two confirmed users through the admin API and signs each in on its own client. The guard queries `pg_class` directly through `pg` and proves itself on a throwaway table rolled back in a transaction.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration pipeline and generated types | Baseline `private` migration, `db:*` scripts, `@/db` types, typed client | Formatters rewriting the generated types file |
| 2. Vitest runner and two-user harness | `unit`/`db` projects, harness, RLS guard + self-test | Vitest ↔ Astro/Vite version compatibility; passing values from globalSetup to workers |
| 3. CI/CD wiring and documentation | `db-test` job, `db push` before deploy, secrets, docs | Missing secrets at merge time block the first deploy |

**Prerequisites:** local Supabase running (`npx supabase start`), Node 22 (`nvm use`), and for Phase 3 the owner creating a Supabase personal access token and setting three GitHub secrets before merge.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- `supabase gen types --local` may need a service that `smoke` excludes (e.g. `postgres-meta`), so `db-test` keeps whatever it needs.
- The Supabase CLI major version stays compatible between local `devDependencies` and CI (both use `npx supabase`).
- The first production push assumes an empty remote migration history, which is checked manually before merge.

## Success Criteria (Summary)

- A migration merged to `main` is applied to the hosted database before the new Worker goes live, and production sign-in still works.
- `npm run test:db` proves two separate user sessions and fails whenever a public table lacks RLS.
- S-02 can add its first group isolation test without writing any test infrastructure.
