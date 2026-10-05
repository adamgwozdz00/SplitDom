-- Local and CI seed. Runs on `supabase start` of a fresh database and on `supabase db reset`;
-- never on `supabase db push`, so nothing here reaches a hosted project.

-- The local app key (block-direct-data-api): its plain value `local-dev-app-key` is committed on
-- purpose and goes into `.env` / `.dev.vars` as SUPABASE_APP_KEY. It is valid only here — every
-- hosted project gets its own random key, inserted by hand (see context/deployment/deploy-plan.md).
insert into private.app_keys (key_hash, note)
values (
  sha256(convert_to('local-dev-app-key', 'UTF8')),
  'local only — never valid in any hosted project'
);
