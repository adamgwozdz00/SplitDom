-- Invite a member by link (S-03): persistence of the Invite aggregate.
--
-- The rules (only a member may invite, 7-day validity, single use) live in TypeScript, in
-- src/lib/invites. This migration only stores and loads the aggregate. Only the SHA-256 hash of the
-- invite token is stored, so a database leak does not leak working links.
--
-- Like the group tables, group_invites is closed to API clients: RLS is on with no policies and table
-- grants are revoked. Signed-in users reach it only through the `security definer` functions below,
-- which take the caller's identity from auth.uid().

create table public.group_invites (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- sha256 of the plaintext token; the length check is a format backstop.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

create index group_invites_group_id_idx on public.group_invites (group_id);

comment on table public.group_invites is 'Invite aggregate (src/lib/invites): invitations to join a group; stores only the token hash. Persistence only.';

alter table public.group_invites enable row level security;

revoke all on table public.group_invites from anon, authenticated;

-- Persistence functions ------------------------------------------------------------------------

-- Stores a new invite. The aggregate decided who may invite; the backstops below refuse what a
-- direct call could otherwise store: another user's identity, a group the caller is not in, and a
-- guessable token.
create function public.create_group_invite(
  p_invite_id uuid,
  p_group_id uuid,
  p_token text,
  p_created_by uuid,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_created_by is distinct from auth.uid() then
    raise exception 'created_by must be the calling user' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'caller is not a member of the group' using errcode = '42501';
  end if;

  if p_token is null or char_length(p_token) < 43 then
    raise exception 'token is too short' using errcode = '22023';
  end if;

  insert into public.group_invites (id, group_id, token_hash, created_by, created_at, expires_at)
  values (p_invite_id, p_group_id, sha256(convert_to(p_token, 'UTF8')), p_created_by, p_created_at, p_expires_at);
end;
$$;

comment on function public.create_group_invite(uuid, uuid, text, uuid, timestamptz, timestamptz) is
  'Persistence only — business rules live in src/lib/invites. Stores a new invite, keeping only the token hash.';

-- Loads an invite's snapshot (snake_case keys) by its plaintext token, or null when none matches.
-- Used and expired invites are returned too: the aggregate decides what they mean. This is the only
-- path that shows a group's name to a non-member, and only to a signed-in holder of the token.
create function public.get_group_invite(p_token text)
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
      'id', i.id,
      'group_id', i.group_id,
      'group_name', g.name,
      'created_by', i.created_by,
      'created_at', i.created_at,
      'expires_at', i.expires_at,
      'used_at', i.used_at,
      'used_by', i.used_by,
      'caller_is_member', exists (
        select 1
        from public.group_members m
        where m.group_id = i.group_id
          and m.user_id = auth.uid()
      )
    )
    from public.group_invites i
    join public.groups g on g.id = i.group_id
    where i.token_hash = sha256(convert_to(p_token, 'UTF8'))
  );
end;
$$;

comment on function public.get_group_invite(text) is
  'Persistence only — business rules live in src/lib/invites. Loads an invite by its plaintext token, or null.';

-- Claims the invite and adds the caller to its group in one transaction. The conditional UPDATE is
-- the race-safe claim: of two concurrent callers exactly one gets a row. Expiry is checked against
-- the database clock, not p_used_at, so a direct call cannot redeem an expired invite with an old
-- timestamp. Returns {group_id, joined}; joined is false when the caller was already a member.
create function public.redeem_group_invite(p_token text, p_used_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.group_invites
  set used_at = p_used_at,
      used_by = auth.uid()
  where token_hash = sha256(convert_to(p_token, 'UTF8'))
    and used_at is null
    and expires_at > now()
  returning group_id into v_group_id;

  if v_group_id is null then
    raise exception 'invite_invalid' using errcode = 'SD001';
  end if;

  insert into public.group_members (group_id, user_id, joined_at)
  values (v_group_id, auth.uid(), p_used_at)
  on conflict (group_id, user_id) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('group_id', v_group_id, 'joined', v_inserted > 0);
end;
$$;

comment on function public.redeem_group_invite(text, timestamptz) is
  'Persistence only — business rules live in src/lib/invites. Claims an invite and adds the caller to its group atomically.';

-- Only signed-in users may call these (see settlement_groups for why anon is revoked explicitly).
revoke execute on function public.create_group_invite(uuid, uuid, text, uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_group_invite(text) from public, anon;
revoke execute on function public.redeem_group_invite(text, timestamptz) from public, anon;

grant execute on function public.create_group_invite(uuid, uuid, text, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_group_invite(text) to authenticated;
grant execute on function public.redeem_group_invite(text, timestamptz) to authenticated;
