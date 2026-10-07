-- BillingPeriod aggregate (F-02): persistence of the period as the aggregate root of its expenses.
--
-- The rules (expenses only in an open period, the payer is a participant, the purchase-date window,
-- the equal split) live in TypeScript, in src/lib/billing-periods. This migration only stores and loads
-- the aggregate: it adds the period's `version` for optimistic locking and the persistence functions
-- the BillingPeriod and Group repositories switch to.
--
-- Expand before contract: create_group, add_expense, list_period_expenses and the `open_period` key of
-- get_my_group / list_my_groups stay untouched, because the previously deployed Worker still calls them.

-- Optimistic locking ---------------------------------------------------------------------------

-- The default only backfills existing rows; new periods get their version from the aggregate.
alter table public.billing_periods add column version integer not null default 0;

comment on column public.billing_periods.version is
  'Optimistic lock: save_billing_period bumps it only while it still equals the version the aggregate loaded.';

comment on table public.billing_periods is
  'BillingPeriod aggregate (src/lib/billing-periods): one billing period of a group, the root of its expenses. Persistence only.';

comment on table public.expenses is
  'BillingPeriod aggregate (src/lib/billing-periods): one purchase paid by a member in a billing period. Persistence only.';

comment on table public.expense_shares is
  'BillingPeriod aggregate (src/lib/billing-periods): the stored split of an expense between members. Persistence only.';

-- Persistence functions: Group -----------------------------------------------------------------

-- Stores a new Group aggregate (the group and its host's membership) in one transaction, without a
-- billing period: the period is opened by the BillingPeriod repository. `p_now` is the aggregate's clock.
create function public.add_group(
  p_group_id uuid,
  p_name text,
  p_host_id uuid,
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

  -- Persistence backstop, as in create_group: the database refuses to store any host but the caller.
  if p_host_id is distinct from auth.uid() then
    raise exception 'host_id must be the calling user' using errcode = '42501';
  end if;

  insert into public.groups (id, name, host_id, created_at)
  values (p_group_id, p_name, p_host_id, p_now);

  insert into public.group_members (group_id, user_id, joined_at)
  values (p_group_id, p_host_id, p_now);
end;
$$;

comment on function public.add_group(uuid, text, uuid, timestamptz) is
  'Persistence only — business rules live in src/lib/groups. Stores a new group and its host for the calling user.';

-- Persistence functions: BillingPeriod ---------------------------------------------------------

-- Stores a newly opened period of a group the caller belongs to. Every value comes from the aggregate.
-- A second open period of the group (or a second period for the same month) surfaces as 23505.
create function public.open_billing_period(
  p_period_id uuid,
  p_group_id uuid,
  p_month date,
  p_opened_at timestamptz,
  p_version integer
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

  if not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'caller is not a member of the group' using errcode = '42501';
  end if;

  insert into public.billing_periods (id, group_id, month, opened_at, version)
  values (p_period_id, p_group_id, p_month, p_opened_at, p_version);
end;
$$;

comment on function public.open_billing_period(uuid, uuid, date, timestamptz, integer) is
  'Persistence only — business rules live in src/lib/billing-periods. Stores a newly opened period of a group of the calling user.';

-- Loads a group's latest period by month (snake_case keys) with its expenses and their shares, or null
-- when the group has no period or the caller is not its member. The expenses use the
-- list_period_expenses shape.
create function public.get_current_billing_period(p_group_id uuid)
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

  if not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  ) then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'group_id', p.group_id,
      'month', p.month,
      'opened_at', p.opened_at,
      'closed_at', p.closed_at,
      'version', p.version,
      'expenses', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'group_id', e.group_id,
            'period_id', e.period_id,
            'payer_id', e.payer_id,
            'title', e.title,
            'amount', e.amount,
            'purchased_on', e.purchased_on,
            'created_at', e.created_at,
            'shares', (
              select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount', s.amount)), '[]'::jsonb)
              from public.expense_shares s
              where s.expense_id = e.id
            )
          )
        ), '[]'::jsonb)
        from public.expenses e
        where e.group_id = p.group_id
          and e.period_id = p.id
      )
    )
    from public.billing_periods p
    where p.group_id = p_group_id
    order by p.month desc
    limit 1
  );
