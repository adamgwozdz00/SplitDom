---
change_id: db-migrations-and-isolation
title: Database migrations pipeline and two-user isolation harness (F-01)
status: implementing
created: 2026-09-27
updated: 2026-09-27
archived_at: null
---

## Notes

Roadmap item F-01 (`context/foundation/roadmap.md`, GitHub issue #5). Schema changes are authored as Supabase CLI migrations in the repo and applied the same way to local, CI and hosted databases; a Vitest two-user harness plus an "RLS on every public table" guard give group-scoped slices (S-02 onward) a ready isolation-verification path. No domain tables here — they emerge from S-02's domain model.
