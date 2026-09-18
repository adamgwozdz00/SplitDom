---
starter_id: next
package_manager: npm
project_name: splitdom
hints:
  language_family: js
  team_size: solo
  deployment_target: vercel
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: false
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

SplitDom is a solo, after-hours, 3-week MVP for splitting household expenses, with must-have auth (FR-001) and automatic month-end period closing (FR-005). The registry's default for (web-app, js) is the 10x Astro Starter on Cloudflare's edge runtime, but its edge constraints on long-running tasks don't fit FR-005's scheduled closing cleanly, so the pick moved to Next.js instead of adding manual workarounds to the default. Next.js clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented) and carries a verified bootstrapper confidence, so scaffolding should be smooth. It deploys to Vercel by default, whose built-in Cron Jobs cover the scheduled period-closing need without standing up a separate server — a good match for a solo, short-timeline build. Payments and realtime are out of scope per the PRD's Non-Goals and nice-to-have priorities. CI runs on GitHub Actions with auto-deploy-on-merge, the standard solo-team default. The self-check came back clean on four of five points; only "can judge agent consistency with Next.js conventions" was marked not-yet-true, which is a single gap and didn't trigger a switch-back nudge.
