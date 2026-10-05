---
date: 2026-10-05T08:49:16+0200
researcher: Claude Code (claude-opus-5-5) for adamgwozdz00
git_commit: 5af5961
branch: chore/close-create-settlement-group
repository: 10xDevs (SplitDom)
topic: "Ground rollout Phase 1 (Domain boundary guard) of context/foundation/test-plan.md — Risk #3"
tags: [research, testing, eslint, domain-boundary, groups, supabase]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude Code (claude-opus-5-5) for adamgwozdz00
---

# Research: Ground rollout Phase 1 — Domain boundary guard (Risk #3)

**Date**: 2026-10-05T08:49:16+0200
**Researcher**: Claude Code (claude-opus-5-5) for adamgwozdz00
**Git Commit**: 5af5961 (no uncommitted changes under `src/`, `supabase/` or `eslint.config.js` at research time, so the `file:line` references match this commit)
**Branch**: chore/close-create-settlement-group
**Repository**: 10xDevs (SplitDom)

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` (Risk #3: a business rule is implemented beside the domain — in a page, endpoint or SQL function — so domain tests stay green while user-visible behaviour is wrong or a path skips the rule). Verify, not blindly accept, the response guidance: prove that pages and endpoints cannot reach a repository or RPC except through the module's service, and that breaking that boundary fails lint before review; challenge "green domain tests mean the rule is enforced"; avoid folder-structure mirrors, file-tree snapshots, and rules re-tested inside endpoint tests. Hot-spot dirs `src/lib/groups` and `src/pages/api` are likelihood evidence, not anchors.

## Summary

1. **Today the boundary holds only by convention.** At commit 5af5961, the three web files that use the groups domain (`src/pages/api/groups/index.ts`, `src/pages/dashboard.astro`, `src/pages/groups/[id].astro`) import the domain only through the barrel `@/lib/groups` and call `createGroupService(...)`. The three `.rpc(` calls in `src/` outside tests are all in `src/lib/groups/group.repository.ts:18,30,50`. Nothing enforces this: `eslint.config.js` has no `no-restricted-imports` or `no-restricted-syntax` rule.
2. **A path-only `no-restricted-imports` rule (the test-plan's stated tool) would miss two of the three real bypass paths:**
   - The barrel re-exports the repository factory (`src/lib/groups/index.ts:8`, `createSupabaseGroupRepository`). A page can import it from `@/lib/groups`, and a rule that only bans internal paths lets it through.
   - Every page gets a full Supabase client from `createClient` (`src/lib/supabase.ts:6-22`). `supabase.rpc("create_group", …)` in a page needs no domain import at all, so no import rule can see it.
   - The core rule also skips dynamic `import()`. The ESLint docs say it "applies to static imports only", and this was confirmed empirically.
3. **A combined core-ESLint guard catches all three bypass paths, and the current code passes it with 0 violations** (verified with ESLint 10.11.0 through `--stdin` on `.ts` and on `.astro` frontmatter). The guard has three parts:
   - `no-restricted-imports` with a `group` pattern for `**/lib/*/*`, plus a `regex` + `importNamePattern` that bans `…Repository` names from any `@/lib/<module>` barrel.
   - `no-restricted-syntax` banning `.rpc(` / `.from(` / `.schema(` calls outside `*.repository.ts` and `__tests__`.
   - A `no-restricted-syntax` selector for dynamic `import()` of module internals.
4. **The assumption the plan says to challenge is confirmed false here.** `src/lib/groups/__tests__/group.service.test.ts` has 13 test blocks (15 cases) that drive `GroupService` through `FakeGroupRepository`. They would stay green if a page called `supabase.rpc("create_group", …)` directly. The service-level unit tests the test plan calls for **already exist** for the groups module, so the missing piece is not more service tests. It is a **test of the lint guard itself**: a negative fixture linted programmatically that asserts the rule fires. Without it, someone can delete the rule or narrow its `files` scope and CI stays green.
5. **Limits of the response.** Lint proves "no path to persistence bypasses the service". It does **not** prove "no page re-implements a rule" (for example `group.hostId === userId` instead of `group.isHost(userId)`). It also does **not** reach SQL functions. The SQL part of Risk #3 is held today by `comment on function` conventions plus existing DB tests. One drift case has no test: the duplicated name limit (aggregate `MAX_LENGTH = 60` against SQL `check (char_length(name) between 1 and 60)`).
6. **The hot-spot evidence is partly misleading.** The bypass surfaces are the module barrel (`src/lib/groups/index.ts`), the shared client factory (`src/lib/supabase.ts`) and the `.astro` pages (2 of the 3 domain call sites). `src/pages/api` holds only 1 domain endpoint. Its 4 auth endpoints use `supabase.auth.*` only.

## Detailed Findings

### 1. Current import boundary (page → service → repository)

- Domain call sites in web files at 5af5961, exact set of 3:
  - `src/pages/api/groups/index.ts:2-3` imports `createGroupService` from `@/lib/groups` and `createClient` from `@/lib/supabase`; `:19` calls `createGroupService(supabase).create(...)`.
  - `src/pages/dashboard.astro:5-6` makes the same two imports; `:16` calls `createGroupService(supabase).listForMember(user.id)`.
  - `src/pages/groups/[id].astro:4-5` makes the same imports; `:15` calls `createGroupService(supabase).getForMember(...)`.
- Components touch the domain only through the barrel: `src/components/groups/GroupCard.astro:2` and `GroupList.astro:2` (`import type { Group }`), and `CreateGroupForm.astro:2` (`GroupName`, used for `maxlength={GroupName.MAX_LENGTH}` at `:21`). The display rules are read from the aggregate (`group.isHost(userId)` at `GroupCard.astro:15` and `GroupList.astro:26`), not re-implemented.
- `src/middleware.ts:2,12` uses the client only for `supabase.auth.getUser()`. The 4 auth endpoints (`src/pages/api/auth/{google,signin,signout,signup}.ts`) and `src/pages/auth/callback.ts` import only `@/lib/supabase` (import scan over `src/pages`, `src/components`, `src/layouts`, `src/middleware.ts`).
- `.rpc(` / `.from(` scan over `src` and `scripts`, excluding `database.types.ts`:
  - The 3 `.rpc(` calls outside tests are at `src/lib/groups/group.repository.ts:18,30,50`.
  - `Array.from` at `src/lib/groups/group-name.value.ts:15` is the only `.from(` outside tests.
  - Every other hit is in `src/lib/groups/__tests__/group.repository.db.test.ts`.
- `GroupService` documents itself as "The only entry point to the Group aggregate" (`src/lib/groups/group.service.ts:9-12`). Only the comment backs this up; nothing enforces it.

### 2. Bypass paths a path-only import rule misses

- **The barrel re-exports the repository factory.** `src/lib/groups/index.ts:8` reads `export { createGroupService, createSupabaseGroupRepository } from "@/lib/groups/group.repository";`. Nothing imports `createSupabaseGroupRepository` _through the barrel_: its only outside consumer is `src/lib/groups/__tests__/group.repository.db.test.ts:6`, which imports the internal path directly. The barrel export is therefore unused, but it lets a page build a repository and skip the service.
- **Every page gets the raw client.** `createClient` (`src/lib/supabase.ts:6-22`) returns the full `createServerClient<Database>` client, typed with all RPCs. A page can call `supabase.rpc(...)` or `supabase.from(...)` without importing anything from the domain.
- **Dynamic import is not covered.** The ESLint `no-restricted-imports` docs (Context7 `/eslint/eslint`, rule docs on `main`) say it "applies to static imports only, not dynamic ones". Empirically, `await import("@/lib/groups/group.repository")` in a page was **not** reported by the rule.
- **Residual bypass (not caught by the candidate guard below).** Computed access `s["rpc"](…)` and destructuring `const { rpc } = s` were not reported by the `callee.property.name` selector (empirical run). The guard catches accidental bypasses, not deliberate ones.

### 3. Candidate guard — empirically verified (ESLint 10.11.0, `node_modules/eslint/package.json`)

Runs used `npx eslint --stdin --stdin-filename <existing path> --rule '<json>'`, with the repo's full flat config (type-aware parser, astro parser), and wrote no files. Pointing `--stdin-filename` at existing paths (`src/pages/api/groups/index.ts`, `src/pages/groups/[id].astro`) avoided project-service lookups for files that do not exist.

| Snippet in a page or endpoint                                                         | Rule / option                                                                                                                         | Reported?                                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `import { Group } from "@/lib/groups/group.aggregate"`                                | `patterns: [{ group: ["**/lib/*/*"] }]`                                                                                               | yes (`.ts` and `.astro` frontmatter)                                                                                |
| `import type { GroupSnapshot } from "@/lib/groups/types"`                             | same                                                                                                                                  | yes (type-only imports are reported unless `allowTypeImports: true`, which the core rule now supports per Context7) |
| `import { GroupService } from "../../../lib/groups/group.service"`                    | same (gitignore-style `**`)                                                                                                           | yes                                                                                                                 |
| `export { Group } from "@/lib/groups/group.aggregate"`                                | same                                                                                                                                  | yes                                                                                                                 |
| `import { createSupabaseGroupRepository } from "@/lib/groups"`                        | `paths: [{ name: "@/lib/groups", importNames: [...] }]` or `patterns: [{ regex: "^@/lib/[^/]+$", importNamePattern: "Repository$" }]` | yes (both forms)                                                                                                    |
| `import { createSupabaseInviteRepository } from "@/lib/invites"` (future S-03 module) | `regex` + `importNamePattern` form                                                                                                    | yes. The per-module `paths` form would need a new entry for each module                                             |
| `import { createGroupService } from "@/lib/groups"`                                   | all of the above                                                                                                                      | no (allowed, correct)                                                                                               |
| `supabase.rpc("list_my_groups")`, `s?.rpc(...)`, `s?.from("groups")`                  | `no-restricted-syntax` `CallExpression[callee.property.name=/^(rpc\|from\|schema)$/]:not([callee.object.name=/^(Array\|Object)$/])`   | yes (`.ts` and `.astro` frontmatter)                                                                                |
| `Array.from("x")`                                                                     | same                                                                                                                                  | no (excluded, correct)                                                                                              |
| `await import("@/lib/groups/group.repository")`                                       | `no-restricted-syntax` `ImportExpression[source.value=/lib\/[^/]+\//]`                                                                | yes                                                                                                                 |

Things to watch when writing the rule:

- **Scope.** The pattern rule must be scoped with `files`/`ignores`: unscoped, it reports `src/lib/groups/group.service.ts:1`, because module internals legitimately import each other by alias.
- **Redundancy.** Combining a `regex: "^@/lib/[^/]+/"` pattern with the `group: ["**/lib/*/*"]` pattern reported each violation twice, so one of the two is enough.
- **Current code is clean.** `npx eslint src/pages src/components src/middleware.ts src/layouts` with the import rule and the syntax rule exited 0. `npx eslint src/lib --ignore-pattern '**/__tests__/**' --ignore-pattern '**/*.repository.ts'` with the syntax rule reported nothing.
- **Scope by file role, not by folder.** The `.rpc`/`.from` ban can cover all of `src/**` except `**/*.repository.ts` and `**/__tests__/**`. This uses the repo's role-suffix naming convention (CLAUDE.md "File naming"), not a mirror of the folders, so new modules (`src/lib/invites/`, later expenses/settlements) are covered without editing the config.

### 4. "Fails lint before review" — where lint runs

- `package.json:10` defines `"lint": "eslint ."`, which covers `.astro` and `src/pages` (eslint-plugin-astro flat configs are in `eslint.config.js`).
- CI runs it: `.github/workflows/ci.yml:20` `- run: npm run lint` in the `ci` job, before `npm test` (`:21`) and `astro check` (`:22`).
- The pre-commit hook runs ESLint on staged files through lint-staged (`package.json:65-78`; CLAUDE.md "husky pre-commit hook runs lint-staged").
- Gap: `npm run lint` over real code shows only that the _current_ code is clean. It does not show that the rule would fire. If the rule is deleted, or its `files` glob stops matching `.astro`, lint stays green. The cheapest proof that the guard works is a unit test that lints a violating fixture with the programmatic `ESLint` API (`lintText(code, { filePath })`) and asserts the rule ids `no-restricted-imports` / `no-restricted-syntax`. The fixture is a code string, not a file-tree snapshot or folder mirror. The `--stdin-filename` runs above suggest `lintText` with an existing `filePath` works with the type-aware parser. This was not run through the Node API (see Open Questions).

### 5. Service-level unit tests — already present for groups

- `src/lib/groups/__tests__/group.service.test.ts` has 13 test blocks: `create` ×4 (`:28-73`), `listForMember` ×4 (`:77-110`), `getForMember` ×5 (`:114-163`). One of them is an `it.each` over 3 malformed ids (`:145-155`), so there are 15 cases in total.
- They run against `FakeGroupRepository` (`src/lib/groups/__tests__/groups.harness.ts:6-33`). They prove the service's rules (membership filter, newest-first ordering, not-found for a non-member or malformed id, no repository call on an invalid name). By construction they cannot prove that a page goes through the service. This confirms the "must challenge" assumption.
- Aggregate and value objects have their own unit files (`group.aggregate.test.ts`, `group-name.value.test.ts`, `billing-month.value.test.ts`).
- `createGroupService` (`src/lib/groups/group.repository.ts:63-69`) has no unit test. It is wiring, exercised by `scripts/smoke.mjs` through the three call sites. Per the test plan, testing it does not belong in Phase 1.
- Correction to the response guidance: "service-level unit tests" should not be a deliverable of Phase 1 for groups. Adding more would repeat existing coverage. The Phase 1 test deliverable is the guard's own negative test (§4). Later modules (invites) get service tests in their own slices (`context/changes/invite-member-by-link/plan.md:242`).

### 6. The SQL-function leg of Risk #3

- `create_group` contains one check beyond auth: `p_host_id is distinct from auth.uid()` (`supabase/migrations/20261002200553_settlement_groups.sql:85-89`). Its comment labels it "Persistence backstop, not a business rule (approved for S-02)". The function comment says "Persistence only — business rules live in src/lib/groups".
- Table constraints copy domain limits as backstops: `check (char_length(name) between 1 and 60)` (`:16`) against `GroupName.MAX_LENGTH = 60` (`src/lib/groups/group-name.value.ts:8`). Also `check (extract(day from month) = 1)` (`:41`) and one open period per group (`:49`).
- ESLint cannot see SQL, so Phase 1's lint guard does not cover this leg. The existing DB tests cover the backstops' refusals (`group.repository.db.test.ts:167,179,190,204`) and tolerance of names stored past the aggregate (`:212`).
- No test pins the two copies of the name limit together. A scan for `repeat(` in the DB test found nothing, so no test sends a 60-code-point name to `create_group`. If the aggregate raised `MAX_LENGTH`, every unit test would stay green while longer names failed in the database as `unexpected`. This is the concrete form of "domain tests green, user-visible behaviour wrong" in SQL. The cheapest fix would be one DB test that stores a name of exactly `GroupName.MAX_LENGTH` code points. It fits Risk #5's repository round-trip (test-plan §2, row #5) better than a lint phase.

## Code References

- `src/lib/groups/index.ts:8` — the barrel re-exports `createSupabaseGroupRepository`, a bypass path no outside caller imports through the barrel
- `src/lib/groups/group.repository.ts:18,30,50` — the 3 `.rpc(` calls in non-test `src/`
- `src/lib/groups/group.repository.ts:63-69` — `createGroupService`, the composition entry used by all 3 web call sites
- `src/lib/groups/group.service.ts:9-12` — "only entry point" claim, enforced by nothing
- `src/lib/supabase.ts:6-22` — full typed client handed to any page
- `src/pages/api/groups/index.ts:2-3,19`, `src/pages/dashboard.astro:5-6,16`, `src/pages/groups/[id].astro:4-5,15` — the 3 domain call sites
- `src/components/groups/CreateGroupForm.astro:2,21` — component uses `GroupName.MAX_LENGTH` from the barrel
- `src/lib/groups/__tests__/group.service.test.ts:27-164` — existing service tests (fake repository)
- `src/lib/groups/__tests__/group.repository.db.test.ts:6` — the only outside consumer of `createSupabaseGroupRepository` (internal path)
- `eslint.config.js` — no boundary rules today; `.claude/` and `database.types.ts` are globally ignored
- `package.json:10`, `.github/workflows/ci.yml:20` — lint runs in CI before tests
- `supabase/migrations/20261002200553_settlement_groups.sql:16,41,49,85-89` — SQL backstops copying domain limits

## Architecture Insights

- The DDD layering (only the service uses the repository, and only the repository talks to Supabase data APIs) maps onto two static facts lint can check:
  - Web files import a module only through its barrel and never import a `*Repository` name.
  - Only `*.repository.ts` files (and tests) call `.rpc` / `.from` / `.schema`.
    Both are keyed on naming conventions the repo already has (`@/lib/<module>` barrels, the `.repository.ts` role suffix), so the guard grows with new modules without editing the config.
- Whether the barrel should export `createSupabase*Repository` at all is a design choice the plan must make. Option A: drop the export (it has no barrel consumer today). Option B: keep it and ban the name at the boundary with `importNamePattern`. Option B still guards a future module that re-adds such an export. A and B can be combined.
- `@/lib/supabase` stays importable by pages: auth endpoints and the middleware legitimately need `supabase.auth.*`. The syntax rule therefore bans data-API _calls_, not the client import.

## Historical Context (from prior changes)

- `context/archive/2026-10-02-create-settlement-group/reviews/impl-review-phase-3.md:62-73` (F2): pages once built `createSupabaseGroupRepository(supabase)` themselves and passed it to `new GroupService(...)`. The fix added `createGroupService(client)` to the barrel. This is supported at 5af5961: the 3 call sites use `createGroupService`. The barrel kept `createSupabaseGroupRepository` (`index.ts:8`), and that export is the leftover bypass path.
- `context/archive/2026-10-02-create-settlement-group/plan.md:271` states that the repository "imports only `@supabase/supabase-js` types and `@/db`, never `@/lib/supabase`". This is supported: `group.repository.ts:1-6`.
- `context/changes/invite-member-by-link/plan.md:332` plans `src/lib/invites/invite.repository.ts` "exported from `src/lib/invites/index.ts`", and `:350` plans `createInviteService(client)`. The next module will repeat the same barrel shape, which argues for a module-generic rule (`regex` + `importNamePattern`) over a per-module `paths` list.
- `context/foundation/test-plan.md:109` records that Context7 confirmed `patterns` with `group` + `message` on ESLint 10.5. This is supported, and on 10.11.0 `importNamePattern` and `allowTypeImports` in patterns also work or exist (empirical run and Context7 rule source).

## Related Research

- `context/changes/invite-member-by-link/research.md` — module structure for the invites slice (persistence functions in `public`, barrel shape)

## Test-plan backport candidates

These are for `/10x-test-plan` to decide on. Research did not edit `test-plan.md`.

1. **Anchor correction (§2 row #3, Source column):** the hot-spot `src/pages/api` (7 changes in 30 days) is weak evidence. Only 1 of its 5 endpoints touches the domain. The bypass surfaces are the module barrel, `src/lib/supabase.ts` and the `.astro` pages.
2. **Response-guidance correction (§2 Risk Response Guidance, row #3):**
   - Test layer: "`no-restricted-imports`" alone does not catch direct `.rpc`/`.from` calls, barrel-exported repository factories or dynamic `import()`. It needs `no-restricted-syntax` and `importNamePattern` as well.
   - Test type: "service-level unit tests" already exist for groups. The missing test is a negative-fixture test of the lint config.
   - Scope: the SQL-function leg is out of lint's reach. Its one untested drift case (name-limit duplication) fits Risk #5.

## Open Questions

1. **Where does the guard's own test live?** The Vitest `unit` project includes only `src/**/__tests__/**/*.test.ts` (CLAUDE.md, Commands). The guard is not a domain module, and CLAUDE.md requires every module to have `index.ts`/`types.ts`/`__tests__`. Placement (for example widening the Vitest `include` to a top-level test location, or a `src/…/__tests__/` home) is a plan decision.
2. **Is programmatic `lintText` cheap enough for the `unit` project?** Type-aware linting (`projectService`) starts a TypeScript program. This was not measured; the `--stdin` CLI runs above were the only timing evidence and were not instrumented.
3. **Drop `createSupabaseGroupRepository` from the barrel, ban it at the boundary, or both?** This is a design choice (see Architecture Insights).
4. **Should `@/db` (the `Database` type) also be restricted in web files?** No web file imports it today. It is not a persistence path by itself, so this is low value.
