---
project: SplitDom
version: 1
status: draft
created: 2026-09-26
updated: 2026-10-06
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: first-full-settlement-cycle
milestone_seq: 1
milestone_status: open
---

# Roadmap: SplitDom

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: First full settlement cycle** — Status: open

- **Intent:** A household can run one complete settlement cycle inside the app, with no spreadsheet: sign in, form a group, record shared expenses, see correct balances, settle debts by manual bank transfer, and close the period so a fresh one opens.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-007, FR-008, FR-009, FR-015 (all must-have FRs); US-01, US-02; NFR-3 and the PRD Guardrails (balance correctness, per-group privacy, author-only edits).

## Vision recap

People who share household costs — partners or roommates — settle shared expenses every month by hand: copying spreadsheets, digging through bank history, and adding amounts on a calculator. SplitDom replaces that spreadsheet for the author's own household. It is not meant to compete with existing expense-splitting apps; its value is fitting one specific settlement flow.

## North star

**S-04: Member adds an expense and immediately sees each member's debt or credit** — the smallest slice that replaces the spreadsheet's core job, sequenced as early as its prerequisites (a group with two members) allow, because under the `speed` goal nothing else is worth building until this works.

> "North star" here means the smallest end-to-end slice whose successful delivery proves the core product hypothesis — that the app can compute a household's balances correctly from shared expenses. Everything else only matters if this works.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                                                | Prerequisites | PRD refs                   | Status   |
| ---- | ----------------------------- | ----------------------------------------------------------------------------------- | ------------- | -------------------------- | -------- |
| F-01 | db-migrations-and-isolation   | (foundation) schema changes ship repo → hosted DB; two-user test harness + RLS guard | —             | NFR-3, Guardrails          | done |
| S-01 | external-identity-sign-in     | user can sign in with an external identity provider                                 | —             | FR-001                     | done |
| S-02 | create-settlement-group       | user can create a settlement group, becomes its host, and it has an open period     | F-01          | FR-002                     | done |
| S-03 | invite-member-by-link         | user can invite someone with a link/code, and that person joins the group           | S-02          | FR-003                     | done        |
| S-04 | add-expense-see-balances      | member can add an expense split equally and immediately see every member's balance  | S-03          | US-01, FR-004, FR-005      | in-progress |
| F-02 | billing-period-aggregate      | (foundation) `BillingPeriod` is the aggregate root that adds expenses and splits them | S-04          | FR-004, FR-005, FR-015     | proposed |
| S-05 | edit-own-expense-rules        | expense author can edit or delete their own expense only while it is still editable | F-02          | FR-005                     | proposed |
| S-06 | generate-transfer-details     | debtor can copy transfer details (account number, amount, title) for a debt         | S-04          | FR-007                     | proposed |
| S-07 | mark-transfer-sent            | debtor can mark a transfer as sent, as a reminder for themselves                    | F-02          | FR-008                     | proposed |
| S-08 | confirm-debt-paid             | creditor can confirm a debt as paid, which closes it                                | F-02          | FR-009                     | proposed |
| S-09 | host-closes-period            | host can close a finished period, which freezes it and opens the next one           | S-05, S-08    | US-02, FR-015              | proposed |
| S-10 | member-profile-display-name   | member can set a display name that the group shows instead of their email           | S-04          | — (supports US-01)         | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                   | Chain                                               | Note                                                                                     |
| ------ | ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | Group and expenses      | `F-01` → `S-02` → `S-03` → `S-04` → `F-02` → `S-05` · `S-10` | The must-have path to the north star; the critical path under the `speed` goal. `S-10` branches off `S-04` and is off the critical path. |
| B      | Sign-in                 | `S-01`                                              | Standalone; existing email/password sign-in keeps every other slice unblocked meanwhile. |
| C      | Settlement and closing  | `S-06` · `S-07` · `S-08` → `S-09`                   | `S-06` joins Stream A at `S-04`, `S-07` and `S-08` at `F-02`; they can run in parallel; `S-09` also needs `S-05`. |

## Baseline

