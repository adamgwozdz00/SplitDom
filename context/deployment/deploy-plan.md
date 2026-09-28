---
project: splitdom
planned_at: 2026-09-20
platform: cloudflare-workers
source_infrastructure: context/foundation/infrastructure.md
source_tech_stack: context/foundation/tech-stack.md
---

# SplitDom — Deploy Plan (Cloudflare Workers)

Audit trail for the first production deployment, produced in Plan Mode and approved by the project owner. Downstream milestone-planning skills should treat this file as ground truth for "what's already deployed and which secrets are already wired."

## Decision basis

- Platform: Cloudflare Workers, per `context/foundation/infrastructure.md` (recommended over Vercel runner-up).
- Stack: Astro + TypeScript + Supabase (external), per `context/foundation/tech-stack.md`.
- CI/CD: GitHub Actions, `auto-deploy-on-merge` to `main`, per `tech-stack.md` hints.

## Verified pre-deploy state (2026-09-20)

- Astro app already bootstrapped (`astro.config.mjs`, `src/pages/`, `@astrojs/cloudflare` adapter, `wrangler.jsonc` present and correctly configured with `nodejs_compat`).
- GitHub remote: `https://github.com/adamgwozdz00/SplitDom` (public, default branch `main`).
- **Bug found**: `.github/workflows/ci.yml` triggered on `branches: [master]` — never matched the actual `main` default branch, so CI had never run. Fixed in this change.
- **Gap found**: no `deploy` job existed in CI (build/lint/smoke only, no `wrangler deploy`). Added in this change.
- **Gap found**: no GitHub Actions secrets configured (`gh secret list` was empty) — `SUPABASE_URL`/`SUPABASE_KEY` referenced by the build step didn't exist yet, nor did `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`.
- **Gap found**: `.env` / `supabase/config.toml` only pointed to a local Supabase instance (`127.0.0.1:54321`) — no real hosted Supabase project existed yet.
- Local machine: no prior `wrangler`/`supabase` CLI auth (no `~/.wrangler`, no `CLOUDFLARE_*`/`SUPABASE_*` env vars). Node pinned via `.nvmrc` (`22.14.0`), satisfying wrangler's Node ≥22 requirement (system default was v19.9.0 — must `nvm use` before running wrangler locally).

## Automated steps (done in this change, branch `chore/cloudflare-deploy-setup`)

1. Fixed `.github/workflows/ci.yml` trigger branches `master` → `main`.
2. Added a `deploy` job to `ci.yml`: runs on `push` to `main` only, gated on `needs: [ci, smoke]`, builds with `SUPABASE_URL`/`SUPABASE_KEY` from secrets, deploys via `cloudflare/wrangler-action@v3` using `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets.
3. Created local `.dev.vars` (gitignored, not committed) from the existing local-Supabase `.env` values, for `wrangler dev`.
4. Left `.nvmrc` (pre-existing, `22.14.0`) and `wrangler.jsonc` untouched (an unrelated formatting-only diff on `wrangler.jsonc` was reverted, not part of this change).
5. Opened PR `chore/cloudflare-deploy-setup` → `main` for review.

## Manual steps (project owner, outside this session — interactive OAuth/dashboard, cannot be scripted by the agent)

1. `nvm use 22` locally before running any `wrangler`/`supabase` command.
2. `npx wrangler login` (Cloudflare OAuth).
3. Create a scoped Cloudflare API token (Workers Scripts: Edit, scoped to this account only — no DNS, no billing) for CI use.
4. Get the Cloudflare Account ID (`npx wrangler whoami`).
5. `npx supabase login` (Supabase OAuth).
6. Create or link a real hosted Supabase project (`npx supabase projects create` / dashboard, then `npx supabase link --project-ref <ref>`).
7. Get the real `SUPABASE_URL` / anon `SUPABASE_KEY` for that hosted project.
8. Set GitHub Actions secrets: `gh secret set CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.
9. First manual production deploy: `npm run build && npx wrangler deploy` (creates the Worker).
10. Set production Worker secrets: `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY`.
11. Merge the PR — every subsequent merge to `main` auto-builds and auto-deploys via the `deploy` job.

## Status: DEPLOYED (updated 2026-09-21)

All automated and manual steps above are complete:

