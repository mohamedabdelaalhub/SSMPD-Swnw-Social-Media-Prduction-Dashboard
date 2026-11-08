-- Doctor payout, Phase 2 (owner decisions 2026-11-08): payout cap = "payable now", tax + withholding percentages, payout review by the financial manager.
-- ADDITIVE ONLY: one new tiny settings table (payout_settings, fallback flag), no existing table/column change, no existing row touched, no existing ledger posting changed. Nothing here moves money by itself.
--   (a) clinic_finance.invoice_fully_paid(invoice)       : fully paid = patient payments + APPROVED insurer payments - approved refunds >= invoice amount - refunds - approved contractual discounts.
--                                                          Credit (آجل) behaves like insurance: it is "unpaid" until the money is actually collected (no payment row = not paid).
--       clinic_finance.doctor_held_fees(doctor)          : sum of the fee earned on invoices that are NOT fully paid. An unpaid invoice holds ONLY its own fee.
--       clinic_finance.doctor_payable_now(doctor)        : greatest(0, doctor_balance - held fees).
--       public.clinic_finance_doctor_payable(key)        : read-only RPC for the payout form (balance / held / payable now / pending / available + the held invoices of one doctor).
--   (b) payout review is restricted to the FINANCIAL MANAGER (clinic_finance.payout_reviewer_allowed). Maker-checker unchanged (the creator can never review).
--       super_admin / general_manager keep review ONLY as a FALLBACK while there is no active financial manager with the accounting module AND payout_settings.manager_fallback is true (default true; super_admin turns it off with public.clinic_finance_set_payout_fallback(false)); the day one exists, they lose payout review automatically.
--       Contract review and every other review action are NOT changed (clinic_finance.allowed('review') is untouched).
--   (c) payout payload must carry tax_pct and withholding_pct (0..100 each, sum <= 100, max 2 decimals); withheld must equal round(gross*tax_pct/100,2)+round(gross*withholding_pct/100,2); net = gross - withheld.
--       Ledger posting is the existing one (net to cash/bank, withheld to 2141). The split and the percentages are kept in the payout payload and in clinic_finance.audit.
-- The command wrapper sits ON TOP of the current public.clinic_finance_doctor_command (whatever wrapper chain is live, e.g. departments/contract revisions), so it does not patch any existing function text.
-- Order of release: ship the dashboard UI first (it sends the extra keys, an older DB ignores them), then apply this file.
-- Rollback: supabase/rollbacks/20261108260000_doctor_payout_phase2.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_doctor_command(text,jsonb,uuid)') is null
     or to_regprocedure('clinic_finance.doctor_command_before_payout2(text,jsonb,uuid)') is not null then
    raise exception 'clinic_finance_doctor_command غير موجودة أو تم تطبيق هذا الملف من قبل';
  end if;
  if to_regprocedure('clinic_finance.doctor_balance(text)') is null or to_regprocedure('clinic_finance.allowed(text)') is null
     or to_regprocedure('clinic_finance.require_access(text)') is null or to_regprocedure('clinic_finance.lock_day()') is null
     or to_regclass('clinic_finance.doctor_payouts') is null or to_regclass('clinic_finance.doctor_allocations') is null
     or to_regclass('clinic_finance.insurance_actions') is null or to_regclass('clinic_finance.audit') is null then
    raise exception 'مكونات محاسبة الأطباء غير موجودة؛ طبّق ملفات الحسابات أولًا';
  end if;
  if position('financial_manager' in pg_get_functiondef('clinic_finance.allowed(text)'::regprocedure)) = 0 then
    raise exception 'clinic_finance.allowed تغيّرت عن النص المتوقع؛ راجع الفرق قبل التطبيق';
  end if;
end $$;

-- ===== (a) payable now =====
create function clinic_finance.invoice_fully_paid(p_invoice uuid) returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare i clinic_finance.invoices%rowtype; refund numeric; adjustment numeric; revenue numeric; collected numeric;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  if not found then return false; end if;
  if i.voided then return true; end if;   -- a voided invoice earns no fee (doctor_sync sets earned to 0), nothing left to wait for
  select coalesce(sum(amount), 0) into refund from clinic_finance.requests where invoice_id = i.id and kind = 'refund' and status = 'approved';
  select coalesce(sum(x.amount), 0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'contractual' and x.status = 'approved';
  revenue := greatest(0, i.amount - refund - adjustment);
  collected := greatest(0, coalesce((select sum(amount) from clinic_finance.payments where invoice_id = i.id), 0) - refund
    + coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'payment' and x.status = 'approved'), 0));
  return collected >= revenue;
end $$;

create function clinic_finance.doctor_held_fees(p_key text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(a.earned), 0) from clinic_finance.doctor_allocations a
  where a.doctor_key = p_key and a.earned > 0 and not clinic_finance.invoice_fully_paid(a.invoice_id)
$$;

