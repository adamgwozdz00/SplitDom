---
change_id: member-profile-display-name
title: Member profile with a display name (S-10)
status: implemented
created: 2026-10-28
updated: 2026-10-28
---

## Notes

Roadmap item S-10, GitHub issue #27. A member sets a display name on `/profile`; wherever the group labels a member (balances, debts, payments, expense list), the display name is shown first, falling back to the member's email. The name belongs to the person (one name in every group) and lives in the `MemberProfile` aggregate next to the account number (S-06).
