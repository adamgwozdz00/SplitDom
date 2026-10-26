-- Contract migration (S-09): drops the expand/contract leftovers.
--
-- Earlier slices replaced these functions but kept them for the previously deployed Worker. The Worker deployed
-- since S-08 calls none of them, and nothing in src/ does. Two of them could write into a closed billing period
-- (add_expense neither bumps `version` nor checks `closed_at`; save_billing_period bumps `version` without
-- checking `closed_at`), so they go before period closing exists.
--
-- Kept: every function the app calls (add_group, get_current_billing_period, open_billing_period,
-- save_billing_period_with_confirmations, list_my_open_billing_months, get_group_aggregate,
-- list_my_group_aggregates, get_group_by_invite_token, get_invite_preview, save_group and the member-profile
-- functions) and the app-key gate.

drop function public.create_group(uuid, text, uuid, uuid, date, timestamptz);
drop function public.add_expense(uuid, uuid, uuid, uuid, text, integer, date, timestamptz, jsonb);
drop function public.list_period_expenses(uuid, uuid);
drop function public.save_billing_period(uuid, uuid, integer, jsonb);
drop function public.save_billing_period_changes(uuid, uuid, integer, jsonb, jsonb, uuid[]);
drop function public.save_billing_period_with_payments(uuid, uuid, integer, jsonb, jsonb, uuid[], jsonb, uuid[]);
drop function public.create_group_invite(uuid, uuid, text, uuid, timestamptz, timestamptz);
drop function public.get_group_invite(text);
drop function public.redeem_group_invite(text, timestamptz);
drop function public.get_my_group(uuid);
drop function public.list_my_groups();
