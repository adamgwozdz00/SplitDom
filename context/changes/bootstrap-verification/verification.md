---
bootstrapped_at: 2026-09-20T19:39:57Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: splitdom
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: splitdom
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack**: SplitDom is a solo, after-hours, 3-week MVP for splitting household expenses, with must-have auth (FR-001) and no background-job requirement — the closing of a billing period (FR-015) is now a manual action taken by the group's creator, not a scheduled task, after the earlier automatic month-end closing (which had forced Next.js/Vercel to get Cron Jobs) was replaced. With that constraint gone, the registry's default for `(web-app, js)` — the 10x Astro Starter (Astro + Supabase + Cloudflare) — is back in play and was accepted as the standard-path recommendation. It clears all four agent-friendly gates (typed, convention-based, popular in training, well-documented), carries `first-class` bootstrapper confidence, and bundles auth + Postgres + edge deploy out of the box, which fits a short solo timeline better than assembling those pieces separately. Its one historical gotcha — the edge runtime's poor fit for long-running background tasks — no longer applies, since nothing in the MVP needs a scheduled job. Deployment targets Cloudflare Pages (the starter's own default). CI runs on GitHub Actions with auto-deploy-on-merge. Payments, realtime, and AI are out of scope per the PRD's Non-Goals and nice-to-have priorities. This choice replaces the prior Next.js/Vercel pick and required a fresh bootstrap.

## Pre-scaffold verification

| Signal      | Value                                          | Severity | Notes                                                     |
| ----------- | ----------------------------------------------- | -------- | ---------------------------------------------------------- |
| npm package | not run                                        | n/a      | `cmd_template` starts with `git clone`; npm-package recency check does not apply |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12T21:16:08Z | fresh    | from card `docs_url`, via GitHub REST API (`gh` CLI unavailable in this environment, used `curl` fallback) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 18 moved silently (`.env.example`, `.github`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `scripts`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `AGENTS.md.scaffold`, `CLAUDE.md.scaffold`, `README.md.scaffold`
**.gitignore handling**: append-merged (cwd lines kept first, scaffold lines de-duped and appended under a `# from 10x-astro-starter` separator)
**.bootstrap-scaffold cleanup**: deleted

**Notes**:
- Before this run, the prior Next.js scaffold (`package.json`, `src/`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `public/`, `node_modules/`, `.next/`) was deliberately removed by the user's explicit request, to avoid a large pile of `.scaffold` siblings from a starter swap. This is why most scaffold files landed as silent moves rather than conflicts. Fully recoverable via git history (commit `286e55e`).
- A pre-existing `CLAUDE.md.scaffold` (an 11-byte stub `@AGENTS.md` left over from the original Next.js bootstrap) was preserved by renaming it to `CLAUDE.md.scaffold.next-bootstrap` before this run's `CLAUDE.md.scaffold` landed, so no prior content was lost.
- `npm install` completed with exit code 0, but emitted many `EBADENGINE` warnings: the starter's dependencies (Astro 7, ESLint 10, several `@typescript-eslint` packages, etc.) require Node `>=20` or `>=22`, while this environment runs Node `v19.9.0`. Nothing failed, but expect friction until Node is upgraded (the starter's own `.nvmrc` pins `22.14.0`).

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: not applicable — 0 findings total (804 dependencies audited: 377 prod, 269 dev, 167 optional)

Audit: 0 findings across CRITICAL, HIGH, MODERATE, and LOW. Clean tree.

## Hints recorded but not acted on

| Hint                     | Value        |
| ------------------------ | ------------ |
| bootstrapper_confidence  | first-class  |
| quality_override         | false        |
| path_taken               | standard     |
| self_check_answers       | null         |
| team_size                | solo         |
| deployment_target        | cloudflare-pages |
| ci_provider              | github-actions |
| ci_default_flow          | auto-deploy-on-merge |
| has_auth                 | true         |
| has_payments             | false        |
| has_realtime             | false        |
| has_ai                   | false        |
| has_background_jobs      | false        |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Upgrade local Node to `22.14.0` (see `.nvmrc`) — `npm install` succeeded on Node `19.9.0` but with many `EBADENGINE` warnings; some tooling (lint, build) may misbehave until Node is upgraded.
- Review the `.scaffold` siblings this run created (`AGENTS.md.scaffold`, `CLAUDE.md.scaffold`, `README.md.scaffold`) and decide which version of each file to keep — the prior Next.js-era `CLAUDE.md` and `AGENTS.md` are almost certainly stale now (they describe a Next.js project) and the starter's own `CLAUDE.md.scaffold` / `AGENTS.md.scaffold` are the ones that actually match the scaffolded code.
- Set up Supabase (`npx supabase start`, requires Docker) and copy `.env.example` to `.env` before running `npm run dev`.
- `git add` the new files and commit the bootstrap swap — the working tree currently has the Next.js removal and the Astro scaffold as uncommitted changes.
