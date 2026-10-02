-- Settlement groups (S-02): persistence of the Group aggregate.
--
-- The rules (name length, the host is a member and never changes, exactly one open period)
-- live in TypeScript, in src/lib/groups. This migration only stores and loads the aggregate:
-- constraints below are backstops, not the source of the rules.
--
-- The tables are closed to API clients: RLS is on with no policies and table grants are revoked
-- from anon and authenticated. Signed-in users reach the data only through the three
-- `security definer` persistence functions at the end, which take the caller's identity from
-- auth.uid() and never from a parameter they trust.

-- Tables ---------------------------------------------------------------------------------------

create table public.groups (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 60),
  -- No cascade: a host cannot be deleted while their group exists.
  host_id uuid not null references auth.users (id),
  created_at timestamptz not null
);

comment on table public.groups is 'Group aggregate (src/lib/groups): the group root. Persistence only.';

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null,
  primary key (group_id, user_id)
);

-- "My groups" lookups go by member.
create index group_members_user_id_idx on public.group_members (user_id);

comment on table public.group_members is 'Group aggregate (src/lib/groups): the group''s members. Persistence only.';

create table public.billing_periods (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- First day of the billing month (Europe/Warsaw calendar), as decided by the aggregate. The check is
  -- a format backstop: create_group is callable past the aggregate, and BillingMonth only restores YYYY-MM-01.
  month date not null check (extract(day from month) = 1),
  opened_at timestamptz not null,
  -- Null means the period is open.
  closed_at timestamptz,
  unique (group_id, month)
);

-- Backstop for the aggregate's "exactly one open period" invariant under concurrent writes.
create unique index billing_periods_one_open_per_group_idx on public.billing_periods (group_id) where closed_at is null;

comment on table public.billing_periods is 'Group aggregate (src/lib/groups): the group''s billing periods. Persistence only.';

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.billing_periods enable row level security;

-- Supabase's default privileges grant every new public table to anon and authenticated; revoke them
-- so direct API access fails with 42501 instead of returning an empty list.
revoke all on table public.groups from anon, authenticated;
revoke all on table public.group_members from anon, authenticated;
revoke all on table public.billing_periods from anon, authenticated;

-- Persistence functions ------------------------------------------------------------------------

-- Stores a new Group aggregate (the group, its host's membership and its open period) in one
-- transaction. Every value comes from the aggregate; `p_now` is the aggregate's clock.
create function public.create_group(
  p_group_id uuid,
  p_name text,
  p_host_id uuid,
  p_period_id uuid,
  p_period_month date,
  p_now timestamptz
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

  -- Persistence backstop, not a business rule (approved for S-02): the aggregate decides who the
  -- host is, and the database refuses to store any identity other than the caller's.
  if p_host_id is distinct from auth.uid() then
    raise exception 'host_id must be the calling user' using errcode = '42501';
  end if;

  insert into public.groups (id, name, host_id, created_at)
  values (p_group_id, p_name, p_host_id, p_now);

  insert into public.group_members (group_id, user_id, joined_at)
  values (p_group_id, p_host_id, p_now);

  insert into public.billing_periods (id, group_id, month, opened_at)
  values (p_period_id, p_group_id, p_period_month, p_now);
end;
$$;

comment on function public.create_group(uuid, text, uuid, uuid, date, timestamptz) is
  'Persistence only — business rules live in src/lib/groups. Stores a new Group aggregate for the calling user.';

-- Loads one group's snapshot (snake_case keys), or null unless the caller is its member, so a
-- non-member cannot tell "exists" from "does not exist".
create function public.get_my_group(p_group_id uuid)
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
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'joined_at', m.joined_at)), '[]'::jsonb)
        from public.group_members m
        where m.group_id = g.id
      ),
      'open_period', (
        select jsonb_build_object('id', p.id, 'month', p.month, 'opened_at', p.opened_at)
        from public.billing_periods p
        where p.group_id = g.id
          and p.closed_at is null
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

comment on function public.get_my_group(uuid) is
  'Persistence only — business rules live in src/lib/groups. Loads one group of the calling user, or null.';

-- Loads the snapshots of every group the caller is a member of, as a JSON array (empty when none).
create function public.list_my_groups()
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
    select coalesce(jsonb_agg(public.get_my_group(me.group_id)), '[]'::jsonb)
    from public.group_members me
    where me.user_id = auth.uid()
  );
end;
$$;

comment on function public.list_my_groups() is
  'Persistence only — business rules live in src/lib/groups. Loads every group of the calling user.';

-- Postgres grants EXECUTE to PUBLIC on new functions and Supabase's default privileges grant it to
-- anon too; only signed-in users may call these.
revoke execute on function public.create_group(uuid, text, uuid, uuid, date, timestamptz) from public, anon;
revoke execute on function public.get_my_group(uuid) from public, anon;
revoke execute on function public.list_my_groups() from public, anon;

grant execute on function public.create_group(uuid, text, uuid, uuid, date, timestamptz) to authenticated;
grant execute on function public.get_my_group(uuid) to authenticated;
grant execute on function public.list_my_groups() to authenticated;
