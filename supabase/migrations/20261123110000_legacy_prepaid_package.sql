-- «باكج مدفوع قبل السيستم» (owner 2026-11-23 via main chat 4: a real, permanent fix — a patient paid a package before the dashboard
-- went live, e.g. 1,000 for 3 laser sessions + 385 for 3 more, paid 15/11, outside the system; her sessions must not be charged again).
--   * 'legacy_package_request' (reception, capability book): patient, name, paid_on (before today), total, lines [{service_id, sessions,
--     amount}], receipt reference. Lines must add up to the total. Pending — nothing posted, no package yet.
--   * public.clinic_reception_legacy_package_review(id, approve, note): super admin / financial manager only, never the requester.
--     Approve → a real package (an inactive one-off template «باكج قديم»), entitlements one per session (value = line / sessions, the
--     last session absorbs the rounding), funded = total, and ONE entry on the approval day:
--     Dr 3198 «مقبوضات قبل تشغيل الداشبورد تحت التسوية» / Cr 2151 — «مبلغ مقدم للباكج — مدفوع قبل التشغيل بتاريخ …».
--     No shift, no cash account (1111), no cash case, opening balances (3199) untouched. Finance clears 3198 later against where the cash went.
--   * 'order_use_package' {order_id, entitlement_id} (reception): a service of the SAME patient and the SAME service uses a session —
--     «ordered»: the order takes the entitlement (price = session value); already executed but unpaid: the package pays the invoice
--     (Dr 2151 / Cr 1122), the price difference is credited (Dr 4192 / Cr 1122) and the doctor fee reduced in proportion.
--   * public.clinic_reception_legacy_packages(ws, patient): read-only — pending requests (approvers / the requester) and the patient's
--     entitlements left.
-- Outer wrapper on public.clinic_reception_command (previous body kept as clinic_reception.command_before_legacy_package).
-- Rollback: supabase/rollbacks/20261123110000_legacy_prepaid_package.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.entitlements') is null or to_regclass('clinic_finance.accounts') is null then
    raise exception 'الباكجات والحسابات غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_legacy_package(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

insert into clinic_finance.accounts(code, name, kind) values ('3198', 'مقبوضات قبل تشغيل الداشبورد تحت التسوية', 'equity') on conflict (code) do nothing;

create table clinic_reception.legacy_package_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id),
  name text not null check (length(btrim(name)) between 3 and 120),
  paid_on date not null,
  total numeric(14,2) not null check (total > 0),
  lines jsonb not null,
  receipt_ref text not null default '' check (length(receipt_ref) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  review_note text,
  package_id uuid references clinic_reception.packages(id),
  check (status = 'pending' or reviewed_by is not null),
  check (reviewed_by is null or reviewed_by <> created_by)
);
alter table clinic_reception.legacy_package_requests enable row level security;
revoke all on clinic_reception.legacy_package_requests from public, anon, authenticated;
alter table clinic_reception.packages add column legacy_paid_on date;

-- validate + normalise the lines: [{service_id, sessions 1..50, amount > 0}], sum = total, services of this workspace (not packages)
create function clinic_reception.legacy_lines(p_workspace uuid, p jsonb, p_total numeric) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare x jsonb; out jsonb := '[]'::jsonb; s record; n int; amt numeric; tot numeric := 0;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 10 then raise exception 'اختار خدمة واحدة على الأقل'; end if;
  for x in select * from jsonb_array_elements(p) loop
    select sv.id, sv.name, sv.code into s from clinic_reception.services sv
     where sv.workspace_id = p_workspace and sv.id = nullif(x->>'service_id', '')::uuid;
    if s.id is null then raise exception 'الخدمة مش موجودة'; end if;
    begin n := (x->>'sessions')::int; amt := round((x->>'amount')::numeric, 2); exception when others then n := null; end;
    if n is null or n < 1 or n > 50 then raise exception 'عدد الجلسات من 1 لـ 50'; end if;
    if amt is null or amt <= 0 then raise exception 'اكتب مبلغ كل خدمة'; end if;
    tot := tot + amt;
    out := out || jsonb_build_object('service_id', s.id, 'name', s.name, 'code', s.code, 'sessions', n, 'amount', amt,
                                     'per_session', round(amt / n, 2));
  end loop;
  if tot <> p_total then raise exception 'مجموع الخدمات (%) لازم يساوي المدفوع (%)', tot, p_total; end if;
  return out;
