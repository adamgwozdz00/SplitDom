---
project: SplitDom
version: 1
status: draft
created: 2026-09-26
updated: 2026-09-26
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
| F-01 | db-migrations-and-isolation   | (foundation) schema changes ship repo → hosted DB; two-user isolation check exists  | —             | NFR-3, Guardrails          | ready    |
| S-01 | external-identity-sign-in     | user can sign in with an external identity provider                                 | —             | FR-001                     | ready    |
| S-02 | create-settlement-group       | user can create a settlement group, becomes its host, and it has an open period     | F-01          | FR-002                     | proposed |
| S-03 | invite-member-by-link         | user can invite someone with a link/code, and that person joins the group           | S-02          | FR-003                     | proposed |
| S-04 | add-expense-see-balances      | member can add an expense split equally and immediately see every member's balance  | S-03          | US-01, FR-004, FR-005      | blocked  |
| S-05 | edit-own-expense-rules        | expense author can edit or delete their own expense only while it is still editable | S-04          | FR-005                     | proposed |
| S-06 | generate-transfer-details     | debtor can copy transfer details (account number, amount, title) for a debt         | S-04          | FR-007                     | proposed |
| S-07 | mark-transfer-sent            | debtor can mark a transfer as sent, as a reminder for themselves                    | S-04          | FR-008                     | proposed |
| S-08 | confirm-debt-paid             | creditor can confirm a debt as paid, which closes it                                | S-04          | FR-009                     | proposed |
| S-09 | host-closes-period            | host can close a finished period, which freezes it and opens the next one           | S-05, S-08    | US-02, FR-015              | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                   | Chain                                               | Note                                                                                     |
| ------ | ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | Group and expenses      | `F-01` → `S-02` → `S-03` → `S-04` → `S-05`          | The must-have path to the north star; the critical path under the `speed` goal.          |
| B      | Sign-in                 | `S-01`                                              | Standalone; existing email/password sign-in keeps every other slice unblocked meanwhile. |
| C      | Settlement and closing  | `S-06` · `S-07` · `S-08` → `S-09`                   | Joins Stream A at `S-04`; `S-06`–`S-08` can run in parallel; `S-09` also needs `S-05`.   |

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

- **Outcome:** (foundation) schema changes are authored in the repo and applied the same way to the local and the hosted database, and a repeatable two-user check proves that one user cannot read another group's data — ready for each group-scoped slice to extend.
- **Change ID:** db-migrations-and-isolation
- **PRD refs:** NFR-3, Success Criteria § Guardrails (per-group privacy)
- **Unlocks:** S-02 (first persisted domain data), and the per-group isolation verification path that S-02, S-03, S-04, S-06 extend.
- **Prerequisites:** — (hosted database project already linked per Baseline)
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Are migrations applied to the hosted database automatically on merge, or manually by the owner? — Owner: user. Block: no.
- **Risk:** Sequenced first because the baseline has no schema or migration path at all; the risk is scope creep into designing the whole schema up front — this foundation delivers only the pipeline and the isolation check, not the domain tables.
- **Status:** ready

## Slices

### S-01: Sign in with an external identity provider

- **Outcome:** user can sign in with one external identity provider and land in the app signed in.
- **Change ID:** external-identity-sign-in
- **PRD refs:** FR-001
- **Prerequisites:** — (auth session handling already present per Baseline)
- **Parallel with:** F-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Which single identity provider for MVP (PRD says "one provider" but does not name it)? — Owner: user. Block: no.
  - Does the existing email/password sign-in stay available (it is FR-013, nice-to-have, but already built)? — Owner: user. Block: no.
- **Risk:** Off the critical path because email/password sign-in already works for development; it also sidesteps the accepted cross-device email-confirmation limitation, which matters for a household app used on phones.
- **Status:** ready

### S-02: Create a settlement group

- **Outcome:** user can create a settlement group, becomes its permanent host, and the group starts with one open billing period.
- **Change ID:** create-settlement-group
- **PRD refs:** FR-002
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Establishes the one-group-per-user rule and the host role that S-09 relies on; getting the host assignment wrong here would ripple into period closing.
- **Status:** proposed

### S-03: Invite a member by link or code

- **Outcome:** user can generate an invite link/code, send it through any channel, and the invited person joins the group after signing in.
- **Change ID:** invite-member-by-link
- **PRD refs:** FR-003
- **Prerequisites:** S-02
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - What happens when the invited person already belongs to another group (MVP allows one group per user)? — Owner: user. Block: no.
  - Does an invite expire or work only once? — Owner: user. Block: no.
- **Risk:** Required before the north star because US-01 needs two members; it is the first flow where a second real user touches the group, so it is where the isolation check first matters for strangers.
- **Status:** proposed

### S-04: Add an expense and see balances

- **Outcome:** group member can add an expense in the open period, split equally between all members, and immediately see each member's debt or credit (e.g. 400 zł rent → the other member owes 200 zł).
- **Change ID:** add-expense-see-balances
- **PRD refs:** US-01, FR-004, FR-005
- **Prerequisites:** S-03
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - How are debts recorded: one debt per expense share, or netted into one debt per pair of members per period? This decides what S-06, S-08, S-05 and S-09 act on. — Owner: user. Block: yes.
  - How are amounts that don't split evenly rounded (e.g. 100 zł / 3) while keeping "sum of expenses = sum of shares"? — Owner: user. Block: no.