end;
$$;

comment on function public.get_current_billing_period(uuid) is
  'Persistence only — business rules live in src/lib/billing-periods. Loads the latest period of a group of the calling user, or null.';

-- Saves a loaded period: bumps its version only while it still equals `p_expected_version`, then stores
-- the expenses added since it was loaded (snake_case keys, shares included). Returns false and stores
-- nothing when the version moved on (a concurrent write); that is a persistence concurrency signal, not a
-- business rule. A foreign key that does not hold (a sharer outside the group) surfaces as 23503.
create function public.save_billing_period(
  p_period_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_expenses jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'caller is not a member of the group' using errcode = '42501';
  end if;

  -- Caller-scoping backstop, as in add_expense: the caller stores only expenses they paid.
  if exists (
    select 1
    from jsonb_to_recordset(p_expenses) as e (payer_id uuid)
    where e.payer_id is distinct from auth.uid()
  ) then
    raise exception 'payer_id must be the calling user' using errcode = '42501';
  end if;

  update public.billing_periods
  set version = version + 1
  where id = p_period_id
    and group_id = p_group_id
    and version = p_expected_version;

  if not found then
    return false;
  end if;

  insert into public.expenses (id, group_id, period_id, payer_id, title, amount, purchased_on, created_at)
  select e.id, p_group_id, p_period_id, e.payer_id, e.title, e.amount, e.purchased_on, e.created_at
  from jsonb_to_recordset(p_expenses) as e (
    id uuid,
    payer_id uuid,
    title text,
    amount integer,
    purchased_on date,
    created_at timestamptz
  );

  insert into public.expense_shares (expense_id, group_id, user_id, amount)
  select e.id, p_group_id, s.user_id, s.amount
  from jsonb_to_recordset(p_expenses) as e (id uuid, shares jsonb)
  cross join lateral jsonb_to_recordset(e.shares) as s (user_id uuid, amount integer);

  return true;
end;
$$;

comment on function public.save_billing_period(uuid, uuid, integer, jsonb) is
  'Persistence only — business rules live in src/lib/billing-periods. Saves a period of a group of the calling user if its version is unchanged.';

-- Loads the open period's month of every group the caller is a member of, as a JSON array
-- `[{ group_id, month }]` (empty when none).
create function public.list_my_open_billing_months()
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
    select coalesce(jsonb_agg(jsonb_build_object('group_id', p.group_id, 'month', p.month)), '[]'::jsonb)
    from public.billing_periods p
    join public.group_members me on me.group_id = p.group_id
    where me.user_id = auth.uid()
      and p.closed_at is null
  );
end;
$$;

comment on function public.list_my_open_billing_months() is
  'Persistence only — business rules live in src/lib/billing-periods. Loads the open month of every group of the calling user.';

-- Postgres grants EXECUTE to PUBLIC on new functions and Supabase's default privileges grant it to
-- anon too; only signed-in users may call these.
revoke execute on function public.add_group(uuid, text, uuid, timestamptz) from public, anon;
revoke execute on function public.open_billing_period(uuid, uuid, date, timestamptz, integer) from public, anon;
revoke execute on function public.get_current_billing_period(uuid) from public, anon;
revoke execute on function public.save_billing_period(uuid, uuid, integer, jsonb) from public, anon;
revoke execute on function public.list_my_open_billing_months() from public, anon;

grant execute on function public.add_group(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.open_billing_period(uuid, uuid, date, timestamptz, integer) to authenticated;
grant execute on function public.get_current_billing_period(uuid) to authenticated;
grant execute on function public.save_billing_period(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.list_my_open_billing_months() to authenticated;
