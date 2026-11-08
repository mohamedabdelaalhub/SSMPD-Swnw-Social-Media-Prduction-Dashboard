-- Rollback of 20261109111000_referral_commission_posting.sql. Refuses while commissions were posted (reverse their journal entries first).
begin;
do $$ begin
  if exists (select 1 from clinic_reception.referral_postings where state = 'posted') then raise exception 'يوجد عمولات تحويل مرحّلة؛ اعكس قيودها أولًا'; end if;
end $$;
drop function public.clinic_reception_so_set_status(uuid, uuid, text);
alter function clinic_reception.so_set_status_before_referral(uuid, uuid, text) rename to clinic_reception_so_set_status;
alter function clinic_reception.clinic_reception_so_set_status(uuid, uuid, text) set schema public;
drop function clinic_reception.referral_post(uuid, uuid);
drop table clinic_reception.referral_postings;
commit;