create function clinic_finance.doctor_payable_now(p_key text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select greatest(0, clinic_finance.doctor_balance(p_key) - clinic_finance.doctor_held_fees(p_key))
$$;

-- ===== (b) who may review payouts =====
create function clinic_finance.has_financial_manager() returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare found boolean;
begin
  select exists(select 1 from public.admins a where a.active and a.role = 'financial_manager'
      and exists(select 1 from public.admin_module_permissions p where p.admin_id = a.id and p.module_key = 'accounting' and p.can_view and p.can_update)) into found;
  if not found and to_regclass('public.admin_extra_roles') is not null then
    execute $q$select exists(select 1 from public.admins a join public.admin_extra_roles r on r.admin_id = a.id
      where a.active and r.role = 'financial_manager'
      and exists(select 1 from public.admin_module_permissions p where p.admin_id = a.id and p.module_key = 'accounting' and p.can_view and p.can_update))$q$ into found;
  end if;
  return found;
end $$;

-- Fallback flag (single row). true (default) = super_admin / general_manager may review payouts while NO active financial manager exists; false = payout review is strictly financial-manager only.
create table clinic_finance.payout_settings(id boolean primary key default true check(id), manager_fallback boolean not null default true, updated_by uuid references public.admins(id), updated_at timestamptz not null default now());
insert into clinic_finance.payout_settings(id) values (true);
alter table clinic_finance.payout_settings enable row level security;
revoke all on clinic_finance.payout_settings from public, anon, authenticated;
create function public.clinic_finance_set_payout_fallback(p_enabled boolean) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null or not public.has_role('super_admin') then raise exception 'تغيير هذا الإعداد للسوبر أدمن فقط' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'قيمة غير صالحة'; end if;
  update clinic_finance.payout_settings set manager_fallback = p_enabled, updated_by = me, updated_at = now() where id;
  insert into clinic_finance.audit(actor, action, detail) values (me, 'payout_manager_fallback', jsonb_build_object('enabled', p_enabled));
  return p_enabled;
end $$;

-- 'financial_manager' = the current user holds the financial_manager role and the accounting module (allowed('review') for a non-manager role already needs both).
-- 'fallback_manager' = no financial manager exists yet, so super_admin / general_manager may still review (audited as a fallback).
-- null = not allowed to review payouts.
create function clinic_finance.payout_review_mode() returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if public.my_admin_id() is null or not clinic_finance.allowed('review') then return null; end if;
  if public.has_role('financial_manager') then return 'financial_manager'; end if;
  if (public.has_role('super_admin') or public.has_role('general_manager')) and (select manager_fallback from clinic_finance.payout_settings where id) and not clinic_finance.has_financial_manager() then return 'fallback_manager'; end if;
  return null;
end $$;

-- ===== read-only RPC for the payout form =====
create function public.clinic_finance_doctor_payable(p_key text default null) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare mode text; result jsonb;
begin
  if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode = '42501'; end if;
  mode := clinic_finance.payout_review_mode();
  select jsonb_build_object('can_review_payouts', mode is not null, 'review_mode', mode, 'doctors', coalesce(jsonb_agg(jsonb_build_object(
      'doctor_key', d.doctor_key, 'doctor_name', d.doctor_name, 'balance', d.balance, 'held_fees', d.held, 'payable_now', greatest(0, d.balance - d.held),
      'pending', d.pending, 'available_now', greatest(0, greatest(0, d.balance - d.held) - d.pending)) order by d.doctor_name), '[]'::jsonb)) into result
  from (select k.doctor_key, k.doctor_name, clinic_finance.doctor_balance(k.doctor_key) balance, clinic_finance.doctor_held_fees(k.doctor_key) held,
          coalesce((select sum(gross) from clinic_finance.doctor_payouts q where q.doctor_key = k.doctor_key and q.status = 'pending'), 0) pending
        from (select doctor_key, max(doctor_name) doctor_name from clinic_finance.doctor_contracts where status = 'active' and (p_key is null or doctor_key = p_key) group by doctor_key) k) d;
  if p_key is not null then
    result := result || jsonb_build_object('held_invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', a.invoice_id, 'invoice_reference', i.reference, 'fee', a.earned) order by i.reference)
      from clinic_finance.doctor_allocations a join clinic_finance.invoices i on i.id = a.invoice_id
      where a.doctor_key = p_key and a.earned > 0 and not clinic_finance.invoice_fully_paid(a.invoice_id)), '[]'::jsonb));
  end if;
  return result;
end $$;

