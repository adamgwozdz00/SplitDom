-- Payments (S-07): the ledger entries a member records when they send a bank transfer to another member.
--
-- A payment counts in the period's balances next to the expenses (pending until the recipient confirms it,
-- S-08). The rules (the debt it needs, the cap, the sender-only withdraw, the pending and posted balances)
-- live in TypeScript, in src/lib/billing-periods. This migration only stores and loads the payments the
-- BillingPeriod aggregate makes, with structural backstops (keys, positive amount, sender <> recipient, and
-- the caller-scoping checks in the save function).
--
-- Expand before contract: a new table, a new function and one extra key in get_current_billing_period (the
-- previously deployed Worker ignores it); save_billing_period_changes stays untouched, so that Worker keeps
-- working. The new Worker calls save_billing_period_with_payments instead.

create table public.payments (
  id uuid primary key,
  group_id uuid not null,
  period_id uuid not null,
  sender_id uuid not null,
  recipient_id uuid not null,
  amount integer not null check (amount > 0),
  sent_at timestamptz not null,
  confirmed_at timestamptz,
  check (sender_id <> recipient_id),
  check (confirmed_at is null or confirmed_at >= sent_at),
  foreign key (period_id, group_id) references public.billing_periods (id, group_id) on delete cascade,
  foreign key (group_id, sender_id) references public.group_members (group_id, user_id),
  foreign key (group_id, recipient_id) references public.group_members (group_id, user_id)
);

comment on table public.payments is
  'Persistence only — rules live in src/lib/billing-periods. Read and written through security definer functions.';

alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;

-- Same as before, plus the period's payments under the key `payments`.
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
            'confirmed_at', y.confirmed_at
          )
        ), '[]'::jsonb)
        from public.payments y
        where y.group_id = p.group_id
          and y.period_id = p.id
      )
    )
    from public.billing_periods p
    where p.group_id = p_group_id
    order by p.month desc
    limit 1
  );
end;
$$;

-- Saves a loaded period like save_billing_period_changes (added, changed and removed expenses, guarded by the
-- period's version), and also stores the payments: the `p_sent` rows (id, sender_id, recipient_id, amount,
-- sent_at) are inserted and the `p_withdrawn` ids deleted. Returns false and stores nothing when the version
-- moved on (a concurrent write); that is a persistence concurrency signal, not a business rule.
create function public.save_billing_period_with_payments(
  p_period_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_added jsonb,
  p_changed jsonb,
  p_removed uuid[],
  p_sent jsonb,
  p_withdrawn uuid[]
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

  -- Caller-scoping backstop, as in save_billing_period_changes: the caller stores only expenses they paid.
  if exists (
    select 1
    from jsonb_to_recordset(p_added) as e (payer_id uuid)
    where e.payer_id is distinct from auth.uid()
  ) then
    raise exception 'payer_id must be the calling user' using errcode = '42501';
  end if;

  -- The same backstop for existing expenses: the caller changes and deletes only expenses they paid in this period.
  if exists (
    select 1
    from (
      select e.id from jsonb_to_recordset(p_changed) as e (id uuid)
      union all
      select unnest(p_removed)
    ) as target (id)
    where not exists (
      select 1
      from public.expenses x
      where x.id = target.id
        and x.period_id = p_period_id
        and x.group_id = p_group_id
        and x.payer_id = auth.uid()
    )
  ) then
    raise exception 'the calling user can change only their own expenses of the period' using errcode = '42501';
  end if;

  -- The backstops for payments, before the version bump so a stale version cannot hide them: the caller sends
  -- only payments of their own, which are unconfirmed, and withdraws only their own unconfirmed payments of
  -- this period.
  if exists (
    select 1
    from jsonb_to_recordset(p_sent) as y (sender_id uuid)
    where y.sender_id is distinct from auth.uid()
  ) then
    raise exception 'sender_id must be the calling user' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(p_withdrawn) as target (id)
    where not exists (
      select 1
      from public.payments x
      where x.id = target.id
        and x.period_id = p_period_id
        and x.group_id = p_group_id
        and x.sender_id = auth.uid()
        and x.confirmed_at is null
    )
  ) then
    raise exception 'the calling user can withdraw only their own unconfirmed payments of the period' using errcode = '42501';
  end if;

  update public.billing_periods
  set version = version + 1
  where id = p_period_id
    and group_id = p_group_id
    and version = p_expected_version
    and closed_at is null;

  if not found then
    return false;
  end if;

  insert into public.expenses (id, group_id, period_id, payer_id, title, amount, purchased_on, created_at)
  select e.id, p_group_id, p_period_id, e.payer_id, e.title, e.amount, e.purchased_on, e.created_at
  from jsonb_to_recordset(p_added) as e (
    id uuid,
    payer_id uuid,
    title text,
    amount integer,
    purchased_on date,
    created_at timestamptz
  );

  insert into public.expense_shares (expense_id, group_id, user_id, amount)
  select e.id, p_group_id, s.user_id, s.amount
  from jsonb_to_recordset(p_added) as e (id uuid, shares jsonb)
  cross join lateral jsonb_to_recordset(e.shares) as s (user_id uuid, amount integer);

  update public.expenses x
  set title = c.title,
      amount = c.amount,
      purchased_on = c.purchased_on
  from jsonb_to_recordset(p_changed) as c (id uuid, title text, amount integer, purchased_on date)
  where x.id = c.id
    and x.period_id = p_period_id
    and x.group_id = p_group_id;

  delete from public.expense_shares
  where group_id = p_group_id
    and expense_id in (select c.id from jsonb_to_recordset(p_changed) as c (id uuid));

  insert into public.expense_shares (expense_id, group_id, user_id, amount)
  select c.id, p_group_id, s.user_id, s.amount
  from jsonb_to_recordset(p_changed) as c (id uuid, shares jsonb)
  cross join lateral jsonb_to_recordset(c.shares) as s (user_id uuid, amount integer);

  delete from public.expenses
  where id = any (p_removed)
    and period_id = p_period_id
    and group_id = p_group_id;

  insert into public.payments (id, group_id, period_id, sender_id, recipient_id, amount, sent_at)
  select y.id, p_group_id, p_period_id, y.sender_id, y.recipient_id, y.amount, y.sent_at
  from jsonb_to_recordset(p_sent) as y (
    id uuid,
    sender_id uuid,
    recipient_id uuid,
    amount integer,
    sent_at timestamptz
  );

  delete from public.payments
  where id = any (p_withdrawn)
    and period_id = p_period_id
    and group_id = p_group_id;

  return true;
end;
$$;

comment on function public.save_billing_period_with_payments(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[]) is
  'Persistence only — business rules live in src/lib/billing-periods. Saves the added, changed and removed expenses and the sent and withdrawn payments of a period of a group of the calling user if its version is unchanged.';

revoke execute on function public.save_billing_period_with_payments(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[]) from public, anon;
grant execute on function public.save_billing_period_with_payments(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[]) to authenticated;
