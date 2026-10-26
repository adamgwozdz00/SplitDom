-- Closing a billing period (S-09): the host closes a finished period and the next one opens in the same write.
--
-- The rules (host only, the month has ended, the host owes nothing on the posted balances, which debts carry over
-- and which payments move) live in TypeScript, in src/lib/billing-periods. This migration stores what the
-- BillingPeriod aggregate produces: the debts carried into the next period (`opening_debts`) and the close itself,
-- as one version-guarded call with structural backstops.
--
-- Expand only: a new table, a new function and one extra key in get_current_billing_period (the previously
-- deployed Worker ignores it and never closes a period).

create table public.opening_debts (
  group_id uuid not null,
  period_id uuid not null,
  debtor_id uuid not null,
  creditor_id uuid not null,
  amount integer not null check (amount > 0),
  primary key (period_id, debtor_id, creditor_id),
  check (debtor_id <> creditor_id),
  foreign key (period_id, group_id) references public.billing_periods (id, group_id) on delete cascade,
  foreign key (group_id, debtor_id) references public.group_members (group_id, user_id),
  foreign key (group_id, creditor_id) references public.group_members (group_id, user_id)
);

comment on table public.opening_debts is
  'Persistence only — rules live in src/lib/billing-periods. A debt carried into a period from the period before it. Read and written through security definer functions.';

alter table public.opening_debts enable row level security;
revoke all on table public.opening_debts from anon, authenticated;

-- Same as before, plus the period's opening debts under the key `opening_debts`.
create or replace function public.get_current_billing_period(p_group_id uuid)
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
      ),
      'payments', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', y.id,
            'sender_id', y.sender_id,
            'recipient_id', y.recipient_id,
            'amount', y.amount,
            'sent_at', y.sent_at,
            'confirmed_at', y.confirmed_at,
            'rejected_at', y.rejected_at
          )
        ), '[]'::jsonb)
        from public.payments y
        where y.group_id = p.group_id
          and y.period_id = p.id
      ),
      'opening_debts', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'debtor_id', o.debtor_id,
            'creditor_id', o.creditor_id,
            'amount', o.amount
          )
        ), '[]'::jsonb)
        from public.opening_debts o
        where o.group_id = p.group_id
          and o.period_id = p.id
      )
    )
    from public.billing_periods p
    where p.group_id = p_group_id
    order by p.month desc
    limit 1
  );
end;
$$;

-- Closes a loaded period of a group the caller hosts and opens the next one: sets `closed_at` and bumps the
-- version of the closed period, inserts the next period (version 0) with its opening debts
-- (`p_opening`: [{debtor_id, creditor_id, amount}]) and moves the pending payments `p_moved` to it. Returns false
-- and stores nothing when the version moved on or the period is already closed (a concurrent write). A second
-- open period of the group, or a second period for the same month, surfaces as 23505.
create function public.close_billing_period(
  p_period_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_closed_at timestamptz,
  p_next_period_id uuid,
  p_next_month date,
  p_next_opened_at timestamptz,
  p_opening jsonb,
  p_moved uuid[]
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

  -- The backstops that do not depend on the period's current state, before the version bump.
  if not exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.host_id = auth.uid()
  ) then
    raise exception 'only the host of the group can close its billing period' using errcode = '42501';
  end if;

  if p_next_month is distinct from (
    select (p.month + interval '1 month')::date
    from public.billing_periods p
    where p.id = p_period_id
      and p.group_id = p_group_id
  ) then
    raise exception 'the next period must cover the month after the closed one' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_opening) as o (debtor_id uuid, creditor_id uuid, amount integer)
    where o.debtor_id is null
      or o.creditor_id is null
      or o.debtor_id = o.creditor_id
      or o.amount is null
      or o.amount <= 0
      or not exists (
        select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = o.debtor_id
      )
      or not exists (
        select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = o.creditor_id
      )
  ) then
    raise exception 'an opening debt needs two distinct members of the group and a positive amount' using errcode = '42501';
  end if;

  update public.billing_periods
  set version = version + 1,
      closed_at = p_closed_at
  where id = p_period_id
    and group_id = p_group_id
    and version = p_expected_version
    and closed_at is null;

  if not found then
    return false;
  end if;

  -- The backstops on the period's payments, right after the version check so that a concurrent payment write
  -- reports a conflict (false) instead of tripping them; raising here rolls the version bump back as well, so
  -- nothing is stored. Every moved payment is a pending payment of this period, and no pending payment of this
  -- period is left behind in the closed period.
  if exists (
    select 1
    from unnest(p_moved) as target (id)
    where not exists (
      select 1
      from public.payments x
      where x.id = target.id
        and x.period_id = p_period_id
        and x.group_id = p_group_id
        and x.confirmed_at is null
        and x.rejected_at is null
    )
  ) then
    raise exception 'only pending payments of the closed period can move' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.payments x
    where x.period_id = p_period_id
      and x.group_id = p_group_id
      and x.confirmed_at is null
      and x.rejected_at is null
      and not (x.id = any (coalesce(p_moved, '{}')))
  ) then
    raise exception 'every pending payment of the closed period must move' using errcode = '42501';
  end if;

  insert into public.billing_periods (id, group_id, month, opened_at, version)
  values (p_next_period_id, p_group_id, p_next_month, p_next_opened_at, 0);

  insert into public.opening_debts (group_id, period_id, debtor_id, creditor_id, amount)
  select p_group_id, p_next_period_id, o.debtor_id, o.creditor_id, o.amount
  from jsonb_to_recordset(p_opening) as o (debtor_id uuid, creditor_id uuid, amount integer);

  update public.payments
  set period_id = p_next_period_id
  where id = any (p_moved)
    and period_id = p_period_id
    and group_id = p_group_id;

  return true;
end;
$$;

comment on function public.close_billing_period(uuid, uuid, integer, timestamptz, uuid, date, timestamptz, jsonb, uuid[]) is
  'Persistence only — business rules live in src/lib/billing-periods. Closes a period of a group the calling user hosts if its version is unchanged, and opens the next one with its opening debts and the moved pending payments.';

revoke execute on function public.close_billing_period(uuid, uuid, integer, timestamptz, uuid, date, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.close_billing_period(uuid, uuid, integer, timestamptz, uuid, date, timestamptz, jsonb, uuid[]) to authenticated;