-- ===== (a)(b)(c) payout command wrapper =====
alter function public.clinic_finance_doctor_command(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_doctor_command(text, jsonb, uuid) rename to doctor_command_before_payout2;
create function public.clinic_finance_doctor_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; r clinic_finance.doctor_payouts%rowtype; v uuid; mode text;
  gross numeric; tp numeric; wp numeric; tax_amt numeric; wh_amt numeric; pend numeric; pay numeric; bal numeric; held numeric; approve boolean;
begin
  if p_action = 'payout' then
    perform clinic_finance.lock_day();
    me := clinic_finance.require_access('create');
    select * into r from clinic_finance.doctor_payouts where created_by = me and token = p_token;
    if found then return clinic_finance.doctor_command_before_payout2(p_action, p_payload, p_token); end if;   -- idempotent replay: the base compares the payload
    if length(trim(coalesce(p_payload->>'doctor_key', ''))) < 2 then raise exception 'اختر الطبيب'; end if;
    if nullif(p_payload->>'tax_pct', '') is null or nullif(p_payload->>'withholding_pct', '') is null then raise exception 'حدد نسبة الضريبة ونسبة الاستقطاع (اكتب 0 إن لم تنطبق)'; end if;
    gross := (p_payload->>'gross')::numeric; tp := (p_payload->>'tax_pct')::numeric; wp := (p_payload->>'withholding_pct')::numeric;
    if gross is null or gross <= 0 or gross::text in ('NaN', 'Infinity', '-Infinity') or gross <> round(gross, 2) then raise exception 'راجع مبالغ التسوية ومرجع السداد'; end if;
    if tp::text in ('NaN', 'Infinity', '-Infinity') or wp::text in ('NaN', 'Infinity', '-Infinity') or tp < 0 or wp < 0 or tp > 100 or wp > 100 or tp + wp > 100 or tp <> round(tp, 2) or wp <> round(wp, 2) then
      raise exception 'نسبة الضريبة والاستقطاع يجب أن تكون بين 0 و100 ومجموعهما لا يتجاوز 100 بحد أقصى خانتين عشريتين';
    end if;
    tax_amt := round(gross * tp / 100, 2); wh_amt := round(gross * wp / 100, 2);
    if (p_payload->>'withheld')::numeric is distinct from tax_amt + wh_amt then raise exception 'مبلغ الاستقطاع لا يطابق النسب المدخلة (المتوقع %)', tax_amt + wh_amt; end if;
    if nullif(p_payload->>'net', '') is not null and (p_payload->>'net')::numeric is distinct from gross - tax_amt - wh_amt then raise exception 'صافي الصرف لا يطابق المبلغ والنسب'; end if;
    bal := clinic_finance.doctor_balance(p_payload->>'doctor_key'); held := clinic_finance.doctor_held_fees(p_payload->>'doctor_key'); pay := greatest(0, bal - held);
    pend := coalesce((select sum(q.gross) from clinic_finance.doctor_payouts q where q.doctor_key = p_payload->>'doctor_key' and q.status = 'pending'), 0);
    if gross + pend > pay then raise exception 'المبلغ يتجاوز المستحق للصرف الآن (المتاح % — الفواتير غير المسددة كاملة تحجز أتعابها)', greatest(0, pay - pend); end if;
    v := clinic_finance.doctor_command_before_payout2(p_action, p_payload, p_token);
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'doctor_payout_terms', v, jsonb_build_object(
      'doctor_key', p_payload->>'doctor_key', 'gross', gross, 'tax_pct', tp, 'withholding_pct', wp, 'tax_amount', tax_amt, 'withholding_amount', wh_amt,
      'withheld', tax_amt + wh_amt, 'net', gross - tax_amt - wh_amt, 'balance', bal, 'held_fees', held, 'payable_now', pay, 'pending_before', pend));
    return v;
  elsif p_action = 'payout_review' then
    perform clinic_finance.lock_day();
    me := clinic_finance.require_access('review');
    mode := clinic_finance.payout_review_mode();
    if mode is null then raise exception 'مراجعة صرف مستحقات الأطباء للمدير المالي فقط' using errcode = '42501'; end if;
    approve := (p_payload->>'approve')::boolean;
    select * into r from clinic_finance.doctor_payouts where id = (p_payload->>'id')::uuid;
    if found and r.status = 'pending' and r.created_by <> me and approve is true then
      pay := clinic_finance.doctor_payable_now(r.doctor_key);
      if r.gross > pay then raise exception 'المستحق للصرف الآن أقل من مبلغ التسوية (المتاح %)؛ ارفضها أو أعد إنشاءها بعد سداد الفواتير', pay; end if;
    end if;
    v := clinic_finance.doctor_command_before_payout2(p_action, p_payload, p_token);
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'doctor_payout_review_gate', v, jsonb_build_object(
      'review_mode', mode, 'approve', approve, 'gross', r.gross, 'payable_now_at_review', pay));
    return v;
  end if;
  return clinic_finance.doctor_command_before_payout2(p_action, p_payload, p_token);
end $$;

revoke all on function clinic_finance.invoice_fully_paid(uuid), clinic_finance.doctor_held_fees(text), clinic_finance.doctor_payable_now(text), clinic_finance.has_financial_manager(),
  clinic_finance.payout_review_mode(), clinic_finance.doctor_command_before_payout2(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.clinic_finance_set_payout_fallback(boolean), public.clinic_finance_doctor_payable(text), public.clinic_finance_doctor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_set_payout_fallback(boolean), public.clinic_finance_doctor_payable(text), public.clinic_finance_doctor_command(text, jsonb, uuid) to authenticated;

commit;
