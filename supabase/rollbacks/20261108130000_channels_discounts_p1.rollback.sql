-- Rollback for 20261108130000_channels_discounts_p1.sql.
-- Restores doctor_sync as it was BEFORE this migration (the 20261017010341 body with the returned_deduction patch of 20261017011033 applied) and moves the previous public snapshot back, then drops what the migration added.
-- WARNING: drops channel_rules and channel_allocations. Invoices already booked with a channel keep their amounts, but their doctor accrual stays
-- as it was computed (net of the platform share) and will no longer be re-derived with it on refunds. Export first:
--   select * from clinic_finance.channel_rules; select * from clinic_finance.channel_allocations;
begin;
drop function if exists public.clinic_finance_snapshot(date, date, integer);
do $$ begin
  if to_regprocedure('clinic_finance.channels_snapshot_base(date,date,integer)') is not null then
    alter function clinic_finance.channels_snapshot_base(date, date, integer) rename to clinic_finance_snapshot;
    alter function clinic_finance.clinic_finance_snapshot(date, date, integer) set schema public;
  end if;
end $$;
revoke all on function public.clinic_finance_snapshot(date, date, integer) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer) to authenticated;
drop function if exists public.clinic_finance_channel_command(text, jsonb, uuid);
drop trigger if exists channel_invoice_snapshot on clinic_finance.invoices;
drop function if exists clinic_finance.channel_invoice_snapshot();
create or replace function clinic_finance.doctor_sync(p_invoice uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a clinic_finance.doctor_allocations%rowtype;i clinic_finance.invoices%rowtype;refund numeric;adjustment numeric;revenue numeric;collected numeric;target numeric;delta numeric;event_id uuid;
begin
 select * into a from clinic_finance.doctor_allocations where invoice_id=p_invoice for update;if not found then return;end if;select * into i from clinic_finance.invoices where id=p_invoice;
 select coalesce(sum(amount),0) into refund from clinic_finance.requests where invoice_id=i.id and kind='refund' and status='approved';
 select coalesce(sum(x.amount),0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='contractual' and x.status='approved';
 revenue:=case when i.voided then 0 else greatest(0,i.amount-refund-adjustment) end;
 collected:=greatest(0,coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)-refund+coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='payment' and x.status='approved'),0));
 target:=greatest(0,a.original_base*revenue/i.amount-greatest(0,a.original_deduction-a.returned_deduction))*(a.terms->>'rate')::numeric/100;
 if a.terms->>'basis'='collected' then target:=case when revenue>0 then target*least(1,collected/revenue) else 0 end;end if;
 target:=round(target,2);delta:=target-a.earned;
 if delta<>0 then insert into clinic_finance.doctor_accruals(invoice_id,doctor_key,delta) values(i.id,a.doctor_key,delta) returning id into event_id;
 perform clinic_finance.post('doctor_accrual',event_id,'استحقاق أو تسوية أتعاب '||a.doctor_name||' — '||i.reference,null,case when delta>0 then '5111' else '2120' end,case when delta>0 then '2120' else '5111' end,abs(delta));update clinic_finance.doctor_allocations set earned=target where invoice_id=i.id;end if;
end $$;
drop function if exists clinic_finance.invoice_revenue(uuid);
drop table if exists clinic_finance.channel_allocations;
drop table if exists clinic_finance.channel_rules;
revoke all on all functions in schema clinic_finance from public, anon, authenticated;
commit;
