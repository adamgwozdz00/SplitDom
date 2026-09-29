# Sign In with Google (S-01) — Plan Brief

> Full plan: `context/changes/external-identity-sign-in/plan.md`

## What & Why

Add "Continue with Google" so a household member can sign in with their Google account and land in SplitDom signed in (FR-001, must-have). Email + password sign-in (FR-013) stays as the alternative. Google sign-in also avoids the accepted cross-device email-confirmation problem, which matters for an app used mostly on phones.

## Starting Point

Auth is Supabase Auth via `@supabase/ssr` with email/password endpoints and a PKCE callback (`src/pages/auth/callback.ts`) that already exchanges a code for a session and redirects to `/dashboard`. No external provider is configured anywhere, and the local redirect allow-list in `supabase/config.toml` does not cover the dev server's `http://localhost:4321` origin.

## Desired End State

Both `/auth/signin` and `/auth/signup` show a Continue with Google button above the unchanged email form. Clicking it goes through Google consent and lands on `/dashboard` signed in, both locally and on production. Cancelling shows an error on the sign-in page. Signing in with Google using an address that already has an email/password account ends in the same user (a confirmed account keeps its password; an unconfirmed one loses it and is confirmed through Google, which makes Google the recovery path for the cross-device email-confirmation limitation). CI stays green without Google secrets, and the smoke test checks the Google redirect.

## Key Decisions Made

| Decision                  | Choice                                                         | Why (1 sentence)                                                                                           | Source            |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- |
| Identity provider         | Google                                                         | FR-001 asks for one provider for the MVP; the owner picked Google.                                         | Roadmap (user)    |
| Email/password sign-in    | Stays, as the alternative                                      | Already built (FR-013) and keeps every dev/test flow working.                                              | Roadmap (user)    |
| Google consent screen     | Published **In production**                                    | Household members invited by link (S-03) must get in without being added as Google test users.            | Plan              |
| Where it is verified      | Locally (real Google client) before merge, then on production  | There is no preview environment; merge deploys straight to production.                                     | Plan              |
| Button placement          | Top of both sign-in and sign-up, then "or", then the email form | Google is the primary path and creates the account on first use; shadcn `Button` outline, not the purple CTA. | Plan              |
| Automated tests           | One smoke step on the redirect; round trip is manual           | Same level as the rest of auth; runs in CI without Google.                                                 | Plan              |
| Hosted provider config    | Enabled by hand in the Supabase Dashboard                      | CI pushes only migrations; `config push` would also push the local `site_url`.                              | Plan              |
| OAuth return path         | Reuse the existing `/auth/callback` unchanged                  | The OAuth PKCE return has the same shape as the email-confirmation return.                                 | Plan              |

## Scope

**In scope:**

- `POST /api/auth/google` endpoint (redirects to Supabase's Google authorize URL)
- Local `[auth.external.google]` config with env-based secrets, `supabase/.env.example`, and the redirect allow-list fix
- Shared `GoogleSignInButton.astro` on both auth pages
- Smoke step for the Google redirect
- Google Cloud OAuth client and hosted provider (owner, manual)
- Docs: `deploy-plan.md`, `README.md`, `CLAUDE.md`

**Out of scope:**

- Other providers, account-linking UI, profile table / Google name and avatar
- Changes to email/password flows, the callback or the cross-device email limitation
- Automating hosted auth config; unit tests with a mocked Supabase client; Google branding verification

## Architecture / Approach

Button (form POST) → `/api/auth/google` calls `signInWithOAuth` (no network call; it builds the authorize URL and sets the PKCE verifier cookie) → 302 to Supabase `/auth/v1/authorize?provider=google` → Google consent → Supabase `/auth/v1/callback` → 302 to app `/auth/callback?code=…` → existing `exchangeCodeForSession` → `/dashboard`. Build order: server and config first, UI next, production last.

## Phases at a Glance

| Phase                                   | What it delivers                                                     | Key risk                                                                  |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. OAuth endpoint + local config        | Endpoint, `config.toml` provider + allow-list, smoke step            | Smoke must assert a redirect to a Supabase URL it does not know (predicate) |
| 2. Button + local end-to-end            | Google button on both pages; first real local round trip             | Needs the owner's Google Cloud OAuth client first                         |
| 3. Production + docs                    | Hosted provider enabled, docs updated, production round trip         | Provider must be enabled in the Dashboard before merge                    |

**Prerequisites:** a Google Cloud project for SplitDom (owner); Supabase Dashboard access to `rpbroqavksbvezskqhlz`; local Supabase running.
**Estimated effort:** ~1–2 sessions across 3 small phases, plus ~30 minutes of owner setup in Google Cloud and the Supabase Dashboard.

## Open Risks & Assumptions

- Verified: the Supabase CLI (2.117/2.118) starts with the Google `env(...)` values unset (warning only), so CI needs no Google secrets or placeholders; criterion 1.4 guards against a CLI regression.
- Automatic same-email identity linking is Supabase behaviour, not ours. The confirmed-account case is checked manually in Phase 2; the unconfirmed case (password removed) can only happen in production and is documented, not tested.
- Google blocks OAuth inside some in-app browsers (for example a link opened from a messenger). Users there need to open the page in their normal browser. This is accepted, not handled.

## Success Criteria (Summary)

- A person with any Google account can sign in on production from a phone or desktop and land on `/dashboard`.
- Email/password sign-up and sign-in behave exactly as before.
- CI (including the new smoke step) is green without Google secrets.
