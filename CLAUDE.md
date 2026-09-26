# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: SplitDom

An Astro web app for splitting shared household expenses among roommates/partners: track expenses, compute per-member balances, generate payment info between debtors and creditors, and let the group's host manually close monthly settlement periods. See `context/foundation/prd.md` (Polish) for functional requirements and user stories, and `context/foundation/tech-stack.md` for the stack rationale — the 10x Astro Starter (Astro + Supabase + Cloudflare) was chosen once period closing (FR-015) became a manual host action, removing the earlier need for scheduled jobs that had pushed the stack to Next.js/Vercel.

**Status**: bootstrapped from the 10x Astro Starter and deployed to Cloudflare Workers (https://10x-astro-starter.adamgwozdz.workers.dev), auto-deployed on every merge to `main`. Only auth exists so far: email + password sign-up/sign-in with a PKCE email-confirmation callback and `/dashboard` route protection. Groups, expenses, balances, settlement and period closing are still to be built — see `context/foundation/roadmap.md` for the milestone, slice order and the next change to plan.

### Commands

Run `nvm use` first — Node is pinned to 22.14.0 in `.nvmrc` (wrangler needs Node ≥ 22; the system default is older).

- `npm run dev` — start the dev server (http://localhost:4321)
- `npm run build` — production build (Cloudflare adapter)
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint (flat config: astro, react, jsx-a11y, typescript-eslint, prettier)
- `npm run format` — Prettier
- `npx astro check` — type check (runs in CI)
- `npm run smoke` — end-to-end smoke test of the auth flow against a running server (`BASE_URL`, default http://localhost:4321)
- `npx supabase start` / `npx supabase stop` — local Supabase (needed by `dev` and `smoke`)

No unit test runner is configured yet. A husky pre-commit hook runs lint-staged (eslint --fix / prettier).

### Structure

- `src/pages/` — Astro routes; `src/pages/api/` — API endpoints (currently only `api/auth/*`); `src/pages/auth/callback.ts` — PKCE code exchange
- `src/components/` — Astro and React components (`ui/` is shadcn/ui, `auth/` holds the auth forms)
- `src/lib/supabase.ts` — server-side Supabase client; `src/middleware.ts` — sets `locals.user` and guards protected routes
- `supabase/config.toml` — local Supabase config; no migrations exist yet
- `wrangler.jsonc` — Cloudflare Workers config; `.github/workflows/ci.yml` — `ci` + `smoke` + `deploy` jobs
- `@/*` path alias resolves to `src/*`
- `context/foundation/` — `prd.md` (source of truth for FR-xxx / US-xx), `tech-stack.md`, `infrastructure.md`, `roadmap.md`
- `context/deployment/deploy-plan.md` — what is deployed, which secrets are wired, and known auth limitations
- `context/changes/` — per-change folders

### Code Conventions

- **Error format** — errors are shaped `{ error: { code, message, context } }`, never `{ error: string }`.
- **File naming** — feature files are named `feature.handler.ts` (dot-suffixed by role), not `featureHandler.ts`.
- **Imports** — use absolute imports via `@/...`; relative parent-traversal imports (`../../...`) are not allowed.
- **Module structure** — every module has its own `index.ts`, `types.ts`, and `__tests__/` directory.
- **Dates** — always UTC, always through the `formatDate()` helper; do not call `new Date().toISOString()` ad hoc.

### Notes

- Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`) live in GitHub Actions secrets and Cloudflare Worker secrets; local values go in `.env` / `.dev.vars` (both gitignored).
- Known accepted limitation: confirming the sign-up email in a different browser/device than the one used to sign up fails (PKCE code verifier missing) — see `context/deployment/deploy-plan.md`.
- `package.json`'s `name` is still the starter placeholder `10x-astro-starter`, not `splitdom`.

### Public roadmap on GitHub

`context/foundation/roadmap.md` is mirrored as GitHub issues (one per F-NN / S-NN, labels `slice` / `foundation` / `north-star`, a GitHub milestone per roadmap milestone, native "blocked by" links) and on the public project board [SplitDom Roadmap](https://github.com/users/adamgwozdz00/projects/6) (fields Status, Roadmap ID, Stream). The board does not sync with the file, so keep them aligned on every change:

- Starting an item → board Status `In progress`, same status in `roadmap.md`.
- PR delivering an item → `Closes #N` in the PR body, linking it to the roadmap issue.
- After merge → board Status `Done` and `roadmap.md` updated; move downstream items whose prerequisites are all done from `Proposed` to `Ready` in both places.
- Roadmap decisions that block/unblock an item, or new slices/milestones → update or create the matching issues, dependencies and board items.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
