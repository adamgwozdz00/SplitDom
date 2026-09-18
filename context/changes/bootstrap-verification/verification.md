---
bootstrapped_at: 2026-09-19T00:09:00Z
starter_id: next
starter_name: Next.js
project_name: splitdom
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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
```

### Why this stack

SplitDom is a solo, after-hours, 3-week MVP for splitting household expenses, with must-have auth (FR-001) and automatic month-end period closing (FR-005). The registry's default for (web-app, js) is the 10x Astro Starter on Cloudflare's edge runtime, but its edge constraints on long-running tasks don't fit FR-005's scheduled closing cleanly, so the pick moved to Next.js instead of adding manual workarounds to the default. Next.js clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented) and carries a verified bootstrapper confidence, so scaffolding should be smooth. It deploys to Vercel by default, whose built-in Cron Jobs cover the scheduled period-closing need without standing up a separate server — a good match for a solo, short-timeline build. Payments and realtime are out of scope per the PRD's Non-Goals and nice-to-have priorities. CI runs on GitHub Actions with auto-deploy-on-merge, the standard solo-team default. The self-check came back clean on four of five points; only "can judge agent consistency with Next.js conventions" was marked not-yet-true, which is a single gap and didn't trigger a switch-back nudge.

## Pre-scaffold verification

| Signal      | Value                                          | Severity | Notes                                                        |
| ----------- | ----------------------------------------------- | -------- | ------------------------------------------------------------- |
| npm package | create-next-app v16.3.5 published 2026-09-17    | fresh    | resolved from cmd_template (`npx create-next-app@latest`)     |
| GitHub repo | not run                                         | n/a      | card `docs_url` (`https://nextjs.org/docs`) is not a GitHub repo URL |

## Scaffold log

**Resolved invocation**: `npx create-next-app@latest bootstrap-scaffold-tmp --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 13 top-level entries (`.next`, `AGENTS.md`, `README.md`, `eslint.config.mjs`, `next-env.d.ts`, `next.config.ts`, `node_modules`, `package-lock.json`, `package.json`, `postcss.config.mjs`, `public`, `src`, `tsconfig.json`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (existing `CLAUDE.md` in cwd won)
**.gitignore handling**: append-merged (cwd's single `.DS_Store` line kept first, then the scaffold's lines de-duped and appended under a `# from next` separator)
**.bootstrap-scaffold cleanup**: deleted (temp dir was `bootstrap-scaffold-tmp`, not `.bootstrap-scaffold` — see note below)

**Note on temp directory naming**: the first attempt at this run used the standard `.bootstrap-scaffold` temp name and failed — `create-next-app` validates the target directory name as an npm package name and refuses any name starting with a period ("name cannot start with a period"). That attempt exited non-zero before writing any files (no cleanup was needed). This run's successful invocation substituted a dot-free temp name, `bootstrap-scaffold-tmp`, at the user's explicit direction for this session; the skill's own convention (`.bootstrap-scaffold`) is incompatible with `create-next-app` and needs a fix upstream in `references/scaffold-merge.md` (flagged separately for a skill-authoring fix).

**Additional note**: the local shell's default Node.js (`v19.9.0`) is below `create-next-app@16.3.5`'s engine requirement (`>=20.9.0`). The user had `nvm` available and switched to `nvm use --lts` (resolved to `v24.21.0`) before the successful retry.

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: not distinguished by this tool run (no findings to split)
**Dependency counts**: 17 prod, 384 dev, 88 optional, 438 total

No findings in any severity tier.

## Hints recorded but not acted on

| Hint                     | Value            |
| ------------------------ | ----------------- |
| bootstrapper_confidence  | verified           |
| quality_override         | false              |
| path_taken               | custom             |
| self_check_answers       | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: false |
| team_size                | solo               |
| deployment_target        | vercel             |
| ci_provider               | github-actions     |
| ci_default_flow          | auto-deploy-on-merge |
| has_auth                 | true               |
| has_payments             | false              |
| has_realtime             | false              |
| has_ai                   | false              |
| has_background_jobs      | true               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history. (This project already has a `.git/` at cwd from before this run.)
- Review `CLAUDE.md.scaffold` and decide whether to fold anything from the starter's version into your existing `CLAUDE.md`.
- The scaffolded `AGENTS.md` contains text addressed directly at AI coding agents (generated by Next.js's own `--agents-md` step, not by this skill or by you) — review it yourself before treating it as instructions; it was not acted on during this run.
- Address audit findings per your project's risk tolerance — none were found in this run.
- Report the `.bootstrap-scaffold` naming-convention bug (leading-dot temp directory name clashes with `create-next-app`'s npm-name validation) to whoever maintains this skill; a fix was already suggested for `references/scaffold-merge.md` and related files.
