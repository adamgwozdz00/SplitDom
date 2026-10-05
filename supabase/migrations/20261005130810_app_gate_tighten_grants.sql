-- App key gate (change block-direct-data-api): least privilege on the verdict helper.
--
-- `api_gate.app_key_verdict()` is called only from `api_gate.check_app_request()`, which is
-- `security definer` (owner `postgres`), so the nested call never needs the request role's grant.
-- The grants to the request roles from migration app_gate were unnecessary (not exploitable: the
-- schema is not exposed and a caller could only judge their own headers); revoke them.
-- `check_app_request()` keeps its grants: PostgREST calls it as the request role.

revoke execute on function api_gate.app_key_verdict() from anon, authenticated, service_role;
