-- Group as the membership aggregate (F-03): persistence of the group as the aggregate root of its
-- members and active invites.
--
-- The rules (only a member invites, an invite is used at most once, a user is a member at most once,
-- the host is a member and never changes) live in TypeScript, in src/lib/groups. This migration only
-- stores and loads the aggregate: it adds the group's `version` for optimistic locking and the
-- persistence functions the Group repository switches to.
--
-- Expand before contract: redeem_group_invite, get_group_invite, create_group_invite, get_my_group and
-- list_my_groups stay untouched, because the previously deployed Worker still calls them.

-- Optimistic locking ---------------------------------------------------------------------------

-- The default only backfills existing rows; new groups get their version from the aggregate.
alter table public.groups add column version integer not null default 0;

comment on column public.groups.version is
  'Optimistic lock: save_group bumps it only while it still equals the version the aggregate loaded.';

-- Persistence functions ------------------------------------------------------------------------

-- Loads one group's snapshot (snake_case keys, members with emails, version) with its ACTIVE invites
-- (unused and not expired by the database clock; the token hash as hex), or null unless the caller is
-- a member, so a non-member cannot tell "exists" from "does not exist".
create function public.get_group_aggregate(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return (
    select jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'host_id', g.host_id,
      'created_at', g.created_at,
      'version', g.version,
      'members', (
        select coalesce(
          jsonb_agg(jsonb_build_object('user_id', m.user_id, 'joined_at', m.joined_at, 'email', u.email)),
          '[]'::jsonb
        )
        from public.group_members m
        join auth.users u on u.id = m.user_id
        where m.group_id = g.id
      ),
      'invites', (
        select coalesce(
          jsonb_agg(jsonb_build_object(
            'id', i.id,
            'created_by', i.created_by,
            'created_at', i.created_at,
            'expires_at', i.expires_at,
            'token_hash', encode(i.token_hash, 'hex')
          )),
          '[]'::jsonb
        )
        from public.group_invites i
        where i.group_id = g.id
          and i.used_at is null
          and i.expires_at > now()
      )
    )
    from public.groups g
    where g.id = p_group_id
      and exists (
        select 1
        from public.group_members me
        where me.group_id = g.id
          and me.user_id = auth.uid()
      )
  );
end;
$$;

comment on function public.get_group_aggregate(uuid) is
  'Persistence only — business rules live in src/lib/groups. Loads one group of the calling user with its active invites, or null.';

-- Loads every group the caller is a member of, as a JSON array (empty when none): members with emails and
-- the version, no invites.
create function public.list_my_group_aggregates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'host_id', g.host_id,
        'created_at', g.created_at,
        'version', g.version,
        'members', (
          select coalesce(
            jsonb_agg(jsonb_build_object('user_id', m.user_id, 'joined_at', m.joined_at, 'email', u.email)),
            '[]'::jsonb
          )
          from public.group_members m
          join auth.users u on u.id = m.user_id
          where m.group_id = g.id
        ),
        'invites', '[]'::jsonb
      )
    ), '[]'::jsonb)
    from public.groups g
    join public.group_members me on me.group_id = g.id
    where me.user_id = auth.uid()
  );
end;
$$;

comment on function public.list_my_group_aggregates() is
  'Persistence only — business rules live in src/lib/groups. Loads every group of the calling user, without invites.';

-- Loads the group of an ACTIVE invite found by the hex SHA-256 of its token, or null when none matches.
-- The caller is usually not a member yet, so access is scoped by possession of the token: the members
-- are returned WITHOUT emails and `invites` holds only the matching invite.
create function public.get_group_by_invite_token(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return (
    select jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'host_id', g.host_id,
      'created_at', g.created_at,
      'version', g.version,
      'members', (
        select coalesce(
          jsonb_agg(jsonb_build_object('user_id', m.user_id, 'joined_at', m.joined_at, 'email', null)),
          '[]'::jsonb
        )
        from public.group_members m
        where m.group_id = g.id
      ),
      'invites', jsonb_build_array(jsonb_build_object(
        'id', i.id,
        'created_by', i.created_by,
        'created_at', i.created_at,
        'expires_at', i.expires_at,
        'token_hash', encode(i.token_hash, 'hex')
      ))
    )
    from public.group_invites i
    join public.groups g on g.id = i.group_id
    where i.token_hash = decode(p_token_hash, 'hex')
      and i.used_at is null
      and i.expires_at > now()
  );
end;
$$;

comment on function public.get_group_by_invite_token(text) is
  'Persistence only — business rules live in src/lib/groups. Loads the group of an active invite by token hash, without member emails, or null.';

