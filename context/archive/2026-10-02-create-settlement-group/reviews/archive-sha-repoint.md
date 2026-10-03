# Archive SHA repoint: create-settlement-group

## 2026-10-03

- **Target**: `origin/main` (base branch of PR #23), snapshot `d0d6b579adff44a7970277fcb4c7423987afda82`
- **Integration commit**: `d0d6b57` — "Dodaj tworzenie grupy rozliczeniowej (S-02) (#23)"
- **PR**: https://github.com/adamgwozdz00/SplitDom/pull/23 (merged by squash from `feat/create-settlement-group`)
- **Evidence**: the PR commit list contains `3b7818d` (p1), `6fa820b` (p1 review fixes), `285ce43` (p2) and `a12eaed` (p3); none of them is an ancestor of `origin/main`; `git diff a12eaed d0d6b57` is empty, so the squash commit's tree is identical to the PR head and integrates all three phases; `d0d6b57` is an ancestor of (equal to) the target snapshot.
- **User decision**: the user delegated the choice ("zrób tak jak uważasz byle to było spójne"), taken as approval to update and archive.

| Row ID | Old suffix (resolved OID) | New SHA |
| ------ | ------------------------- | ------- |
| 1.1 | 3b7818d (3b7818da78fb295054f7e97acb93c13384bda68e) | d0d6b57 |
| 1.2 | 3b7818d (3b7818da78fb295054f7e97acb93c13384bda68e) | d0d6b57 |
| 1.3 | 3b7818d (3b7818da78fb295054f7e97acb93c13384bda68e) | d0d6b57 |
| 1.4 | 3b7818d (3b7818da78fb295054f7e97acb93c13384bda68e) | d0d6b57 |
| 1.5 | 3b7818d (3b7818da78fb295054f7e97acb93c13384bda68e) | d0d6b57 |
| 2.1 | 285ce43 (285ce43717e22abff416c54e159818e891f930cd) | d0d6b57 |
| 2.2 | 285ce43 (285ce43717e22abff416c54e159818e891f930cd) | d0d6b57 |
| 2.3 | 285ce43 (285ce43717e22abff416c54e159818e891f930cd) | d0d6b57 |
| 2.4 | 285ce43 (285ce43717e22abff416c54e159818e891f930cd) | d0d6b57 |
| 2.5 | 285ce43 (285ce43717e22abff416c54e159818e891f930cd) | d0d6b57 |
| 3.1 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.2 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.3 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.4 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.5 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.6 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |
| 3.7 | a12eaed (a12eaed82ebc052c08cde2a80aa64edd33f5dec1) | d0d6b57 |

Total rows repointed: 17. Row 3.8 (production check after merge) is still pending and has no SHA.
