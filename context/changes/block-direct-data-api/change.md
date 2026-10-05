---
change_id: block-direct-data-api
title: Block direct Data API calls that bypass the app (app-secret header checked by db_pre_request)
status: implementing
created: 2026-10-05
updated: 2026-10-05
archived_at: null
---

## Notes

Every request to the Supabase Data API (PostgREST, including /rest/v1/rpc) without the secret app header x-app-key is rejected with 403; the secret is known only to the Worker (Cloudflare secret `SUPABASE_APP_KEY`) and the database (sha256 hashes in `private.app_keys`). The existing S-02/S-03 persistence functions keep their auth.uid() checks. Do this before S-04 is planned again.

Planning (2026-10-05): the gate ships in observe mode first (PR 1) because evidence conflicts on whether `db_pre_request` fires on hosted Supabase; a production probe picks branch A (enforce through the hook) or B (guard in every persistence function) for PR 2. The user also decided to remove all database tests, the S-04 planning artifacts, the test plan and the test plan's Phase 1 change folder (`testing-domain-boundary-guard`); S-04 and the test plan will be written anew after this change. See `plan.md`.

Decision (2026-10-05): chosen over (B) server-only access with the secret/service_role key — a leaked key would bypass RLS and drop auth.uid() as a second layer — and over (C) disabling the Data API in favour of a direct Postgres connection (Hyperdrive), which is a stack change too large for the MVP. Pattern source: Supabase docs, "Securing your API" → pre-request function.