end $$;
revoke all on function clinic_reception.legacy_lines(uuid, jsonb, numeric) from public, anon, authenticated;

create function clinic_reception.legacy_package_request(p_workspace uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare pat uuid; d date; tot numeric; ls jsonb; v uuid; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select id into pat from clinic_reception.patients where workspace_id = p_workspace and id = nullif(p->>'patient_id', '')::uuid;
  if pat is null then raise exception 'اختار المريض'; end if;
  begin d := (p->>'paid_on')::date; exception when others then d := null; end;
  if d is null or d >= today or d < today - 730 then raise exception 'اكتب تاريخ الدفع القديم (قبل النهارده)'; end if;
  begin tot := round((p->>'total')::numeric, 2); exception when others then tot := null; end;
  if tot is null or tot <= 0 then raise exception 'اكتب المبلغ اللي اتدفع'; end if;
  if length(btrim(coalesce(p->>'name', ''))) < 3 then raise exception 'اكتب اسم الباكج'; end if;
  ls := clinic_reception.legacy_lines(p_workspace, p->'lines', tot);
  if exists (select 1 from clinic_reception.legacy_package_requests r where r.patient_id = pat and r.status = 'pending' and r.paid_on = d and r.total = tot) then
    raise exception 'الطلب ده متسجّل ومستني الاعتماد'; end if;
  insert into clinic_reception.legacy_package_requests(workspace_id, patient_id, name, paid_on, total, lines, receipt_ref, created_by)
    values (p_workspace, pat, left(btrim(p->>'name'), 120), d, tot, ls, left(btrim(coalesce(p->>'receipt_ref', '')), 200), p_me) returning id into v;
  return jsonb_build_object('id', v, 'status', 'pending', 'lines', ls);
end $$;
revoke all on function clinic_reception.legacy_package_request(uuid, jsonb, uuid) from public, anon, authenticated;

-- approvers: super admin / financial manager, never the requester
create function public.clinic_reception_legacy_package_review(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); r clinic_reception.legacy_package_requests%rowtype; tp uuid; pkg uuid; x jsonb; i int; acc numeric;
  val numeric; je uuid; fe uuid; descr text; dims jsonb; visits int;
begin
  if me is null or not (public.has_role('super_admin') or public.has_role('financial_manager')) then
    raise exception 'اعتماد الباكج القديم للسوبر أدمن أو المدير المالي بس' using errcode = '42501'; end if;
  select * into r from clinic_reception.legacy_package_requests where id = p_id for update;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if r.status <> 'pending' then raise exception 'الطلب ده اتراجع قبل كده'; end if;
  if r.created_by = me then raise exception 'اللي سجّل الطلب مايقدرش يعتمده — محتاج حد تاني'; end if;
  if not p_approve then
    if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
    update clinic_reception.legacy_package_requests set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = left(btrim(p_note), 500) where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'rejected');
  end if;
  perform clinic_finance.lock_day();
  select max((l->>'sessions')::int) into visits from jsonb_array_elements(r.lines) l;
  descr := 'مبلغ مقدم للباكج — مدفوع قبل التشغيل بتاريخ ' || to_char(r.paid_on, 'DD/MM/YYYY');
  insert into clinic_reception.package_templates(workspace_id, code, name, version, price, visits, validity_days, terms, active)
    values (r.workspace_id, 'LEGACY-' || left(r.id::text, 8), r.name, 1, r.total, visits, 730, descr || coalesce(' — ' || nullif(r.receipt_ref, ''), ''), false)
    returning id into tp;
  insert into clinic_reception.packages(workspace_id, patient_id, template_id, name, contract_price, visits, expires_on, terms, created_by, legacy_paid_on)
    values (r.workspace_id, r.patient_id, tp, r.name, r.total, visits, r.paid_on + 730, descr, me, r.paid_on) returning id into pkg;
  for x in select * from jsonb_array_elements(r.lines) loop
    acc := 0;
    for i in 1 .. (x->>'sessions')::int loop
      val := case when i = (x->>'sessions')::int then (x->>'amount')::numeric - acc else (x->>'per_session')::numeric end;
      acc := acc + val;
      insert into clinic_reception.entitlements(package_id, visit_no, service_id, quantity, allocated_value, snapshot)
        select pkg, i, s.id, 1, val, to_jsonb(s) from clinic_reception.services s where s.id = (x->>'service_id')::uuid;
    end loop;
  end loop;
  -- the receipt: Dr 3198 / Cr 2151 on the approval day, no shift (the same journal + finance mirror as clinic_reception.post)
  dims := jsonb_build_object('patient_id', r.patient_id, 'package_id', pkg, 'legacy_request_id', r.id, 'paid_on', r.paid_on, 'receipt_ref', r.receipt_ref);
  insert into clinic_reception.journal(workspace_id, source, source_id, description, dimensions, actor_id)
    values (r.workspace_id, 'legacy_package', pkg, descr, dims, me) returning id into je;
  insert into clinic_reception.journal_lines values (je, '3198', r.total, 0), (je, '2151', 0, r.total);
  if exists (select 1 from clinic_reception.workspaces w where w.id = r.workspace_id and w.mode = 'live') then
    insert into clinic_finance.entries(source, source_id, description, shift_id, created_by) values ('reception_legacy_package', je, descr, null, me) returning id into fe;
    insert into clinic_finance.lines(entry_id, account, debit, credit) values (fe, '3198', r.total, 0), (fe, clinic_reception.account('2151'), 0, r.total);
    update clinic_reception.journal set finance_entry_id = fe where id = je;
  end if;
  update clinic_reception.packages set funded = r.total where id = pkg;
  update clinic_reception.legacy_package_requests set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), package_id = pkg where id = r.id;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (r.workspace_id, me, 'legacy_package_approve', r.id, jsonb_build_object('package_id', pkg, 'total', r.total, 'paid_on', r.paid_on));
  return jsonb_build_object('id', r.id, 'status', 'approved', 'package_id', pkg, 'journal_id', je, 'finance_entry_id', fe);
