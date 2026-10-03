---
change_id: create-settlement-group
title: Create a settlement group with its first open period (S-02)
status: archived
created: 2026-10-02
updated: 2026-10-03
archived_at: 2026-10-03T14:50:10Z
---

## Notes

S-02 from `context/foundation/roadmap.md` (FR-002, GitHub issue #7).

Decisions (2026-10-02, from the user):

- Business rules and invariants live in TypeScript aggregates (`src/lib/groups/`), not in the database. SQL functions only persist and load, taking the caller's identity from `auth.uid()`; light constraints (uniqueness, length, foreign keys) are allowed as backstops. No ORM and no new infrastructure (no Hyperdrive, no new secrets).
- A billing period is a calendar month counted in **Europe/Warsaw**; timestamps are stored in UTC. This also resolves S-09's timezone question.
- Groups have a required name, 1–60 characters after trimming.
- FR-002 changed during plan review: a user may create any number of groups and belong to many groups. `/dashboard` lists groups; each group has its own page `/groups/[id]` (404 for non-members).
- Group privacy is enforced by the application layer; domain tables have RLS on with no policies (deny-all for the Supabase API).

Implementation deviation (2026-10-02, Phase 1 review, from the user):

- The plan's free-standing use cases (`createGroup`, `listMyGroups`, `getMyGroup` in `create-group.handler.ts` / `get-my-groups.handler.ts`) are replaced by one aggregate service, `GroupService` (`src/lib/groups/group.service.ts`). Only the repository reads and writes the `Group` aggregate, and only `GroupService` uses the repository; it is built with `new GroupService(repository, () => crypto.randomUUID(), () => new Date())`.
  - `createGroup({ name, userId, now }, { repository, newId })` → `service.create({ name, hostId })`;
  - `listMyGroups({ repository })` → `service.listForMember(userId)` (also filters on `isMember(userId)`);
  - `getMyGroup({ groupId, userId }, { repository })` → `service.getForMember({ groupId, userId })`.
- No CQRS command/query layer for now; Phase 3's endpoint and pages call `GroupService` directly.
- Phase 1 review (F2, 2026-10-02): `create_group` takes `p_host_id` from the aggregate and raises `42501` unless it equals `auth.uid()` — a persistence backstop so the domain's host and the stored host can never silently diverge. plan.md's contracts were updated to match (F1).
- Phase 2 review (2026-10-02, `reviews/impl-review-phase-2.md`): `billing_periods.month` gets `check (extract(day from month) = 1)` as a format backstop, and `Group.restore` restores the stored name as is (`GroupName.fromStored`) instead of re-applying `GroupName.create`, so a group stored past the aggregate cannot make the list unreadable (F1). User-deletion constraints are recorded in `context/deployment/deploy-plan.md` (F5).
