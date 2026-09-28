# Sign In with Google (S-01) Implementation Plan

## Overview

Let a user sign in to SplitDom with their Google account (FR-001, the must-have sign-in path) and land in the app signed in, while the existing email + password sign-in (FR-013) stays available next to it. The OAuth round trip reuses the PKCE callback that already exists for email confirmation, so the change is a small server endpoint, a shared button on the auth pages, local and hosted provider configuration, and one new smoke step.

Decisions already made by the user (2026-09-28, recorded in `change.md` and `roadmap.md`): the provider is **Google**, and email/password sign-in **stays**.

## Current State Analysis

- Auth is Supabase Auth through `@supabase/ssr`. `src/lib/supabase.ts:6-22` builds a cookie-backed server client (PKCE is the default flow), and `src/middleware.ts:6-25` sets `locals.user` and redirects anonymous users away from `/dashboard`.
- Email/password endpoints are thin `POST` form handlers that redirect: `src/pages/api/auth/signin.ts:4-20` (errors → `/auth/signin?error=<message>`, success → `/`), `signup.ts` (uses `emailRedirectTo: ${origin}/auth/callback`), `signout.ts`.
- `src/pages/auth/callback.ts:4-27` already handles every PKCE return: `error_description` → `/auth/signin?error=…`, missing `code` → `/auth/signin`, otherwise `exchangeCodeForSession(code)` → `/dashboard`. An OAuth return from Supabase has the same shape, so the callback needs no change.
- The auth pages `src/pages/auth/signin.astro` and `signup.astro` render a React form (`SignInForm` / `SignUpForm`) inside a card, with the server error passed from the `error` query param. Shared auth UI pieces live in `src/components/auth/` (`SubmitButton`, `ServerError`, …).
- `supabase/config.toml:150-156`: local `site_url = "http://127.0.0.1:4321"` and `additional_redirect_urls = ["https://127.0.0.1:4321"]` (https, no path wildcard). `npm run dev` serves `http://localhost:4321`, so a `redirectTo` of `http://localhost:4321/auth/callback` is not on the local allow-list. No `[auth.external.google]` block exists; the Apple block (`config.toml:305-319`) shows the CLI's provider shape, including `skip_nonce_check` ("Required for local sign in with Google auth").
- The hosted project `rpbroqavksbvezskqhlz` has `site_url = https://10x-astro-starter.adamgwozdz.workers.dev` and `additional_redirect_urls = https://10x-astro-starter.adamgwozdz.workers.dev/**`, set by hand in the Supabase Dashboard (`context/deployment/deploy-plan.md`, "Post-deploy findings" 1). CI never pushes auth config, only migrations (`supabase db push`).
- `scripts/smoke.mjs` checks the auth flow with a cookie jar and `redirect: "manual"`, matching `location` by prefix. CI's `smoke` job runs it against a production build backed by local Supabase started with the CLI.
- Secrets: `.gitignore` ignores `.env*` everywhere, so `supabase/.env` (which the Supabase CLI reads for `env(...)` substitution in `config.toml`) is already gitignored. `.env.example` lists only `SUPABASE_URL` / `SUPABASE_KEY`.

## Desired End State

- `/auth/signin` and `/auth/signup` both show a **Continue with Google** button at the top of the card, then an "or" divider, then the unchanged email/password form.
- Clicking it posts to `/api/auth/google`, which redirects the browser to Supabase's Google authorize URL. After Google consent, Supabase returns to `/auth/callback?code=…`, the session is created, and the user lands on `/dashboard` signed in, with their Google email shown.
- Cancelling on Google's consent screen lands the user on `/auth/signin` with a readable error message, not a crash or a blank page.
- A user who already has an email/password account and signs in with Google using the same address ends up in the **same** Supabase user (Supabase links identities with the same email automatically), so later group data keyed by user id is not split across two accounts. Two cases, both Supabase behaviour that we document rather than implement:
  - **Confirmed** email/password account: the Google identity is added and the password keeps working.
  - **Unconfirmed** email/password account (only possible where email confirmation is on, i.e. production): Supabase removes the unconfirmed password identity (anti pre-account-takeover), confirms the user through Google's verified email and signs them in; the old password stops working. This makes Google the recovery path for people stuck on the accepted cross-device PKCE email-confirmation limitation.
