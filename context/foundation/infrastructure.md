---
project: splitdom
researched_at: 2026-09-20
recommended_platform: cloudflare
runner_up: vercel
context_type: mvp
tech_stack:
  language: typescript
  framework: astro
  runtime: cloudflare-workers
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only platform researched that clears all five agent-friendly criteria with a plain Pass, and it is also the native, zero-adapter-tax target of the already-bootstrapped 10x Astro Starter (`@astrojs/cloudflare`). This is a revised decision: the prior research round (2026-09-19) recommended Netlify specifically because SplitDom's billing-period closing was an automatic, calendar-scheduled task requiring Scheduled Functions/Cron Jobs, which pushed the pick away from Cloudflare's edge constraints on long-running tasks. That requirement no longer exists — closing a billing period (FR-015) is now a manual action the group's creator performs in the UI — so the platform decision was re-run from scratch rather than patched, and Cloudflare's edge model is no longer a liability.

## Platform Comparison

Scored against the five criteria in `references/agent-friendly-criteria.md`: CLI-first, managed/serverless, agent-readable docs, stable deployment API, MCP/integration. Scale: Pass / Partial / Fail.

**Hard filters**: none applied. SplitDom does not need persistent connections (WebSockets/long-polling) per the developer interview, and all six candidate platforms support the project's stack (Astro 7 SSR via an official or documented adapter, TypeScript, external Supabase). No platform was dropped before scoring.

| Platform | CLI-first | Managed/serverless | Agent-readable docs | Stable deploy API | MCP/integration | Key note |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass | `wrangler` covers deploy/rollback/tail end-to-end; native Astro adapter (no third-party tax) |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | MCP is public beta (as of 2026-09-20); native Astro adapter; Hobby plan's non-commercial ToS clause is a soft risk for a multi-housemate app |
| **Render** | Partial | Pass | Pass | Pass | Pass | No dedicated CLI rollback (dashboard/API only); otherwise clean, predictable flat pricing |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | No dedicated CLI rollback (UI/API only); credit-based pricing (post-Sept-2025) is less predictable than a flat tier; history of adapter breaking changes between minor versions |
| **Railway** | Partial | Pass | Pass | Pass | Partial | Rollback to an arbitrary deployment is dashboard-only; MCP is Railway's own "public testing" label; no free tier; Astro SSR needs manual adapter setup (no auto-detect) |
| **Fly.io** | Partial | Pass | Partial | Pass | Partial | Docs source is HTML, not markdown/MDX (llms.txt exists but is thinner); MCP explicitly marked experimental; no official Astro+Fly starter — you own and maintain the Dockerfile; no free tier since Oct 2024 |