- **Risk:** This is the north star and carries the balance-correctness guardrail; a wrong debt model here forces rework in every settlement slice, which is why the debt-granularity question blocks planning.
- **Status:** blocked

### S-05: Edit and delete rules for own expenses

- **Outcome:** expense author can edit or delete their own expense while its period is open and its debt is not yet confirmed as paid; nobody else can modify it.
- **Change ID:** edit-own-expense-rules
- **PRD refs:** FR-005
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Kept separate from S-04 so the north star stays small; it must land before S-09 because closing a period relies on the "no edits after lock" rule.
- **Status:** proposed

### S-06: Generate transfer details

- **Outcome:** debtor can see and copy plain-text transfer details for a debt — creditor's account number, amount, and transfer title — to paste into any online banking.
- **Change ID:** generate-transfer-details
- **PRD refs:** FR-007
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Where and when does a member provide their bank account number? — Owner: user. Block: no.
- **Risk:** Introduces the most sensitive data in the app (account numbers), so it extends the F-01 isolation check; low logic risk otherwise.
- **Status:** proposed

### S-07: Mark a transfer as sent

- **Outcome:** debtor can mark a transfer as sent, as a reminder for themselves; the debt stays open until the creditor confirms it.
- **Change ID:** mark-transfer-sent
- **PRD refs:** FR-008
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small, independent status change; sequenced after S-04 only because it needs a debt to exist.
- **Status:** proposed

### S-08: Confirm a debt as paid

- **Outcome:** creditor can confirm that a debt has been paid, which closes it and locks the related expense against edits.
- **Change ID:** confirm-debt-paid
- **PRD refs:** FR-009
- **Prerequisites:** S-04
- **Parallel with:** S-01, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The only action that finally settles money in the app; S-09's closing precondition depends on it, so it sits on the path to milestone completion.
- **Status:** proposed

### S-09: Host closes the billing period

- **Outcome:** host can close the current period once its calendar month has ended and all of the host's own debts from it are confirmed paid; its expenses become read-only and exactly one new open period starts.
- **Change ID:** host-closes-period
- **PRD refs:** US-02, FR-015
- **Prerequisites:** S-05, S-08
- **Parallel with:** S-01, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Which timezone defines "the calendar month has ended"? — Owner: user. Block: no.
- **Risk:** The most rule-heavy slice (host-only, month ended, host's debts paid, exactly one new open period); placed last because it consumes the edit-lock and paid-debt rules from S-05 and S-08.
- **Status:** proposed

## Backlog Handoff

Mirrored on GitHub: milestone [M-1](https://github.com/adamgwozdz00/SplitDom/milestone/1), board [SplitDom Roadmap](https://github.com/users/adamgwozdz00/projects/6).

| Roadmap ID | Change ID                   | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                                    |
| ---------- | --------------------------- | ------------------------------------------------------------ | --------------------- | -------------------------------------------------------- |
| F-01       | db-migrations-and-isolation | Set up DB migrations and a two-user group-isolation check    | yes                   | [#5](https://github.com/adamgwozdz00/SplitDom/issues/5) · Run `/10x-plan db-migrations-and-isolation` |
| S-01       | external-identity-sign-in   | Sign in with an external identity provider                   | yes                   | [#6](https://github.com/adamgwozdz00/SplitDom/issues/6) · Run `/10x-plan external-identity-sign-in`; pick provider |
| S-02       | create-settlement-group     | Create a settlement group with its first open period         | no                    | [#7](https://github.com/adamgwozdz00/SplitDom/issues/7) · Needs F-01 |
| S-03       | invite-member-by-link       | Invite a member to the group by link/code                    | no                    | [#8](https://github.com/adamgwozdz00/SplitDom/issues/8) · Needs S-02 |
| S-04       | add-expense-see-balances    | Add an expense split equally and show member balances        | no                    | [#9](https://github.com/adamgwozdz00/SplitDom/issues/9) · Needs S-03 and the debt-granularity decision |
| S-05       | edit-own-expense-rules      | Enforce edit/delete rules for an author's own expenses       | no                    | [#10](https://github.com/adamgwozdz00/SplitDom/issues/10) · Needs S-04 |
| S-06       | generate-transfer-details   | Generate copyable transfer details for a debt                | no                    | [#11](https://github.com/adamgwozdz00/SplitDom/issues/11) · Needs S-04 |
| S-07       | mark-transfer-sent          | Let the debtor mark a transfer as sent                       | no                    | [#12](https://github.com/adamgwozdz00/SplitDom/issues/12) · Needs S-04 |
| S-08       | confirm-debt-paid           | Let the creditor confirm a debt as paid                      | no                    | [#13](https://github.com/adamgwozdz00/SplitDom/issues/13) · Needs S-04 |
| S-09       | host-closes-period          | Let the host close a finished period and open the next one   | no                    | [#14](https://github.com/adamgwozdz00/SplitDom/issues/14) · Needs S-05 and S-08 |

## Open Roadmap Questions

1. **How are debts recorded — per expense share, or netted per pair of members per period?** — Owner: user. Block: S-04 (and through it S-05, S-06, S-07, S-08, S-09).
2. **What is the expected request volume (qps) at target scale?** (PRD Open Question 1) — Owner: user. Block: roadmap-wide: no.
3. **What is the expected data volume?** (PRD Open Question 2) — Owner: user. Block: roadmap-wide: no.

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