- It works locally (`npm run dev` + local Supabase with a real Google OAuth client) and in production (hosted Supabase with the Google provider enabled). The Google consent screen is published **In production**, so any Google account can sign in, matching open email sign-up and invite-by-link (S-03).
- CI stays green without any Google secrets, and `npm run smoke` asserts the Google redirect.

Verify with: `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke` locally and in CI, a manual local round trip, and after merge a manual round trip on https://10x-astro-starter.adamgwozdz.workers.dev.

### Key Discoveries:

- On the server, `supabase.auth.signInWithOAuth` makes no network call. It builds `<SUPABASE_URL>/auth/v1/authorize?provider=google&redirect_to=…&code_challenge=…&code_challenge_method=s256`, stores the PKCE code verifier through the cookie adapter (`setAll` in `src/lib/supabase.ts:15-19`), and returns `{ data: { url } }`. The endpoint only has to redirect to `data.url`. The same mechanism already makes the email-confirmation callback work.
- Because no network call happens, the smoke step can assert the redirect even when Google is not configured in local Supabase (as in CI). Following that URL is not part of the smoke test.
- Supabase silently falls back to `site_url` when `redirect_to` is not on the allow-list. Locally that would send the user to `http://127.0.0.1:4321/?code=…`, a different cookie origin from `localhost`, and the PKCE exchange would fail. That is why the allow-list fix is part of Phase 1, not a nice-to-have.
- Google OAuth needs two things outside the repo: a Google Cloud OAuth client with Supabase's callback URLs as authorized redirect URIs (`https://rpbroqavksbvezskqhlz.supabase.co/auth/v1/callback`, `http://127.0.0.1:54321/auth/v1/callback`), and the provider enabled in each Supabase instance (local: `config.toml` + `supabase/.env`; hosted: Dashboard).

## What We're NOT Doing

- No second external provider (Apple, GitHub, …). FR-001 is one provider for the MVP.
- No removal or change of email/password sign-up/sign-in, the email-confirmation callback, or the accepted cross-device PKCE limitation for email confirmation.
- No account-linking UI and no manual linking (`enable_manual_linking` stays `false`). Same-email linking is whatever Supabase does automatically, and it is verified manually, not re-implemented.
- No user profile table or storing of the Google name/avatar. Tables emerge from the slices that need them (S-02 onward).
- No `supabase config push` or other automation of hosted auth settings. The hosted provider is enabled by hand in the Dashboard, like `site_url` was, because `config push` would also push the local `site_url`.
- No unit test with a mocked Supabase client. The smoke step covers the redirect; the full Google round trip is manual.
- No change to where email/password sign-in lands (`/`) or to `src/pages/auth/callback.ts`.
- No Google branding verification (logo on the consent screen). Only non-sensitive scopes (`openid`, `email`, `profile`) are used, so publishing In production needs no Google review.

## Implementation Approach

Server and configuration first, UI second, production last. Phase 1 adds the endpoint, the local provider config and the allow-list fix, and proves the redirect with the smoke test. CI must stay green without Google secrets, so nothing is user-visible yet. Phase 2 adds the button and does the first real Google round trip locally, once the owner has created the Google OAuth client. Phase 3 enables the provider on the hosted project before merge (harmless while there is no button in production), updates the docs, and verifies on production after the merge deploys.

## Critical Implementation Details

- **Unset env vars in CI (verified):** CI's `smoke` and `db-test` jobs run `supabase start` without Google secrets. Supabase CLI v2.117.0 (installed) and v2.118.0 (CI `latest`) keep an unset `env(...)` as the literal string and only print `WARN: environment variable is unset`; `client_id` is then non-empty and the `secret` is exempt from validation for Google, so `start` succeeds. Google is simply unusable in that instance, which the smoke step never needs. No CI placeholders are needed; criterion 1.4 guards against a CLI regression. The CLI auto-loads both `supabase/.env` and the repo-root `.env` (non-overriding); `supabase/.env` is the documented place for the Google variables.
- **`skip_nonce_check = true`** is required for the local Google provider; without it, local Google sign-in fails the nonce check.
- **Hosted before merge:** the Supabase Dashboard provider must be enabled before the Phase 3 PR is merged. The merge auto-deploys the button, and without the provider it would lead straight to an "Unsupported provider: provider is not enabled" error.

## Phase 1: Google OAuth Endpoint and Local Provider Configuration

### Overview

Add the server side of Google sign-in and configure local Supabase for it, with an automated smoke check. Nothing visible changes in the UI yet.

