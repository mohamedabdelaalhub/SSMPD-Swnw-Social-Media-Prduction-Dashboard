-- Rollback of 20261119010000 (refuses if reception lines were already paid out; posted referral_fee entries stay in the journal).
begin;
do $$ begin if exists (select 1 from clinic_finance.desk_payout_rx) then raise exception 'فيه صرف اتسجل على فواتير الاستقبال؛ مينفعش الرجوع'; end if; end $$;
drop trigger if exists post_referral_fee on clinic_reception.orders;
drop trigger if exists referral_retry_provider on clinic_reception.providers;
drop trigger if exists referral_follow_credit on clinic_reception.invoices;
drop trigger if exists referral_follow_contractual on clinic_reception.claims;
drop function if exists clinic_reception.post_referral_fee();
drop function if exists clinic_reception.referral_retry_provider();
drop function if exists clinic_reception.referral_follow_cut();
drop function if exists clinic_reception.referral_try(uuid);
drop function if exists clinic_reception.sync_referral(uuid);
alter table clinic_reception.referral_issues rename to referral_issues_rolled_back;
do $$
declare def text;
begin
  def := pg_get_functiondef('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)'::regprocedure);
  execute replace(def, $s$elsif p_credit='2120' and p_source in ('doctor_fee','referral_fee') then$s$, $s$elsif p_credit='2120' and p_source='doctor_fee' then$s$);
  def := pg_get_functiondef('public.clinic_reception_doctor_payout(text,jsonb,uuid)'::regprocedure);
  execute replace(def, $s$      select coalesce(sum(k.fee), 0) + coalesce((select sum(r.fee) from clinic_finance.desk_payout_rx r where r.payout_id = q.id), 0) into payable from clinic_finance.doctor_payout_invoices k where k.payout_id = q.id;$s$, $s$      select coalesce(sum(k.fee), 0) into payable from clinic_finance.doctor_payout_invoices k where k.payout_id = q.id;$s$);
end $$;
do $$
declare def text;
  new_txt constant text := $s$    insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x where x.src = 'finance';
    insert into clinic_finance.desk_payout_rx(payout_id, rx_invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x where x.src = 'reception';$s$;
  old_txt constant text := $s$    insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x;$s$;
begin
  def := pg_get_functiondef('public.clinic_reception_doctor_payout(text,jsonb,uuid)'::regprocedure);
  if position(new_txt in def) = 0 then raise exception 'clinic_reception_doctor_payout is not patched'; end if;
  execute replace(def, new_txt, old_txt);
end $$;
drop function clinic_finance.desk_payable(text);
create function clinic_finance.desk_payable(p_doctor text) returns table(invoice_id uuid, reference text, description text, amount numeric, fee numeric, created_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select i.id, i.reference, i.description, i.amount, f.fee, i.created_at
  from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
  join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided
  where clinic_finance.invoice_fully_paid(i.id)
    and not exists (select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                    where k.doctor_key = p_doctor and k.invoice_id = i.id and q.status in ('pending','approved'))
$$;
revoke all on function clinic_finance.desk_payable(text) from public, anon, authenticated;
create or replace function clinic_finance.desk_held(p_doctor text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(f.fee), 0) from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
  join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided where not clinic_finance.invoice_fully_paid(i.id)
$$;
create or replace function clinic_finance.desk_payout_json(q clinic_finance.doctor_payouts) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', q.id, 'status', q.status, 'gross', q.gross, 'net', q.gross - q.withheld, 'doctor_key', q.doctor_key, 'reference', q.reference,
    'created_at', q.created_at, 'reviewed_at', q.reviewed_at, 'review_note', q.review_note,
    'requested_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = q.created_by),
    'reviewed_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = q.reviewed_by),
    'doctor_name', (select p.name from clinic_reception.providers p where p.id = d.provider_id),
    'provider_id', d.provider_id, 'workspace_id', d.workspace_id, 'computed_gross', d.computed_gross, 'adjust_note', d.adjust_note,
    'handed_at', d.handed_at, 'handed_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = d.handed_by),
    'receipt_path', d.receipt_path, 'receipt_at', d.receipt_at,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', k.invoice_id, 'reference', i.reference, 'description', i.description, 'amount', i.amount, 'fee', k.fee, 'created_at', i.created_at) order by i.created_at)
                 from clinic_finance.doctor_payout_invoices k join clinic_finance.invoices i on i.id = k.invoice_id where k.payout_id = q.id), '[]'::jsonb))
  from clinic_finance.desk_payouts d where d.payout_id = q.id
$$;
drop function clinic_finance.desk_rx_fees(text);
drop table clinic_finance.desk_payout_rx;
commit;
