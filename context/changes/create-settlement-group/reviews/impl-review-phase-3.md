<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create a Settlement Group (S-02)

- **Plan**: context/changes/create-settlement-group/plan.md
- **Scope**: Phase 3 of 3
- **Reviewed phases**: 3
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 7 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Phase 3 was reviewed as uncommitted work. The staged files are:

- `src/pages/api/groups/index.ts`
- `src/middleware.ts`
- `src/pages/dashboard.astro`
- `src/components/groups/*`
- `src/pages/groups/[id].astro`
- `scripts/smoke.mjs`

Also reviewed, though not staged: the project sections of `CLAUDE.md` and the `.claude/launch.json` `splitdom-preview` config.

**Drift check.** Every planned item matches the plan, nothing is missing, and nothing touches "What We're NOT Doing".

**Verified safe:**

- **CSRF.** Astro 7.3.3 enables `security.checkOrigin` for `output: "server"`, so a cross-origin form POST gets 403.
- **Open redirect and XSS.** No user input reaches `Location`. There is no `set:html`, and `?error` is mapped through `groupErrorMessage`.
- **Authorization.** `hostId` comes from `locals.user`, and `create_group` also enforces `p_host_id = auth.uid()`.
- **Isolation.** A non-member and an unknown id both get 404.
- **Middleware bypass.** Probes against the preview (`/%64ashboard`, `//api/groups`, case variants) did not reach any protected page anonymously.

**Gates 3.1–3.3 are green:**

- smoke 20/20, plus a break-check of the middleware protection;
- `npm test` 49, `npm run test:db` 22;
- `astro check`, `lint` and `build`.

Manual checks 3.4–3.8 are pending.

## Findings

### F1 — A failed create shows the list-loading message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/index.ts:27, src/lib/groups/group-error.messages.ts:8, src/pages/dashboard.astro:43-57
- **Detail**: Any failed create (a DB error, an id collision, no Supabase) redirects to `/dashboard?error=unexpected`. The form then says "Couldn't load your groups, try again", which describes a load failure, not a create failure. When the list also failed to load, the same alert appears twice. Phase 1 review F4 skipped this as a wording concern; it is now visible in the UI.
- **Fix**: Make the `unexpected` message generic ("Something went wrong, try again"). The dashboard list and the group page render their own load-failure sentence ("Couldn't load your groups, try again").
- **Decision**: FIXED — `unexpected` now reads "Something went wrong, try again"; the module exports `GROUPS_LOAD_FAILED_MESSAGE` ("Couldn't load your groups, try again"), which the dashboard list and the group page render on a load failure.

### F2 — `GroupService` construction is duplicated in three places

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/api/groups/index.ts:19-23, src/pages/dashboard.astro:17-21, src/pages/groups/[id].astro:15-19
- **Detail**: The endpoint, the dashboard and the group page each build `createSupabaseGroupRepository(supabase)` and pass it to `new GroupService(...)` with the arrow id generator and clock. The read-only pages pass an id generator they never use. The workerd "Illegal invocation" comment exists only in the endpoint. The pages never call the repository, but they assemble it, so composition knowledge leaks into three web files.
- **Fix**: Add one composition function to the groups module, for example `createGroupService(client: SupabaseClient<Database>): GroupService` in `src/lib/groups/group.repository.ts` next to the repository it wires. It would carry the arrow id generator, the clock and the workerd comment. All three call sites use it.
  - Strength: The workerd pitfall lives in one place, and web files only ask for "the group service for this client". It stays inside the domain module, not in a generic utils module.
  - Tradeoff: It adds one public function to the barrel, and the composition sits next to the infrastructure (the Supabase repository) rather than in the pure domain files.
  - Confidence: HIGH — it is a mechanical change; smoke and the tests cover all three call sites.
  - Blind spot: Whether you would rather keep composition explicit at each edge, as the plan's deviation note ("call GroupService directly") allows.
- **Decision**: FIXED — `createGroupService(client)` in `src/lib/groups/group.repository.ts` (exported from the barrel) wires the Supabase repository, the arrow id generator, the clock and the workerd comment; the endpoint, dashboard and group page use it.

