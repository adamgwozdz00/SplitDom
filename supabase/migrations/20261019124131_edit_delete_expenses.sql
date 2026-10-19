-- Edit and delete own expenses (S-05): persistence of the changes the BillingPeriod aggregate makes to a loaded
-- period, next to the expenses it adds.
--
-- The rules (only the payer changes an expense, only while the period is open, the date window, the re-split)
-- live in TypeScript, in src/lib/billing-periods. This function only stores the result, guarded by the
-- period's `version` like save_billing_period.
--
-- Expand before contract: save_billing_period stays untouched, because the previously deployed Worker still
-- calls it; the new Worker calls save_billing_period_changes instead.

-- Saves a loaded period: bumps its version only while it still equals `p_expected_version` (and the period is
-- still open), then stores the expenses added since load (`p_added`, with shares), rewrites the expenses
-- changed since load (`p_changed`: title, amount, purchase date and shares) and deletes the removed ones
-- (`p_removed`; their shares cascade). Returns false and stores nothing when the version moved on (a concurrent
-- write); that is a persistence concurrency signal, not a business rule.
create function public.save_billing_period_changes(
  p_period_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_added jsonb,
  p_changed jsonb,
  p_removed uuid[]
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

  -- Caller-scoping backstop, as in save_billing_period: the caller stores only expenses they paid.
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

  return true;
end;
$$;

comment on function public.save_billing_period_changes(uuid, uuid, integer, jsonb, jsonb, uuid[]) is
  'Persistence only — business rules live in src/lib/billing-periods. Saves the added, changed and removed expenses of a period of a group of the calling user if its version is unchanged.';

revoke execute on function public.save_billing_period_changes(uuid, uuid, integer, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.save_billing_period_changes(uuid, uuid, integer, jsonb, jsonb, uuid[]) to authenticated;
