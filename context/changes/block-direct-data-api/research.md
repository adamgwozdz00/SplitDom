---
date: 2026-10-05T10:52:15Z
researcher: Claude (Opus 5.5) for adamgwozdz00
git_commit: ca859f1
branch: chore/archive-invite-member-by-link
repository: 10xDevs (SplitDom)
topic: "Block direct Supabase Data API calls that bypass the app — internal call sites and wiring, external evidence on db_pre_request, secret storage and rollout; remove the database tests"
tags: [research, supabase, postgrest, db_pre_request, security, data-api, ci, testing]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude (Opus 5.5)
---

# Research: Block direct Data API calls that bypass the app

**Date**: 2026-10-05T10:52:15Z
**Researcher**: Claude (Opus 5.5) for adamgwozdz00
**Git Commit**: ca859f1 (working tree has uncommitted edits in `context/foundation/roadmap.md`, `context/foundation/test-plan.md` and the untracked `context/changes/add-expense-see-balances/`)
**Branch**: chore/archive-invite-member-by-link
**Repository**: 10xDevs (SplitDom)

## Research Question

The user decided (2026-10-05, see `change.md`) that a user must never be able to call the Supabase Data API (PostgREST `/rest/v1`, including `/rest/v1/rpc`) bypassing the app. Chosen approach: requests without a secret app header `x-app-key`, known only to the Worker and the database, are rejected with 403 — via a PostgREST `db_pre_request` function. `auth.uid()` filtering stays as a second layer. The user asked for internal research plus external research (Exa web search, Context7).

**Scope decision added mid-research (user, 2026-10-05):** remove the database tests from the repository entirely (all `*.db.test.ts`, the `src/db/__tests__/` harness, the `test:db` script, the CI `db-test` job and the CLAUDE.md rule that requires a `*.db.test.ts`), as a step of this change's plan. This document records what that removal touches; it does not re-open the decision.

## Summary

1. **Blocking risk for the chosen mechanism — `db_pre_request` may not fire on hosted Supabase.** A measured lab (erfi.dev, runs 2026-08-28 and 2026-09-03 on hosted micro projects) set `ALTER ROLE authenticator SET pgrst.db_pre_request`; the role setting persisted, but no pre-request ran within 61–120 s after `NOTIFY pgrst, 'reload config'` nor within 182 s after a full project restart. The same lab shows it firing on a self-hosted PostgREST v16.2. Supabase's own docs ("Securing your API") still document the pattern for hosted projects, and two GitHub issues (supabase#37359, 2025-07; supabase#3233, older) report it working. **No 2025–2026 measured confirmation that it fires on hosted was found.** Treat "the hook fires on our production project" as unverified; the plan must prove it against production (curl without the header → 403) before relying on it, or use the fallback below.
2. **A fallback that is measured to work on hosted: check the header inside each persistence function.** The same lab measured that `current_setting('request.headers', true)` is readable in SQL on hosted PostgREST and that a header check in an RLS policy holds (S22b). A `stable` (not `immutable` — an immutable zero-arg helper is folded at plan time, S22c) `security definer` helper in schema `private`, called first in each of the 6 persistence functions, gives the same 403 gate without depending on the hook. Cost: one call per function and a rule every future function must follow. Both mechanisms can be combined (hook as the global net, per-function call as the guaranteed gate).
3. **The app side is one line.** Every runtime Supabase client is built in `createClient()` at `src/lib/supabase.ts:10`; the installed `@supabase/ssr` 0.12.7 / `supabase-js` 2.116.0 accept `global: { headers }` and send them on every PostgREST call (and also on Auth calls, harmless server-side). The app calls exactly 6 RPC functions and no `.from()` tables; no Supabase client, URL or key reaches the browser.
4. **Auth is not affected.** Sign-in, sign-up, sign-out, the OAuth start, the PKCE callback and `getUser()` in the middleware go to GoTrue (`/auth/v1`), which is not behind PostgREST.
5. **The secret value cannot live in a migration** (it would be committed). No per-environment SQL mechanism exists in the repo today. Options: a hash of the key in a `private` table inserted per environment (manual SQL in production; local seed), or Supabase Vault (installed locally, `supabase_vault` 0.3.1, but decrypts on every read and `[db.vault]` CLI sync semantics are unverified). Hash-compare (`sha256`) is the cheaper option and avoids plain `=` timing concerns.
6. **Rollout order is the main operational risk.** The `deploy` job pushes migrations before deploying the Worker (`.github/workflows/ci.yml:93-110`). A migration that turns on a fail-closed gate would make the currently live Worker (no header) get 403 on every RPC until the new Worker is live and its secret is set. Expand/contract (CLAUDE.md:49) requires two steps: first ship the Worker sending the header (and set the Worker secret), then enable the gate.
7. **The pending S-04 plan raises the stakes.** `context/changes/add-expense-see-balances/plan.md:67,358` plans persistence functions that validate nothing (no `auth.uid()` membership filter) and the uncommitted test-plan edits call a direct RPC "an accepted risk". If S-04 lands that way, this gate becomes the only guard against direct RPC — and it contradicts the "auth.uid() stays as a second layer" statement in `change.md`. This needs reconciling before S-04 is planned further.
8. **Removing the DB tests** deletes 4 test files, 3 harness files, the `db` Vitest project, the `test:db` script and the `pg`/`@types/pg` dev dependencies (used only by the harness), and the CI `db-test` job — which also hosts the `db:types` drift check and is a `needs` of `deploy`. With the DB tests gone, verification of this gate has to happen in the smoke test (HTTP probe without the header) and with a production probe.

