-- Rollback of 20261127290000_legacy_package_remaining.sql: puts the three functions back exactly as they were (saved definitions),
-- drops the helper. Refused if a request already used «المدفوع قبل كده» (its approval / invoice must stay explainable).
begin;
do $$ declare r record; begin
  if exists (select 1 from clinic_reception.legacy_package_requests where paid_before is not null) then
    raise exception 'مينفعش الرجوع: فيه طلبات اتسجلت بالمدفوع قبل كده والباقي'; end if;
  for r in select def from clinic_reception.legacy_saved_defs loop execute r.def; end loop;
end $$;
drop function if exists clinic_reception.legacy_remaining_invoice(uuid, uuid);
alter table clinic_reception.legacy_package_requests drop constraint if exists legacy_paid_before_range;
alter table clinic_reception.legacy_package_requests drop column if exists paid_before;
drop table if exists clinic_reception.legacy_saved_defs;
commit;