### F3 — A non-form POST to `/api/groups` returns 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/index.ts:11
- **Detail**: `await context.request.formData()` is not caught, so a POST without a form body or with JSON throws, and the result is a raw 500. The auth endpoints share the same pattern.
- **Fix**: Catch the parse failure and redirect to `/dashboard?error=invalid_group_name`.
- **Decision**: FIXED — `formData()` failures are caught and treated as a missing name (`invalid_group_name`).

### F4 — Middleware prefix match protects more than intended

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:4,18
- **Detail**: `pathname.startsWith(route)` also matches `/groupsX` and `/api/groupsfoo` (verified with curl), so any future public route starting with `/groups` would be protected by accident. It fails closed, so nothing is exposed.
- **Fix**: Match whole segments: `pathname === route || pathname.startsWith(`${route}/`)`.
- **Decision**: FIXED — the middleware matches whole segments; `/groupsX` and `/api/groupsfoo` now return 404 while `/groups/<id>` and `/api/groups` still redirect anonymous users (verified with curl on the preview).

### F5 — Group page failure status and heading

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/groups/[id].astro:9-11,41-44; src/pages/dashboard.astro:10-12
- **Detail**:
  - A load failure other than `group_not_found` renders with status 200, as the plan specifies, so it is invisible to status-based monitoring.
  - That branch also has no `<h1>`.
  - Both pages throw when there is no user, which gives a generic 500. This is acceptable as a wiring assertion behind the middleware.
- **Fix**: Add an `<h1>` (for example "Group") to the failure branch. Keep the 200 and the throw as specified.
- **Decision**: FIXED — the group page's load-failure branch has an `<h1>` ("Group"); status 200 and the throw stay as planned.

### F6 — Smoke steps depend on earlier group ids

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:128-151
- **Detail**: If "create group A" fails, later steps request `/groups/undefined`. "Group page redirects after signout" then still passes, with a 302 to sign-in, without testing a real id.
- **Fix**: Make the group-dependent steps fail explicitly when `groupIds[0]` is missing.
- **Decision**: FIXED — `requestGroupA()` makes group-A steps fail explicitly when the group was not created.

### F7 — CLAUDE.md conventions left implicit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md (Commands, Code Conventions, Database changes)
- **Detail**:
  - Groups endpoints put an error **code** in `?error=` and map it to a message. Auth endpoints put an encoded human message there. The same parameter now means two things, and the code-based convention, which is the safer one, is not documented.
  - The Database changes bullet "`security definer` helpers used by RLS policies go in schema `private`" sits next to the new "persistence functions live in `public`" bullet without a qualifier.
  - `npm run smoke` is still described as a smoke test of "the auth flow".
- **Fix**: In the project sections of CLAUDE.md:
  - document the `?error=<code>` + per-module message convention for new endpoints;
  - qualify the `private` bullet ("RLS-policy helpers only; persistence functions: see below");
  - change the smoke description to "auth and create-group flows".
- **Decision**: FIXED — CLAUDE.md documents the `?error=<code>` convention under Error format, qualifies the `private` bullet, and describes smoke as covering the auth and create-group flows.

### F8 — Create form UX details

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/groups/CreateGroupForm.astro:21,49-62
- **Detail**:
  - The submit button has no pending text, unlike the auth `SubmitButton`.
  - The typed name is lost after a validation redirect.
  - After a network failure the button stays disabled until the page is reloaded.
  - The browser's `maxlength` counts UTF-16 units, so it is stricter than `GroupName` for emoji. It is never looser, so this is harmless.
- **Fix**: Accept for the MVP. Optionally set the button text to "Creating…" when it is disabled.
- **Decision**: ACCEPTED — MVP; no pending text, name not preserved after a validation redirect.

### F9 — `.claude/launch.json` gained a preview config outside the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .claude/launch.json
- **Detail**: A `splitdom-preview` entry (`npm run preview -- --port 4321`) was added to run the smoke gate against a production preview, mirroring CI. It is tooling, not app code, and it hardcodes the nvm PATH like the existing entry.
- **Fix**: Commit it with Phase 3 as dev tooling.
- **Decision**: FIXED — `.claude/launch.json` (`splitdom-preview`) is committed with Phase 3 as dev tooling.
