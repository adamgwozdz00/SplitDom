---
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
---

## Why this stack

SplitDom is a solo, after-hours, 3-week MVP for splitting household expenses, with must-have auth (FR-001) and no background-job requirement — the closing of a billing period (FR-015) is now a manual action taken by the group's creator, not a scheduled task, after the earlier automatic month-end closing (which had forced Next.js/Vercel to get Cron Jobs) was replaced. With that constraint gone, the registry's default for `(web-app, js)` — the 10x Astro Starter (Astro + Supabase + Cloudflare) — is back in play and was accepted as the standard-path recommendation. It clears all four agent-friendly gates (typed, convention-based, popular in training, well-documented), carries `first-class` bootstrapper confidence, and bundles auth + Postgres + edge deploy out of the box, which fits a short solo timeline better than assembling those pieces separately. Its one historical gotcha — the edge runtime's poor fit for long-running background tasks — no longer applies, since nothing in the MVP needs a scheduled job. Deployment targets Cloudflare Pages (the starter's own default). CI runs on GitHub Actions with auto-deploy-on-merge. Payments, realtime, and AI are out of scope per the PRD's Non-Goals and nice-to-have priorities. This choice replaces the prior Next.js/Vercel pick and requires a fresh bootstrap.
