# Archive SHA repoint — billing-period-aggregate

- **Date**: 2026-10-07
- **Target**: origin/main (github.com/adamgwozdz00/SplitDom), snapshot 8c78087178bb94d3e194294306d721ec9599e27a
- **Integration commit**: 19e9ef790e7567f2ad182380d56d38514cee4eef — refactor: BillingPeriod as the aggregate root for expenses (F-02) (#35)
- **PR**: https://github.com/adamgwozdz00/SplitDom/pull/35 (MERGED; its commit list contains all five old SHAs)
- **Evidence**: `git diff 234ad7e 19e9ef7 -- src supabase` is 2 lines (review fixes), so the squash integrates the implementation covered by the rows; 19e9ef7 is an ancestor of the target snapshot.
- **Decision**: user chose "Update and archive".

| Rows | Old suffix | New SHA |
| --- | --- | --- |
| 1.1–1.4 | 1e36d76 | 19e9ef7 |
| 2.1–2.4 | 1074602 | 19e9ef7 |
| 3.1–3.5 | 8114f08 | 19e9ef7 |
| 4.1–4.4 | 1ac2988 | 19e9ef7 |
| 5.1–5.12 | 234ad7e | 19e9ef7 |

Affected rows: 29
