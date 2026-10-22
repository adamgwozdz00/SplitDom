# External research: how money systems model debts and repayments

> Change: `mark-transfer-sent` (S-07). Date: 2026-10-21. Source: exa.ai web search.
> Trigger: manual testing of S-07 phase 3 showed that "sent" marks, the displayed debt and the real debt drift apart.

## The observed failure (input)

1. A pays 200 zł, so B owes A 100 zł.
2. B marks 100 zł as sent, and the panel says "Nothing left to pay" (correct).
3. A pays 100 zł. The debt is 150 zł, the mark is 100 zł, and the remaining 50 zł is correct.
4. The balances and debts still show 150 zł, because marks are not part of balances. This is misleading: B really owes 50 zł.
5. B marks the remaining amount, so the mark is replaced with 150 zł.
6. B pays 300 zł. Expense balances net to 0 and B's mark turns into "no longer owe". In reality B already sent A 150 zł, so **A owes B 150 zł**, and the app shows 0. This is a wrong result.

Root cause in our model: the mark is a mutable per-pair state that lives **outside** the balance computation. Balances are derived from expenses only, so money that actually moved disappears from the accounts when the debt changes direction.

## Archetype: the ledger (double-entry accounting)

- **Fowler, Patterns for Accounting**: the archetype is Account, Accounting Entry and Accounting Transaction. "The value, or balance, of the Account is derived as the sum of all the Accounting Entrys." Errors are fixed by replacement, reversal or difference adjustments; Fowler's draft lists all three without making any of them the default. https://martinfowler.com/eaaDev/AccountingNarrative.html
- **Square Books, Stripe Ledger, Griffin**: an immutable, append-only log of entries. A balance is never stored as an independent mutable figure; it is computed from the entries, and a mistake is corrected by a new entry, not by an update.
- **Modern Treasury, "How to Scale a Ledger"**: real money moves asynchronously, so an account reports a **posted balance** (settled entries only) and a **pending balance** (posted plus expected entries). Only _pending_ entries can be discarded or replaced; posted entries are permanent. https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-ii

## Group-expense apps

- **Splitwise**: "Settle up" records a payment made outside the app (cash, bank transfer). Balances update **immediately**. Undo means deleting the payment record. There is no confirmation by the recipient. A payment is an expense-like entry in the opposite direction, and "the balance is always the sum of every share minus every payment". https://kb.splitwise.com/balances-and-expenses/i-accidentally-settled-up-how-can-i-undo-this
- **Splitwise LLD write-ups**: modelling Expense and Settlement as the same class is a "candidate mistake", but both fold into one ledger. "Settlements … are ledger entries too", and the balance is a computed view over expenses and settlements.
- **Tricount**: three transaction types: expense, income and **transfer** ("money transferred between participants"). A suggested reimbursement can be marked "paid", which creates a transfer that counts in balances. https://help.tricount.com/en/articles/tricount-faqs
- **Tricount pitfall** (money.stackexchange 129986): a user repaid an out-of-date amount, so after "mark as paid" the balance showed a new debt. This is the same class of problem as steps 3–5 above. Paying against the current balance, with the payment inside the ledger, keeps the numbers consistent.
- **Eider, Halved, TabApp**: payments are recorded against a person's balance, and "the record reflects expenses and payments added so far". TabApp lets the **recipient** say when the money arrived.

## Variants with confirmation by the recipient (closest to PRD FR-008/FR-009)

- **Split-It** (open source): a settlement has `paymentStatus` pending, confirmed or failed. The receiver confirms or rejects, and **balances count only confirmed settlements**. https://github.com/ShubhamPatra/split-it
- **Co-oto**: the payer declares a payment and the owner confirms or rejects it. Confirm resets the balance **as of the declaration date**, so later costs stay owed. Reject clears the declaration, and the balance stays as it was. The payer can withdraw the declaration. https://www.co-oto.app/documentation/couts/validation-paiements/

## Proposals for SplitDom (candidates for /10x-plan, not decisions yet)

1. **A payment is a ledger entry, not a pair state (the core fix).** Replace the per-pair mark that gets replaced with one `Payment` record per bank transfer: from, to, amount, sent at, status. Several payments per pair per period are allowed. Balances are computed from expenses **and** payments: a payment from B to A counts as "B gave A money", so `PeriodBalances` nets it like an expense share in the opposite direction. In the observed failure, step 4 would show 50 zł and step 6 would show "A owes B 150 zł". The "remaining to send" workaround becomes unnecessary, because the debt itself is true.
2. **Pending vs confirmed, borrowed from ledgers.** A payment starts as `sent` (pending) and becomes `confirmed` in S-08, or is rejected, which discards it. Three ways to show it:
   - (a) **Counted at once** (Splitwise, Tricount): sent payments change balances immediately, and the creditor can reject one in S-08. One number on screen. This contradicts PRD FR-008's "informational only", so the PRD needs an amendment.
   - (b) **Counted after confirmation** (Split-It, Co-oto): balances use confirmed payments only, and pending ones are shown beside them ("after confirmation: A owes you 150 zł"). Faithful to the PRD, but two numbers on screen.
   - (c) **Both computed, one shown by default** (Modern Treasury's posted and pending balances): the domain derives both balances. The page shows the pending one (including sent payments, labelled "awaiting confirmation"), and the confirmed one decides S-08 and S-09 rules, such as closing the period.
3. **Pay against the current debt.** The transfer details and the "mark as sent" form propose the current net debt, which already accounts for pending payments. A payment larger than the current debt is refused or needs an explicit confirmation, which prevents typos and double payments.
4. **Guard against a stale page** (the Tricount pitfall). The mark form carries the period's `version` (or the debt it showed). If expenses changed in between, the POST redirects with "the debt changed, check the new amount" instead of recording silently.
5. **Corrections as new entries.** A sent payment can be withdrawn (deleted) only while it is unconfirmed. A confirmed payment is permanent, and a mistake is corrected with a new payment in the opposite direction, not by editing. This keeps a trustworthy history (Square, Stripe, Fowler).
6. **Visible history.** List the period's payments next to its expenses (who, to whom, how much, status), so both sides can see why the balance is what it is.

Consequences for other slices: S-08 shrinks to confirming or rejecting a payment. FR-005's "lock the expense once its debt is paid" may become unnecessary, because editing an expense after a payment only shifts the balance and the payment stays. S-09's "host's debts are paid" becomes "the host owes nothing once confirmed payments are counted". In this change, the Phase 1–2 code (one mark per pair, unique per pair, replace on re-mark) and the uncommitted "remaining amount" logic of Phase 3 would be reworked. The migration has not been pushed to production, so it can still change.

## What this suggests for SplitDom (input for framing, not a decision)

- Our "mark" is not a ledger entry. It is a mutable pair state, replaced and never netted, and that is what lets it drift from the real debt.
- Every reference treats a repayment as an **entry in the same ledger as the expenses**: one record per transfer (from, to, amount, time), and balances computed over expenses and payments together.
- The open product choice maps onto an existing pattern: **pending vs posted** (Modern Treasury, Split-It, Co-oto). Either a sent payment counts immediately (Splitwise, Tricount), or it counts only once confirmed while a pending balance shows the expected outcome.
