<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Sign In with Google (S-01)

- **Plan**: context/changes/external-identity-sign-in/plan.md
- **Mode**: Deep
- **Date**: 2026-09-28
- **Verdict**: SOUND (all findings fixed in plan)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

11/11 existing paths ✓, 3/3 new paths absent as expected ✓, 5/5 config symbols ✓, brief↔plan ✓.

Deep verification (sub-agent, node_modules and upstream sources) confirmed:
- `signInWithOAuth` makes no network call on the server. It stores the PKCE verifier via `setAll` before returning, and `/auth/callback` reads the legacy key unchanged.
- CI preview's `url.origin` is `http://localhost:4321`.
- Astro `checkOrigin` is on, and a same-origin form POST passes.
- GoTrue always accepts loopback redirect hosts, so the `localhost` allow-list entry is the one that matters.

## Findings

### F1 — Unconfirmed email account loses its password after Google sign-in

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State; Phase 2 (criterion 2.8); Phase 3 (deploy-plan)
- **Detail**: Supabase automatic linking has two cases:
  - **Confirmed** email/password user: the Google identity is linked and the password keeps working.
  - **Unconfirmed** user: `RemoveUnconfirmedIdentities` clears the password and the email identity, then the user is confirmed through Google.

  Local `enable_confirmations = false`, so only the confirmed case can be tested. The plan promised "same user" without describing the password loss, or that Google becomes the recovery path for the cross-device PKCE limitation.
- **Fix**: Describe both cases in Desired End State and in the deploy-plan section; narrow 2.8 to a confirmed account.
- **Decision**: FIXED

### F2 — Smoke step does not fit the existing step table

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — #4 Smoke step
- **Detail**: Rows compare status plus an app-relative Location prefix (`scripts/smoke.mjs:38-67`). The Google Location starts with the Supabase API URL, which the script does not know. `signInWithOAuth` writes three verifier cookies.
- **Fix**: Add an optional `check(actual, jar)` predicate. It asserts the authorize pathname, `provider`, the exact `redirect_to`, `code_challenge_method=s256`, and the `-auth-token-code-verifier` cookie.
- **Decision**: FIXED

### F3 — Google button can use the existing shadcn Button

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — #1 GoogleSignInButton
- **Detail**: The plan asked for hand-styling "consistent with SubmitButton", which is the purple primary CTA. `src/components/ui/button.tsx` already has an `outline` variant and renders statically in `.astro`. The Google form must be a sibling of the email form, never nested in it.
- **Fix**: Use `<Button variant="outline" type="submit">` without `client:*`, and state the sibling-form rule.
- **Decision**: FIXED

### F4 — "CLI vs unset env" risk already verified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; brief Open Risks
- **Detail**:
  - Supabase CLI v2.117.0 and v2.118.0 keep an unset `env(...)` literal and only warn; `start` succeeds, and the Google `secret` is exempt from validation. The CI placeholder fallback is unnecessary.
  - The CLI also auto-loads the repo-root `.env`.
- **Fix**: State the verified behaviour, drop the fallback, and keep 1.4 as a regression guard.
- **Decision**: FIXED
