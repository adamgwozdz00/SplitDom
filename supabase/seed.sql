-- Local and CI seed. Runs on `supabase start` of a fresh database and on `supabase db reset`;
-- `supabase db push` skips it unless given `--include-seed`. Never use that flag against a hosted
-- project: it would make the public local app key below valid there and open the app-key gate.

-- The local app key (block-direct-data-api): its plain value `local-dev-app-key` is committed on
-- purpose and goes into `.env` / `.dev.vars` as SUPABASE_APP_KEY. It is valid only here — every
-- hosted project gets its own random key, inserted by hand (see context/deployment/deploy-plan.md).
insert into private.app_keys (key_hash, note)
values (
  sha256(convert_to('local-dev-app-key', 'UTF8')),
  'local only — never valid in any hosted project'
);