-- Loads the narrow read model behind the invite page by token hash: used and expired invites are
-- returned too (the page says what they mean), or null when none matches. This and
-- get_group_by_invite_token are the only paths that show a group to a non-member.
create function public.get_invite_preview(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return (
    select jsonb_build_object(
      'group_id', i.group_id,
      'group_name', g.name,
      'expires_at', i.expires_at,
      'used_at', i.used_at,
      'caller_is_member', exists (
        select 1
        from public.group_members m
        where m.group_id = i.group_id
          and m.user_id = auth.uid()
      )
    )
    from public.group_invites i
    join public.groups g on g.id = i.group_id
    where i.token_hash = decode(p_token_hash, 'hex')
  );
end;
$$;

comment on function public.get_invite_preview(text) is
  'Persistence only — business rules live in src/lib/groups. Loads the invite page read model by token hash, or null.';

-- Saves a loaded group: bumps its version only while it still equals `p_expected_version`, then stores
-- what changed since it was loaded:
--   p_new_invites  [{ id, created_by, created_at, expires_at, token_hash }]   (hash as hex)
--   p_used_invites [{ id, used_at, used_by }]
--   p_new_members  [{ user_id, joined_at }]
-- Returns false and stores nothing when the version moved on (a concurrent write); that is a persistence
-- concurrency signal, not a business rule. An invite that was already used (claimed meanwhile by the
-- previous redeem path) raises SD001, which rolls the whole save back.
-- Backstops: a new invite's created_by and a new member's user_id must be the caller, a new invite
-- requires the caller to be a member, and a caller who is not yet a member may only add themselves by
-- claiming an invite of this group in the same call.
create function public.save_group(
  p_group_id uuid,
  p_expected_version integer,
  p_new_invites jsonb,
  p_used_invites jsonb,
  p_new_members jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_member boolean;
  v_used_count integer;
  v_claimed integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_is_member := exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_new_invites) as i (created_by uuid)
    where i.created_by is distinct from auth.uid()
  ) then
    raise exception 'created_by must be the calling user' using errcode = '42501';
  end if;

  if jsonb_array_length(p_new_invites) > 0 and not v_is_member then
    raise exception 'caller is not a member of the group' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_used_invites) as i (used_by uuid)
    where i.used_by is distinct from auth.uid()
  ) then
    raise exception 'used_by must be the calling user' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_new_members) as m (user_id uuid)
    where m.user_id is distinct from auth.uid()
  ) then
    raise exception 'user_id must be the calling user' using errcode = '42501';
  end if;

  v_used_count := jsonb_array_length(p_used_invites);

  if jsonb_array_length(p_new_members) > 0 and not v_is_member and v_used_count = 0 then
    raise exception 'a new member needs an invite' using errcode = '42501';
  end if;

  update public.groups
  set version = version + 1
  where id = p_group_id
    and version = p_expected_version;

  if not found then
    return false;
  end if;

  insert into public.group_invites (id, group_id, token_hash, created_by, created_at, expires_at)
  select i.id, p_group_id, decode(i.token_hash, 'hex'), i.created_by, i.created_at, i.expires_at
  from jsonb_to_recordset(p_new_invites) as i (
    id uuid,
    created_by uuid,
    created_at timestamptz,
    expires_at timestamptz,
    token_hash text
  );

  -- The conditional claim is the race-safe backstop next to the version guard.
  update public.group_invites gi
  set used_at = u.used_at,
      used_by = u.used_by
  from jsonb_to_recordset(p_used_invites) as u (id uuid, used_at timestamptz, used_by uuid)
  where gi.id = u.id
    and gi.group_id = p_group_id
    and gi.used_at is null;

  get diagnostics v_claimed = row_count;

  if v_claimed <> v_used_count then
    raise exception 'invite_invalid' using errcode = 'SD001';
  end if;

  insert into public.group_members (group_id, user_id, joined_at)
  select p_group_id, m.user_id, m.joined_at
  from jsonb_to_recordset(p_new_members) as m (user_id uuid, joined_at timestamptz);

  return true;
end;
$$;

comment on function public.save_group(uuid, integer, jsonb, jsonb, jsonb) is
  'Persistence only — business rules live in src/lib/groups. Saves a group (new invites, used invites, new members) if its version is unchanged.';

-- Postgres grants EXECUTE to PUBLIC on new functions and Supabase's default privileges grant it to
-- anon too; only signed-in users may call these.
revoke execute on function public.get_group_aggregate(uuid) from public, anon;
revoke execute on function public.list_my_group_aggregates() from public, anon;
revoke execute on function public.get_group_by_invite_token(text) from public, anon;
revoke execute on function public.get_invite_preview(text) from public, anon;
revoke execute on function public.save_group(uuid, integer, jsonb, jsonb, jsonb) from public, anon;

grant execute on function public.get_group_aggregate(uuid) to authenticated;
grant execute on function public.list_my_group_aggregates() to authenticated;
grant execute on function public.get_group_by_invite_token(text) to authenticated;
grant execute on function public.get_invite_preview(text) to authenticated;
grant execute on function public.save_group(uuid, integer, jsonb, jsonb, jsonb) to authenticated;