### Changes Required:

#### 1. Google sign-in endpoint

**File**: `src/pages/api/auth/google.ts` (new)

**Intent**: Start the Google OAuth flow. Mirror `signin.ts`: build the server client, call `signInWithOAuth` for Google with the callback as the return address, and redirect the browser to the URL Supabase returns. On a missing client or an error, redirect to the sign-in page with the message, like the existing endpoints.

**Contract**: `POST /api/auth/google` (form post, no body fields). Calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${context.url.origin}/auth/callback` } })`. Success → `302` to `data.url` (`<SUPABASE_URL>/auth/v1/authorize?provider=google&…`) with the PKCE code-verifier cookie set on the response. Supabase not configured → `302 /auth/signin?error=Supabase%20is%20not%20configured`. `error` → `302 /auth/signin?error=<encoded message>`.

#### 2. Local Supabase auth configuration

**File**: `supabase/config.toml`

**Intent**: Enable Google in local Supabase with secrets read from the environment, and put the dev server's real origins on the redirect allow-list so the OAuth return reaches `/auth/callback` on the same origin that holds the PKCE cookie.

**Contract**: `[auth] additional_redirect_urls` becomes `["http://localhost:4321/**", "http://127.0.0.1:4321/**"]` (`site_url` unchanged). New `[auth.external.google]` block, shaped like the Apple block: `enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, `redirect_uri = ""`, `url = ""`, `skip_nonce_check = true`, `email_optional = false`.

#### 3. Local secret template

**File**: `supabase/.env.example` (new)

**Intent**: Document the two variables the Supabase CLI needs for local Google sign-in, so a developer knows to copy it to `supabase/.env` (gitignored).

**Contract**: Keys `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` with placeholder values and a one-line comment pointing to the Google Cloud setup in `context/deployment/deploy-plan.md`.

#### 4. Smoke step

**File**: `scripts/smoke.mjs`

**Intent**: Prove in CI that the Google endpoint redirects to Supabase's Google authorize URL with the callback as `redirect_to` and sets the PKCE verifier cookie, without contacting Google.

**Contract**: The step row shape gains an optional predicate: `[name, run, { status, location?, check? }]`, where `check(actual, jar)` returns `true` or a failure reason and is evaluated in addition to the status check. Existing rows are unchanged. New step after "home renders" (empty cookie jar at that point): `POST /api/auth/google` → `status: 302`, and `check` parses `actual.location` with `new URL()` and asserts:
- `pathname` ends with `/auth/v1/authorize` (the Supabase host is not known to the script, so it is not asserted);
- `searchParams.get("provider") === "google"`;
- `searchParams.get("redirect_to") === BASE_URL + "/auth/callback"`;
- `searchParams.get("code_challenge_method") === "s256"`;
- the jar holds a cookie whose name ends with `-auth-token-code-verifier` (the legacy key the callback reads; `signInWithOAuth` also writes `…-auth-token-flows-code-verifier` and `…-auth-token-flow-<hex>-code-verifier`, which stay in the jar harmlessly).

Keep the script zero-dependency.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Local Supabase starts with the Google variables unset: `npx supabase stop && env -u SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID -u SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET npx supabase start` (with no `supabase/.env` present)
- Smoke test passes, including the new Google redirect step: `npm run smoke` against `npm run dev`
- CI is green on the PR (`ci`, `smoke`, `db-test`)

#### Manual Verification:

- `curl -si -X POST -H "Origin: http://localhost:4321" http://localhost:4321/api/auth/google` shows a `302` whose `Location` points at `http://127.0.0.1:54321/auth/v1/authorize?provider=google` with `redirect_to=http%3A%2F%2Flocalhost%3A4321%2Fauth%2Fcallback`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Google Button and Local End-to-End Sign-In

### Overview

Show the Google option on both auth pages and complete the first real Google round trip against local Supabase. This phase has an owner prerequisite: the Google Cloud OAuth client.

### Changes Required:

#### 1. Shared Google button

**File**: `src/components/auth/GoogleSignInButton.astro` (new)

**Intent**: One reusable block for both pages: a form that posts to the Google endpoint with a full-width "Continue with Google" button styled like the card's existing controls, followed by an "or" divider separating it from the email form. It is static, so it is an Astro component, not a React island.

