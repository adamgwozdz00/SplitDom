---
date: 2026-10-23T00:00:00+02:00
researcher: Claude (claude-opus-5-5) with adamgwozdz00
git_commit: 411b15e
branch: feat/confirm-debt-paid
repository: SplitDom (10xDevs)
topic: "Do the S-09 (host-closes-period) guidelines fit the accounting (ledger) archetype the billing period already uses?"
tags: [research, external, billing-periods, period-close, ledger, S-09]
status: complete
last_updated: 2026-10-26
last_updated_by: Claude (claude-opus-5-5)
last_updated_note: "Decision 3 recorded (FR-005 lock: oldest-first application); handoff to /10x-plan added"
---

# Research: Do the S-09 guidelines fit the accounting archetype?

**Date**: 2026-10-23
**Researcher**: Claude (claude-opus-5-5) with adamgwozdz00
**Git Commit**: 411b15e
**Branch**: feat/confirm-debt-paid
**Repository**: SplitDom (10xDevs)

## Research Question

Search the web (exa.ai) and decide together whether the current guidelines of slice S-09 (host-closes-period) are adequate and fit the accounting archetype SplitDom already uses (a ledger of entries with posted and pending balances, adopted in S-07/S-08).

## Summary

The guidelines fit the archetype on **locking** and on **which balance judges the rule**, but they diverge from it on **what happens to balances that are still open at close** and on **pending entries at close**:

1. **Fits** — a closed period refuses every posting (expenses and payments); corrections never reopen it; the close bumps `version`; the host's precondition is judged on the posted balances. This matches GnuCash, NetSuite, Intacct and the posted/pending split of Modern Treasury.
2. **Gap 1 (decisive): open debts are stranded.** In accounting, closing zeroes the period's *nominal* accounts (income, expenses) but **carries the balance-sheet accounts forward as opening balances** (GnuCash, OpenStax). A debt between two members is a receivable/payable, i.e. a balance-sheet item. S-09 only requires the *host's* debts to be settled (FR-015, by design); every other member's debt stays in the closed period, where `sendPayment`, `confirmPayment` and `rejectPayment` refuse a closed period (`billing-period.aggregate.ts:272`, `:356`). Nothing in the current guidelines moves it into the new period, so after a close those debts cannot be paid or confirmed in the app — the PRD's full cycle "up to the debt being closed" (`prd.md:33`) breaks for them.
3. **Gap 2: pending entries at close.** Accounting systems refuse to close while draft/in-progress entries sit in the period (Workday, nearsync: "post it or void it"). SplitDom's pending payments are exactly such entries. The roadmap already lists this as an unknown (`roadmap.md:247`); the archetype answers it with "block, or carry forward", never "freeze as pending forever".
4. **Gap 3: period continuity.** The new period is `BillingMonth.of(now)` (`billing-period.aggregate.ts:65-69`), so a late close (e.g. October closed on 3 December) skips November. Accounting periods are contiguous. In addition, while the old period stays open after its month ended, the purchase-date window allows only that month's dates (`purchase-date.value.ts:68-77`), so new-month expenses wait for the host's close.

Recommended direction (for `/10x-plan`, not a decision): **carry forward each open pair debt (posted balance) as an opening-balance entry of the new period**, and decide pending payments explicitly (block the close, or carry them forward). Both are standard close mechanics and keep the PRD's "host only settles their own debts" rule intact.

## Detailed Findings

### What S-09 currently says

- US-02 / FR-015: host-only; allowed when (a) the period's calendar month has ended and (b) every debt where the host is debtor is confirmed paid; closing makes the period's expenses immutable and opens exactly one new period (`context/foundation/prd.md:58-68`, `:85`).
- The PRD's Socrates resolution deliberately does **not** require other members' debts to be settled (`prd.md:86`).
- Roadmap: host's debts judged on posted balances (`context/foundation/roadmap.md:249`); close must bump `version` (`roadmap.md:245`); open unknowns on pending payments (`roadmap.md:247`) and on a new period whose month starts after today (`roadmap.md:248`).
- Neither the PRD nor the roadmap says what happens to non-host debts left in the closed period (inspected: `prd.md` FR-005/FR-008/FR-009/FR-015/US-02 and roadmap S-09 section `roadmap.md:235-250`).

