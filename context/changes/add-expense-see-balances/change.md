---
change_id: add-expense-see-balances
title: Add an expense and see balances
status: impl_reviewed
created: 2026-10-05
updated: 2026-10-06
archived_at: null
---

## Notes

Roadmap slice S-04 (north star) in `context/foundation/roadmap.md` — PRD refs US-01, FR-004, FR-005; prerequisite S-03 is done.

Open unknowns carried from the roadmap:

- Debt granularity (blocks planning): one debt per expense share, or netted into one debt per pair of members per period? Decides what S-05, S-06, S-08 and S-09 act on.
- Rounding of amounts that don't split evenly (e.g. 100 zł / 3) while keeping "sum of expenses = sum of shares".
