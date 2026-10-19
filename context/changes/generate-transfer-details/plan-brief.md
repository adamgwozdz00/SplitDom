# Generate Transfer Details (S-06) — Plan Brief

> Full plan: `context/changes/generate-transfer-details/plan.md`

## What & Why

A member stores their Polish bank account number on a profile page, and a debtor sees copyable transfer details (account number, amount, title) next to each of their debts. This delivers FR-007 so settling a debt no longer needs the spreadsheet or retyping amounts.

## Starting Point

Balances and netted pair debts already render on the group page, and a copy-to-clipboard pattern exists in the invite panel. No bank data, profile or NRB validation exists yet.

## Desired End State

`/profile` saves a validated account number. On a group page each debt the viewer owes shows account, amount and title with copy buttons; a missing creditor number shows a clear message. Only a debtor's creditors' numbers are fetched, and strangers cannot read them.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where the number is entered | `/profile` page | One place per person, fits future S-10 |
| Profile shape | `MemberProfile` per user, account number only | Small scope; S-10 adds display name later |
| Format | Polish NRB, 26 digits, mod-97, optional `PL` prefix | Matches PLN-only PRD and catches typos |
| Visibility | TypeScript derives the viewer's creditors; SQL scopes to shared-group members | Rules in aggregates, SQL only narrows to `auth.uid()` |
| Missing creditor number | Message at the debt, amount and title still copyable | Debtor knows whom to ask |
| Title | `SplitDom <group> <month>`, max 140 chars | Creditor recognizes the payment; no emails in bank history |
| Tests | Unit + two-user-plus-stranger smoke | Verifies privacy on a real database; no E2E |

## Scope

**In scope:** NRB value object, `MemberProfile` aggregate and service, migration with persistence functions, `/profile`, transfer panel with copy, smoke steps, docs.

**Out of scope:** display name (S-10), mark sent / confirm paid (S-07/S-08), QR, foreign IBAN, E2E, contract migration.

## Architecture / Approach

New module `src/lib/member-profiles/` (aggregate, service, repository) next to a pure `TransferDetails` builder in `billing-periods`; the page composes them. A new table `member_profiles` follows the RLS-without-policies, `security definer` function convention and is expand-only.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Domain | NRB, MemberProfile, TransferDetails with unit tests | Getting the mod-97 check right |
| 2. Persistence | Migration, functions, repository, regenerated types | Leaking numbers beyond shared groups |
| 3. UI | Profile page, endpoint, transfer panel with copy | Clipboard behavior across browsers |
| 4. Smoke and docs | Two-user plus stranger smoke, docs, roadmap | Smoke flake with extra users |

**Prerequisites:** S-04 and S-05 done (they are).
**Estimated effort:** ~3-4 sessions across 4 phases.

## Open Risks & Assumptions

- The month in the title is English (`BillingMonth.label()`); accepted.
- S-10 will extend `member_profiles`; its display-name scope question stays open there.
- Account numbers are sensitive; protection relies on RLS, the app-key gate and function scoping, not column encryption.

## Success Criteria (Summary)

- A debtor can copy account, amount and title for each of their debts.
- Only members of a shared group's debts see a creditor's number; strangers get nothing.
- `npm test`, `npx astro check`, `npm run lint` and `npm run smoke` pass.