### What the code does today (relevant to closing)

- Balances are computed per period from that period's expenses and payments only (`billing-period.aggregate.ts:416-431`); there is no opening-balance input.
- A closed period refuses `addExpense`, `editableExpense`, `sendPayment`, `withdrawPayment`, `confirmPayment`, `rejectPayment` (`billing-period.aggregate.ts:119`, `:166`, `:272`, `:305`, `:356`).
- `BillingPeriod.open` sets the month from `now` (`billing-period.aggregate.ts:65-69`).
- The service loads only the latest period of the group (`billing-period.service.ts:29-38`); the group page has no view of earlier periods (search of `src/pages/groups/[id].astro` for "previous|history|closed" found nothing).
- The DB allows at most one open period per group (`supabase/migrations/20261002200553_settlement_groups.sql:49`).

### The accounting archetype on closing a period (external, exa.ai)

| Rule | Source | SplitDom S-09 |
|---|---|---|
| A closed period accepts no postings, enforced below the UI | NetSuite period close; nearsync "rejected by the database"; Intacct close books | Fits (aggregate refuses; `save_billing_period_with_confirmations` stores only while open) |
| Corrections go to the next open period, history is not rewritten | nearsync; Workday ("create a reversing journal in the next open ledger period"); Intacct adjustment journal | Fits (no reopen in PRD); a correction would be a new expense/payment in the new period |
| Balance-sheet accounts carry forward as opening balances; income/expense accounts reset to zero | GnuCash book closing; OpenStax 5.1 (permanent vs temporary accounts); BusDK `opening` entry | **Gap** — expenses reset (fits), but pair debts (receivables/payables) are not carried |
| Draft / in-progress entries block the close (post or void them first) | nearsync "Drafts block the close"; Workday "must post or cancel In Progress journals" | **Open** — pending payments; roadmap unknown |
| Open lots stay with the open book | GnuCash: a transaction in an open lot is not moved to the closed book | Same idea as carrying an unsettled debt forward |
| Posted balance is the basis for reconciliation/rules; pending is the user-facing view | Modern Treasury balance types | Fits (host rule on posted balances) |
| Periods are contiguous; future periods can exist before they accept postings | BusDK period lifecycle (future → open → closed → locked) | **Gap** — `of(now)` can skip a month |
| Book closing can be partial: lock A/P or A/R before the full close | NetSuite period-close checklist | Alternative to carry-forward: "closed for expenses, open for settlements" |

Group-expense apps: when a group/app is left with unsettled balances, the recommended move is either settle everyone to zero first or add **one opening entry per balance** in the new place ("One entry captures the net result of everything that came before", Are We Even guide on leaving Splitwise). This is the same carry-forward mechanic in consumer terms.

### Options for the stranded debts (Gap 1)

1. **Carry forward (archetype default).** On close, for every pair with a non-zero posted debt, the new period starts with an opening-balance entry (debtor → creditor, amount). It counts in both balances of the new period, cannot be edited or deleted, and is paid with ordinary payments there. Keeps the PRD rule (host settles only their own debts) and the "closed = frozen" rule. Cost: a new entry type in `BillingPeriod` (and a table or column), and the new period is opened by the aggregate from the old one rather than from scratch.
2. **Two-stage close (NetSuite-style partial lock).** Closing locks expenses but keeps payments open in the old period until its pair debts are settled. Cost: two open "things" per group, every payment command must target a specific period, the UI must show several periods; conflicts with the one-open-period index and the "latest period" loading.
3. **Require a zero posted balance for everyone.** Simplest and archetype-clean, but reverses the PRD's Socrates resolution (`prd.md:86`) and lets any member block the host. Rejected unless the product owner changes FR-015.

Pending payments (Gap 2) follow the chosen option: with (1), either block the close while any payment is pending (archetype default; the host sees which ones) or carry a pending payment's amount forward as part of the opening debt and mark the payment as carried (more moving parts). With (2) they simply stay confirmable.

### Period continuity (Gap 3)

