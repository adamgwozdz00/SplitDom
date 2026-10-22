-- Payment confirmations (S-08): the recipient of a payment confirms or rejects it.
--
-- A rejected payment stays in the ledger with `rejected_at` set and counts in no balance; a confirmed one has
-- `confirmed_at`. The rules (recipient only, final decisions, closed period, balances) live in TypeScript, in
-- src/lib/billing-periods. This migration stores the decisions, with structural backstops: the two timestamps
-- exclude each other, and the save function lets only the recipient decide a still-pending payment.
--
-- Expand only: a nullable column, two checks every existing row satisfies, one extra key in
-- get_current_billing_period (the previously deployed Worker ignores it) and a new save function.
-- save_billing_period_with_payments stays untouched for that Worker and awaits a contract migration.

alter table public.payments
  add column rejected_at timestamptz,
  add constraint payments_not_confirmed_and_rejected check (confirmed_at is null or rejected_at is null),
  add constraint payments_rejected_after_sent check (rejected_at is null or rejected_at >= sent_at);

-- Same as before, and each payment object also carries `rejected_at`.
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
      )
    )
    from public.billing_periods p
    where p.group_id = p_group_id
    order by p.month desc
    limit 1
  );
end;
$$;

-- Saves a loaded period like save_billing_period_with_payments, and also stores the recipient's decisions:
-- `p_confirmed` ([{id, confirmed_at}]) and `p_rejected` ([{id, rejected_at}]) set those columns on payments of the
-- period. Returns false and stores nothing when the version moved on (a concurrent write).
create function public.save_billing_period_with_confirmations(
  p_period_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_added jsonb,
  p_changed jsonb,
  p_removed uuid[],
  p_sent jsonb,
  p_withdrawn uuid[],
  p_confirmed jsonb,
  p_rejected jsonb
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
        and x.rejected_at is null
    )
  ) then
    raise exception 'the calling user can withdraw only their own pending payments of the period' using errcode = '42501';
  end if;

  -- The backstop for decisions: the caller confirms and rejects only pending payments of this period that were
  -- sent to them.
  if exists (
    select 1
    from (
      select d.id from jsonb_to_recordset(p_confirmed) as d (id uuid)
      union all
      select d.id from jsonb_to_recordset(p_rejected) as d (id uuid)
    ) as target (id)
    where not exists (
      select 1
      from public.payments x
      where x.id = target.id
        and x.period_id = p_period_id
        and x.group_id = p_group_id
        and x.recipient_id = auth.uid()
        and x.confirmed_at is null
        and x.rejected_at is null
    )
  ) then
    raise exception 'the calling user can confirm or reject only pending payments sent to them' using errcode = '42501';
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

  -- An id in both lists breaks the table's confirmed-xor-rejected check.
  update public.payments x
  set confirmed_at = d.confirmed_at
  from jsonb_to_recordset(p_confirmed) as d (id uuid, confirmed_at timestamptz)
  where x.id = d.id
    and x.period_id = p_period_id
    and x.group_id = p_group_id;

  update public.payments x
  set rejected_at = d.rejected_at
  from jsonb_to_recordset(p_rejected) as d (id uuid, rejected_at timestamptz)
  where x.id = d.id
    and x.period_id = p_period_id
    and x.group_id = p_group_id;

  return true;
end;
$$;

comment on function public.save_billing_period_with_confirmations(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[], jsonb, jsonb) is
  'Persistence only — business rules live in src/lib/billing-periods. Saves the added, changed and removed expenses and the sent, withdrawn, confirmed and rejected payments of a period of a group of the calling user if its version is unchanged.';

revoke execute on function public.save_billing_period_with_confirmations(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[], jsonb, jsonb) from public, anon;
grant execute on function public.save_billing_period_with_confirmations(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[], jsonb, jsonb) to authenticated;
