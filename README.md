# SplitDom

A web app for splitting shared household expenses among roommates and partners: track expenses, see per-member balances, get payment info between debtors and creditors, and let the group's host close monthly settlement periods.

**Live:** https://10x-astro-starter.adamgwozdz.workers.dev (auto-deployed on every merge to `main`)

**Status:** only authentication exists so far — email + password sign-up/sign-in, email confirmation via a PKCE callback, and a protected `/dashboard`. Groups, expenses, balances, settlement and period closing are still to be built. See the [roadmap](context/foundation/roadmap.md) and the public [SplitDom Roadmap](https://github.com/users/adamgwozdz00/projects/6) board.

## Tech Stack

Bootstrapped from the [10x Astro Starter](https://github.com/przeprogramowani/10x-astro-starter).

- [Astro](https://astro.build/) v7 — server-first rendering and API endpoints
- [React](https://react.dev/) v19 — interactive components
- [TypeScript](https://www.typescriptlang.org/) v6
- [Tailwind CSS](https://tailwindcss.com/) v4 + [shadcn/ui](https://ui.shadcn.com/)
- [Supabase](https://supabase.com/) — auth and Postgres
- [Cloudflare Workers](https://workers.cloudflare.com/) — hosting

Why this stack: [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md).

## Prerequisites

- Node.js 22.14.0 (pinned in `.nvmrc`; wrangler needs Node ≥ 22) — run `nvm use`
- npm
- [Docker](https://www.docker.com/) for the local Supabase stack

## Getting Started

1. Install dependencies:

```bash
nvm use
npm install
```

2. Start the local Supabase stack (config lives in `supabase/config.toml`):

```bash
npx supabase start
```

3. Create `.env` (Astro) and `.dev.vars` (Cloudflare runtime) and fill both with the URL and anon key printed by `supabase start`:

```bash
cp .env.example .env
cp .env.example .dev.vars
```

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

4. Run the dev server at http://localhost:4321:

```bash
npm run dev
```

Local Supabase has email confirmation disabled, so you can sign in right after signing up. Supabase Studio runs at http://localhost:54323. Stop the stack with `npx supabase stop`.

## Available Scripts

- `npm run dev` — start the dev server (http://localhost:4321)
- `npm run build` — production build (Cloudflare adapter)
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` — Prettier
- `npx astro check` — type check
- `npm run smoke` — end-to-end smoke test of the auth flow against a running server (`BASE_URL`, default `http://localhost:4321`)

A husky pre-commit hook runs lint-staged (eslint --fix / prettier). No unit test runner is configured yet.

## Project Structure

```md
.
├── src/
│ ├── pages/ # Astro routes
│ │ ├── api/auth/ # sign-up, sign-in, sign-out endpoints
│ │ └── auth/ # auth pages + PKCE callback (callback.ts)
│ ├── components/ # Astro & React components (ui/ = shadcn/ui, auth/ = auth forms)
│ ├── layouts/ # Astro layouts
│ ├── lib/ # server-side Supabase client and helpers
│ └── middleware.ts # sets locals.user and guards protected routes
├── supabase/ # local Supabase config
├── scripts/smoke.mjs # auth-flow smoke test
├── context/ # product docs (PRD, roadmap, tech stack, deploy plan) and per-change folders
└── wrangler.jsonc # Cloudflare Workers config
```

## Auth Routes

| Route                 | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `/auth/signup`        | Email/password sign-up form                                  |
| `/auth/signin`        | Email/password sign-in form                                  |
| `/auth/confirm-email` | Post-signup "check your inbox" page                          |
| `/auth/callback`      | Exchanges the email-confirmation code for a session (PKCE)   |
| `/dashboard`          | Protected page (redirects to `/auth/signin` when signed out) |

Protected paths are listed in `PROTECTED_ROUTES` in `src/middleware.ts`.

Known limitation: confirming the sign-up email in a different browser or device than the one used to sign up fails (missing PKCE code verifier) — accepted for the MVP, see [`context/deployment/deploy-plan.md`](context/deployment/deploy-plan.md).

## CI and Deployment

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`:

- **ci** — lint, `astro check` and build
- **smoke** — starts a local Supabase, serves the production preview on the Cloudflare runtime and runs `npm run smoke`
- **deploy** — on push to `main` only, after `ci` and `smoke` pass: builds and deploys to Cloudflare Workers with wrangler

Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) live in GitHub Actions secrets; `SUPABASE_URL` and `SUPABASE_KEY` are also set as Cloudflare Worker secrets. Details in [`context/deployment/deploy-plan.md`](context/deployment/deploy-plan.md).