- With carry-forward the next period should be the **month after** the closed one (contiguous), not `BillingMonth.of(now)`. If that month has already ended (a very late close), it can be closed straight away; its window is valid because its month is not in the future.
- The window rule means members cannot add next-month expenses until the host closes (`purchase-date.value.ts:68-77`). This is not a contradiction of the archetype (posting to a future period before it opens is optional in BusDK), but it is a product consequence worth stating in the plan.

## Code References

- `src/lib/billing-periods/billing-period.aggregate.ts:65-77` — `open` takes the month from `now`
- `src/lib/billing-periods/billing-period.aggregate.ts:265-298` — `sendPayment` refuses a closed period and caps by pending debt
- `src/lib/billing-periods/billing-period.aggregate.ts:352-381` — confirm/reject refuse a closed period
- `src/lib/billing-periods/billing-period.aggregate.ts:415-431` — pending and posted balances, per period only
- `src/lib/billing-periods/purchase-date.value.ts:68-77` — window: period's month, not after today
- `src/lib/billing-periods/billing-period.service.ts:29-38` — loads only the latest period
- `supabase/migrations/20261002200553_settlement_groups.sql:49` — one open period per group

## Architecture Insights

- The ledger archetype was adopted in S-07 (`context/archive/2026-10-20-mark-transfer-sent/external-research.md:17-21`) and the posted/pending split in S-07/S-08. Carry-forward is the missing third piece of that same archetype (period boundaries), so it fits the existing model instead of adding a new one.
- In archetype terms: an expense is a nominal (temporary) entry that belongs to its month; a pair debt is a permanent balance. S-09 currently treats both as temporary.
- The aggregate boundary stays one period; carry-forward means `close()` of the old period produces the opening entries the new period starts with (a domain operation, consistent with the "logic in aggregates" convention in `CLAUDE.md`).

## Historical Context (from prior changes)

- `context/archive/2026-10-20-mark-transfer-sent/external-research.md:48` — predicted that S-09's "host's debts are paid" becomes "the host owes nothing once confirmed payments are counted". Supported: adopted as the roadmap risk note (`roadmap.md:249`).
- `context/foundation/roadmap.md:245` — close must bump `version` so a stale add fails. Still valid.
- `context/foundation/roadmap.md:246` — the contract migration dropping `add_expense` etc. must land before S-09. Still listed as a prerequisite; not re-verified here.

## Related Research

- `context/archive/2026-10-20-mark-transfer-sent/external-research.md` — ledger archetype, posted vs pending
- `context/archive/2026-10-05-add-expense-see-balances/research.md` — money allocation

## Open Questions

1. ~~**Stranded debts**: carry forward as opening entries (recommended), two-stage close, or require everyone at zero?~~ Decided 2026-10-23: carry forward (see "Follow-up 2026-10-23").
2. ~~**Pending payments at close**: block the close, move them to the new period, or allow deciding them after close?~~ Decided 2026-10-23: B, move them (see "Decision 2").
3. **Next month**: month after the closed one (contiguous) or month of `now`? — Owner: user. Recommended: contiguous (see "Handoff to /10x-plan").
4. **History**: should members see closed periods (read-only) after a close? Closed books stay reportable in every inspected system; SplitDom has no such view today. — Owner: user.
5. ~~**FR-005 lock after carry-forward**: does a confirmed payment that pays a carried debt lock the new period's expenses of that pair?~~ Decided 2026-10-26: oldest-first application (see "Decision 3").

## Follow-up 2026-10-23: decision on stranded debts, analysis of pending payments

### Decision 1 (user, 2026-10-23): carry forward

On close, every pair with a non-zero **posted** debt (expenses plus confirmed payments, `billing-period.aggregate.ts:425-431`) opens the new period as an **opening-balance entry** (debtor → creditor, amount). Opening entries count in both balances of the new period, are not editable or deletable, and are paid with ordinary payments there. Expenses do not carry (nominal entries); the closed period stays a frozen record. This supersedes options 2 and 3 of "Options for the stranded debts".

Consequence for the code (input for the plan, not a design): `PeriodBalances.of` takes only expenses and payments today (`period-balances.value.ts:30-31`), so it needs opening entries as a third input; `sendPayment`'s cap on the pending debt (`billing-period.aggregate.ts:278-286`) then covers carried debts automatically.

### Why pending payments must be decided together with carry-forward