## Detailed Findings

### A. Where the app talks to Supabase (internal)

- Single client factory: `src/lib/supabase.ts:10` — `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { cookies })`, no `global` option today; returns `null` if either env var is missing (`:7`). `SUPABASE_KEY` is the anon key (`.github/workflows/ci.yml:43-47`, `context/deployment/deploy-plan.md:88`).
- Data API (PostgREST) calls — exactly these 6 RPC names, no `.from()` in app code:
  - `src/lib/groups/group.repository.ts:18` `create_group`, `:30` `list_my_groups`, `:50` `get_my_group`
  - `src/lib/invites/invite.repository.ts:20` `create_group_invite`, `:32` `get_group_invite`, `:40` `redeem_group_invite`
  - Reached from `src/pages/api/groups/index.ts:19`, `src/pages/api/groups/[id]/invites.ts:20,25`, `src/pages/api/invites/redeem.ts:23`, `src/pages/dashboard.astro:15-16`, `src/pages/groups/[id].astro:15-17`, `src/pages/invite/[token].astro:32-33`.
- Auth (GoTrue, not gated): `src/middleware.ts:12` (`getUser`), `src/pages/api/auth/signin.ts:14`, `signup.ts:13`, `signout.ts:7`, `google.ts:9` (builds the authorize URL, no HTTP call on the server), `src/pages/auth/callback.ts:29` (`exchangeCodeForSession`).
- `src/lib/config-status.ts:1,14` only reads the env vars to show a banner.
- Browser exposure: no `createBrowserClient`, no `PUBLIC_*` env vars; env fields are `context: "server", access: "secret"` (`astro.config.mjs:17-21`); the React islands (`SignInForm`, `SignUpForm`) import no Supabase code.
- Session cookies are readable by the user: `@supabase/ssr` defaults `httpOnly: false` (`node_modules/@supabase/ssr/dist/main/utils/constants.js:7`). Even with `httpOnly`, the user can read them in devtools — this is the threat the change addresses.

### B. Sending the header (supabase-js / @supabase/ssr, installed versions)

- `SupabaseClientOptions.global.headers` exists (`node_modules/@supabase/supabase-js/dist/index.d.mts:277-286`); `createServerClient` accepts and spreads it, adding only `X-Client-Info` (`node_modules/@supabase/ssr/dist/main/createServerClient.js:22-30`).
- supabase-js passes the same headers to `PostgrestClient` (`node_modules/@supabase/supabase-js/dist/index.mjs:680-681`), to the Auth client (`:665`, `:841-848`; `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:187`), and to Storage, Functions and Realtime (`index.mjs:675,688,696`). So `x-app-key` also reaches `/auth/v1` on the same Supabase host — harmless, since the client only runs in the Worker.

### C. PostgREST `db_pre_request` mechanics (external, Context7 + PostgREST source)

