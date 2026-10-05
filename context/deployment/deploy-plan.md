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
- **Gates**: `deploy` needs `ci` (lint, unit tests, type check, build) and `smoke`. `smoke` starts local Supabase with the CLI from `devDependencies`, applies all migrations, fails if `src/db/database.types.ts` differs from `npm run db:types` output, then runs the smoke test against the production preview.
- **Secrets** (GitHub Actions only, used only by `deploy`, which runs only on push to `main`; never given to the Worker or to PR jobs):
  - `SUPABASE_ACCESS_TOKEN` — Supabase access token for `supabase link`. A scoped token needs exactly: **Project Settings: Read** (`project_admin_read`), **API Keys: Read** + **API Key Secrets: Read** (`api_gateway_keys_read`, `api_gateway_keys_secret_read` — `link` calls `GET …/api-keys?reveal=true` and fails without them), and **Connection Pooling: Read** (`database_pooling_config_read`). Everything else can be None; `db push` itself talks to Postgres with the password, not to the Management API.
  - `SUPABASE_DB_PASSWORD` — hosted database password
  - `SUPABASE_PROJECT_ID` — `rpbroqavksbvezskqhlz`
- **IPv4 pooler (first-deploy finding, 2026-09-27)**: GitHub runners have no IPv6 and `db.<ref>.supabase.co` resolves only to IPv6, so `db push` must go through the session pooler (`aws-1-eu-west-1.pooler.supabase.com:5432`). `supabase link` writes that URL to `supabase/.temp/pooler-url`, but it swallows errors from the pooler API — with a token lacking **Connection Pooling: Read** the file is silently missing and `db push` fails with `IPv6 is not supported on your current network`. A 403 on `…/api-keys` (missing **API Key Secrets: Read**) fails `link` with `Authorization failed for the access token and project ref pair`. In both cases the deploy stopped before `wrangler deploy`, as designed.
- **Rollback policy — forward-only**: `wrangler rollback` reverts the Worker, not the database. Never edit a pushed migration; fix mistakes with a new corrective migration, and keep each migration compatible with the previously deployed Worker (expand before contract). There are no down migrations.
- **`private` schema convention**: the baseline migration creates schema `private` (not in `api.schemas`, so invisible to PostgREST; `usage` granted to `authenticated` only). `security definer` helpers used in RLS policies belong there.
- The Worker keeps using only `SUPABASE_URL` + the anon `SUPABASE_KEY`; it never gets DDL or service-role credentials.

## Google sign-in (added 2026-09-28, change `external-identity-sign-in`, S-01)

Google is the must-have sign-in path (FR-001); email/password (FR-013) stays next to it. `POST /api/auth/google` calls `signInWithOAuth`, which makes no network call on the Worker: it only builds Supabase's authorize URL and sets the PKCE code-verifier cookie. The OAuth return goes through the same `/auth/callback` as email confirmation.

- **Google Cloud project**: a dedicated project for SplitDom holds the consent screen and the OAuth client.
- **OAuth consent screen**: user type **External**, app name "SplitDom", publishing status **In production**, so any Google account can sign in. Only non-sensitive scopes (`openid`, `email`, `profile`), so no Google verification is needed. Publishing still requires a homepage URL and a privacy policy URL: homepage `https://10x-astro-starter.adamgwozdz.workers.dev`, privacy policy `https://10x-astro-starter.adamgwozdz.workers.dev/privacy` (the public `src/pages/privacy.astro`). Authorized domains: `rpbroqavksbvezskqhlz.supabase.co` (the OAuth callback host) and the `workers.dev` domain of the homepage and privacy links.
- **OAuth client**: type "Web application", one client for both Supabase instances, with authorized redirect URIs:
  - `https://rpbroqavksbvezskqhlz.supabase.co/auth/v1/callback` (hosted)
  - `http://127.0.0.1:54321/auth/v1/callback` (local Supabase)