**Contract**: No props. Renders `<form method="POST" action="/api/auth/google">` containing `<Button variant="outline" type="submit">` from `@/components/ui/button` (rendered statically, no `client:*` directive), full width, labelled "Continue with Google" with a Google "G" mark as inline SVG (`aria-hidden`); then a horizontal "or" divider (plain markup, no new shared component). Do not reuse `SubmitButton`: its purple primary styling would make Google look like a second primary action. The Google form is a sibling placed before the email form island, never nested inside it (`SignInForm.tsx:43` is itself a `<form>`).

#### 2. Auth pages

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Put the Google option first on both pages, since Google is the must-have path (FR-001) and email/password is the alternative (FR-013). Google sign-in creates the account on first use, so it belongs on sign-up as well.

**Contract**: `<GoogleSignInButton />` is inserted between the `<h1>` and the existing form island on each page. Forms, the `error` query-param handling and the footer links are unchanged. Errors from the Google flow arrive at `/auth/signin?error=…` and are shown by the existing `ServerError` in `SignInForm`.

#### 3. Owner setup: Google Cloud OAuth client (manual, outside the repo)

**Intent**: Create the credentials both Supabase instances use.

**Contract**: In Google Cloud Console (a project for SplitDom): configure the OAuth consent screen (External, app name "SplitDom", scopes `openid`, `email`, `profile`, publishing status **In production**). Create an OAuth client of type "Web application" with authorized redirect URIs `https://rpbroqavksbvezskqhlz.supabase.co/auth/v1/callback` and `http://127.0.0.1:54321/auth/v1/callback`. Put the client id and secret into `supabase/.env` (from `supabase/.env.example`) and restart local Supabase.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke test still passes: `npm run smoke` against `npm run dev`

#### Manual Verification:

- `/auth/signin` and `/auth/signup` show "Continue with Google", an "or" divider, then the unchanged email form, at desktop and phone width
- Local round trip: Continue with Google → Google account chooser → consent → lands on `/dashboard` showing the Google email; Topbar on `/` shows the same email; Sign out works
- Cancel on Google's consent screen lands on `/auth/signin` with a visible error message
- Signing in with Google using the email of an existing confirmed local email/password account ends in the same user (one row in Supabase Studio → Authentication → Users, with both `email` and `google` identities), and email/password sign-in still works for that user afterwards (local accounts are always confirmed because `enable_confirmations = false`; the unconfirmed case is documented, not tested)
- Email/password sign-up and sign-in still work locally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Production Enablement and Documentation

### Overview

Enable Google on the hosted Supabase project, document the setup and the new auth route, and verify the flow on production after the merge deploys it.

### Changes Required:

#### 1. Owner setup: hosted Supabase provider (manual, before merge)

**Intent**: Turn on Google for the production auth server with the same OAuth client.

**Contract**: Supabase Dashboard → project `rpbroqavksbvezskqhlz` → Authentication → Sign In / Providers → Google: enabled, client id and secret from Phase 2, "Skip nonce check" off. URL Configuration is left as is (`site_url` and `https://10x-astro-starter.adamgwozdz.workers.dev/**` already cover `/auth/callback`).

#### 2. Deploy plan

**File**: `context/deployment/deploy-plan.md`

**Intent**: Record the Google sign-in setup as ground truth for later changes, like the database-migrations section.

**Contract**: New section "Google sign-in (added 2026-09-28, change `external-identity-sign-in`, S-01)": the Google Cloud project, consent screen (External, In production, non-sensitive scopes), OAuth client and its two redirect URIs; the hosted provider enabled by hand in the Dashboard (not via `config push`, and why); local setup through `supabase/.env`; the variable names; and automatic same-email linking with its two cases (confirmed account: Google added, password kept; unconfirmed account: password identity removed, user confirmed and signed in through Google), noting that Google is therefore the recovery path for the cross-device PKCE email-confirmation limitation described above.

#### 3. Project docs

**Files**: `README.md`, `CLAUDE.md`, `.env.example`

**Intent**: Keep the entry-point docs accurate: auth now includes Google.

**Contract**: `README.md` — the Status line mentions Google sign-in; the Auth Routes table gains `POST /api/auth/google`; local setup explains copying `supabase/.env.example` to `supabase/.env` for Google (optional: email/password works without it). `CLAUDE.md` — the Status paragraph and `src/pages/api/` description mention the Google endpoint. `.env.example` — unchanged unless a Worker variable is added (none is expected: the Worker never sees Google secrets).

