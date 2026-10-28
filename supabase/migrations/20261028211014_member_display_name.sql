-- Member display name (S-10): the name a person goes by in their groups, next to the account number in
-- member_profiles. It belongs to the person, so there is one name in every group.
--
-- The rules (trim, 1-40 characters, no control characters, only the owner changes it, who may see it) live in
-- TypeScript, in src/lib/member-profiles. These functions only persist and load, scoped to auth.uid(). The
-- `check` is a length backstop only.
--
-- Expand before contract: a nullable column, one additive key in get_my_member_profile and two new functions.
-- The previously deployed Worker keeps working: it calls the old save_my_member_profile, which leaves
-- display_name alone, and ignores the extra JSON key. The old save cannot simply gain a parameter (two functions
-- with the same named arguments would be ambiguous for PostgREST), so the new save has its own name and the old
-- one stays as an expand/contract leftover until a later contract migration.

alter table public.member_profiles add column display_name text;

alter table public.member_profiles
  add constraint member_profiles_display_name_length check (display_name is null or char_length(display_name) between 1 and 40);

create or replace function public.get_my_member_profile()
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
      'display_name', p.display_name,
      'version', p.version
    )
    from public.member_profiles p
    where p.user_id = auth.uid()
  );
end;
$$;

-- Stores the signed-in user's whole profile. Version 0 creates it; any other version updates it only while the
-- stored version still equals `p_expected_version`, and bumps it. Returns false and stores nothing when the
-- version moved on (a concurrent write); that is a persistence concurrency signal, not a business rule.
create function public.save_my_member_profile_with_display_name(
  p_expected_version integer,
  p_account_number text default null,
  p_display_name text default null
)
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
    insert into public.member_profiles (user_id, account_number, display_name)
    values (auth.uid(), p_account_number, p_display_name)
    on conflict (user_id) do nothing;
  else
    update public.member_profiles
    set account_number = p_account_number, display_name = p_display_name, version = version + 1, updated_at = now()
    where user_id = auth.uid() and version = p_expected_version;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.save_my_member_profile_with_display_name(integer, text, text) is
  'Persistence only — stores the signed-in user''s profile guarded by its version. Rules live in src/lib/member-profiles.';

-- The display names of those of `p_user_ids` who have one and are members of `p_group_id`, only when the
-- signed-in user is a member of that group too; an empty list otherwise.
create function public.get_group_member_display_names(p_group_id uuid, p_user_ids uuid[])
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
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name))
      from public.member_profiles p
      where p.user_id = any (p_user_ids)
        and p.display_name is not null
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

comment on function public.get_group_member_display_names(uuid, uuid[]) is
  'Persistence only — display names of fellow members of a group the caller belongs to. Rules live in src/lib/member-profiles.';

revoke execute on function public.save_my_member_profile_with_display_name(integer, text, text) from public, anon;
grant execute on function public.save_my_member_profile_with_display_name(integer, text, text) to authenticated;
revoke execute on function public.get_group_member_display_names(uuid, uuid[]) from public, anon;
grant execute on function public.get_group_member_display_names(uuid, uuid[]) to authenticated;
