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

## Status as of this plan

Steps 1–5 (automated) are implemented on branch `chore/cloudflare-deploy-setup`, not yet merged. Steps 1–11 (manual) have **not** been performed yet — no Cloudflare/Supabase account is wired up, no secrets exist, no Worker has been deployed. This file will need a follow-up entry once the first live deploy actually happens (deployed URL, deploy timestamp, Worker name).

## Verification (once manual steps are complete)

- `gh run list` — confirm `ci` + `smoke` + `deploy` jobs pass on `main`.
- Visit the deployed Worker URL and exercise the full Supabase auth flow (FR-001) live — `astro dev` runs on Node, not `workerd`, so this is the first real test of that path (see risk register in `infrastructure.md`).
- `npx wrangler tail` briefly after first real traffic — watch for `1015` (CPU-cap) errors, a known risk for Astro SSR on the free tier per `infrastructure.md`'s risk register.

## Out of scope

Multi-region HA, Docker, and anything beyond first MVP deploy — per `infrastructure.md`'s own scope boundary.