### Success Criteria:

#### Automated Verification:

- Linting and formatting pass: `npm run lint`
- CI is green on the PR (`ci`, `smoke`, `db-test`)
- After merge, the `deploy` job on `main` succeeds

#### Manual Verification:

- The hosted Supabase Dashboard shows Google enabled before the PR is merged
- Production round trip on https://10x-astro-starter.adamgwozdz.workers.dev: Continue with Google → consent → `/dashboard` with the Google email, on a desktop browser and on a phone
- A Google account that is not the owner's (for example a household member's) can sign in, confirming the consent screen is In production
- Email/password sign-in still works on production

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- None added. The endpoint is a single SDK call plus a redirect; its behaviour is covered by the smoke step.

### Integration Tests:

- `scripts/smoke.mjs`: `POST /api/auth/google` → `302` to `<SUPABASE_URL>/auth/v1/authorize?provider=google` with `redirect_to` = `<BASE_URL>/auth/callback`, plus the PKCE code-verifier cookie. Runs locally and in the CI `smoke` job without Google credentials.
- Existing smoke steps (email sign-up, sign-in, sign-out, dashboard protection) keep passing, proving email/password is untouched.

### Manual Testing Steps:

1. Locally, with `supabase/.env` filled: sign in with Google from `/auth/signin`, and again from `/auth/signup`; both land on `/dashboard`.
2. Cancel on Google's consent screen; see the error on `/auth/signin`.
3. Create an email/password account with your Gmail address, then sign in with Google using it; Studio shows one user with two identities.
4. On production after merge: the same round trip on desktop and phone, and a second person's Google account.

## Performance Considerations

None. The endpoint adds one redirect before Google's page, and no work happens on the Worker beyond building a URL.

## Migration Notes

No database migration. Google users land in Supabase's `auth.users` / `auth.identities` like email users. Rollback is `wrangler rollback` (or a revert PR) plus disabling the provider in the Dashboard; nothing in the database needs undoing.

## References

- Roadmap item: `context/foundation/roadmap.md` — S-01 (FR-001; unknowns resolved 2026-09-28)
- PRD: `context/foundation/prd.md` — FR-001, FR-013
- PKCE callback reused as is: `src/pages/auth/callback.ts:4-27`
- Endpoint pattern to mirror: `src/pages/api/auth/signin.ts:4-20`
- Hosted auth URL configuration and PKCE limitation: `context/deployment/deploy-plan.md` ("Post-deploy findings")
- Provider block shape: `supabase/config.toml:305-319`
- Smoke test: `scripts/smoke.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Google OAuth Endpoint and Local Provider Configuration

#### Automated

- [x] 1.1 Linting passes: `npm run lint`
- [x] 1.2 Type checking passes: `npx astro check`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Local Supabase starts with the Google variables unset
- [x] 1.5 Smoke test passes, including the new Google redirect step: `npm run smoke`
- [ ] 1.6 CI is green on the PR (`ci`, `smoke`, `db-test`)

#### Manual

- [x] 1.7 `POST /api/auth/google` redirects to the local Supabase Google authorize URL with the localhost callback

### Phase 2: Google Button and Local End-to-End Sign-In

#### Automated

- [ ] 2.1 Linting passes: `npm run lint`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Smoke test still passes: `npm run smoke`

#### Manual

- [ ] 2.5 Sign-in and sign-up pages show Continue with Google, an "or" divider and the unchanged email form
- [ ] 2.6 Local Google round trip lands on `/dashboard` with the Google email; sign out works
- [ ] 2.7 Cancelling Google consent shows an error on `/auth/signin`
- [ ] 2.8 Google sign-in with an existing confirmed email/password address links into the same user
- [ ] 2.9 Email/password sign-up and sign-in still work locally

### Phase 3: Production Enablement and Documentation

#### Automated

- [ ] 3.1 Linting and formatting pass: `npm run lint`
- [ ] 3.2 CI is green on the PR (`ci`, `smoke`, `db-test`)
- [ ] 3.3 After merge, the `deploy` job on `main` succeeds

#### Manual

- [ ] 3.4 Hosted Supabase shows Google enabled before merge
- [ ] 3.5 Production Google round trip works on desktop and phone
- [ ] 3.6 A non-owner Google account can sign in on production
- [ ] 3.7 Email/password sign-in still works on production
