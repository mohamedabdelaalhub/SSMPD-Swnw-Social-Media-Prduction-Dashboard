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
-- Review fixes (main chat, 2026-11-18):
--   * the referral follows the cash: a credit note (invoices.credit_amount) or an insurer contractual cut (claims.contractual) reverses the
--     same share of the referral (referral_reversal 2120 → 5111), like doctor_credit_note / doctor_contractual do for the executing doctor;
--   * no silent loss: anything that prevents posting is kept in clinic_reception.referral_issues and retried when the doctor's provider row
--     appears; a failure never blocks completing the order (logged instead of raised);
--   * self-referral (referring doctor = performing / executing doctor) earns nothing;
--   * a referral posting nets an existing doctor debt (1194) like doctor_fee does;
--   * the desk never offers more than the doctor's balance: fees already paid through the accounting payout screen consume the newest
--     reception lines first; the approver's amount cap counts reception lines too.
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
  join clinic_reception.invoices i on i.id = f.inv and i.finance_invoice_id is null
$$;
revoke all on function clinic_finance.desk_rx_fees(text) from public, anon, authenticated;

drop function clinic_finance.desk_payable(text);
create function clinic_finance.desk_payable(p_doctor text)
returns table(invoice_id uuid, reference text, description text, amount numeric, fee numeric, created_at timestamptz, src text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with fin as (
    select i.id, i.reference, i.description, i.amount, f.fee, i.created_at
    from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
    join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided
    where clinic_finance.invoice_fully_paid(i.id)
      and not exists (select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                      where k.doctor_key = p_doctor and k.invoice_id = i.id and q.status in ('pending','approved'))),
  rx as (
    select r.invoice_id, r.reference, r.description, r.amount, r.created_at,
           r.fee - coalesce((select sum(k.fee) from clinic_finance.desk_payout_rx k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                             where k.doctor_key = p_doctor and k.rx_invoice_id = r.invoice_id and q.status in ('pending','approved')), 0) fee
    from clinic_finance.desk_rx_fees(p_doctor) r where r.paid),
  -- fees already paid through the accounting payout screen consume the newest reception lines first
  cap as (select greatest(0, clinic_finance.doctor_balance(p_doctor) - clinic_finance.desk_held(p_doctor) - coalesce((select sum(fee) from fin), 0)) c),
  rxo as (select rx.*, sum(rx.fee) over (order by rx.created_at desc, rx.invoice_id) cum from rx where rx.fee > 0)
  select id, reference, description, amount, fee, created_at, 'finance' from fin
  union all
  select rxo.invoice_id, rxo.reference, rxo.description, rxo.amount, least(rxo.fee, cap.c - (rxo.cum - rxo.fee)), rxo.created_at, 'reception'
  from rxo, cap where cap.c - (rxo.cum - rxo.fee) > 0
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

-- the approver's amount cap includes the reception lines of the payout
do $$
declare def text; patched text;
  old_txt constant text := $s$      select coalesce(sum(k.fee), 0) into payable from clinic_finance.doctor_payout_invoices k where k.payout_id = q.id;$s$;
  new_txt constant text := $s$      select coalesce(sum(k.fee), 0) + coalesce((select sum(r.fee) from clinic_finance.desk_payout_rx r where r.payout_id = q.id), 0) into payable from clinic_finance.doctor_payout_invoices k where k.payout_id = q.id;$s$;
begin
  def := pg_get_functiondef('public.clinic_reception_doctor_payout(text,jsonb,uuid)'::regprocedure);
  if position(old_txt in def) = 0 then raise exception 'Missing approve cap target in clinic_reception_doctor_payout (md5 %)', md5(def); end if;
  patched := replace(def, old_txt, new_txt); execute patched;
  raise notice 'approve cap patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;

-- a referral posting nets an existing doctor debt (1194) exactly like doctor_fee
do $$
declare def text; patched text;
  old_txt constant text := $s$elsif p_credit='2120' and p_source='doctor_fee' then$s$;
  new_txt constant text := $s$elsif p_credit='2120' and p_source in ('doctor_fee','referral_fee') then$s$;
begin
  def := pg_get_functiondef('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)'::regprocedure);
  if position(old_txt in def) = 0 then raise exception 'Missing offset target in clinic_reception.post (md5 %)', md5(def); end if;
  patched := replace(def, old_txt, new_txt); execute patched;
  raise notice 'clinic_reception.post patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;

-- referral share → the referring doctor's account, once, when the referred order is executed
create table clinic_reception.referral_issues (
  order_id uuid primary key references clinic_reception.orders(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  reason text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table clinic_reception.referral_issues enable row level security;
revoke all on clinic_reception.referral_issues from public, anon, authenticated;

-- keeps the referral equal to its share of what the patient / insurer really owes (credit notes and contractual cuts reverse it)
create function clinic_reception.sync_referral(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare i clinic_reception.invoices%rowtype; r0 numeric; cur numeric; target numeric; cut numeric; dims jsonb;
begin
  select * into i from clinic_reception.invoices where id = p_invoice;
  if not found or i.order_id is null or i.amount <= 0 then return; end if;
  select coalesce(sum(l.credit), 0), (array_agg(j.dimensions))[1] into r0, dims from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
   where j.workspace_id = i.workspace_id and j.source = 'referral_fee' and j.source_id = i.order_id;
  if r0 <= 0 then return; end if;
  select coalesce(sum(l.credit - l.debit), 0) into cur from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
   where j.workspace_id = i.workspace_id and j.source in ('referral_fee', 'referral_reversal', 'referral_restore') and j.source_id = i.order_id;
  cut := i.credit_amount + coalesce((select c.contractual from clinic_reception.claims c where c.invoice_id = i.id), 0);
  target := round(r0 * greatest(0, 1 - cut / i.amount), 2);
  if cur > target then
    perform clinic_reception.post(i.workspace_id, 'referral_reversal', i.order_id, 'رد نسبة إحالة (إشعار دائن / خصم تعاقدي)', '2120', '5111', cur - target, dims);
  elsif cur < target then
    perform clinic_reception.post(i.workspace_id, 'referral_restore', i.order_id, 'إعادة نسبة إحالة بعد تعديل الإشعار', '5111', '2120', target - cur, dims);
  end if;
end $$;
revoke all on function clinic_reception.sync_referral(uuid) from public, anon, authenticated;

-- posts the referral of one completed order (idempotent); never raises: problems are kept in referral_issues
create function clinic_reception.referral_try(p_order uuid) returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; ref text; perf text; amt numeric; prov uuid; inv uuid; pat uuid; why text;
begin
  select * into o from clinic_reception.orders where id = p_order;
  if not found or o.status <> 'completed' or to_regclass('clinic_reception.order_ext') is null then return 'skip'; end if;
  begin
    execute 'select nullif(trim(referring_doctor_key), ''''), nullif(trim(performing_doctor_key), ''''), round(coalesce((priced->>''referral_commission'')::numeric, 0), 2) from clinic_reception.order_ext where order_id = $1'
      into ref, perf, amt using p_order;
    if ref is null or coalesce(amt, 0) <= 0 then return 'none'; end if;
    if ref = perf or ref = (select doctor_key from clinic_reception.providers where id = o.provider_id) then return 'self'; end if;
    if exists (select 1 from clinic_reception.journal where workspace_id = o.workspace_id and source = 'referral_fee' and source_id = o.id) then
      update clinic_reception.referral_issues set resolved_at = coalesce(resolved_at, now()) where order_id = o.id; return 'done';
    end if;
    select id into prov from clinic_reception.providers where workspace_id = o.workspace_id and doctor_key = ref order by active desc, id limit 1;
    select id into inv from clinic_reception.invoices where order_id = o.id;
    why := case when prov is null then 'missing_provider' when inv is null then 'missing_invoice' end;
    if why is not null then
      insert into clinic_reception.referral_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, why, ref)
        on conflict (order_id) do update set reason = excluded.reason, detail = excluded.detail, resolved_at = null;
      return why;
    end if;
    select patient_id into pat from clinic_reception.visits where id = o.visit_id;
    perform clinic_reception.post(o.workspace_id, 'referral_fee', o.id, 'نسبة إحالة طبيب', '5111', '2120', amt,
      jsonb_build_object('patient_id', pat, 'visit_id', o.visit_id, 'order_id', o.id, 'provider_id', prov, 'invoice_id', inv, 'referral', true));
    perform clinic_reception.sync_referral(inv);
    update clinic_reception.referral_issues set resolved_at = now() where order_id = o.id;
    return 'posted';
  exception when others then
    insert into clinic_reception.referral_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, 'error', left(sqlerrm, 500))
      on conflict (order_id) do update set reason = 'error', detail = excluded.detail, resolved_at = null;
    return 'error';
  end;
end $$;
revoke all on function clinic_reception.referral_try(uuid) from public, anon, authenticated;

create function clinic_reception.post_referral_fee() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then perform clinic_reception.referral_try(new.id); end if;
  return new;
end $$;
revoke all on function clinic_reception.post_referral_fee() from public, anon, authenticated;
create trigger post_referral_fee after update of status on clinic_reception.orders for each row execute function clinic_reception.post_referral_fee();

-- retry waiting referrals when the referring doctor's provider row appears / gets its doctor_key
create function clinic_reception.referral_retry_provider() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare x record;
begin
  if new.doctor_key is null or to_regclass('clinic_reception.order_ext') is null then return new; end if;
  for x in execute 'select q.order_id from clinic_reception.referral_issues q join clinic_reception.order_ext e on e.order_id = q.order_id
                     where q.resolved_at is null and q.workspace_id = $1 and e.referring_doctor_key = $2' using new.workspace_id, new.doctor_key loop
    perform clinic_reception.referral_try(x.order_id);
  end loop;
  return new;
end $$;
revoke all on function clinic_reception.referral_retry_provider() from public, anon, authenticated;
create trigger referral_retry_provider after insert or update of doctor_key on clinic_reception.providers for each row execute function clinic_reception.referral_retry_provider();

-- credit notes / contractual cuts keep the referral proportional (never blocks the underlying operation)
create function clinic_reception.referral_follow_cut() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare inv uuid := case when tg_table_name = 'claims' then (to_jsonb(new)->>'invoice_id')::uuid else (to_jsonb(new)->>'id')::uuid end; ord uuid; ws uuid;
begin
  begin
    perform clinic_reception.sync_referral(inv);
  exception when others then
    select order_id, workspace_id into ord, ws from clinic_reception.invoices where id = inv;
    if ord is not null then
      insert into clinic_reception.referral_issues(order_id, workspace_id, reason, detail) values (ord, ws, 'sync_error', left(sqlerrm, 500))
        on conflict (order_id) do update set reason = 'sync_error', detail = excluded.detail, resolved_at = null;
    end if;
  end;
  return new;
end $$;
revoke all on function clinic_reception.referral_follow_cut() from public, anon, authenticated;
create trigger referral_follow_credit after update of credit_amount on clinic_reception.invoices for each row
  when (new.credit_amount is distinct from old.credit_amount) execute function clinic_reception.referral_follow_cut();
create trigger referral_follow_contractual after insert or update of contractual on clinic_reception.claims for each row execute function clinic_reception.referral_follow_cut();

commit;