- Runs inside the request transaction, after the role switch (`SET ROLE anon|authenticated|service_role`) and transaction-scoped settings, before the main query (docs.postgrest.org/en/v14/references/transactions.html; maintainer in PostgREST discussion #2728).
- Covers table GET/HEAD/POST/PATCH/PUT/DELETE, every RPC (GET or POST, incl. `/rpc/graphql`) and the root OpenAPI endpoint; not OPTIONS (no transaction) — per PostgREST `main` source (`Query.hs`, `MainTx.hs`, `Plan.hs`) as read by the worker.
- Headers: `current_setting('request.headers', true)::json->>'x-app-key'`; header names are lowercased.
- 403: `raise sqlstate 'PGRST' using message = json_build_object(...)::text, detail = json_build_object('status', 403)::text` (Supabase "Securing your API") or `raise sqlstate 'PT403'`. `insufficient_privilege` yields 401 for `anon` and 403 otherwise, so it is not deterministic.
- Runs as the request role → a function reading a secret must be `security definer` and executable by `anon`, `authenticated` and `service_role`; put it in a non-exposed schema (`private`) so it is not callable via `/rpc`. Always schema-qualify the configured name (supabase-tenant-rbac#29: `function db_pre_request() does not exist`).
- Supabase's official example exempts every non-`anon` role (`if jwt_role <> 'anon' then return;`). That exemption must **not** be copied: the threat here is `authenticated` users.
- Only one pre-request function per role; a broken or dropped function fails every REST request — version the name instead of replacing in place.

### D. Supabase-hosted specifics (external)

- Setting it from a migration is permitted: supautils lists `pgrst.*` in `privileged_role_allowed_configs` and `authenticator*` in reserved roles whose settings the privileged role may change (supabase/postgres `ansible/files/postgresql_config/supautils.conf.j2`). Locally, `postgres` holds `admin_option` on `authenticator` and there is no `PGRST_DB_PRE_REQUEST` env on the PostgREST container (worker's read-only catalog check). A 2022 report of `permission denied to set parameter` is outdated.
- **Whether it then fires on hosted is contradicted** (see Summary 1): erfi.dev measured "does not fire on hosted" (sections "The IP filter that does not fire on hosted", claim table row "db-pre-request does not fire on hosted — tested"); Supabase docs and supabase#37359 / #3233 say it works. Unresolved by this research; resolvable only by a production probe.
- Not affected by the gate: Studio table/SQL editor (direct Postgres as `postgres`), dashboard impersonation (no longer via PostgREST, supabase#37359), Auth, Storage and Realtime (direct Postgres). Affected: anything calling `/rest/v1` without the header — including `service_role`/secret-key calls unless exempted, Edge Functions, `pg_net`/cron calls to REST, API-docs "try it".
- GraphQL `/graphql/v1` is routed to PostgREST `/rpc/graphql` (self-hosted Envoy routing table; pg_graphql docs) — covered by the gate by inference; hosted routing not stated. `graphql_public` is exposed locally (`supabase/config.toml:13`); pg_graphql is no longer enabled by default on new or idle projects (Supabase changelog 42180).
- Realtime/Storage bypass PostgREST; our tables are protected there by RLS with no policies, revoked grants (`supabase/migrations/20261002200553_settlement_groups.sql:53-61`, `20261005080344_group_invites.sql:27-29`) and no `supabase_realtime` publication membership.
- Verify on production before overriding: `select setconfig from pg_db_role_setting where setrole = 'authenticator'::regrole;` — no evidence Supabase sets its own pre-request, but only one is possible. `current_setting('pgrst.db_pre_request')` reads NULL from an ordinary session even when set (KnowCode), so check `pg_db_role_setting`.
- Platform change: from 2026-10-30 existing projects stop auto-granting new `public` tables to API roles (changelog 45329); this repo already revokes grants explicitly.

### E. Per-function header check (fallback, external evidence)

- erfi.dev S22b (hosted, 2026-09-14): a header-keyed check inside an RLS policy holds on hosted; S16: an RPC returning `request.headers` sees the headers.
- S22c: a zero-argument `immutable` function reading `request.headers` is folded at plan time (EXPLAIN: `One-Time Filter: false`) — the helper must be `stable`.
- Shape for this repo: `private.assert_app_request()` (`stable`, `security definer`, `set search_path = ''`), called as the first statement of each of the 6 persistence functions and every future one; raising `PT403`/`PGRST` 403. Schema `private` already grants `usage` to `authenticated` only (`supabase/migrations/20260927211445_private_schema.sql:12-15`); anon is already refused by `revoke execute … from public, anon` on every persistence function (`20261002200553_settlement_groups.sql:178-184`, `20261005080344_group_invites.sql:165-171`).
- Changing the 6 existing functions means `create or replace` in a new migration (forward-only rule, CLAUDE.md:49).

### F. Storing and comparing the secret

- Migrations are committed, so the value cannot be in one. No mechanism runs environment-specific SQL today: `supabase/seed.sql` does not exist although `[db.seed]` is enabled (`supabase/config.toml:60-65`); `scripts/` holds only `smoke.mjs`; `supabase/.env` holds only Google OAuth vars.
- Vault: extension present locally (`supabase_vault` 0.3.1, empty), `vault.decrypted_secrets` granted to `postgres`/`service_role` only, so a `postgres`-owned `security definer` function can read it; it decrypts on every query (supabase.com/docs/guides/database/vault). `[db.vault]` in `config.toml` (`:50-51`, commented) can seed Vault from env; `db push` reportedly syncs it unless `--skip-vault` — semantics across CLI versions unverified.
- Hash table alternative: `private.app_keys(key_hash bytea)` with `sha256` of the key (pgcrypto `digest`), compare hashes; supports two rows during rotation (add new → deploy Worker → remove old), mirroring Supabase's `private.anon_api_keys` example. dba.stackexchange #285739: plain text `=` leaks timing; hash-then-compare mitigates; no SQL constant-time compare exists.
- Fail closed when no key row exists — unless the plan deliberately chooses fail-open for the rollout window (see G).

### G. Env wiring and rollout order (internal)

Places a new secret (e.g. `SUPABASE_APP_KEY`) touches:

1. `astro.config.mjs:17-21` — new `envField.string({ context: "server", access: "secret" })`.
2. `src/lib/supabase.ts:3,10` — import and `global.headers`.
3. Cloudflare Worker secret — manual `wrangler secret put` (`context/deployment/deploy-plan.md:48`; CI never sets Worker secrets).
4. Local `.env` / `.dev.vars` (gitignored, `.gitignore:36,59,63`) and `.env.example` (note: root `.env.example` is matched by `.env*` in `.gitignore:36` and is not tracked; only `supabase/.env.example` is).
5. CI `smoke` job — writes `.env`/`.dev.vars` at `.github/workflows/ci.yml:44-48`; the local DB must hold the same key (seed or a step running SQL).
6. Production DB — one-time manual insert of the key hash (or Vault secret); hosted settings are changed by hand, never via `supabase config push` (`context/deployment/deploy-plan.md:99`).
7. GitHub secret — only if build/deploy needs it; Astro `access: "secret"` values are read at runtime (assumption carried from how `SUPABASE_KEY` works; adapter source not checked).

Rollout: `deploy` (`.github/workflows/ci.yml:78-110`) runs `supabase db push` (`:94-101`) before `npm run build` and `wrangler deploy` (`:102-110`); comment at `:93`: "Database first". A gate migration in the same deploy as the header-sending Worker leaves the old Worker without the header between push and deploy, and forever if the build or deploy fails; `wrangler rollback` would also restore a header-less Worker (CLAUDE.md:49, deploy-plan `:86`). Therefore: PR 1 — Worker sends the header (no-op for the DB) + Worker secret set + production key row inserted; PR 2 — gate migration. A single PR would only be safe with a fail-open-when-unconfigured gate, which weakens the guarantee.

### H. Removing the database tests (decision, impact inventory)

Files and config the removal touches (inspected):

- Test files (4): `src/db/__tests__/rls-guard.db.test.ts`, `src/db/__tests__/two-users.db.test.ts`, `src/lib/groups/__tests__/group.repository.db.test.ts`, `src/lib/invites/__tests__/invite.repository.db.test.ts`.
- Harness (3): `src/db/__tests__/global.setup.ts`, `two-users.harness.ts`, `pg.harness.ts` (the whole `src/db/__tests__/` directory). `src/db/` then has no `__tests__/`, which the module-structure convention (CLAUDE.md "every module has its own `index.ts`, `types.ts`, and `__tests__/`") would flag — decide whether `src/db/` counts as a module.
- `vitest.config.ts:20-31` (the `db` project block, `name: "db"` at `:23`); `package.json:15` — `test:db`; `package.json:45,55` — `@types/pg`, `pg` (imported only by `pg.harness.ts` and `rls-guard.db.test.ts`).
- CI: `.github/workflows/ci.yml:58-76` — `db-test` job, which also runs `npm run db:types` + `git diff --exit-code` (`:71-74`, the generated-types drift check required by CLAUDE.md "CI fails if it is out of date"), and `:79` `deploy.needs: [ci, smoke, db-test]`. The drift check (and the "migrations apply cleanly from scratch" signal) must move, e.g. into `smoke`, which already runs `supabase start`.
- Docs: CLAUDE.md:22, :24, :38, :41, :51 (the "add a `*.db.test.ts` that uses `createTwoUsers()`" step and "the RLS guard in `test:db` fails…"); `context/foundation/test-plan.md:100,129,152-154` and rows #2/#4/#6; `context/deployment/deploy-plan.md:80`.
- Guarantees lost with them (stated, not argued): the RLS guard (every `public` table has RLS on; `anon` has no usage on `private`, `rls-guard.db.test.ts:46-52`), the two-user isolation proofs per persistence function, anon refusal (42501) and direct-table-access refusal, and the invite claim/expiry backstops (`invite.repository.db.test.ts`). Supabase Advisor lints remain as a manual signal.
- Unit tests (`*.test.ts`) use in-memory fakes and are unaffected.

## Code References

- `src/lib/supabase.ts:3,7,10` — env import, null guard, the only client factory
- `src/middleware.ts:12` — `auth.getUser()` (GoTrue, not gated)
- `src/lib/groups/group.repository.ts:18,30,50` — RPC `create_group`, `list_my_groups`, `get_my_group`
- `src/lib/invites/invite.repository.ts:20,32,40` — RPC `create_group_invite`, `get_group_invite`, `redeem_group_invite`
- `astro.config.mjs:17-21` — server-secret env schema
- `supabase/config.toml:13` — exposed schemas `public`, `graphql_public`; `:50-51` commented `[db.vault]`; `:60-65` seed config (no `seed.sql`)
- `supabase/migrations/20260927211445_private_schema.sql:12-15` — `private` schema grants
- `supabase/migrations/20261002200553_settlement_groups.sql:53-61,176-184` — table revokes, function revoke/grant pattern
- `supabase/migrations/20261005080344_group_invites.sql:27-29,164-171` — same pattern for invites
- `.github/workflows/ci.yml:41-48` (smoke env), `:58-76` (db-test + types drift), `:78-110` (deploy order)
- `scripts/smoke.mjs:37,124` — HTTP-only smoke, no Supabase client
- `vitest.config.ts:20-31`, `package.json:15,45,55` — DB test wiring

## Architecture Insights

- The Worker is already the only legitimate Data API client: one factory, server-only env, no browser client. The gate formalises that as a secret the user cannot obtain, rather than relying on the anon key not leaking (Supabase documents the publishable/anon key as public).
- The gate is a transport check, not domain logic; it fits the rule that database functions only persist and load (CLAUDE.md "Domain logic"), as long as it stays a one-line guard in `private`.
- `db_pre_request` is a global, all-or-nothing switch on `authenticator`; a per-function guard is local, testable through the smoke test, and independent of PostgREST config — at the cost of a convention every new persistence function must follow.

## Historical Context (from prior changes)

- `context/archive/2026-10-02-invite-member-by-link/research.md:65,172,313` and `plan.md:653,660` — direct-RPC callers considered; the invite rules got SQL backstops so a direct `redeem_group_invite` call cannot reuse or extend an invite. Still supported by the current migration (`20261005080344_group_invites.sql:148`, `SD001`).
- `context/archive/2026-09-27-db-migrations-and-isolation/plan.md:34` — origin of the RLS-on/no-policies + definer-function isolation model and the RLS guard test that this change now removes.
- `context/changes/add-expense-see-balances/plan.md:33,67,358`, `plan-brief.md:69`, `research.md:72` (uncommitted, S-04) — "persistence functions validate nothing", direct RPC an accepted risk. Contradicts `change.md` ("auth.uid() stays as a second layer") — see Open Questions.

## Related Research

- `context/changes/add-expense-see-balances/research.md`
- `context/archive/2026-10-02-invite-member-by-link/research.md`

## Open Questions

1. **Does `db_pre_request` fire on our hosted project?** Contradicted evidence (erfi.dev measured "no"; Supabase docs say "yes"). Resolve with a production probe before relying on it, or choose the per-function guard (E) — or both. Blocking for the plan's mechanism choice.
2. **Where does the key live in the DB** — hash in a `private` table (recommended by evidence: cheap, rotatable, no decryption) or Vault (`[db.vault]` sync semantics unverified)?
3. **How does the local DB / CI smoke get the key** — committed local-only dev value in `supabase/seed.sql` (runs on `db reset`, not on `db push`) plus the same value written to `.env`/`.dev.vars` in CI, or a script step.
4. **Exempt `service_role`?** Nothing in the app uses it; with the DB tests removed no test client uses it either. Not exempting is stricter.
5. **Reconcile with S-04:** if persistence functions stop filtering on `auth.uid()`, this gate becomes the only guard against direct RPC; `change.md` assumes `auth.uid()` stays. Decide before planning S-04 further.
6. **Where the `db:types` drift check moves** once `db-test` is deleted, and what replaces `db-test` in `deploy.needs`.
7. **Verification without DB tests:** a smoke step that calls `/rest/v1/rpc/list_my_groups` on local Supabase without the header (expect 403) and with it (expect 200/empty), plus a one-off production probe after rollout.
