-- Owner 2026-11-18: «صرف حساب الدكتور من كاش التحصيل بعد الاعتماد».
-- Reception collection registers (treasury_kind collection, operation_mode 'receive') stay «استلام فقط» for every payout EXCEPT one:
-- a reception doctor-payout request (clinic_finance.desk_payouts, built by 20261117230000) that is being approved right now by an
-- approver who is not its requester. That cash really leaves the reception drawer to the doctor, so it is booked exactly as it happens
-- (2120 → 1111 on the requester's shift): the drawer's expected cash drops by the same amount, the handover to the main treasury is lower
-- by the same amount, and the shift shows the payout with its approver and receipt. No paper transfer, no false shortage.
-- Everything else is unchanged: petty cash / expenses / refunds / accounting doctor payouts from a receive-only register are still refused,
-- the proven-cash limit (clinic_finance.cash_limit) still applies, the amount is still the dashboard's own, maker-checker is still enforced.
-- In-place anchor patch of clinic_finance.post (one line). Rollback: supabase/rollbacks/20261118030000_desk_payout_from_collection.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.desk_payouts') is null or to_regprocedure('clinic_finance.desk_approver()') is null then
    raise exception 'صرف حساب الطبيب من الاستقبال (20261117230000) غير مطبق';
  end if;
  if to_regprocedure('clinic_finance.desk_payout_from_collection(uuid,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- True only inside the desk approval of a pending reception payout, for that payout's own shift, by an approver who is not the requester.
create function clinic_finance.desk_payout_from_collection(p_payout uuid, p_shift uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select p_payout is not null and p_shift is not null and clinic_finance.desk_approver() and exists (
    select 1 from clinic_finance.desk_payouts d join clinic_finance.doctor_payouts q on q.id = d.payout_id
    where q.id = p_payout and q.shift_id = p_shift and q.status = 'pending' and q.created_by is distinct from public.my_admin_id())
$$;
revoke all on function clinic_finance.desk_payout_from_collection(uuid, uuid) from public, anon, authenticated;

do $$
declare def text; patched text;
  old_line constant text := $s$if p_credit='1111' and p_source<>'deposit' then perform clinic_finance.register_direction(p_shift,'pay');end if;$s$;
  new_line constant text := $s$if p_credit='1111' and p_source<>'deposit' and not (p_source='doctor_payment' and clinic_finance.desk_payout_from_collection(p_source_id,p_shift)) then perform clinic_finance.register_direction(p_shift,'pay');end if;$s$;
begin
  def := pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure);
  if position(old_line in def) = 0 then raise exception 'Missing patch target in clinic_finance.post (md5 %)', md5(def); end if;
  patched := replace(def, old_line, new_line);
  execute patched;
  raise notice 'clinic_finance.post patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;

commit;
