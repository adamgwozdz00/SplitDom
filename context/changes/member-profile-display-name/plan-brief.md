# Member Profile with a Display Name (S-10) — Plan Brief

> Full plan: `context/changes/member-profile-display-name/plan.md`

## What & Why

A member sets one display name on `/profile`, and the group shows it instead of their email in every view that labels a member. Emails make the balance view hard to read; this slice (roadmap S-10, issue #27) fixes that without touching balance logic.

## Starting Point

The labelling rule already lives in one function, `memberLabel`, used by five group components, and it shows the email from the group snapshot. The `MemberProfile` aggregate (S-06) holds the bank account number and has a proven pattern for letting group members read another member's profile data.

## Desired End State

On `/profile` a member saves or clears a display name in its own form. Fellow members see that name in balances, debts, transfer details, payments and the expense list; without a name they see the email, as today. Outsiders cannot read the name.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope of the name | One per user, across all groups | Matches the roadmap design note; lives in `MemberProfile` | Plan |
| Duplicate names | Allowed, no check or disambiguation | Keeps profiles independent of groups; no race on joining | Plan |
| Form | Separate form and endpoint on `/profile` | An invalid account number never blocks the name, small diff | Plan |
| Where shown | Group views only (via `memberLabel`) | Matches "wherever the group labels a member"; Topbar and dashboard keep the email | Plan |
| Limits | Trim, 1–40 code points, no control characters, blank clears | Simple value object like `AccountNumber`; Astro escapes output | Plan |
| Label order | You → display name → email → "Member" | One rule in one function | Plan |
| Database | Expand only: new column, `get_group_member_display_names`, a new-named save function | The old save cannot gain a parameter without a PostgREST ambiguity; old Worker keeps working | Plan |

## Scope

**In scope:** `DisplayName` value object, aggregate/service/repository changes, migration, `/profile` form and endpoint, `memberLabel` and the five components, unit tests, smoke steps, CLAUDE.md and roadmap updates.

**Out of scope:** name uniqueness, name in the Topbar/dashboard/invite preview, per-group names, dropping the old save function, Playwright.

## Architecture / Approach

Follow the account-number path end to end: the aggregate owns the rules, the service loads/changes/saves with the one-retry on a lost race, and a new `security definer` function returns the names of fellow members of a group the caller belongs to. The group page loads names for all members in one call and passes a map to the five components, which feed `memberLabel`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Domain and persistence | `DisplayName`, aggregate, service, repository, migration, unit tests | New save function must keep the version guard identical |
| 2. Profile form and group labels | `/profile` form, endpoint, `memberLabel` precedence, five components | Missing a `memberLabel` call site |
| 3. Smoke and documentation | Smoke steps incl. stranger check, CLAUDE.md, roadmap | Smoke needs a running server and local Supabase |

**Prerequisites:** S-04 and S-06 done. **Estimated effort:** about half a day.

## Success Criteria (Summary)

- A saved name replaces the email for co-members in every group view and disappears when cleared.
- A user outside the group cannot read the name through the Data API.
- `npm test`, `npx astro check`, `npm run lint`, `npm run build` and `npm run smoke` pass.
