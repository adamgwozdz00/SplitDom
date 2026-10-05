-- App key gate (change block-direct-data-api), step 1 of 2: observe mode.
--
-- Goal: no one may call the Data API (PostgREST: /rest/v1, including /rest/v1/rpc) bypassing the
-- app. A signed-in user can read their access token from the session cookie and pair it with the
-- anon key, which Supabase treats as public. Every legitimate request comes from the Worker, which
-- sends a secret header `x-app-key`; this migration stores hashes of valid keys and registers a
-- PostgREST pre-request function that judges that header.
--
-- Observe mode: the gate blocks nothing yet. A request carrying `x-app-gate-probe` gets a 418 whose
-- message names the verdict (`ok`, `missing`, `invalid`), so we can prove in production that the
-- hook fires at all (evidence on hosted Supabase conflicts) before a later migration enforces it.
-- Every other request passes, so the previously deployed Worker, which sends no header, keeps working.
--
-- Rules:
-- - No role is exempt, `service_role` included: the threat is a signed-in (`authenticated`) user.
-- - A key's value never appears in SQL or in the database; only its sha256 is stored. Production
--   keys are inserted by hand (see context/deployment/deploy-plan.md); supabase/seed.sql inserts a
--   local-only key.
-- - The functions live in schema `api_gate`, not `private`: PostgREST runs the pre-request function
--   after switching to the request role, which can be `anon`, and `private` denies `anon` usage.
--   `api_gate` is not in `api.schemas`, so nothing in it is callable through the API.
-- - Never drop or rename `api_gate.check_app_request` while the hook points at it: every REST
--   request would fail. Change it only with `create or replace` under the same signature.

-- Key store ------------------------------------------------------------------------------------

create table private.app_keys (
  -- sha256 of the key's UTF-8 bytes. Several rows may be valid at once (key rotation).
  key_hash bytea primary key,
  created_at timestamptz not null default now(),
  note text
);

comment on table private.app_keys is
  'Hashes of valid x-app-key values (block-direct-data-api). Read only by the api_gate functions.';

alter table private.app_keys enable row level security;

revoke all on table private.app_keys from public, anon, authenticated, service_role;

-- Gate schema ----------------------------------------------------------------------------------

create schema api_gate;

comment on schema api_gate is
  'Non-exposed schema for the PostgREST pre-request gate. Usable by every request role; not part of the API.';

revoke all on schema api_gate from public;

grant usage on schema api_gate to anon, authenticated, service_role;

-- Gate functions -------------------------------------------------------------------------------

-- Judges the current request's `x-app-key` header: 'missing', 'ok' or 'invalid'.
-- Volatile on purpose: an immutable function reading request.headers can be folded at plan time.
create function api_gate.app_key_verdict()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- PostgREST lowercases header names. Outside a request the setting is null or '' (never valid json).
  v_key text := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-app-key', '');
begin
  if v_key is null then
    return 'missing';
  end if;

  if exists (
    select 1
    from private.app_keys
    where key_hash = pg_catalog.sha256(pg_catalog.convert_to(v_key, 'UTF8'))
  ) then
    return 'ok';
  end if;

  return 'invalid';
end;
$$;

comment on function api_gate.app_key_verdict() is
  'Verdict on the request''s x-app-key header: ok, missing or invalid. Compares sha256 hashes only.';

-- The PostgREST pre-request function. Observe mode: answers only requests carrying
-- `x-app-gate-probe`, with a 418 naming the verdict; lets every other request through.
create function api_gate.check_app_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(current_setting('request.headers', true), '')::json ->> 'x-app-gate-probe' is not null then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'APPGATE_PROBE',
        'message', 'app gate: ' || api_gate.app_key_verdict())::text,
      -- PostgREST v14 requires `headers` in DETAIL, even when empty.
      detail = json_build_object('status', 418, 'status_text', 'App Gate Probe', 'headers', json_build_object())::text;
  end if;
end;
$$;

comment on function api_gate.check_app_request() is
  'PostgREST pre-request gate (observe mode): answers x-app-gate-probe requests with the x-app-key verdict.';

-- Postgres grants EXECUTE to PUBLIC on new functions; grant it explicitly to the request roles only.
revoke execute on function api_gate.app_key_verdict() from public, anon, authenticated, service_role;
revoke execute on function api_gate.check_app_request() from public, anon, authenticated, service_role;

grant execute on function api_gate.app_key_verdict() to anon, authenticated, service_role;
grant execute on function api_gate.check_app_request() to anon, authenticated, service_role;

-- Registration ---------------------------------------------------------------------------------

alter role authenticator set pgrst.db_pre_request = 'api_gate.check_app_request';

notify pgrst, 'reload config';
