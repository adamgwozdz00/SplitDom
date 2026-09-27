-- Baseline migration: the `private` schema.
--
-- A non-exposed home for `security definer` helper functions used by RLS policies
-- in later slices. It is intentionally NOT listed in `api.schemas` (supabase/config.toml),
-- so nothing in it is reachable through the REST/GraphQL API. Signed-in users only get
-- `usage`, so policies evaluated for them can call helpers defined here.

create schema if not exists private;

comment on schema private is 'Non-exposed schema for security definer helpers used by RLS policies. Not part of the API.';

revoke all on schema private from public;
revoke all on schema private from anon;

grant usage on schema private to authenticated;
