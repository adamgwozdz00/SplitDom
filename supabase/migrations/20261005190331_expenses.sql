-- Expenses (S-04): persistence of the Expense aggregate.
--
-- The rules (equal split, the payer absorbs the leftover grosze, shares sum to the amount, the period
-- is open, shares go to current members) live in TypeScript, in src/lib/expenses and src/lib/groups.
-- This migration only stores and loads the aggregate: it keeps structural integrity (foreign keys,
-- not null, single-column checks) and the auth.uid() scoping of the persistence functions.
--
-- Like the group tables, the expense tables are closed to API clients: RLS is on with no policies and
-- table grants are revoked. Signed-in users reach them only through the `security definer` functions
-- below. Money is stored as integer grosze.

-- Composite-key targets ------------------------------------------------------------------------

-- Lets expenses reference (period, group), so a period always belongs to the expense's group.
alter table public.billing_periods add constraint billing_periods_id_group_id_key unique (id, group_id);

-- Tables ---------------------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  period_id uuid not null,
  payer_id uuid not null,
  title text not null check (char_length(title) between 1 and 60),
  -- Grosze.
  amount integer not null check (amount between 1 and 100000000),
  purchased_on date not null,
  created_at timestamptz not null,
  unique (id, group_id),
  foreign key (period_id, group_id) references public.billing_periods (id, group_id) on delete cascade,
  -- No cascade: the payer must stay a member of the group.
  foreign key (group_id, payer_id) references public.group_members (group_id, user_id)
);

create index expenses_period_id_idx on public.expenses (period_id);

comment on table public.expenses is 'Expense aggregate (src/lib/expenses): one purchase paid by a member in a billing period. Persistence only.';

create table public.expense_shares (
  expense_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  -- Grosze.
  amount integer not null check (amount >= 0),
  primary key (expense_id, user_id),
  foreign key (expense_id, group_id) references public.expenses (id, group_id) on delete cascade,
  -- No cascade: every share belongs to a member of the expense's group.
  foreign key (group_id, user_id) references public.group_members (group_id, user_id)
);

comment on table public.expense_shares is 'Expense aggregate (src/lib/expenses): the stored split of an expense between members. Persistence only.';

alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

revoke all on table public.expenses from anon, authenticated;
revoke all on table public.expense_shares from anon, authenticated;

-- Persistence functions ------------------------------------------------------------------------

-- Stores a new Expense aggregate (the expense and its shares) in one transaction. Every value comes
-- from the aggregate; the only checks are the caller-scoping backstops below. A foreign key that does
-- not hold (a foreign period, a payer or sharer outside the group) surfaces as 23503.
create function public.add_expense(
  p_expense_id uuid,
  p_group_id uuid,
  p_period_id uuid,
  p_payer_id uuid,
  p_title text,
  p_amount integer,
  p_purchased_on date,
  p_created_at timestamptz,
  p_shares jsonb
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

  if p_payer_id is distinct from auth.uid() then
    raise exception 'payer_id must be the calling user' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'caller is not a member of the group' using errcode = '42501';
  end if;

  insert into public.expenses (id, group_id, period_id, payer_id, title, amount, purchased_on, created_at)
  values (p_expense_id, p_group_id, p_period_id, p_payer_id, p_title, p_amount, p_purchased_on, p_created_at);

  insert into public.expense_shares (expense_id, group_id, user_id, amount)
  select p_expense_id, p_group_id, s.user_id, s.amount
  from jsonb_to_recordset(p_shares) as s (user_id uuid, amount integer);
end;
$$;

comment on function public.add_expense(uuid, uuid, uuid, uuid, text, integer, date, timestamptz, jsonb) is
  'Persistence only — business rules live in src/lib/expenses. Stores a new expense and its shares for the calling user.';

-- Loads the expenses of one period (snake_case keys, shares included) as a JSON array, empty when
-- there are none, or null unless the caller is a member of the group.
create function public.list_period_expenses(p_group_id uuid, p_period_id uuid)
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
    where e.group_id = p_group_id
      and e.period_id = p_period_id
  );
end;
$$;

comment on function public.list_period_expenses(uuid, uuid) is
  'Persistence only — business rules live in src/lib/expenses. Loads the expenses of one period for a member, or null.';

revoke execute on function public.add_expense(uuid, uuid, uuid, uuid, text, integer, date, timestamptz, jsonb) from public, anon;
revoke execute on function public.list_period_expenses(uuid, uuid) from public, anon;

grant execute on function public.add_expense(uuid, uuid, uuid, uuid, text, integer, date, timestamptz, jsonb) to authenticated;
grant execute on function public.list_period_expenses(uuid, uuid) to authenticated;

-- Member emails --------------------------------------------------------------------------------

-- Same body as before, plus each member's email (from auth.users), so co-members can be labelled.
-- Only members of the group get the snapshot, so emails are shown to co-members only. Adding a key
-- is compatible with the previously deployed Worker, whose parser ignores unknown keys.
create or replace function public.get_my_group(p_group_id uuid)
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
        select coalesce(
          jsonb_agg(jsonb_build_object('user_id', m.user_id, 'joined_at', m.joined_at, 'email', u.email)),
          '[]'::jsonb
        )
        from public.group_members m
        join auth.users u on u.id = m.user_id
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

-- Account deletion -----------------------------------------------------------------------------

-- A member's account can no longer be deleted while they belong to a group (their expenses and shares
-- would otherwise lose their payer), the same as the host. Restrict, like groups.host_id.
alter table public.group_members
  drop constraint group_members_user_id_fkey,
  add constraint group_members_user_id_fkey foreign key (user_id) references auth.users (id);