- **Hosted provider, enabled by hand in the Dashboard**: Supabase Dashboard → project `rpbroqavksbvezskqhlz` → Authentication → Sign In / Providers → Google: enabled, client id and secret from the OAuth client above, "Skip nonce check" off. URL Configuration is unchanged (`site_url` and `https://10x-astro-starter.adamgwozdz.workers.dev/**` already cover `/auth/callback`). This is not done with `supabase config push`, because that would also push the local `site_url` and redirect allow-list from `supabase/config.toml` over the hosted ones (see "Post-deploy findings" 1). CI still pushes only migrations. The provider must be enabled before the Google button reaches production; otherwise the button leads to "Unsupported provider: provider is not enabled".
- **Local setup**: `supabase/config.toml` has an `[auth.external.google]` block (`skip_nonce_check = true`, required for local Google sign-in) whose `client_id` / `secret` read `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` / `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`. Copy `supabase/.env.example` to `supabase/.env` (gitignored), fill both values and restart local Supabase; the CLI auto-loads `supabase/.env`. With the variables unset the CLI only prints `WARN: environment variable is unset` and starts anyway with Google unusable, so CI (`smoke`) needs no Google secrets; the smoke test only asserts the redirect to Supabase's authorize URL and never contacts Google. `additional_redirect_urls` lists `http://localhost:4321/**` and `http://127.0.0.1:4321/**`, so the OAuth return reaches the dev server on the origin that holds the PKCE cookie.
- **Secrets**: the Google client id and secret live only in the hosted Supabase Dashboard and in local `supabase/.env`. The Worker never sees them (it keeps only `SUPABASE_URL` + `SUPABASE_KEY`), and there are no Google GitHub Actions secrets.
- **Automatic same-email linking** (Supabase behaviour, not app code; `enable_manual_linking` stays `false`): signing in with Google using the address of an existing email/password account ends in the **same** Supabase user, so data keyed by user id is not split.
  - **Confirmed** email/password account: the Google identity is added and the password keeps working.
  - **Unconfirmed** email/password account (only possible in production, where email confirmation is on): Supabase removes the unconfirmed password identity (protection against pre-account takeover), confirms the user through Google's verified email and signs them in; the old password stops working. Google is therefore the recovery path for the cross-device PKCE email-confirmation limitation described in "Post-deploy findings" 3.
- **Cancelled consent**: Google returns only `error=access_denied`, which Supabase forwards as `/auth/callback?error=access_denied&error_description=` (empty description). `/auth/callback` turns it into `/auth/signin?error=Sign-in was cancelled`; the smoke test covers it.
- **Landing page**: both Google and email/password sign-in land on `/dashboard` (email/password used to land on `/`).

## Settlement groups (added 2026-10-02, change `create-settlement-group`, S-02)

The migration `settlement_groups` adds `groups`, `group_members` and `billing_periods`. The tables have RLS on with no policies and no `anon`/`authenticated` grants. Signed-in users reach them only through the `security definer` persistence functions `create_group`, `list_my_groups` and `get_my_group`. The migration only adds objects, so it is compatible with the previously deployed Worker.

Known constraints on deleting a user (accepted for now, revisit before any account-deletion or GDPR flow):

- **A host cannot be deleted.** `groups.host_id` references `auth.users` without cascade, because a group's host never changes. Deleting a user who hosts a group (Dashboard or `auth.admin.deleteUser`) fails with a foreign-key error, which GoTrue reports as "Database error deleting user".
- **A member's membership disappears silently.** `group_members.user_id` cascades, so deleting a non-host member removes them from the group outside the `Group` aggregate. This is harmless while groups hold no expenses. Revisit it in S-04, once expenses and balances reference members.

## Member invites (added 2026-10-05, change `invite-member-by-link`, S-03)

The migration `group_invites` adds one table (RLS on, no policies, no `anon`/`authenticated` grants) and the `security definer` functions `create_group_invite`, `get_group_invite` and `redeem_group_invite`. It only adds objects, so it is compatible with the previously deployed Worker. Invites need **no Supabase or Cloudflare configuration change**: no new secret, no redirect allow-list entry, and `redirectTo` / `emailRedirectTo` are unchanged. The invite to return to after sign-in travels in the `sd_pending_invite` cookie (`SameSite=Lax`, 24 h), which survives the top-level GET back from Google and from the confirmation email.

Known limitation (accepted, same cause as "Post-deploy findings" 3): confirming the sign-up email in a different browser or device than the one that opened the invite link also loses the pending invite, because the cookie lives in the first browser. The invitee then opens the link again after signing in. Google sign-in remains the cross-device path.

## Out of scope

Multi-region HA, Docker, and anything beyond first MVP deploy — per `infrastructure.md`'s own scope boundary.