What's already in place in the codebase as of `2026-09-26` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 + Tailwind 4 + shadcn/ui (`astro.config.mjs`, `src/components/ui/`); `src/pages/dashboard.astro` is still a starter placeholder.
- **Backend / API:** partial — Astro API routes exist only for auth (`src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`, `src/pages/auth/callback.ts`); no domain endpoints.
- **Data:** partial — Supabase client (`src/lib/supabase.ts`) and a linked hosted Supabase project exist; no migrations, schema, or access policies (`supabase/` contains only `config.toml` and `snippets/`).
- **Auth:** partial — email + password sign-up/sign-in with PKCE email-confirmation callback and `/dashboard` route protection (`src/middleware.ts`) work; sign-in with an external identity provider (FR-001) is absent. Known accepted limitation: confirming email on a different browser/device fails (see `context/deployment/deploy-plan.md`).
- **Deploy / infra:** present — Cloudflare Workers, GitHub Actions `ci` + `smoke` + `deploy` on merge to `main`, secrets wired (`.github/workflows/ci.yml`, `context/deployment/deploy-plan.md`).
- **Observability:** absent — no logging library or error tracking.

## Foundations

### F-01: Database migrations and group-isolation check

- **Outcome:** (foundation) schema changes are authored in the repo and applied the same way to the local and the hosted database (pushed to production before each Worker deploy), and a reusable two-user test harness plus a guard that fails CI on any public table without row-level security are ready for each group-scoped slice to prove that one user cannot read another group's data. No domain tables — they emerge from S-02's domain model.
- **Change ID:** db-migrations-and-isolation
- **PRD refs:** NFR-3, Success Criteria § Guardrails (per-group privacy)
- **Unlocks:** S-02 (first persisted domain data), and the per-group isolation model (RLS without policies, revoked grants, `security definer` persistence functions) that S-02, S-03, S-04, S-06 extend. (Its two-user DB test harness was removed on 2026-10-05 in `block-direct-data-api`; the Data API now also refuses calls without the Worker's app key.)
- **Prerequisites:** — (hosted database project already linked per Baseline)
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - ~~Are migrations applied to the hosted database automatically on merge, or manually by the owner?~~ Resolved 2026-09-27: automatically, `supabase db push` in the `deploy` job before `wrangler deploy`.
- **Risk:** Sequenced first because the baseline has no schema or migration path at all; the risk is scope creep into designing the whole schema up front — this foundation delivers only the pipeline, the test harness and the RLS guard, not the domain tables.
- **Status:** done

### F-02: BillingPeriod as the aggregate root for expenses

- **Outcome:** (foundation) the expenses model is reshaped around behaviour instead of tables: `BillingPeriod` becomes the aggregate root that adds expenses, splits them through a `SplitPolicy` and derives balances, so the rules that span a whole period (expenses only in the open period, no edits once the period is closed or a debt is paid, host-only closing) have one consistency boundary. `Expense` becomes an entity inside the aggregate (it keeps a local id because it will be edited and deleted), `ExpenseShare` a value object computed by the split policy. `Group` keeps membership and the host; the period references it by id and receives the participants. Behaviour visible to users does not change. Built test-first (TDD).
- **Change ID:** billing-period-aggregate
- **PRD refs:** FR-004, FR-005, FR-015 (no new functionality; prepares the consistency boundary these rely on)
- **Unlocks:** S-05 (edit/delete through `BillingPeriod`), S-07 and S-08 (transfers and paid debts live in the same aggregate, because they lock edits and gate closing), and through them S-09.
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-06, S-10
- **Blockers:** —
- **Unknowns:**
  - Do transfers and paid-debt confirmations (FR-008/009) live inside `BillingPeriod`? Leaning yes, since they block edits and closing. — Owner: user. Block: no (F-02 only leaves room for them).
  - FR-005 locks an expense once "its debt" is paid, but debts are netted per pair of members across many expenses. Does a paid debt lock every expense of that pair in the period, or freeze the balance and let later edits create a compensating debt? — Owner: user. Block: S-05, S-08.
  - Concurrent writes: two members adding an expense at once both change the same aggregate, so `billing_periods` needs a version column (optimistic locking) or an equivalent guard. — Owner: user. Block: no.
  - Does the open period move out of the `Group` aggregate into its own `billing_periods` repository? — Owner: user. Block: no.
- **Risk:** A refactor right after the north star; the risk is regressing balance correctness, so the existing expense and balance tests must keep passing and the new aggregate is driven by tests written first. Sequenced before S-05, S-07 and S-08 so they build on the new boundary instead of being reworked later.
- **Status:** proposed

## Slices

### S-01: Sign in with an external identity provider

- **Outcome:** user can sign in with one external identity provider and land in the app signed in.
- **Change ID:** external-identity-sign-in
- **PRD refs:** FR-001
- **Prerequisites:** — (auth session handling already present per Baseline)
- **Parallel with:** F-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - ~~Which single identity provider for MVP (PRD says "one provider" but does not name it)?~~ Resolved 2026-09-28: Google.
  - ~~Does the existing email/password sign-in stay available (it is FR-013, nice-to-have, but already built)?~~ Resolved 2026-09-28: yes, it stays alongside Google sign-in.
- **Risk:** Off the critical path because email/password sign-in already works for development; it also sidesteps the accepted cross-device email-confirmation limitation, which matters for a household app used on phones.
- **Status:** done

### S-02: Create a settlement group

- **Outcome:** user can create a settlement group, becomes its permanent host, and the group starts with one open billing period; the group's tables come from this slice's domain model and ship with the first two-user isolation test (user B cannot read user A's group), built on the F-01 harness.
- **Change ID:** create-settlement-group
- **PRD refs:** FR-002
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Establishes the host role and the membership-based group access that S-09 and every later slice rely on; getting the host assignment wrong here would ripple into period closing. (FR-002 changed 2026-10-02: a user may create and belong to many groups.)
- **Status:** done

### S-03: Invite a member by link or code

- **Outcome:** user can generate an invite link/code, send it through any channel, and the invited person joins the group after signing in.
- **Change ID:** invite-member-by-link
- **PRD refs:** FR-003
- **Prerequisites:** S-02
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - ~~What happens when the invited person already belongs to another group?~~ Resolved 2026-10-02: no longer applies — FR-002 now allows a user to belong to many groups, so the invitee simply joins one more.
  - ~~Does an invite expire or work only once?~~ Resolved 2026-10-04: an invite works once and expires after 7 days (`context/changes/invite-member-by-link/research.md`, Decisions).
- **Risk:** Required before the north star because US-01 needs two members; it is the first flow where a second real user touches the group, so it is where the isolation check first matters for strangers.
- **Status:** done

### S-04: Add an expense and see balances

- **Outcome:** group member can add an expense in the open period, split equally between all members, and immediately see each member's debt or credit (e.g. 400 zł rent → the other member owes 200 zł).
- **Change ID:** add-expense-see-balances
- **PRD refs:** US-01, FR-004, FR-005
- **Prerequisites:** S-03
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - ~~How are debts recorded: one debt per expense share, or netted into one debt per pair of members per period? This decides what S-06, S-08, S-05 and S-09 act on.~~ Resolved 2026-10-05 (S-04 planning): a netted debt per pair of members per period, derived from shares stored per expense (`context/changes/add-expense-see-balances/plan.md`).
  - ~~How are amounts that don't split evenly rounded (e.g. 100 zł / 3) while keeping "sum of expenses = sum of shares"?~~ Resolved 2026-10-05 (S-04 planning): integer grosze; debtors pay floor(amount / n), the payer's share absorbs the remainder (`context/changes/add-expense-see-balances/plan.md`).
- **Risk:** This is the north star and carries the balance-correctness guardrail; a wrong debt model here forces rework in every settlement slice, which is why the debt-granularity question blocks planning.
- **Status:** in-progress

### S-05: Edit and delete rules for own expenses

- **Outcome:** expense author can edit or delete their own expense while its period is open and its debt is not yet confirmed as paid; nobody else can modify it.
- **Change ID:** edit-own-expense-rules
- **PRD refs:** FR-005
- **Prerequisites:** F-02
- **Parallel with:** S-01, S-06, S-07, S-08, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Kept separate from S-04 so the north star stays small; it must land before S-09 because closing a period relies on the "no edits after lock" rule. Until it lands, a duplicate expense (a POST sent without JavaScript or retried) cannot be removed (see `context/deployment/deploy-plan.md`, "Expenses").
- **Status:** proposed

### S-06: Generate transfer details

- **Outcome:** debtor can see and copy plain-text transfer details for a debt — creditor's account number, amount, and transfer title — to paste into any online banking.
- **Change ID:** generate-transfer-details
- **PRD refs:** FR-007
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-05, S-07, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:**
  - Where and when does a member provide their bank account number? — Owner: user. Block: no.
- **Risk:** Introduces the most sensitive data in the app (account numbers), so it must follow the F-01 isolation model (and stays behind the app-key gate); low logic risk otherwise.
- **Status:** proposed

### S-07: Mark a transfer as sent

- **Outcome:** debtor can mark a transfer as sent, as a reminder for themselves; the debt stays open until the creditor confirms it.
- **Change ID:** mark-transfer-sent
- **PRD refs:** FR-008
- **Prerequisites:** F-02
- **Parallel with:** S-01, S-05, S-06, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small, independent status change; sequenced after S-04 only because it needs a debt to exist.
- **Status:** proposed

### S-08: Confirm a debt as paid

- **Outcome:** creditor can confirm that a debt has been paid, which closes it and locks the related expense against edits.
- **Change ID:** confirm-debt-paid
- **PRD refs:** FR-009
- **Prerequisites:** F-02
- **Parallel with:** S-01, S-05, S-06, S-07, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The only action that finally settles money in the app; S-09's closing precondition depends on it, so it sits on the path to milestone completion.
- **Status:** proposed

### S-09: Host closes the billing period

- **Outcome:** host can close the current period once its calendar month has ended and all of the host's own debts from it are confirmed paid; its expenses become read-only and exactly one new open period starts.
- **Change ID:** host-closes-period
- **PRD refs:** US-02, FR-015
- **Prerequisites:** S-05, S-08
- **Parallel with:** S-01, S-06, S-07, S-10
- **Blockers:** —
- **Unknowns:**
  - ~~Which timezone defines "the calendar month has ended"?~~ Resolved 2026-10-02 (S-02 planning): Europe/Warsaw; timestamps stay in UTC, and `BillingMonth` in `src/lib/groups/` is the single place that maps a moment to its billing month.
  - How does `add_expense` stay safe against a period closed between loading the group and storing the expense? It does not check that the period is open (S-04 left this to S-09 on purpose); a race-safe guard needs a `closed_at is null` check with `for share` on the period row in `add_expense` and `for update` in the closing function. (S-04 implementation review, 2026-10-06)
  - Can the new open period's month start after today in Europe/Warsaw? If so, `PurchaseDate.window` gives min > max and rejects every purchase date, so either the next period opens only once its month has started or the window rule changes. (S-04 implementation review, 2026-10-06)
- **Risk:** The most rule-heavy slice (host-only, month ended, host's debts paid, exactly one new open period); placed last because it consumes the edit-lock and paid-debt rules from S-05 and S-08.
- **Status:** proposed

### S-10: Member profile with a display name

- **Outcome:** member can set a display name in their profile; wherever the group labels a member (balances, debts, expense list), the display name is shown first, falling back to the member's email.
- **Change ID:** member-profile-display-name
- **PRD refs:** — (not in PRD v1; makes the US-01 balance view readable without exposing emails as the primary label)
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Is the display name per user (one name in every group) or per group membership? — Owner: user. Block: no.
  - Should the profile also hold the bank account number that S-06 needs (S-06 unknown "where and when does a member provide their bank account number")? — Owner: user. Block: no.
- **Risk:** Low logic risk, provided S-04 keeps the member-labelling rule in one place, so this slice changes the label source without touching the balance views. Added 2026-10-05 during S-04 planning.
- **Status:** proposed

## Backlog Handoff

Mirrored on GitHub: milestone [M-1](https://github.com/adamgwozdz00/SplitDom/milestone/1), board [SplitDom Roadmap](https://github.com/users/adamgwozdz00/projects/6).

| Roadmap ID | Change ID                   | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                                    |
| ---------- | --------------------------- | ------------------------------------------------------------ | --------------------- | -------------------------------------------------------- |
| F-01       | db-migrations-and-isolation | Set up DB migrations and a two-user group-isolation check    | done                  | [#5](https://github.com/adamgwozdz00/SplitDom/issues/5) · Delivered in [PR #18](https://github.com/adamgwozdz00/SplitDom/pull/18) |
| S-01       | external-identity-sign-in   | Sign in with an external identity provider                   | done                  | [#6](https://github.com/adamgwozdz00/SplitDom/issues/6) · Delivered in [PR #20](https://github.com/adamgwozdz00/SplitDom/pull/20) |
| S-02       | create-settlement-group     | Create a settlement group with its first open period         | done                  | [#7](https://github.com/adamgwozdz00/SplitDom/issues/7) · Delivered in [PR #23](https://github.com/adamgwozdz00/SplitDom/pull/23) |
| S-03       | invite-member-by-link       | Invite a member to the group by link/code                    | yes                   | [#8](https://github.com/adamgwozdz00/SplitDom/issues/8) · Run `/10x-plan invite-member-by-link`; research in `context/changes/invite-member-by-link/research.md` |
| S-04       | add-expense-see-balances    | Add an expense split equally and show member balances        | no                    | [#9](https://github.com/adamgwozdz00/SplitDom/issues/9) · Needs S-03 and the debt-granularity decision |
| F-02       | billing-period-aggregate    | Refactor: BillingPeriod as the aggregate root for expenses   | no                    | [#32](https://github.com/adamgwozdz00/SplitDom/issues/32) · Needs S-04; then `/10x-plan billing-period-aggregate` |
| S-05       | edit-own-expense-rules      | Enforce edit/delete rules for an author's own expenses       | no                    | [#10](https://github.com/adamgwozdz00/SplitDom/issues/10) · Needs S-04 |
| S-06       | generate-transfer-details   | Generate copyable transfer details for a debt                | no                    | [#11](https://github.com/adamgwozdz00/SplitDom/issues/11) · Needs S-04 |
| S-07       | mark-transfer-sent          | Let the debtor mark a transfer as sent                       | no                    | [#12](https://github.com/adamgwozdz00/SplitDom/issues/12) · Needs S-04 |
| S-08       | confirm-debt-paid           | Let the creditor confirm a debt as paid                      | no                    | [#13](https://github.com/adamgwozdz00/SplitDom/issues/13) · Needs S-04 |
| S-09       | host-closes-period          | Let the host close a finished period and open the next one   | no                    | [#14](https://github.com/adamgwozdz00/SplitDom/issues/14) · Needs S-05 and S-08 |
| S-10       | member-profile-display-name | Let a member set a display name shown instead of their email | no                    | [#27](https://github.com/adamgwozdz00/SplitDom/issues/27) · Needs S-04 |

## Open Roadmap Questions

1. **How are debts recorded — per expense share, or netted per pair of members per period?** — Owner: user. Block: S-04 (and through it S-05, S-06, S-07, S-08, S-09).
2. **What is the expected request volume (qps) at target scale?** (PRD Open Question 1) — Owner: user. Block: roadmap-wide: no.
3. **What is the expected data volume?** (PRD Open Question 2) — Owner: user. Block: roadmap-wide: no.
4. **How is a member's personal data erased once they have expenses?** The privacy page promises deletion on request, but since S-04 a member who paid an expense or holds a share can be neither removed from a group nor deleted (see `context/deployment/deploy-plan.md`, "Known constraints on deleting a user"). Options: pseudonymise the email in `auth.users` and keep the financial rows, or delete a group's data only when its last member leaves. Whatever removes a member must also decide what happens to their expenses: `PeriodBalances` currently ignores an expense whose payer is not a member, and any share held by a non-member (`src/lib/expenses/period-balances.value.ts`). — Owner: user. Block: roadmap-wide: no (needed before the first deletion request).

## Parked

- **Minimal set of transfers settling the whole group at once (FR-006)** — Why parked: nice-to-have; pairwise settlement is enough for the `speed` goal.
- **QR code for bank payment (FR-010)** — Why parked: nice-to-have; PRD accepts it as post-MVP.
- **Expense categories with monthly/yearly summaries (FR-011)** — Why parked: nice-to-have; PRD §Non-Goals excludes advanced analytics.
- **Automatic debt payment through a mobile payment system (FR-012)** — Why parked: PRD §Non-Goals — no payment integration in MVP.
- **Email + password sign-in as an official alternative (FR-013)** — Why parked: nice-to-have; note it already exists in the codebase (see S-01 unknowns).
- **Custom expense split (own amounts / selected members) (FR-014)** — Why parked: nice-to-have; MVP uses equal split only.
- **Multiple currencies** — Why parked: PRD §Non-Goals.
- **Scheduled, automatic period closing** — Why parked: PRD §Non-Goals — closing is always a manual host action.
- **Transferring the host role** — Why parked: PRD §Non-Goals.
- **Observability (logging, error tracking)** — Why parked: absent in baseline, but no PRD requirement gates launch on it; revisit if production debugging becomes painful.

## Milestone History

## Done

- **F-01: (foundation) schema changes are authored in the repo and applied the same way to the local and the hosted database (pushed to production before each Worker deploy), and a reusable two-user test harness plus a guard that fails CI on any public table without row-level security are ready for each group-scoped slice to prove that one user cannot read another group's data. No domain tables — they emerge from S-02's domain model.** — Archived 2026-10-03 → `context/archive/2026-09-27-db-migrations-and-isolation/`. Lesson: —.
- **S-01: user can sign in with one external identity provider and land in the app signed in.** — Archived 2026-10-03 → `context/archive/2026-09-28-external-identity-sign-in/`. Lesson: —.
- **S-02: user can create a settlement group, becomes its permanent host, and the group starts with one open billing period; the group's tables come from this slice's domain model and ship with the first two-user isolation test (user B cannot read user A's group), built on the F-01 harness.** — Archived 2026-10-03 → `context/archive/2026-10-02-create-settlement-group/`. Lesson: —.
- **S-03: user can generate an invite link/code, send it through any channel, and the invited person joins the group after signing in.** — Archived 2026-10-05 → `context/archive/2026-10-02-invite-member-by-link/`. Lesson: —.
