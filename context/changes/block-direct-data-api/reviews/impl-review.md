<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Block Direct Data API Calls

- **Plan**: context/changes/block-direct-data-api/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence: re-ran Phase 1–4 automated criteria on `chore/block-direct-data-api-closeout` (reference greps, 107 unit tests, lint, `astro check`, build, types unchanged, full smoke with the enforced gate). Local read-only probes found no bypass: missing, empty or wrong key → 403 for anon and `service_role`; upper-case header name passes (PostgREST lowercases); table GET/HEAD, OpenAPI root and `/graphql/v1` → 403; `api_gate` not exposed (PGRST106); both gate functions `security definer` with `search_path=""`; `private.app_keys` readable by `postgres` only. Production: 403 `APPGATE` without and with a wrong key; the app key passes the gate (manual 4.5/4.6 confirmed by the user).

## Findings

### F1 — The gate can silently fail open, and nothing checks production automatically

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261005114042_app_gate.sql:117, .github/workflows/ci.yml (deploy job)
- **Detail**: The hook is a role setting (`pg_db_role_setting` on `authenticator`), not schema. A restore or clone, a role reset, or the documented emergency off-switch left on would remove the gate, and every direct call would then pass. With the DB tests removed, smoke runs only against local Supabase, and the production check in deploy-plan is manual. A loss of the gate would go unnoticed.
- **Fix**: Add a step to the `deploy` job after `wrangler deploy` that POSTs `$SUPABASE_URL/rest/v1/rpc/list_my_groups` with the anon key (`SUPABASE_KEY` secret) twice, without `x-app-key` and with `x-app-key: local-dev-app-key`, and fails unless both return 403 with `"code":"APPGATE"`.
  - Strength: It catches a missing hook, and a committed local key accidentally valid in production (F3), on every deploy, using secrets the job already has.
  - Tradeoff: It checks only at deploy time. Drift between deploys still needs a scheduled run, which is optional.
  - Confidence: HIGH — the same curl was verified by hand against production on 2026-10-05.
  - Blind spot: The step cannot prove the 200 path (it would need a user token); the app's own traffic covers that.
- **Decision**: SKIPPED

### F2 — deploy-plan production steps describe the observe-mode rollout, not the enforced state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/deployment/deploy-plan.md:131-141
- **Detail**: Steps 1–4 still read "Before merging the observe-mode PR" and expect a 418 `app gate: missing/ok` from `x-app-gate-probe`. Under `app_gate_enforce` the same curl returns 403. On a fresh or restored hosted project, migrations replay the enforced gate while `private.app_keys` is empty, so the Data API is down until the hash is inserted. The steps do not say this.
- **Fix**: Mark steps 1–4 as the historical observe-mode rollout. Add a short "new project / restore" order: set the Worker secret, push migrations, insert the hash immediately (Data API returns 403 until then), then run the enforced post-deploy check.
- **Decision**: SKIPPED

### F3 — `db push --include-seed` would make the committed local key valid in production

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/seed.sql:1-2
- **Detail**: The seed comment says the seed "never" runs on `supabase db push`. That holds only without `--include-seed` (verified in `supabase db push --help`). One push with that flag would insert the hash of the public `local-dev-app-key` into production and defeat the gate.
- **Fix**: Name the flag in the seed comment and in deploy-plan ("never run `db push --include-seed` against a hosted project"). The F1 probe with the local key catches it if it ever happens.
- **Decision**: FIXED

### F4 — `.env.example` is not tracked and lacks `SUPABASE_APP_KEY`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .gitignore:36, README.md:46-47
- **Detail**: README step 3 says `cp .env.example .env`, but `.gitignore`'s `.env*` ignores `.env.example` (pre-existing). The local copy has only URL and KEY. Following the README leaves `createClient` returning null and the app showing "Supabase nie jest skonfigurowany".
- **Fix**: Add `!.env.example` to `.gitignore` and commit `.env.example` with `SUPABASE_URL=`, `SUPABASE_KEY=` and `SUPABASE_APP_KEY=local-dev-app-key`.
- **Decision**: FIXED

### F5 — Stale wording left in docs after enforcement and test removal

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/deployment/deploy-plan.md:101; context/foundation/roadmap.md:85,172; context/changes/block-direct-data-api/change.md (Notes)
- **Detail**: Three places are out of date:
  - deploy-plan:101 says the Worker "keeps only `SUPABASE_URL` + `SUPABASE_KEY`", contradicting :88.
  - roadmap:85 and :172 refer to the "per-group isolation verification path" and the F-01 isolation check, which this change deleted.
  - change.md Notes do not record that PR #29 enforced the gate or that production returned 403. Phase 4 Docs asked for this; it exists only in the epilogue commit message.
- **Fix**: Mention all three Worker secrets at :101. Reword the roadmap lines to drop the deleted check. Add one sentence to change.md about PR #29 enforcement and the production result.
- **Decision**: FIXED

### F6 — `app_key_verdict()` has execute grants it does not need

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261005114042_app_gate.sql:109-113
- **Detail**: It is called only from the `security definer` `check_app_request`, so the nested call runs as `postgres`. The grants to anon, authenticated and service_role are unnecessary. They are not exploitable: `api_gate` is not exposed, and a caller can only judge their own headers.
- **Fix**: In the next migration that touches the gate, revoke execute on `app_key_verdict()` from anon, authenticated and service_role. Do not edit the pushed migration.
- **Decision**: FIXED (new migration 20261005130810_app_gate_tighten_grants.sql)

### F7 — CLAUDE.md does not say the gate covers only PostgREST

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: CLAUDE.md:51
- **Detail**: The gate protects the Data API, including `/graphql/v1`. Realtime, Storage and Auth connect to Postgres directly and are not gated. There is no exposure today (RLS with no policies, revoked grants, no publication). A future Storage bucket or Realtime channel will need its own controls.
- **Fix**: Add one sentence to the "App-key gate" bullet: covers PostgREST only; Storage/Realtime need their own RLS-based controls.
- **Decision**: FIXED

### F8 — Smoke's direct-call helpers hide sign-in failures and keep an unused default

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:126,136-144
- **Detail**: `firstUserToken()` does not check `response.ok`. A failed sign-in sends `Bearer undefined`, and the step fails with 401 instead of 403, which is confusing but never a false pass. `directRpc`'s default `token = SUPABASE_KEY` is unused since the probe steps were removed.
- **Fix**: Throw with the response status when the token request fails, and drop the unused default.
- **Decision**: FIXED
