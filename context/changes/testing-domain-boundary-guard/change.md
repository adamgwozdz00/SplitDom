---
change_id: testing-domain-boundary-guard
title: Domain boundary guard — lint pages and endpoints off repositories and RPCs
status: preparing
created: 2026-10-04
updated: 2026-10-05
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Domain boundary guard".
Risks covered: #3 (a business rule is implemented beside the domain — in a page, endpoint or SQL function — so domain tests stay green while user-visible behaviour is wrong or a path bypasses the rule). Test types planned: static import-boundary lint (ESLint no-restricted-imports) + service-level unit tests.
Risk response intent: #3 — prove that pages and endpoints cannot reach a repository or RPC except through the module's service, and that breaking this boundary fails lint before review; challenge "green domain tests mean the rule is enforced"; avoid folder-structure mirrors and file-tree snapshots.
After creating the folder, follow the downstream continuation rule.