- Steps 1–5 (automated) merged via [PR #1](https://github.com/adamgwozdz00/SplitDom/pull/1).
- Steps 1–11 (manual) all performed: Cloudflare + Supabase CLI auth done, scoped API token created, real Supabase project linked (`rpbroqavksbvezskqhlz`, region `eu-west-1`), all 4 GitHub secrets set (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`), first manual `wrangler deploy` done, production Worker secrets set, PR merged.
- **Live URL**: https://10x-astro-starter.adamgwozdz.workers.dev
- Every merge to `main` now auto-builds and auto-deploys via the `deploy` job (verified working across [PR #2](https://github.com/adamgwozdz00/SplitDom/pull/2) and [PR #3](https://github.com/adamgwozdz00/SplitDom/pull/3)).

### Post-deploy findings (from live end-to-end testing, not caught by CI)

1. **Supabase Auth Site URL was still the platform default `http://localhost:3000`** — never customized for production, so email-confirmation links redirected to a dead localhost with `otp_expired`/`access_denied`. Fixed manually in Supabase Dashboard → Authentication → URL Configuration: `site_url` → `https://10x-astro-starter.adamgwozdz.workers.dev`, `additional_redirect_urls` → `https://10x-astro-starter.adamgwozdz.workers.dev/**`. Not something `wrangler`/CI could have caught — it's a Supabase-side project setting, invisible to the deploy pipeline. Companion fix: `supabase/config.toml`'s local `site_url` was also wrong (port 3000 instead of Astro's actual dev port 4321) — fixed in PR #2.
2. **No app code handled the post-confirmation redirect** — `src/pages/index.astro` was still the unmodified Astro starter placeholder; the `?code=`/`?error=` params from Supabase's verify endpoint were never read, so users landed "Not signed in" even after a valid confirmation. Fixed in PR #3: new `src/pages/auth/callback.ts` calls `exchangeCodeForSession`, `signup.ts` now passes `emailRedirectTo`.
3. **Known limitation, accepted as-is (decision below)**: Supabase's default email-confirmation flow uses PKCE, which requires the `code_verifier` (stored in a cookie set during `signUp`) to be present in the browser that opens the confirmation link. If a user signs up in one browser/device and opens the confirmation email in another (a very plausible pattern for a household-expense app — phone Gmail app vs. desktop browser), `exchangeCodeForSession` fails with "PKCE code verifier not found in storage". Verified via a same-cookie-jar `curl` reproduction against local Supabase (signup → confirmation email → verify → `/auth/callback?code=`, all with one cookie jar): the full chain returns `302` to `/dashboard` with a valid session when the cookie is present, confirming `/auth/callback`'s `exchangeCodeForSession` logic itself is correct and the failure is specifically the cross-browser/cross-device case. This is a product/UX decision (PKCE vs. implicit flow for email confirmations, or an explicit "resend/re-request" recovery path), not a deploy-pipeline or app-logic defect.

**Decision (2026-09-21, project owner)**: keep PKCE as-is for MVP. Accepted trade-off: users who confirm their email on a different browser/device than the one they signed up on will hit "PKCE code verifier not found in storage" and need to sign up again (or a future recovery flow). Revisit if this turns out to affect real users in practice.

## Verification (performed)

- `gh run list` — `ci` + `smoke` + `deploy` all pass on `main` (confirmed across the initial deploy and both follow-up PRs).
- Full Supabase signup flow exercised live (FR-001): registration → confirmation email → verify → (after fixes above) landing on `/dashboard` in the same-browser case. Cross-browser PKCE case still fails as described above.
- No `1015` (CPU-cap) errors observed during testing.

## Database migrations in the deploy (added 2026-09-27, change `db-migrations-and-isolation`, F-01)

Schema changes live in `supabase/migrations/` as Supabase CLI migrations and reach the hosted project `rpbroqavksbvezskqhlz` only through CI:

- **Order in the `deploy` job**: `npm ci` → `npx supabase link --project-ref $SUPABASE_PROJECT_ID` → `npx supabase db push --yes` → `npm run build` → `wrangler deploy`. If the push fails, the job stops before the Worker is deployed, so the previous Worker keeps running against the unchanged schema.
- **Concurrency**: `deploy` runs in the `deploy-production` concurrency group (`cancel-in-progress: false`), so two quick merges push migrations one after the other, never in parallel.
- **Gates**: `deploy` needs `ci` (lint, unit tests, type check, build), `smoke`, and `db-test`. `db-test` starts local Supabase with the CLI from `devDependencies`, applies all migrations, runs `npm run test:db` (two-user harness + RLS guard), and fails if `src/db/database.types.ts` differs from `npm run db:types` output.
- **Secrets** (GitHub Actions only, used only by `deploy`, which runs only on push to `main`; never given to the Worker or to PR jobs):
  - `SUPABASE_ACCESS_TOKEN` — Supabase access token for `supabase link`. A scoped token needs exactly: **Project Settings: Read** (`project_admin_read`), **API Keys: Read** + **API Key Secrets: Read** (`api_gateway_keys_read`, `api_gateway_keys_secret_read` — `link` calls `GET …/api-keys?reveal=true` and fails without them), and **Connection Pooling: Read** (`database_pooling_config_read`). Everything else can be None; `db push` itself talks to Postgres with the password, not to the Management API.
  - `SUPABASE_DB_PASSWORD` — hosted database password
  - `SUPABASE_PROJECT_ID` — `rpbroqavksbvezskqhlz`
- **IPv4 pooler (first-deploy finding, 2026-09-27)**: GitHub runners have no IPv6 and `db.<ref>.supabase.co` resolves only to IPv6, so `db push` must go through the session pooler (`aws-1-eu-west-1.pooler.supabase.com:5432`). `supabase link` writes that URL to `supabase/.temp/pooler-url`, but it swallows errors from the pooler API — with a token lacking **Connection Pooling: Read** the file is silently missing and `db push` fails with `IPv6 is not supported on your current network`. A 403 on `…/api-keys` (missing **API Key Secrets: Read**) fails `link` with `Authorization failed for the access token and project ref pair`. In both cases the deploy stopped before `wrangler deploy`, as designed.
- **Rollback policy — forward-only**: `wrangler rollback` reverts the Worker, not the database. Never edit a pushed migration; fix mistakes with a new corrective migration, and keep each migration compatible with the previously deployed Worker (expand before contract). There are no down migrations.
- **`private` schema convention**: the baseline migration creates schema `private` (not in `api.schemas`, so invisible to PostgREST; `usage` granted to `authenticated` only). `security definer` helpers used in RLS policies belong there.
- The Worker keeps using only `SUPABASE_URL` + the anon `SUPABASE_KEY`; it never gets DDL or service-role credentials.

## Out of scope

Multi-region HA, Docker, and anything beyond first MVP deploy — per `infrastructure.md`'s own scope boundary.
