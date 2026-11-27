-- Close-shift screen follows the blind-count switch (owner 2026-11-26 «احنا في فترة تجريبية نأجل تطبيق العد الأعمى مؤقتا», confirmed
-- for the close-shift screen too). Needs 20261126220000 (clinic_finance.blind_count_settings).
--   Switch OFF (trial, now): the CALLER'S OWN open shifts get the expected drawer cash (clinic_finance.shift_cash = opening + cash in
--     − cash out) and the opening balance, so the cashier sees «المفروض في الدرج» before counting. Both close paths:
--       * reception (Mazen): public.clinic_booking_snapshot → «جرد وتسليم الوردية» (finance-advances.js / booking cash);
--       * finance desk: public.clinic_finance_snapshot → «جرد وإغلاق الوردية» (finance-cash.js).
--   Switch ON: both snapshots are returned exactly as the previous functions return them (blind, unchanged).
-- Two outer wrappers; the previous functions are kept untouched as clinic_finance.snapshot_pre_blind_switch and
-- clinic_finance.booking_snapshot_pre_blind_switch (rule 11: nothing removed).
-- The count check (count-check.js / clinic_finance_count_check) and the close-shift RPC are not changed.
-- Rollback: supabase/rollbacks/20261127020000_close_shift_blind_switch.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.blind_count_settings') is null then raise exception 'طبق 20261126220000 (إعداد العدّ الأعمى) الأول'; end if;
  if to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.clinic_finance_snapshot(date,date,integer)') is null or to_regprocedure('public.clinic_booking_snapshot(date,date)') is null
     or to_regprocedure('clinic_finance.shift_cash(uuid)') is null then
    raise exception 'clinic_finance_snapshot / clinic_booking_snapshot / shift_cash غير موجودة'; end if;
end $$;

alter function public.clinic_finance_snapshot(date, date, integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) rename to snapshot_pre_blind_switch;
revoke all on function clinic_finance.snapshot_pre_blind_switch(date, date, integer) from public, anon, authenticated;
alter function public.clinic_booking_snapshot(date, date) set schema clinic_finance;
alter function clinic_finance.clinic_booking_snapshot(date, date) rename to booking_snapshot_pre_blind_switch;
revoke all on function clinic_finance.booking_snapshot_pre_blind_switch(date, date) from public, anon, authenticated;

-- adds expected + opening_book to the caller's own OPEN shifts that do not carry them yet
create function clinic_finance.blind_reveal(p_shifts jsonb, p_me uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(case
           when s->>'expected' is null and fs.status = 'open' and fs.cashier_id = p_me
           then s || jsonb_build_object('expected', clinic_finance.shift_cash(fs.id), 'opening_book', fs.opening_book, 'blind_off', true)
           else s end order by t.n), '[]'::jsonb)
    from jsonb_array_elements(p_shifts) with ordinality t(s, n)
    left join clinic_finance.shifts fs on fs.id = nullif(t.s->>'id', '')::uuid
$$;
revoke all on function clinic_finance.blind_reveal(jsonb, uuid) from public, anon, authenticated;

create function public.clinic_finance_snapshot(p_from date, p_to date, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.snapshot_pre_blind_switch(p_from, p_to, p_offset); me uuid := public.my_admin_id();
  blind boolean := coalesce((select enabled from clinic_finance.blind_count_settings where id), true);
begin
  if v is null or jsonb_typeof(v) <> 'object' then return v; end if;
  v := v || jsonb_build_object('blind_count', blind);
  if blind or me is null then return v; end if;
  if jsonb_typeof(v->'shifts') = 'array' then v := jsonb_set(v, '{shifts}', clinic_finance.blind_reveal(v->'shifts', me)); end if;
  if jsonb_typeof(v->'active_shifts') = 'array' then v := jsonb_set(v, '{active_shifts}', clinic_finance.blind_reveal(v->'active_shifts', me)); end if;
  return v;
end $$;
revoke all on function public.clinic_finance_snapshot(date, date, integer) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer) to authenticated;

create function public.clinic_booking_snapshot(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.booking_snapshot_pre_blind_switch(p_from, p_to); me uuid := public.my_admin_id();
  blind boolean := coalesce((select enabled from clinic_finance.blind_count_settings where id), true);
begin
  if v is null or jsonb_typeof(v) <> 'object' then return v; end if;
  v := v || jsonb_build_object('blind_count', blind);
  if blind or me is null then return v; end if;
  if jsonb_typeof(v->'shifts') = 'array' then v := jsonb_set(v, '{shifts}', clinic_finance.blind_reveal(v->'shifts', me)); end if;
  return v;
end $$;
revoke all on function public.clinic_booking_snapshot(date, date) from public, anon;
grant execute on function public.clinic_booking_snapshot(date, date) to authenticated;

commit;
