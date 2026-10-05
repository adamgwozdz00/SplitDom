# Archive SHA repoint — invite-member-by-link

- **Date:** 2026-10-05
- **Target:** `origin/main` (https://github.com/adamgwozdz00/SplitDom.git), snapshot `03c8b2943cd770e31464350c0228f2d49202a95e`
- **Integration commit:** `03c8b29` — "feat: invite a member to the group by link (S-03) (#25)"
- **PR:** https://github.com/adamgwozdz00/SplitDom/pull/25 (merged, squash)
- **Evidence:** the PR commit list contains 4cc4030, d4dae5e, 1307a49, 6351beb (plus 85ec462, a7237f4); the squash commit's diff covers `src/lib/invites/`, the invite pages/endpoints, migration, smoke and docs. The old SHAs are not ancestors of the target (`merge-base --is-ancestor` exit 1), and the squash commit is (exit 0).
- **Decision:** user chose "Update and archive" on 2026-10-05.

| Row IDs | Old suffix | New SHA |
| --- | --- | --- |
| 1.1–1.4 (4 rows) | 4cc4030 | 03c8b29 |
| 2.1–2.5 (5 rows) | d4dae5e | 03c8b29 |
| 3.1, 3.2, 3.3, 3.6 (4 rows) | 1307a49 | 03c8b29 |
| 4.1–4.4, 4.6, 4.7, 4.8 (7 rows) | 6351beb | 03c8b29 |

**Total repointed rows: 20**
