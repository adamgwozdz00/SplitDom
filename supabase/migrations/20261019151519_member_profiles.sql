-- Member profiles (S-06): one row per person holding the bank account number a debtor copies into their
-- banking. The number belongs to the person, not to a group, so it lives in its own table; S-10 will add the
-- display name to the same row.
--
-- The rules (only the owner changes a profile, the NRB checksum, who may see a number: only the debtor of the
-- owner, derived from the balances) live in TypeScript, in src/lib/member-profiles and src/lib/billing-periods.
-- These functions only persist and load, scoped to auth.uid(). The `check` is a format backstop only.
--
-- Expand before contract: a new table and new functions, nothing existing changes, so the previously
-- deployed Worker keeps working.
--
-- Unlike the group tables, the user FK cascades: a profile is the person's own data, so deleting the user
-- deletes it (see Open Roadmap Question 4 about erasing a member's data).

create table public.member_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  account_number text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint member_profiles_account_number_format check (account_number is null or account_number ~ '^[0-9]{26}$')
);

comment on table public.member_profiles is
  'Persistence only — rules live in src/lib/member-profiles. Read and written through security definer functions.';

alter table public.member_profiles enable row level security;
revoke all on table public.member_profiles from anon, authenticated;

-- The signed-in user's profile, or null when none was stored yet.
create function public.get_my_member_profile()
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
      'user_id', p.user_id,
      'account_number', p.account_number,
      'version', p.version
    )
    from public.member_profiles p
    where p.user_id = auth.uid()
  );
end;
$$;

comment on function public.get_my_member_profile() is
  'Persistence only — the signed-in user''s profile as jsonb, or null. Rules live in src/lib/member-profiles.';

-- Stores the signed-in user's profile. Version 0 creates it; any other version updates it only while the
-- stored version still equals `p_expected_version`, and bumps it. Returns false and stores nothing when the
-- version moved on (a concurrent write); that is a persistence concurrency signal, not a business rule.
create function public.save_my_member_profile(p_account_number text, p_expected_version integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_expected_version = 0 then
    insert into public.member_profiles (user_id, account_number)
    values (auth.uid(), p_account_number)
    on conflict (user_id) do nothing;
  else
    update public.member_profiles
    set account_number = p_account_number, version = version + 1, updated_at = now()
    where user_id = auth.uid() and version = p_expected_version;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.save_my_member_profile(text, integer) is
  'Persistence only — stores the signed-in user''s profile guarded by its version. Rules live in src/lib/member-profiles.';

-- The stored account numbers of those of `p_user_ids` who have one and are members of `p_group_id`, only when
-- the signed-in user is a member of that group too; an empty list otherwise. Which of those numbers a page
-- may use (only the creditors of the viewer's own debts) is decided in TypeScript.
create function public.get_group_member_account_numbers(p_group_id uuid, p_user_ids uuid[])
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

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'account_number', p.account_number))
      from public.member_profiles p
      where p.user_id = any (p_user_ids)
        and p.account_number is not null
        and exists (
          select 1 from public.group_members me
          where me.group_id = p_group_id and me.user_id = auth.uid()
        )
        and exists (
          select 1 from public.group_members them
          where them.group_id = p_group_id and them.user_id = p.user_id
        )
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_group_member_account_numbers(uuid, uuid[]) is
  'Persistence only — account numbers of fellow members of a group the caller belongs to. Rules live in src/lib/billing-periods.';

revoke execute on function public.get_my_member_profile() from public, anon;
grant execute on function public.get_my_member_profile() to authenticated;
revoke execute on function public.save_my_member_profile(text, integer) from public, anon;
grant execute on function public.save_my_member_profile(text, integer) to authenticated;
revoke execute on function public.get_group_member_account_numbers(uuid, uuid[]) from public, anon;
grant execute on function public.get_group_member_account_numbers(uuid, uuid[]) to authenticated;
