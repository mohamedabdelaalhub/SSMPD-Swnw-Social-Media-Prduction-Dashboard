-- 1) Fix #541 «صرف الحساب»: on live the doctor's fee for a reception visit is posted ONLY in the reception journal (source doctor_fee,
--    5111 → 2120, dimensions provider_id + invoice_id; see clinic_reception services 'execute'). clinic_finance.desk_payable/desk_held read
--    only clinic_finance.doctor_accruals (0 rows on live), so the desk showed nothing for reception-collected visits. Now the desk also reads
--    the reception fees per reception invoice: payable once the invoice is fully paid (patient part due = 0 and any insurance claim paid),
--    held until then. Paid lines are recorded in clinic_finance.desk_payout_rx (reception invoices are not clinic_finance.invoices).
-- 2) Owner 2026-11-18: the referral share («نسب الإحالة», clinic_reception.referral_rates, computed per order by clinic_reception_so_attach
--    into order_ext.priced.referral_commission: net after discount × the referring doctor's rate) must reach the referring doctor's account.
--    When such an order is executed (status → completed, which also creates its reception invoice) the commission is posted once:
--    source referral_fee, 5111 → 2120 with the REFERRING doctor's provider_id and the order's invoice_id. It is then held / payable exactly
--    like the doctor's own fees (paid only once the patient has paid that invoice in full) and shows in «صرف الحساب» and the doctor balance.
-- Rollback: supabase/rollbacks/20261119010000_desk_payout_reception_fees_referrals.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.desk_payouts') is null or to_regprocedure('clinic_reception.due(uuid)') is null
     or to_regprocedure('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)') is null then
    raise exception 'مكونات صرف الأطباء أو الاستقبال غير موجودة';
  end if;
  if to_regclass('clinic_finance.desk_payout_rx') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.desk_payout_rx (
  payout_id uuid not null references clinic_finance.doctor_payouts(id),
  rx_invoice_id uuid not null references clinic_reception.invoices(id),
  doctor_key text not null,
  fee numeric(14,2) not null check (fee > 0),
  created_at timestamptz not null default now(),
  primary key (payout_id, rx_invoice_id)
);
create index desk_payout_rx_lookup on clinic_finance.desk_payout_rx(doctor_key, rx_invoice_id);
alter table clinic_finance.desk_payout_rx enable row level security;
revoke all on clinic_finance.desk_payout_rx from public, anon, authenticated;

-- reception fees of a doctor per reception invoice (live workspaces), with the invoice's paid state
create function clinic_finance.desk_rx_fees(p_doctor text)
returns table(invoice_id uuid, reference text, description text, amount numeric, fee numeric, created_at timestamptz, paid boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select i.id, 'RX-' || i.invoice_no, i.description, i.amount, f.fee, i.created_at,
         clinic_reception.due(i.id) <= 0 and not exists (select 1 from clinic_reception.claims c where c.invoice_id = i.id and c.paid + c.contractual < c.amount)
  from (select nullif(j.dimensions->>'invoice_id', '')::uuid inv, sum(l.credit - l.debit) fee
          from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
          join clinic_reception.workspaces w on w.id = j.workspace_id and w.mode = 'live'
          join clinic_reception.providers p on p.id = nullif(j.dimensions->>'provider_id', '')::uuid and p.workspace_id = w.id and p.doctor_key = p_doctor
         where nullif(j.dimensions->>'invoice_id', '') is not null
         group by 1 having sum(l.credit - l.debit) > 0) f
  join clinic_reception.invoices i on i.id = f.inv
$$;
revoke all on function clinic_finance.desk_rx_fees(text) from public, anon, authenticated;

drop function clinic_finance.desk_payable(text);
create function clinic_finance.desk_payable(p_doctor text)
returns table(invoice_id uuid, reference text, description text, amount numeric, fee numeric, created_at timestamptz, src text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select i.id, i.reference, i.description, i.amount, f.fee, i.created_at, 'finance'
  from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
  join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided
  where clinic_finance.invoice_fully_paid(i.id)
    and not exists (select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                    where k.doctor_key = p_doctor and k.invoice_id = i.id and q.status in ('pending','approved'))
  union all
  select r.invoice_id, r.reference, r.description, r.amount,
         r.fee - coalesce((select sum(k.fee) from clinic_finance.desk_payout_rx k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                           where k.doctor_key = p_doctor and k.rx_invoice_id = r.invoice_id and q.status in ('pending','approved')), 0),
         r.created_at, 'reception'
  from clinic_finance.desk_rx_fees(p_doctor) r
  where r.paid
    and r.fee - coalesce((select sum(k.fee) from clinic_finance.desk_payout_rx k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                          where k.doctor_key = p_doctor and k.rx_invoice_id = r.invoice_id and q.status in ('pending','approved')), 0) > 0
$$;
revoke all on function clinic_finance.desk_payable(text) from public, anon, authenticated;

create or replace function clinic_finance.desk_held(p_doctor text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select sum(f.fee) from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
    join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided where not clinic_finance.invoice_fully_paid(i.id)), 0)
  + coalesce((select sum(r.fee) from clinic_finance.desk_rx_fees(p_doctor) r where not r.paid), 0)
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
    'invoices', coalesce((select jsonb_agg(x order by x->>'created_at') from (
        select jsonb_build_object('invoice_id', k.invoice_id, 'reference', i.reference, 'description', i.description, 'amount', i.amount, 'fee', k.fee, 'created_at', i.created_at) x
          from clinic_finance.doctor_payout_invoices k join clinic_finance.invoices i on i.id = k.invoice_id where k.payout_id = q.id
        union all
        select jsonb_build_object('invoice_id', k.rx_invoice_id, 'reference', 'RX-' || i.invoice_no, 'description', i.description, 'amount', i.amount, 'fee', k.fee, 'created_at', i.created_at)
          from clinic_finance.desk_payout_rx k join clinic_reception.invoices i on i.id = k.rx_invoice_id where k.payout_id = q.id) s), '[]'::jsonb))
  from clinic_finance.desk_payouts d where d.payout_id = q.id
$$;

-- the request records finance lines and reception lines in their own tables
do $$
declare def text; patched text;
  old_txt constant text := $s$    insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x;$s$;
  new_txt constant text := $s$    insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x where x.src = 'finance';
    insert into clinic_finance.desk_payout_rx(payout_id, rx_invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x where x.src = 'reception';$s$;
begin
  def := pg_get_functiondef('public.clinic_reception_doctor_payout(text,jsonb,uuid)'::regprocedure);
  if position(old_txt in def) = 0 then raise exception 'Missing patch target in clinic_reception_doctor_payout (md5 %)', md5(def); end if;
  patched := replace(def, old_txt, new_txt); execute patched;
  raise notice 'clinic_reception_doctor_payout patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;

-- referral share → the referring doctor's account, once, when the referred order is executed
create function clinic_reception.post_referral_fee() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare ref text; amt numeric; prov uuid; inv uuid; v record;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  if to_regclass('clinic_reception.order_ext') is null then return new; end if;
  execute 'select nullif(trim(referring_doctor_key), ''''), round(coalesce((priced->>''referral_commission'')::numeric, 0), 2) from clinic_reception.order_ext where order_id = $1'
    into ref, amt using new.id;
  if ref is null or coalesce(amt, 0) <= 0 then return new; end if;
  if exists (select 1 from clinic_reception.journal where workspace_id = new.workspace_id and source = 'referral_fee' and source_id = new.id) then return new; end if;
  select id into prov from clinic_reception.providers where workspace_id = new.workspace_id and doctor_key = ref order by active desc, id limit 1;
  select id into inv from clinic_reception.invoices where order_id = new.id;
  if prov is null or inv is null then return new; end if;
  select patient_id into v from clinic_reception.visits where id = new.visit_id;
  perform clinic_reception.post(new.workspace_id, 'referral_fee', new.id, 'نسبة إحالة طبيب', '5111', '2120', amt,
    jsonb_build_object('patient_id', v.patient_id, 'visit_id', new.visit_id, 'order_id', new.id, 'provider_id', prov, 'invoice_id', inv, 'referral', true));
  return new;
end $$;
revoke all on function clinic_reception.post_referral_fee() from public, anon, authenticated;
create trigger post_referral_fee after update of status on clinic_reception.orders for each row execute function clinic_reception.post_referral_fee();

commit;
