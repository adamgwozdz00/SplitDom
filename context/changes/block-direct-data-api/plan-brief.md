# Block Direct Data API Calls — Plan Brief

> Full plan: `context/changes/block-direct-data-api/plan.md`
> Research: `context/changes/block-direct-data-api/research.md`

## What & Why

A signed-in user can take their access token from the session cookie, pair it with the public anon key and call `/rest/v1/rpc/*` directly, bypassing the app. The user decided this must never be possible: every Data API request without a secret `x-app-key` header — known only to the Worker and the database — gets 403. The same change removes the database tests, the S-04 planning artifacts and the test plan, which the user will recreate afterwards.

## Starting Point

One server-only Supabase client (`src/lib/supabase.ts:10`) makes all 6 RPC calls; nothing reaches the browser. The 6 persistence functions are granted to `authenticated` and check `auth.uid()`. PostgREST's `db_pre_request` hook is the documented way to gate every request, but a measured 2026 lab says it does not fire on hosted Supabase, while Supabase's docs say it does.

## Desired End State

Direct Data API calls without the key get 403 (`APPGATE`) for every role; the app works unchanged because the Worker sends the header. `npm run smoke` proves 403 without and 200 with the key. No DB tests, no `db-test` job (the `db:types` drift check lives in `smoke`), no S-04 plan, no test plan; S-04 is `blocked` again on the roadmap.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Gate approach | Secret header checked in the database | Keeps `supabase-js` and the stack; a leaked key alone opens nothing without a user JWT | Research (user, before research) |
| Mechanism under uncertainty | Observe mode first (PR 1), enforce in PR 2 via the hook (A) or a per-function guard (B) | The production probe settles whether the hook fires, without risking an outage | Plan |
| Relation to S-04 | Leave S-04 out; delete its plan, the test plan and the test-plan Phase 1 folder | User will recreate them after this change | Plan |
| Key storage | sha256 hashes in `private.app_keys` | Cheap per request, a leaked row reveals no key, two rows allow rotation | Plan (research evidence) |
| Local / CI key | Fixed `local-dev-app-key` hashed in `supabase/seed.sql` | Seed never runs on `db push`, so it never exists in production | Plan |
| Gate schema | New non-exposed schema `api_gate` | The hook runs as `anon` too, and `private` denies `anon` usage | Plan |
| `service_role` | Not exempt | Nothing uses it; an exemption only widens the surface | Plan |
| DB tests | Removed entirely | User decision, 2026-10-05 | Research (user) |
| Types-drift check | Moved into `smoke` (devDependency CLI) | One Supabase start in CI, byte-identical type generation | Plan |

## Scope

**In scope:**
- Deleting S-04 artifacts, the test plan and `testing-domain-boundary-guard`; roadmap/board S-04 back to `blocked`
- Deleting all DB tests, `test:db`, `pg` deps and the `db-test` job; drift check into `smoke`
- `private.app_keys`, `api_gate` functions, hook registration, `seed.sql`, Worker header, smoke gate steps, docs
- Manual production steps: Worker secret, key hash insert, probes

**Out of scope:**
- Rewriting S-04 or the test plan; changing existing `auth.uid()` checks
- Vault, a dedicated exposed `api` schema, Hyperdrive, service-role key in the Worker
- `httpOnly` cookies; Storage/Realtime gating; a GitHub secret for the key

## Architecture / Approach

Worker → `createServerClient` with `global.headers["x-app-key"]` → PostgREST → `api_gate.check_app_request()` (pre-request, runs as the request role) → `api_gate.app_key_verdict()` hashes the header and looks it up in `private.app_keys` → `ok` passes; otherwise (after PR 2) 403. In observe mode the function only answers requests carrying `x-app-gate-probe` with a 418 naming the verdict. Branch B moves the same verdict into `api_gate.assert_app_request()`, called first in each persistence function.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Remove S-04 artifacts and the test plan | Clean slate for the user's rewrite; S-04 `blocked` | Untracked S-04 folder is unrecoverable once deleted |
| 2. Remove DB tests, drift check into smoke | Lean CI with `ci` + `smoke` only | Losing isolation/RLS-guard coverage (accepted) |
| 3. Key, header, observe-mode gate (PR 1) | Production probe decides branch A or B | Worker secret missing at deploy → "not configured" |
| 4. Enforce (PR 2) | 403 for every direct call without the key | Key mismatch → app down; emergency off-switch documented |

**Prerequisites:** Local Supabase running; `wrangler` and Supabase Dashboard access for the manual production steps.
**Estimated effort:** ~2–3 sessions across 4 phases, two PRs plus two short manual production windows.

## Open Risks & Assumptions

- Whether the hook fires on hosted is unknown until the Phase 3 probe; branch B is fully specified, so the outcome changes only Phase 4's mechanism.
- Removing DB tests drops the RLS guard and isolation proofs; only Supabase Advisor and smoke remain as signals.
- Branch B adds a convention every future persistence function must follow, with no automated check.
- A user with a valid session still reaches everything the app itself exposes; the gate only removes the bypass path.

## Success Criteria (Summary)

- A direct Data API call with a real user token and no `x-app-key` returns 403 in production; with the key, 200
- The app works end to end in production after both deploys
- CI runs only `ci` and `smoke`, with smoke proving the gate and the types drift check