Soft weights from the developer interview: no persistent-connection requirement (no hard filter triggered), cost vs. DX roughly equal priority (doesn't strongly favor or penalize any platform, though it keeps the no-free-tier platforms — Fly.io, Railway — at a real, if minor, disadvantage), no existing platform familiarity (no tie-break bias), single-region traffic (edge-native reach is a non-factor, not a tiebreaker either way), external Supabase acceptable (removes any pressure toward platforms with their own co-located database).

Four platforms (Cloudflare, Vercel, Render, Netlify) score 4-or-5-of-5 Pass; the difference comes down to which single criterion carries a Partial. CLI-first and stable-deploy-API are the two criteria weighted heavily per `agent-friendly-criteria.md`; MCP/integration is explicitly light-weight unless top picks tie on everything else. That weighting is why Vercel (Partial only on the light-weight MCP criterion) outranks Render and Netlify (both Partial on the heavily-weighted CLI-first criterion, specifically missing a CLI rollback subcommand).

### Platforms on the shortlist

#### 1. Cloudflare (Recommended)

Clears every criterion with a plain Pass and is the native deployment target the chosen starter (10x Astro Starter) already ships with — zero adapter tax, `wrangler deploy`/`wrangler rollback`/`wrangler tail` cover the full operational loop, and Cloudflare publishes the best-in-class agent-readable docs of the six platforms researched (`llms.txt` + `llms-full.txt` + per-page markdown, GA). Free tier covers 100k requests/day; realistic cost for SplitDom's SSR workload is $0-5/month (see Risk Register for the CPU-cap caveat). Its historical weakness — edge runtimes being a poor fit for long-running background tasks — is now moot, since FR-015 replaced the scheduled monthly close with a manual user action.

#### 2. Vercel (runner-up)

The most mature, battle-tested option for Astro SSR (native adapter maintained inside the `withastro/astro` monorepo), with GA docs-as-markdown and a deterministic CLI. Its only scoring gap is that Vercel's MCP server is still public beta. The Hobby (free) tier's "no financial gain" clause is a soft, non-scoring risk worth a manual read given SplitDom is shared among housemates, even without direct monetization.

#### 3. Render

Clean, predictable pricing with no credit system (free with cold starts, or $7/month flat for always-on) and a GA, well-documented MCP server. Its one gap is the heavily-weighted CLI-first criterion: rollback is dashboard/API-only, with no dedicated CLI subcommand, unlike Cloudflare's single-command `wrangler rollback`.

## Anti-Bias Cross-Check: Cloudflare

### Devil's Advocate — Weaknesses

1. **CPU-time billing mismatch.** The free tier caps at 10ms CPU per invocation, but Astro SSR routinely burns 10-20ms — meaning the "free" plan is likely to be exceeded by real SSR traffic almost immediately, silently forcing the $5/month Workers Paid plan. This isn't obvious until the app is deployed and starts throwing `1015` (CPU exceeded) errors.
2. **Open, unresolved adapter bug** ([withastro/astro#14540](https://github.com/withastro/astro/issues/14540)): the Cloudflare adapter doesn't reliably pick up `wrangler.jsonc` vars at build time, forcing env vars to be duplicated into `.env.development`/`.env.production`. A solo developer on a 3-week timeline could lose real hours debugging an env var that "works locally but not in prod" before discovering this is a known adapter bug, not a config mistake.
3. **Pages→Workers migration churn.** Cloudflare itself now tells new 2026 projects to target Workers directly rather than Pages. Tutorials, Stack Overflow answers, and AI training data still skew toward the older Pages-centric mental model — a stale-knowledge trap for both the developer and any AI agent assisting on the project.
4. **`nodejs_compat`/CommonJS friction.** Supabase's JS SDK and other auth/utility libraries sometimes ship CommonJS, which needs pre-bundling or the `nodejs_compat` flag to run correctly on the `workerd` runtime — a class of error specific to Workers that won't surface in local `astro dev` testing (which runs on Node, not `workerd`).
5. **No escape hatch.** If Workers' CPU or memory model ever becomes a genuine blocker, there's no "add more resources" lever the way there is on Fly.io/Railway/Render — the fix is migrating adapters, not turning a dial.

### Pre-Mortem — How This Could Fail

SplitDom shipped on Cloudflare Workers in three weeks, and free-tier hosting felt like a win. A month in, the developer added the balance-calculation page with a few Supabase queries per request; SSR routes started intermittently returning `1015` (CPU-exceeded) errors under nothing more than normal single-household usage, because Astro SSR routinely burns 10-20ms of CPU against a 10ms free-tier ceiling nobody had budgeted for. Diagnosing it took a weekend, since the error only appeared in production, never in local `astro dev`. Around the same time, an environment variable added for a new feature worked locally but silently failed in the deployed Worker — the known-but-undocumented-in-tutorials `wrangler.jsonc` pickup bug, costing another evening. By the time both were fixed, the developer had spent more hours debugging Workers-specific runtime quirks than building the custom-split feature the PRD had deferred to nice-to-have. Nobody had mapped "Workers CPU billing model" or "adapter env-var bug" as risks at decision time — both were discoverable in minutes of the same research that produced this document, but weren't weighted because the platform looked obviously right on paper.

### Unknown Unknowns

- `astro dev` runs on Node, not `workerd` — local testing never exercises the real Workers CPU limits, `nodejs_compat` restrictions, or the `wrangler.jsonc` env-var bug. "Works on my machine" is a weaker signal on this stack than usual.
- Cloudflare is actively deprecating "Pages" as the recommended path in favor of "Workers with static assets" for 2026 projects — most existing tutorials and AI training data still skew toward the older Pages-centric mental model.
- CPU time is cumulative across *all* awaited work in a request, including parallel `Promise.all()` calls — a common performance instinct ("parallelize the Supabase queries") does not reduce CPU billing the way it reduces wall-clock time on a traditional server.
- `wrangler rollback` is instant and version-pinned (a genuine strength), but it rolls back the Worker code only, not any Supabase schema/migration state — a bad deploy paired with a bad migration still needs a manual, unautomated database fix. This is a general risk across every platform researched, not Cloudflare-specific, but easy to assume "rollback" means full safety.
- Cloudflare's GA MCP server ecosystem (13+ servers) manages Cloudflare itself (DNS, Workers config, KV) via Claude — it is not an app-level integration for SplitDom's own features. Easy to over-read as more relevant to this project than it actually is.

**Decision**: after reviewing these findings, the risks were judged manageable for MVP scope (a $5/month contingency plan and known workarounds exist for both concrete bugs) and Cloudflare was kept as the recommendation. Risks are carried into the register below rather than triggering a platform swap.

## Operational Story

- **Preview deploys**: Cloudflare Workers Builds, connected to the GitHub repo, generates a preview deployment with its own URL for every push to a non-production branch/PR — no extra configuration beyond connecting the repo (GA).
- **Secrets**: `wrangler secret put <NAME>` stores encrypted secrets (e.g. `SUPABASE_KEY`) in Cloudflare's vault, readable only by the deployed Worker; local dev secrets go in `.dev.vars` (gitignored, already covered by the merged `.gitignore`). Non-secret env vars live in `wrangler.jsonc`. Rotation = re-run `wrangler secret put` with the new value, then redeploy.
- **Rollback**: `wrangler rollback [deployment-id]` reverts the live Worker to a prior version in seconds — deterministic and scriptable. It does **not** revert Supabase schema/migrations, so a migration-paired deploy needs a separate, manually-verified DB rollback step.
- **Approval**: routine deploys on merge to main can run unattended via GitHub Actions + `wrangler deploy` (matches `tech-stack.md`'s `auto-deploy-on-merge`). Rotating the Supabase service-role key, deleting Cloudflare/Supabase resources, or changing the billing plan remain manual, human-only actions.
- **Logs**: `wrangler tail` streams live logs (note: samples/drops under heavy traffic, per research — a non-issue at SplitDom's scale). Cloudflare's GA MCP servers offer structured, agent-queryable access to deployment and observability data as an alternative to parsing CLI output, though they manage Cloudflare infrastructure, not SplitDom's own application data.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Astro SSR (10-20ms CPU/request) likely exceeds the free tier's 10ms CPU cap, causing `1015` errors under real traffic | Devil's advocate | H | M | Budget for the $5/month Workers Paid plan from day one; monitor CPU time via `wrangler tail`/observability during early testing |
| Open adapter bug: `wrangler.jsonc` env vars not reliably picked up at build time ([astro#14540](https://github.com/withastro/astro/issues/14540)) | Devil's advocate / Research finding | M | M | Duplicate env vars into `.env.development`/`.env.production` per Astro's Cloudflare docs; verify every new env var against a deployed preview, not just local dev |
| Stale tutorials/training data reference the deprecated Cloudflare Pages path instead of Workers | Devil's advocate / Unknown unknowns | M | L | Cross-check any Cloudflare guidance against current `wrangler` docs (`llms.txt`) rather than older Pages-era tutorials; the starter already targets Workers directly |
| `nodejs_compat`/CommonJS friction with Supabase SDK or other auth libraries on the `workerd` runtime | Devil's advocate | M | M | Confirm `nodejs_compat` is enabled (starter default); test the full Supabase auth flow on a deployed preview early, not only in local `astro dev` |
| No resource "dial" if Workers' CPU/memory model becomes a hard blocker for a future feature | Devil's advocate | L | M | Not a near-term MVP concern given no background jobs; revisit only if a future feature needs sustained compute |
| Local `astro dev` runs on Node, not `workerd` — doesn't exercise real Workers constraints | Unknown unknowns | M | M | Test every change touching middleware, env access, or Node APIs on a deployed Cloudflare preview before merging |
| `Promise.all()` parallelization does not reduce cumulative CPU billing the way it reduces wall-clock time | Unknown unknowns | L | L | Keep in mind when optimizing Supabase query patterns; don't assume parallel calls are "free" on CPU billing |
| `wrangler rollback` reverts Worker code only, not Supabase schema/migrations | Unknown unknowns | M | M | Treat DB migrations as a separate, manually-verified rollback step; avoid pairing a schema-breaking migration with a code deploy when avoidable |
| Cloudflare's GA MCP servers manage Cloudflare infrastructure, not SplitDom's own application data | Unknown unknowns | L | L | Don't over-rely on MCP as an app-level integration; treat it as an infra-ops convenience only |

*Likelihood/Impact: L = low, M = medium, H = high.*

## Getting Started

The project is already bootstrapped from the 10x Astro Starter, which ships pre-wired for this exact platform.

1. Confirm `wrangler` is available (`npx wrangler --version` — it's already a starter dependency) and authenticate: `npx wrangler login`.
2. Create or link a Supabase project, then copy `.env.example` to `.env` (Node/local dev) and populate `.dev.vars` (Cloudflare local dev) with `SUPABASE_URL` and `SUPABASE_KEY`, per the starter's own `CLAUDE.md`.
3. Verify `nodejs_compat` is set in `wrangler.jsonc` (starter default) and do an early end-to-end test of the Supabase auth flow (FR-001) on a deployed preview, not only locally — this is the fastest way to catch the `nodejs_compat`/CommonJS and env-var-pickup risks from the register above before they block later work.
4. Connect the GitHub repo to Cloudflare Workers Builds for automatic preview deployments per PR and auto-deploy-on-merge to production (matching `tech-stack.md`'s CI/CD hints).
5. Run `npx wrangler deploy` for the first production deploy, then set the real secrets with `wrangler secret put SUPABASE_KEY` (and any others) rather than relying on `wrangler.jsonc` plain vars for anything sensitive.

## Out of Scope

This research did not cover:
- Docker image configuration
- CI/CD pipeline setup (beyond noting that `tech-stack.md` assumes GitHub Actions with auto-deploy-on-merge)
- Production-scale architecture (multi-region, high availability, disaster recovery)