end $$;
revoke all on function public.clinic_reception_legacy_package_review(uuid, boolean, text) from public, anon;
grant execute on function public.clinic_reception_legacy_package_review(uuid, boolean, text) to authenticated;

-- switch a service of the same patient / service to a package session:
--   * «ordered» (not executed yet): the order takes the entitlement (price = session value); execution recognizes it from 2151.
--   * already executed but NOT paid (owner case: completed 500, nothing collected): the package pays the invoice now —
--     Dr 2151 / Cr 1122 for the session value (allocation 'package'), the rest of the invoice (price − session value) is a credit
--     (Dr 4192 / Cr 1122, invoices.credit_amount) and the doctor fee is reduced in the same proportion (Dr 2120 / Cr 5111).
create function clinic_reception.order_use_package(p_workspace uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o record; en clinic_reception.entitlements%rowtype; pkg clinic_reception.packages%rowtype; val numeric; i record; due numeric; covered numeric;
  diff numeric := 0; fee numeric; dims jsonb; done boolean;
begin
  select ord.*, v.patient_id as visit_patient into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
   where ord.id = nullif(p->>'order_id', '')::uuid and ord.workspace_id = p_workspace for update of ord;
  if not found then raise exception 'الخدمة مش موجودة'; end if;
  if o.status not in ('ordered', 'completed') then raise exception 'الخدمة دي اتلغت'; end if;
  done := o.status = 'completed';
  if o.entitlement_id is not null then raise exception 'الخدمة دي متخصومة من باكج بالفعل'; end if;
  if not done and (o.discount > 0 or exists (select 1 from clinic_reception.discount_requests dr where dr.order_id = o.id and dr.status in ('pending', 'approved'))) then
    raise exception 'الخدمة دي عليها خصم — شيله الأول'; end if;
  if to_regclass('clinic_reception.order_quotes') is not null then
    execute 'select exists (select 1 from clinic_reception.order_quotes q where q.order_id = $1)' into done using o.id;
    if done then raise exception 'الخدمة دي على تأمين / تعاقد'; end if;
    done := o.status = 'completed';
  end if;
  select * into en from clinic_reception.entitlements where id = nullif(p->>'entitlement_id', '')::uuid for update;
  select * into pkg from clinic_reception.packages where id = en.package_id and workspace_id = p_workspace for update;
  if en.id is null or pkg.id is null then raise exception 'جلسة الباكج مش موجودة'; end if;
  if pkg.patient_id <> o.visit_patient then raise exception 'الباكج ده لمريض تاني'; end if;
  if pkg.status <> 'active' or pkg.expires_on < (now() at time zone 'Africa/Cairo')::date then raise exception 'الباكج مش ساري'; end if;
  if en.service_id <> o.service_id then raise exception 'الجلسة دي لخدمة تانية'; end if;
  if en.used + o.quantity > en.quantity or exists (select 1 from clinic_reception.orders x where x.entitlement_id = en.id and x.status <> 'cancelled') then
    raise exception 'الجلسة دي اتستخدمت — اختار جلسة تانية'; end if;
  val := round(en.allocated_value * o.quantity / en.quantity, 2);
  if not done then
    update clinic_reception.orders set entitlement_id = en.id, price = val, discount = 0 where id = o.id;
    return jsonb_build_object('order_id', o.id, 'entitlement_id', en.id, 'value', val, 'patient_pays', 0, 'executed', false,
      'left', (select count(*) from clinic_reception.entitlements e where e.package_id = pkg.id and e.service_id = en.service_id and e.used < e.quantity
                 and not exists (select 1 from clinic_reception.orders x where x.entitlement_id = e.id and x.status <> 'cancelled')));
  end if;
  -- executed: the invoice must be unpaid (nothing collected, no insurer share)
  select * into i from clinic_reception.invoices where order_id = o.id and kind = 'service' for update;
  if i.id is null then raise exception 'فاتورة الخدمة مش موجودة'; end if;
  due := clinic_reception.due(i.id);
  if i.payer_amount > 0 or exists (select 1 from clinic_reception.allocations a where a.invoice_id = i.id) or due <> i.amount - i.credit_amount then
    raise exception 'الخدمة دي اتدفع منها جزء — الخصم من الباكج للخدمات اللي ماتدفعش منها حاجة بس'; end if;
  if due <= 0 then raise exception 'الفاتورة دي مفيش عليها مطلوب'; end if;
  covered := least(val, due); diff := due - covered;
  dims := jsonb_build_object('patient_id', i.patient_id, 'invoice_id', i.id, 'package_id', pkg.id, 'order_id', o.id);
  perform clinic_reception.post(p_workspace, 'package_use', o.id, 'استخدام رصيد الباكج (بعد التنفيذ)', '2151', '1122', covered, dims);
  insert into clinic_reception.allocations(workspace_id, invoice_id, source, amount) values (p_workspace, i.id, 'package', covered);
  if diff > 0 then
    perform clinic_reception.post(p_workspace, 'package_price_diff', o.id, 'فرق سعر الخدمة عن قيمة جلسة الباكج', '4192', '1122', diff, dims);
    update clinic_reception.invoices set credit_amount = credit_amount + diff where id = i.id;
    fee := round(coalesce(o.doctor_fee, 0) * diff / nullif(i.amount, 0), 2);
    if fee > 0 then perform clinic_reception.post(p_workspace, 'package_price_diff_fee', o.id, 'تسوية أتعاب فرق سعر الباكج', '2120', '5111', fee,
                       dims || jsonb_build_object('provider_id', o.provider_id)); end if;
  end if;
  update clinic_reception.entitlements set used = used + o.quantity, recognized = recognized + covered where id = en.id;
  update clinic_reception.packages set recognized = recognized + covered where id = pkg.id;
  update clinic_reception.orders set entitlement_id = en.id where id = o.id;
  return jsonb_build_object('order_id', o.id, 'entitlement_id', en.id, 'value', covered, 'patient_pays', 0, 'executed', true, 'credited', diff,
    'left', (select count(*) from clinic_reception.entitlements e where e.package_id = pkg.id and e.service_id = en.service_id and e.used < e.quantity
               and not exists (select 1 from clinic_reception.orders x where x.entitlement_id = e.id and x.status <> 'cancelled')));
end $$;
revoke all on function clinic_reception.order_use_package(uuid, jsonb, uuid) from public, anon, authenticated;

-- read-only: pending requests + the patient's open package sessions
create function public.clinic_reception_legacy_packages(p_workspace uuid, p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); approver boolean := public.has_role('super_admin') or public.has_role('financial_manager');
begin
  if not approver then perform clinic_reception.access(p_workspace, 'view'); end if;
  return jsonb_build_object('can_review', approver,
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'patient_id', r.patient_id, 'patient', p.name, 'file_no', p.file_no, 'name', r.name,
        'paid_on', r.paid_on, 'total', r.total, 'lines', r.lines, 'receipt_ref', r.receipt_ref, 'created_by', r.created_by,
        'requester', (select coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') from public.admins a where a.id = r.created_by), 'created_at', r.created_at,
        'mine', r.created_by = me) order by r.created_at)
      from clinic_reception.legacy_package_requests r join clinic_reception.patients p on p.id = r.patient_id
     where r.workspace_id = p_workspace and r.status = 'pending' and (approver or r.created_by = me or r.patient_id = p_patient)), '[]'::jsonb),
    'sessions', case when p_patient is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('entitlement_id', e.id, 'package_id', k.id,
        'package', k.name, 'service_id', e.service_id, 'service', e.snapshot->>'name', 'visit_no', e.visit_no, 'value', e.allocated_value,
        'legacy_paid_on', k.legacy_paid_on,
        'left', (select count(*) from clinic_reception.entitlements e2 where e2.package_id = k.id and e2.service_id = e.service_id and e2.used < e2.quantity
                   and not exists (select 1 from clinic_reception.orders x where x.entitlement_id = e2.id and x.status <> 'cancelled')),
        'of', (select count(*) from clinic_reception.entitlements e3 where e3.package_id = k.id and e3.service_id = e.service_id)) order by k.purchased_at, e.service_id, e.visit_no)
      from clinic_reception.entitlements e join clinic_reception.packages k on k.id = e.package_id
     where k.workspace_id = p_workspace and k.patient_id = p_patient and k.status = 'active' and e.used < e.quantity
       and not exists (select 1 from clinic_reception.orders x where x.entitlement_id = e.id and x.status <> 'cancelled')
       and e.visit_no = (select min(e4.visit_no) from clinic_reception.entitlements e4 where e4.package_id = k.id and e4.service_id = e.service_id and e4.used < e4.quantity
                           and not exists (select 1 from clinic_reception.orders x where x.entitlement_id = e4.id and x.status <> 'cancelled'))), '[]'::jsonb) end);
end $$;
revoke all on function public.clinic_reception_legacy_packages(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_legacy_packages(uuid, uuid) to authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_legacy_package;
  alter function public.command_before_legacy_package(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_legacy_package(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb;
begin
  if p_action in ('legacy_package_request', 'order_use_package') then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    if p_action = 'legacy_package_request' then out := clinic_reception.legacy_package_request(p_workspace, p_payload, me);
    else out := clinic_reception.order_use_package(p_workspace, p_payload, me); end if;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, p_action, coalesce(nullif(out->>'id', ''), nullif(out->>'order_id', ''))::uuid, p_payload || out);
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  return clinic_reception.command_before_legacy_package(p_workspace, p_action, p_payload, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
