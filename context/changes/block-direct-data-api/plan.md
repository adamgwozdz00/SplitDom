# Block Direct Data API Calls Implementation Plan

## Overview

A signed-in user can today take their access token from the `@supabase/ssr` session cookie, pair it with the anon key (public by Supabase's own definition) and call `/rest/v1/rpc/*` directly, bypassing the Worker. This plan makes the Supabase Data API refuse every request that does not carry a secret app header `x-app-key`, known only to the Worker (Cloudflare secret) and the database (a sha256 hash in `private.app_keys`).

Because external evidence conflicts on whether PostgREST's `db_pre_request` hook fires on hosted Supabase, the gate ships in two PRs: **PR 1** registers the hook in a harmless *observe* mode, provable in production with a curl probe; **PR 2** enforces — through the hook if the probe proved it fires (branch A), otherwise through a guard called at the top of every persistence function (branch B).

The same change also removes, per the user's decisions of 2026-10-05: all database tests (the `test:db` suite, its harness and the CI `db-test` job), the S-04 planning artifacts, the test plan and the test plan's Phase 1 change folder. The user will recreate the S-04 plan and the test plan after this change.

## Current State Analysis

- One Supabase client factory, server-only: `src/lib/supabase.ts:10` (`createServerClient` with `SUPABASE_URL` + anon `SUPABASE_KEY`, null guard at `:7`); env fields are `context: "server", access: "secret"` (`astro.config.mjs:17-21`); no browser client, no `PUBLIC_*` vars (research §A).
- The app calls exactly 6 RPC functions and no tables: `create_group`, `list_my_groups`, `get_my_group` (`src/lib/groups/group.repository.ts:18,30,50`), `create_group_invite`, `get_group_invite`, `redeem_group_invite` (`src/lib/invites/invite.repository.ts:20,32,40`). Auth calls (`middleware.ts:12`, `api/auth/*`, `auth/callback.ts:29`) go to GoTrue `/auth/v1`, not PostgREST.
- `global.headers` on `createServerClient` reaches every PostgREST call (and also Auth/Storage/Realtime calls — harmless server-side) in the installed `@supabase/ssr` 0.12.7 / `supabase-js` 2.116.0 (research §B).
- Schema `private` grants `usage` to `authenticated` only (`supabase/migrations/20260927211445_private_schema.sql:12-15`). The 6 persistence functions are `security definer`, `set search_path = ''`, `execute` revoked from `public, anon` and granted to `authenticated` (`20261002200553_settlement_groups.sql:176-184`, `20261005080344_group_invites.sql:164-171`).
- `supabase/config.toml:60-65` enables seeding from `./seed.sql`, which does not exist. Local email confirmations are off (`config.toml:209`), so a script can sign in through `/auth/v1/token?grant_type=password` right after signing up.
- CI (`.github/workflows/ci.yml`): `smoke` uses `supabase/setup-cli@v1` `latest` (`:36-38`) and excludes `postgres-meta` (`:42`); `db-test` (`:58-76`) runs `test:db` and the `db:types` drift check with the devDependency CLI; `deploy` needs `[ci, smoke, db-test]` (`:79`) and pushes migrations before deploying the Worker (`:93-110`).
- `scripts/smoke.mjs` is HTTP-only against `BASE_URL`, zero dependencies; `package.json:13` runs `node scripts/smoke.mjs`.

## Desired End State

- Any request to the Data API (`/rest/v1/*`, incl. RPC) without a valid `x-app-key` gets **403** with the gate's own error code — for `anon`, `authenticated` and `service_role` alike. The app works unchanged because the Worker sends the header.
- Local dev and CI use a fixed, local-only key seeded from `supabase/seed.sql`; production uses a random key whose hash was inserted by hand and whose value lives only in the Worker secret `SUPABASE_APP_KEY`.
- `npm run smoke` proves the gate: a signed-in smoke user calling `list_my_groups` directly gets 403 without the header and 200 with it.
- No database tests, no `test:db`, no `pg` dependency, no `db-test` job; the `db:types` drift check runs inside `smoke`.
- No S-04 planning folder, no `context/foundation/test-plan.md`, no `testing-domain-boundary-guard` folder; the roadmap shows S-04 as `blocked` again.
- Verify: Progress below fully checked, including the production probe after PR 2.

### Key Discoveries:

- The hook runs **after** the role switch, as the request role (PostgREST transactions docs; research §C). Its schema therefore needs `usage` for `anon`, `authenticated` and `service_role` — which `private` deliberately denies to `anon`. Hence a dedicated, non-exposed schema `api_gate` for the gate functions; the key table stays in `private`.
- Supabase's official pre-request example exempts every non-`anon` role; that exemption must not be copied (research §C). `service_role` is not exempt either (decided in planning: nothing uses it).
- A pre-request function can raise `sqlstate 'PGRST'` with a JSON `detail` carrying a custom status (Supabase "Securing your API"; PostgREST v14 errors docs) — the observe-mode probe relies on this, not on response headers, because headers set via `response.headers` are not guaranteed on error responses.
- erfi.dev measured that `db_pre_request` did **not** fire on hosted projects after `NOTIFY` or a restart, while a header read inside SQL on hosted works (S16, S22b); a zero-argument `immutable` header-reading function is folded at plan time (S22c) — never mark gate functions `immutable` (research §D–E).
- Postgres 17 has a built-in `sha256(bytea)`, so the hash needs no `pgcrypto`; with `search_path = ''` call it as `pg_catalog.sha256(pg_catalog.convert_to(<text>, 'UTF8'))`.
- `supabase db push` never runs the seed, so the committed local key never reaches production.

## What We're NOT Doing

- No change to S-02/S-03 persistence functions' existing `auth.uid()` checks (they stay); in branch A no persistence function changes at all.
- Not writing S-04 or the test plan anew — the user will recreate them after this change.
- No replacement for the deleted DB tests beyond the smoke gate probe and the `db:types` drift check (accepted loss: RLS guard, two-user isolation proofs, anon/direct-table refusal tests, invite backstop tests).
- No Vault, no dedicated exposed `api` schema, no Hyperdrive / Data-API-off architecture, no service-role key in the Worker.
- No `httpOnly` change to the session cookies (does not stop a user with devtools; out of scope).
- No gating of Storage/Realtime (not used; our tables have no policies, revoked grants and no publication membership).
- `src/db/` keeps no `__tests__/` after the removal; it is the generated-types folder, not a domain module, so the module-structure convention is not extended to it.
- No GitHub Actions secret for the app key: Astro `access: "secret"` values are read at runtime from Worker bindings, like `SUPABASE_KEY`.

## Implementation Approach

PR 1 = Phases 1–3, PR 2 = Phase 4. PR 1 is expand-only: the Worker starts sending the header, the key table and gate function appear, and the hook is registered in observe mode, which only answers a dedicated probe header and lets every other request through — so the old Worker (no header) and a `wrangler rollback` stay safe. Between the PRs a human sets the production key and runs the probe; its result picks branch A or B for Phase 4. PR 2 is safe to deploy database-first because by then the live Worker already sends a valid key.

## Critical Implementation Details

- **Ordering across the PRs.** Before merging PR 1: `wrangler secret put SUPABASE_APP_KEY` (otherwise the new Worker reports "not configured", because the factory now requires the key). After PR 1 deploys: insert the production key hash, then probe. Merge PR 2 only after the probe returned `ok` for the real key (branch A) or proved the hook silent (branch B).
- **Emergency off-switch for PR 2.** Branch A: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';` in the SQL editor. Branch B: re-create `api_gate.assert_app_request()` with an empty body. Both are documented in `deploy-plan.md`; each is followed by a forward migration that records the state.
- **Never drop or rename the registered function while the hook points at it** — every REST request would fail. Change it only with `create or replace` under the same signature.

## Phase 1: Remove S-04 planning artifacts and the test plan

### Overview

Delete the documents the user will recreate, and leave no reference to them in the roadmap or in this change's notes.

### Changes Required:

#### 1. Deleted documents

**File**: `context/changes/add-expense-see-balances/` (whole folder, untracked), `context/foundation/test-plan.md`, `context/changes/testing-domain-boundary-guard/` (whole folder)

**Intent**: Remove the S-04 change (change, research, plan, brief), the test plan and the test plan's Phase 1 change, as decided by the user on 2026-10-05.

**Contract**: The three paths no longer exist. The untracked S-04 folder cannot be restored from git — delete it only in this phase, not earlier.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Return S-04 to its pre-planning state and remove references to the deleted plan, keeping the S-10 slice (already mirrored as issue #27).

**Contract**: S-04 Status `planning` → `blocked` in the At-a-glance table and the S-04 body (the debt-granularity unknown is still `Block: yes`); S-10 Risk no longer cites `context/changes/add-expense-see-balances/plan.md` or the `Group.memberLabel` decision as made — rephrase as "S-04 should keep the labelling rule in one place"; frontmatter `updated` bumped if present. GitHub board item for S-04 set to the status matching `blocked` (per CLAUDE.md "Public roadmap on GitHub").

#### 3. This change's notes

**File**: `context/changes/block-direct-data-api/change.md`

**Intent**: Replace the stale "update rows #2, #4 and #6 of the test plan" and "Vault" wording with the decisions made in planning.

**Contract**: `## Notes` only; frontmatter untouched.

### Success Criteria:

#### Automated Verification:

- The three paths are gone: `test ! -e context/changes/add-expense-see-balances && test ! -e context/foundation/test-plan.md && test ! -e context/changes/testing-domain-boundary-guard`
- No live reference remains: `grep -rn "add-expense-see-balances/plan\|test-plan.md\|testing-domain-boundary-guard" CLAUDE.md README.md context --include=*.md | grep -v context/archive | grep -v context/changes/block-direct-data-api` prints nothing
- `grep -n "S-04" context/foundation/roadmap.md` shows Status `blocked` in the table row and the S-04 body

#### Manual Verification:

- The SplitDom Roadmap board shows S-04 with the status matching `blocked`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Remove the database tests and move the types-drift check into smoke

### Overview

Delete the `db` test suite and everything that only exists for it; keep CI's guarantee that generated types match the migrations.

### Changes Required:

#### 1. Test files and harness

**File**: `src/db/__tests__/` (whole folder: `global.setup.ts`, `pg.harness.ts`, `two-users.harness.ts`, `rls-guard.db.test.ts`, `two-users.db.test.ts`), `src/lib/groups/__tests__/group.repository.db.test.ts`, `src/lib/invites/__tests__/invite.repository.db.test.ts`

**Intent**: Remove all database tests and their harness (user decision 2026-10-05).

**Contract**: No `*.db.test.ts` anywhere under `src/`; unit tests (`*.test.ts`, in-memory fakes) untouched.

#### 2. Test runner and dependencies

**File**: `vitest.config.ts`, `package.json`, `package-lock.json`

**Intent**: Drop the `db` Vitest project, the `test:db` script and the `pg` / `@types/pg` dev dependencies (imported only by the removed harness).

**Contract**: `vitest.config.ts` keeps only the `unit` project (the `**/*.db.test.ts` exclude may go too); `npm uninstall pg @types/pg` updates the lockfile.

#### 3. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Delete the `db-test` job and run the `db:types` drift check inside `smoke`, which already starts local Supabase from a clean database.

**Contract**:
- `smoke` drops `supabase/setup-cli@v1` and uses the devDependency CLI (`npx supabase start|status|stop`) so generated types match local output byte for byte (the reason recorded in the old `db-test` comment); its `start -x` list no longer excludes `postgres-meta` (same list as the old `db-test`).
- A step "Check generated database types are up to date" (`npm run db:types` + `git diff --exit-code src/db/database.types.ts`) runs right after Supabase starts.
- `deploy.needs` becomes `[ci, smoke]`.

#### 4. Documentation

**File**: `CLAUDE.md`, `README.md`, `context/deployment/deploy-plan.md`

**Intent**: Remove every instruction that refers to the database tests.

**Contract**: CLAUDE.md — Commands (drop `test:db`; `npx supabase start` is needed by `dev` and `smoke`), Structure (`src/db/` has no `__tests__/`; `vitest.config.ts` has one project; CI jobs `ci` + `smoke` + `deploy`), Database changes (the group-scoped-table recipe no longer mentions the RLS guard or "add a `*.db.test.ts` … `createTwoUsers()`"; RLS-on stays as the rule). README — CI job list. deploy-plan — the "Gates" bullet (`:80`) describes `deploy` needing `ci` + `smoke` and the drift check inside `smoke`.

### Success Criteria:

#### Automated Verification:

- No database tests remain: `find src -name "*.db.test.ts" | wc -l` prints 0 and `test ! -e src/db/__tests__`
- No leftovers: `grep -rn "test:db\|createTwoUsers\|withDb\|db-test\|from \"pg\"" src scripts package.json vitest.config.ts .github CLAUDE.md README.md` prints nothing
- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Types are current against a fresh local database: `npm run db:reset && npm run db:types && git diff --exit-code src/db/database.types.ts`

#### Manual Verification:

- On the PR, the workflow shows only `ci` and `smoke`, and `smoke` runs the types-drift step green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: App key, Worker header and the gate in observe mode (closes PR 1)

### Overview

Add the key store, the gate function and the hook registration in observe mode; make the Worker send `x-app-key`; give local dev and CI the same local-only key; prove locally that the hook fires and judges the key correctly. Then, in production, set the key and probe.

### Changes Required:

#### 1. Migration: key store, gate schema, observe-mode hook

**File**: `supabase/migrations/<timestamp>_app_gate.sql` (via `npm run db:new app_gate`)

**Intent**: Store hashes of valid app keys, define the gate in a non-exposed schema every request role can use, and register it as the PostgREST pre-request function in observe mode.

**Contract**:
- `private.app_keys (key_hash bytea primary key, created_at timestamptz not null default now(), note text)`; RLS enabled with no policies; `revoke all … from public, anon, authenticated, service_role` (only `postgres`-owned definer code reads it). Several rows are valid at once (rotation).
- Schema `api_gate`, **not** added to `[api] schemas`: `revoke all on schema api_gate from public`; `grant usage … to anon, authenticated, service_role`.
- `api_gate.app_key_verdict() returns text` — `security definer`, `set search_path = ''`, volatile (never `immutable`): reads `current_setting('request.headers', true)::json->>'x-app-key'` and returns `'missing'` (absent/empty), `'ok'` (its sha256 is in `private.app_keys`) or `'invalid'`. `execute` revoked from `public`, granted to `anon, authenticated, service_role`.
- `api_gate.check_app_request() returns void` — same attributes; **observe mode**: if the request has header `x-app-gate-probe`, raise `sqlstate 'PGRST'` with `message` `{"code":"APPGATE_PROBE","message":"app gate: <verdict>"}` and `detail` `{"status":418,"status_text":"App Gate Probe"}`; otherwise return without effect. Same grants.
- `alter role authenticator set pgrst.db_pre_request = 'api_gate.check_app_request'; notify pgrst, 'reload config';`
- Header comment explaining: why `api_gate` and not `private` (the hook runs as `anon` too), why no role is exempt, that the value of a key never appears in SQL (hash only), and the observe → enforce plan.

#### 2. Local key seed

**File**: `supabase/seed.sql` (new)

**Intent**: Give every local and CI database the same local-only key, without it ever reaching production (seed runs on `supabase start` of a fresh database and on `db reset`, never on `db push`).

**Contract**: Inserts `sha256('local-dev-app-key')` into `private.app_keys` with `note = 'local only — never valid in any hosted project'`; a comment states the same.

#### 3. Worker sends the header

**File**: `astro.config.mjs`, `src/lib/supabase.ts`, `src/lib/config-status.ts`

**Intent**: Read the key from a new server secret and send it on every Supabase request the Worker makes; treat a missing key like a missing URL/key.

**Contract**: `SUPABASE_APP_KEY: envField.string({ context: "server", access: "secret", optional: true })`; `createClient` returns `null` unless `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_APP_KEY` are all set, and passes `global: { headers: { "x-app-key": SUPABASE_APP_KEY } }` to `createServerClient`; `config-status` reports "configured" only with all three.

#### 4. Local env, CI env, smoke

**File**: `.github/workflows/ci.yml`, `package.json`, `scripts/smoke.mjs`, `README.md`

**Intent**: Wire the local key into `.env` / `.dev.vars` and let the smoke test probe Supabase directly.

**Contract**:
- CI `smoke` writes `SUPABASE_APP_KEY=local-dev-app-key` next to `SUPABASE_URL` / `SUPABASE_KEY` into `.env` (copied to `.dev.vars`).
- `package.json` `smoke`: `node --env-file=.env scripts/smoke.mjs` (Node 22 built-in; `.env` already exists for `dev`).
- `scripts/smoke.mjs` reads `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_APP_KEY` from the environment and fails fast if any is missing. New steps, after the existing ones, talking to Supabase directly (no app):
  - probe without `x-app-key` (headers `apikey`, `x-app-gate-probe: 1`) on `POST /rest/v1/rpc/list_my_groups` → status 418, body message `app gate: missing`;
  - same with `x-app-key: <SUPABASE_APP_KEY>` → 418, `app gate: ok`;
  - same with a wrong key → 418, `app gate: invalid`;
  - without the probe header and without `x-app-key`, signed in as the first smoke user (access token from `POST /auth/v1/token?grant_type=password` with the smoke user's email/password) → 200, body lists group A (observe mode lets it through; this step flips to 403 in Phase 4).
- README: local setup adds `SUPABASE_APP_KEY=local-dev-app-key` to `.env` / `.dev.vars`; `npm run smoke` needs local Supabase and `.env`.

#### 5. Docs for the secret and the gate

**File**: `CLAUDE.md`, `context/deployment/deploy-plan.md`

**Intent**: Record the new secret, the gate and the manual production steps.

**Contract**: CLAUDE.md — Structure (`supabase/seed.sql`; `api_gate` schema), Database changes (new bullet: every Data API request passes `api_gate.check_app_request()`; `private.app_keys` holds key hashes; never drop/rename the registered function), Notes (`SUPABASE_APP_KEY` is the third Worker secret; local value `local-dev-app-key`). deploy-plan — Worker secrets now three; a "App key gate" section with: key generation (`openssl rand -hex 32`), `wrangler secret put SUPABASE_APP_KEY`, inserting the hash computed locally (`printf %s "$KEY" | shasum -a 256` → `insert into private.app_keys (key_hash, note) values (decode('<hex>','hex'), 'production <date>')` in the SQL editor), the probe commands, the pre-merge check `select setconfig from pg_db_role_setting where setrole = 'authenticator'::regrole;` (no foreign `pgrst.db_pre_request` to overwrite), and rotation (add new hash → set secret → deploy → delete old hash).

#### 6. Production rollout of PR 1 (manual, human)

**Intent**: Make production ready for enforcement and settle branch A vs B.

**Contract**: Before merge: the `pg_db_role_setting` check above; generate `$KEY`; `npx wrangler secret put SUPABASE_APP_KEY`. Merge → `deploy` pushes the migration and deploys the Worker. Then insert the hash, and run the three probes against `https://rpbroqavksbvezskqhlz.supabase.co/rest/v1/rpc/list_my_groups` with the production anon key:
- `x-app-gate-probe: 1` and no key → **418 `app gate: missing`** means the hook fires → branch A;
- **401/403 `permission denied for function`** (no 418), also after waiting ~2 min and re-trying, means the hook does not fire → branch B;
- with `x-app-key: $KEY` → **418 `app gate: ok`** (branch A only) confirms the stored hash matches the Worker's key.
Record the result and the branch in `change.md` Notes.

### Success Criteria:

#### Automated Verification:

- Migrations and seed apply from scratch: `npm run db:reset`
- Types are unchanged by the new schemas (only `public` is generated): `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Lint, unit tests, type check and build pass: `npm run lint && npm test && npx astro check && npm run build`
- Smoke passes against the dev server with local Supabase, including the 4 new gate steps: `npm run smoke`
- The gate is not reachable through the API: `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:54321/rest/v1/rpc/check_app_request -H "apikey: <local anon key>" -H "x-app-key: local-dev-app-key"` prints `404`

#### Manual Verification:

- After the PR 1 deploy, the production app still works (sign in, dashboard lists groups, invite flow)
- The production probe result (418 `missing` / 418 `ok`, or no 418) is recorded in `change.md` with the chosen branch

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. PR 1 is merged at the end of this phase.

---

## Phase 4: Enforce the gate (PR 2)

### Overview

Turn the observation into a 403 for every request without a valid key, using the mechanism the production probe proved. Implement exactly one branch, named in `change.md`.

### Changes Required:

#### 1A. Branch A — the hook fires: enforcing pre-request function

**File**: `supabase/migrations/<timestamp>_app_gate_enforce.sql`

**Intent**: Make the registered hook reject every request whose verdict is not `ok`.

**Contract**: `create or replace function api_gate.check_app_request()` (same signature, attributes and grants): verdict `ok` → return; otherwise raise `sqlstate 'PGRST'` with `message` `{"code":"APPGATE","message":"Requests must come through the app."}` and `detail` `{"status":403}`. The probe header is no longer special. No persistence function changes.

#### 1B. Branch B — the hook does not fire: guard in every persistence function

**File**: `supabase/migrations/<timestamp>_app_gate_enforce.sql`

**Intent**: Unregister the silent hook and enforce the same verdict inside each persistence function, which is measured to work on hosted.

**Contract**:
- `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`
- `api_gate.assert_app_request() returns void` — `security definer`, `set search_path = ''`, volatile; raises the same 403 `APPGATE` error when the verdict is not `ok`; `execute` to `authenticated` only (anon cannot call persistence functions anyway).
- `create or replace` the 6 functions (`create_group`, `get_my_group`, `list_my_groups`, `create_group_invite`, `get_group_invite`, `redeem_group_invite`) with `perform api_gate.assert_app_request();` as the first statement and the body otherwise copied byte for byte from the latest migration that defines it; grants are preserved by `create or replace` but are re-stated for clarity.
- CLAUDE.md "Database changes": every persistence function starts with `perform api_gate.assert_app_request();` — a transport check, not a business rule.

#### 2. Smoke (both branches)

**File**: `scripts/smoke.mjs`

**Intent**: Prove enforcement instead of observation.

**Contract**: The three probe-header steps are replaced by: signed-in smoke user calling `list_my_groups` directly **without** `x-app-key` → 403 with code `APPGATE`; with a wrong key → 403 `APPGATE`; **with** `SUPABASE_APP_KEY` → 200 listing group A. All existing app-level steps still pass (the Worker sends the key).

#### 3. Docs (both branches)

**File**: `CLAUDE.md`, `context/deployment/deploy-plan.md`, `context/changes/block-direct-data-api/change.md`

**Intent**: Record that the gate is enforced, by which mechanism, and how to switch it off in an emergency.

**Contract**: CLAUDE.md Status line and Database changes bullet state the enforced mechanism; deploy-plan "App key gate" gains the enforced state, the post-deploy probe and the emergency off-switch for the chosen branch (see Critical Implementation Details).

#### 4. Production rollout of PR 2 (manual, human)

**Intent**: Confirm enforcement in production.

**Contract**: Merge → `deploy` pushes the enforcing migration, then the Worker (unchanged behaviour). Probe with a real user token taken from the browser session cookie: no `x-app-key` → 403 `APPGATE`; with `x-app-key: $KEY` → 200. Then use the app end to end.

### Success Criteria:

#### Automated Verification:

- Migrations and seed apply from scratch: `npm run db:reset`
- Types are unchanged: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Lint, unit tests, type check and build pass: `npm run lint && npm test && npx astro check && npm run build`
- Smoke passes against the dev server with local Supabase, including the 403-without-key and 200-with-key steps: `npm run smoke`

#### Manual Verification:

- In production, a direct `POST /rest/v1/rpc/list_my_groups` with a signed-in user's token and no `x-app-key` returns 403 `APPGATE`, and with the key returns 200
- The production app works end to end after the PR 2 deploy (sign in, create a group, invite, join)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- Existing unit tests (`npm test`, in-memory fakes) must stay green; the gate adds no TypeScript domain logic to unit-test.

### Integration Tests:

- `npm run smoke` is the only integration check left: the app flows (Worker → PostgREST with the header) plus direct Data API calls with and without the key, as an anonymous probe (Phase 3) and as a signed-in user (Phases 3–4).

### Manual Testing Steps:

1. Before PR 1 merge: check `pg_db_role_setting` for `authenticator` in production; set the Worker secret.
2. After PR 1 deploy: insert the key hash; run the probes; record the branch.
3. After PR 2 deploy: direct call with a user token without/with the key (403/200); use the app end to end.

## Performance Considerations

One extra function call per Data API request: a header read, one `sha256` and a primary-key lookup in a tiny table. No Vault decryption. Negligible next to the request itself.

## Migration Notes

- Forward-only: Phase 4 changes the gate with `create or replace` (branch A) or re-creates the persistence functions (branch B) in a new migration; nothing pushed is edited.
- Expand/contract: PR 1 is compatible with the previously deployed Worker (observe mode never blocks traffic without the probe header); PR 2 is compatible with the PR 1 Worker (it already sends a valid key). `wrangler rollback` to any Worker from PR 1 onward keeps working; rolling back past PR 1 after PR 2 would break the app — use the emergency off-switch first.

## References

- Related research: `context/changes/block-direct-data-api/research.md`
- Client factory: `src/lib/supabase.ts:10`
- Function lockdown pattern: `supabase/migrations/20261002200553_settlement_groups.sql:176-184`
- Supabase "Securing your API" (pre-request function, custom error status); PostgREST v14 "Transactions → Pre-Request"; erfi.dev "Locking down Supabase" (S16, S22b, S22c)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Remove S-04 planning artifacts and the test plan

#### Automated

- [x] 1.1 The three paths are gone — 552df2c
- [x] 1.2 No live reference remains — 552df2c
- [x] 1.3 Roadmap shows S-04 as blocked — 552df2c

#### Manual

- [x] 1.4 The SplitDom Roadmap board shows S-04 with the status matching blocked — 552df2c

### Phase 2: Remove the database tests and move the types-drift check into smoke

#### Automated

- [x] 2.1 No database tests remain — e65e371
- [x] 2.2 No leftovers — e65e371
- [x] 2.3 Unit tests pass — e65e371
- [x] 2.4 Lint passes — e65e371
- [x] 2.5 Type check passes — e65e371
- [x] 2.6 Build passes — e65e371
- [x] 2.7 Types are current against a fresh local database — e65e371

#### Manual

- [x] 2.8 On the PR, the workflow shows only ci and smoke, and smoke runs the types-drift step green — 7714d6a

### Phase 3: App key, Worker header and the gate in observe mode (closes PR 1)

#### Automated

- [x] 3.1 Migrations and seed apply from scratch — 7714d6a
- [x] 3.2 Types are unchanged by the new schemas — 7714d6a
- [x] 3.3 Lint, unit tests, type check and build pass — 7714d6a
- [x] 3.4 Smoke passes including the 4 new gate steps — 7714d6a
- [x] 3.5 The gate is not reachable through the API — 7714d6a

#### Manual

- [ ] 3.6 After the PR 1 deploy, the production app still works
- [ ] 3.7 The production probe result is recorded in change.md with the chosen branch

### Phase 4: Enforce the gate (PR 2)

#### Automated

- [ ] 4.1 Migrations and seed apply from scratch
- [ ] 4.2 Types are unchanged
- [ ] 4.3 Lint, unit tests, type check and build pass
- [ ] 4.4 Smoke passes including the 403-without-key and 200-with-key steps

#### Manual

- [ ] 4.5 In production, a direct call without the key returns 403 APPGATE and with the key returns 200
- [ ] 4.6 The production app works end to end after the PR 2 deploy