Carrying the posted debt forward leaves the question of what a payment that is still pending at close means. Worked example (one pair, amounts in zł):

- October: B owes A 100 from expenses; B has sent 60, pending. Posted debt B → A = 100, pending debt = 40.
- The host closes October; November opens with the opening entry B → A 100.

| Option | November right after close | A confirms the 60 | A rejects the 60 |
|---|---|---|---|
| **A. Block the close** while any payment of the period is pending | — (close refused until A decides or B withdraws) | close then carries 40 | close then carries 100 |
| **B. Move pending payments** to the new period (same id, sender, recipient, amount, sent time, still pending) | pending 40, posted 100 — same numbers as before the close | in November: posted 40 | in November: posted 100 |
| **C. Decide after close** in the closed period | pending 100 (the 60 is invisible in November) | October posted 40, but November still says 100 → B is overcharged 60 unless a cross-period adjustment entry is posted (Fowler's Difference Adjustment) | consistent (100) |
| **D. Carry the pending debt** (40) and freeze the payment as pending | pending 40, posted 40 | nothing to do | impossible — the recipient loses the final say (contradicts FR-009, `prd.md:95`) |

Archetype support:

- A is the textbook default: in-progress journals must be posted or cancelled before close (Workday), "drafts block the close … post it or void it" (nearsync).
- B is also archetype-backed: GnuCash keeps a transaction that sits in an open lot "with the open book" instead of moving it to the closed one; Workday's pending operational transactions are posted "in this period or the next open period".
- C needs a second, cross-period mechanism and breaks the invariant that a closed period receives no writes. D breaks FR-009. Both are rejected.

### Trade-offs between A and B

- **Who can unblock (A):** only the payment's recipient (confirm/reject) or its sender (withdraw) — never the host (`billing-period.aggregate.ts:304-381`). A recipient who ignores a payment blocks the host indefinitely. This is a narrower form of the "any member can block the host" problem the PRD rejected (`prd.md:86`): it blocks on an unmade decision, not on an unpaid debt. Simple to build: one extra close precondition plus a list of blocking payments in the refusal.
- **Consistency (B):** the new period's pending and posted balances equal the old period's at close, so nothing a member sees changes except the period label; the closed period holds only final entries (expenses, confirmed and rejected payments). `sendPayment` stays idempotent by id across the close, because the reloaded latest period still contains the moved payment (`billing-period.aggregate.ts:266-271`, service reload `billing-period.service.ts:278-279`).
- **Cost (B):** the close becomes one write that closes the old period, opens the new one, inserts opening entries and moves pending payments (re-parenting `payments` rows), all under the old period's `version` guard; the Payments list in the new period should mark a moved payment as sent in the previous month.
- **Side effect to settle in either option (FR-005 lock):** a payment confirmed in the new period — moved, or newly sent against an opening entry — locks every expense of that pair in the new period (`billing-period.aggregate.ts:146-154`, FR-005 `prd.md:83`), although it pays (part of) an older debt. Under netted pair debts a payment cannot be attributed to specific expenses, so the plan must decide whether the lock stays as is or excludes payments up to the carried amount.

### Recommendation

**B (move pending payments)**: it keeps the recipient's final say, never lets a non-host member block the close, and keeps every balance unchanged across the close. A remains the fallback if a single-write close that re-parents payments proves too costly in the plan.

### Decision 2 (user, 2026-10-23): B, move pending payments

On close, every payment of the period that is still pending moves to the new period unchanged (same id, sender, recipient, amount, sent time, still pending); its recipient confirms or rejects it there and its sender may withdraw it there. Rejected and confirmed payments stay in the closed period. Options A, C and D are not pursued.

## Follow-up 2026-10-23 (2): the FR-005 expense lock after carry-forward

### The problem

The lock as built (S-08): an expense is locked once a **confirmed** payment exists, in either direction, between its payer and one of its sharers, and the lock covers every expense of that pair in the period, including ones added later (`billing-period.aggregate.ts:142-154`; FR-005 `prd.md:83`). Within one period that was coherent: every payment paid that period's expenses. After carry-forward, a payment in the new period may pay the **carried** debt instead.

Worked example (one pair, zł). November opens with the opening entry B → A 100. On 5 November A pays a 60 expense split between A and B (B's share 30); B now owes A 130.

| Step | Current rule | Oldest-first rule (below) |
|---|---|---|
| B pays 100 (the October debt), A confirms | the 60 expense is locked, and so is every A/B expense added later in November | nothing locked: the 100 covered the carried 100 |
| B pays a further 30, A confirms | (already locked) | confirmed B → A = 130 > carried 100, so the A/B expenses of November lock |

Under the current rule a pair that settles last month's debt early in the month can no longer edit any shared expense of the new month. Every debt that is not the host's carries forward (FR-015 requires settling only the host's own, `prd.md:85-86`), so this would be the common case, not an edge case.

### Archetype evidence (exa.ai)

- **Payments are applied to the oldest open debt first.** QuickBooks: with automatic application "payments will be automatically posted to the oldest open invoice"; NetSuite's default suggests the oldest invoice when no invoice matches the amount; AGDATA Phoenix allocates "starting at the oldest unpaid or part-paid invoice until the payment amount is exhausted".
- **What a payment has settled is no longer edited; corrections are new documents.** bexio: a partially paid or paid invoice cannot have its amounts modified, a credit note is recommended; Stripe: a finalized invoice's amount cannot be edited, a credit note decreases it.
- In SplitDom terms: the opening entry is the oldest "invoice" of the pair; the period's expenses are newer ones. A confirmed payment settles the opening entry first, and only the excess settles (and therefore locks) the period's expenses.

### Options

1. **Keep the rule as is.** No change; over-locks as shown above. Simple, but makes FR-005's edit window mostly unavailable in any month that follows a carry-forward.
2. **Oldest-first application (recommended).** For each direction d of a pair: if the sum of confirmed payments in direction d in the period exceeds the opening entry in direction d, the pair's expenses are locked (as today, both directions, including later ones). Opening entries are never editable themselves. Without an opening entry the rule reduces exactly to today's rule (carried amount 0), so S-08's behaviour within a period is unchanged. Moved pending payments need no special case: once confirmed they count like any other payment.
3. **Exclude only moved payments** (sent before the period opened). Rejected: a new payment sent in November for the October debt over-locks the same way.
4. **Drop the lock.** The ledger keeps balances true without it (the S-07 research said as much, `context/archive/2026-10-20-mark-transfer-sent/external-research.md:48`), but this reverses the S-08 decision (`roadmap.md:231`) and FR-005; out of S-09's scope.

### Consequences of option 2

- FR-005 needs a wording amendment: a confirmed payment first settles the debt carried over from the previous period; it locks the pair's expenses only once the pair's confirmed payments in the period exceed that carried debt.
- `isLocked` needs the period's opening entries next to its payments; it stays a pure aggregate rule (no SQL), as `CLAUDE.md` requires for `expense_locked`.
- Partial confirmations below the carried amount never lock; this is intended (they pay old debt).

### Decision 3 (user, 2026-10-26): oldest-first application

Option 2 is adopted. Confirmed payments of a pair in a period first settle the opening entry carried in the same direction; the pair's expenses (both directions, including ones added later) lock only once the confirmed payments in one direction exceed the opening entry in that direction. With no opening entry the rule is exactly S-08's rule. Options 1, 3 and 4 are not pursued.

## Handoff to /10x-plan (2026-10-26)

### Settled (user decisions and verified facts)

| # | Settled point | Source |
|---|---|---|
| 1 | Host-only close; allowed once the period's month has ended (Europe/Warsaw) and the host owes nothing on the **posted** balances | `prd.md:58-68`, `:85`; `roadmap.md:244`, `:249` |
| 2 | A closed period accepts no writes of any kind (expenses, payments, decisions); no reopen; corrections are new entries in the open period | archetype table above; `billing-period.aggregate.ts:119`, `:272`, `:305`, `:356` |
| 3 | The close bumps `version` (stale writes fail and their retry reloads) | `roadmap.md:245` |
| 4 | **Decision 1** — every non-zero posted pair debt becomes an opening-balance entry of the new period (immutable, counts in both balances, paid by ordinary payments) | "Decision 1" |
| 5 | **Decision 2** — pending payments move to the new period unchanged; confirmed and rejected stay in the closed period | "Decision 2" |
| 6 | **Decision 3** — FR-005 lock uses oldest-first application against the opening entry | "Decision 3" |
| 7 | At most one open period per group (partial unique index) | `supabase/migrations/20261002200553_settlement_groups.sql:49` |

Invariant the plan can test directly: for every pair, the new period's pending and posted debts right after the close equal the old period's at the moment of close.

### Contracts the plan will touch (inferred from the decisions, not designed here)

- **Domain** (`src/lib/billing-periods/`): an opening-balance entry (value object or entity) inside `BillingPeriod`; `PeriodBalances.of` gains it as a third input (`period-balances.value.ts:30-31`); `isLocked` gains the carried amounts (`billing-period.aggregate.ts:146-154`); a `close` command on the aggregate that checks host, month ended and the host's posted debts, and yields the next period (opening entries plus moved pending payments); `BillingPeriodService` gets a close entry point.
- **Persistence**: storage for opening entries (new group-scoped table under the RLS/no-grant rules in `CLAUDE.md`), loading them in `get_current_billing_period`, and one version-guarded write that closes the old period, opens the new one, inserts opening entries and re-parents pending `payments` rows. Forward-only, expand-before-contract migration.
- **PRD amendments**: FR-015/US-02 (open debts and pending payments carry over), FR-005 (oldest-first lock). Roadmap S-09 unknown on pending payments (`roadmap.md:247`) can be marked resolved.
- **UI**: close action visible to the host only, with the refusal reasons of US-02 (`prd.md:65-67`); opening entries shown next to expenses; moved payments marked as sent in the previous month.

### Still open before or during planning

1. **Next month** (Open Question 3): recommendation — the month after the closed one, not `BillingMonth.of(now)` (`billing-period.aggregate.ts:65-69`), so a late close never skips a month; a new period whose month has already ended can be closed at once. This also resolves the roadmap unknown on a month that starts after today (`roadmap.md:248`): the next month never starts after today when a close is only allowed after the closed month ended.
2. **History** (Open Question 4): read-only view of closed periods — in S-09 or a later slice.
3. **Prerequisite**: the contract migration that drops `add_expense` and the other unused RPCs must land before S-09 ships (`roadmap.md:246`); not re-verified in this research.
4. **Purchase-date window**: between the month's end and the close, members cannot add new-month expenses (`purchase-date.value.ts:68-77`); accept and state it, or change in the plan.

## Sources

- GnuCash, Books / Accounting Periods — https://wiki.gnucash.org/docs/STABLE/bookperiods.html
- NetSuite, Accounting Period Close — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html
- Sage Intacct, Close books — https://www.intacct.com/ia/docs/en_US/help_action/General_Ledger/Open_and_close_books/close-books.htm
- BusDK, bus-period SDD — https://docs.busdk.com/sdd/bus-period.html
- nearsync, Closing a period — https://nearsync.ai/help/finance/closing-a-period/
- OpenStax, Principles of Accounting 5.1 — https://openstax.org/books/principles-financial-accounting/pages/5-1-describe-and-prepare-closing-entries-for-a-business
- Workday, Journal Statuses and Pending Transactions — https://doc.workday.com/admin-guide/en-us/financial-management/financial-accounting/period-and-year-close/dan1370796977933.html
- Martin Fowler, Patterns for Accounting — https://martinfowler.com/eaaDev/AccountingNarrative.html
- Modern Treasury, How to Scale a Ledger II — https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-ii
- Are We Even, Moving from Splitwise — https://www.areweeven.com/blog/move-expense-history-from-splitwise
- QuickBooks, Applying a payment towards an invoice — https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/resolve-common-issues-applying-payment-towards/L2UMXN8tt_US_en_US
- NetSuite, Accounting Preferences (Apply Payments Without Invoice Numbers) — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_40152749557.html
- AGDATA Phoenix, Applying Payments to Invoices — https://help.agdata.com.au/phoenix/9/allocating_payments_to_invoice.html
- bexio, How to edit or delete an invoice — https://help.bexio.com/s/article/000001859
- Stripe, Credit notes and credit memos — https://docs.stripe.com/use-stripe-apps/netsuite/credit-notes-credit-memos
