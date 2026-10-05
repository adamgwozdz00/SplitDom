-- App key gate (change block-direct-data-api), step 2 of 2: enforce.
--
-- The observe-mode gate (migration app_gate) was probed in production on 2026-10-05: the pre-request
-- hook fires on hosted Supabase, and the Worker's key hash is stored (verdict `ok`). From now on every
-- Data API request whose `x-app-key` verdict is not `ok` is refused with 403 — for every role,
-- `service_role` included. The persistence functions do not change.
--
-- Compatible with the previously deployed Worker: since PR #28 it sends a valid key on every request.
--
-- Emergency off-switch (SQL editor), followed by a forward migration that records the state:
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

-- Same signature, attributes and grants as in app_gate: `create or replace` keeps the registered hook
-- valid at every moment (dropping it would fail every REST request).
create or replace function api_gate.check_app_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if api_gate.app_key_verdict() <> 'ok' then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'APPGATE',
        'message', 'Requests must come through the app.')::text,
      -- PostgREST v14 requires `headers` in DETAIL, even when empty.
      detail = json_build_object('status', 403, 'headers', json_build_object())::text;
  end if;
end;
$$;

comment on function api_gate.check_app_request() is
  'PostgREST pre-request gate: refuses (403 APPGATE) every Data API request without a valid x-app-key.';

notify pgrst, 'reload config';
