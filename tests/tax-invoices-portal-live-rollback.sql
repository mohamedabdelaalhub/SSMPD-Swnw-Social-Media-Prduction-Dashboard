-- Live rollback test for 20261122280000_tax_invoices_portal.sql («الفواتير الضريبية + بوابة الضرائب»). ONE transaction ending with
-- ROLLBACK: the migration body (inlined), then on real data: the financial manager sets the start dates + doctor rate, the accountant
-- records the upload of a real recent visit invoice, the financial manager confirms, the report and the doctor suggestion read it.
-- Metadata only (asserts no finance entry is added). Nothing is kept. Run the whole file as one script.
begin;
-- ===== migration body (20261122280000) =====

do $$ begin
  if to_regprocedure('public.clinic_finance_invoice_tax(text,uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_finance.invoices') is null or to_regclass('clinic_reception.visits') is null or to_regclass('clinic_finance.supplier_receipts') is null
     or to_regprocedure('clinic_finance.require_access(text)') is null then raise exception 'مكونات الحسابات والاستقبال والمشتريات غير موجودة'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'visits' and column_name = 'invoice_no') then
    raise exception 'طبّق 20261119030000 (أرقام الفواتير) الأول'; end if;
end $$;

create table clinic_finance.tax_settings (
  id boolean primary key default true check (id),
  tax_invoices_from date,
  e_invoices_from date,
  doctor_withholding_rate numeric(5,2) check (doctor_withholding_rate is null or doctor_withholding_rate between 0 and 100),
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now()
);
insert into clinic_finance.tax_settings(id) values (true);

create table clinic_finance.invoice_tax_status (
  doc_kind text not null check (doc_kind in ('visit_invoice', 'finance_invoice', 'purchase_invoice')),
  doc_id uuid not null,
  is_tax_invoice boolean,
  is_e_invoice boolean,
  portal_status text not null default 'not_uploaded' check (portal_status in ('not_uploaded', 'pending', 'uploaded')),
  uploaded_at timestamptz,
  portal_uuid text check (portal_uuid is null or length(portal_uuid) between 4 and 120),
  portal_ref text check (portal_ref is null or length(portal_ref) <= 120),
  note text not null default '' check (length(note) <= 500),
  recorded_by uuid references public.admins(id),
  recorded_at timestamptz,
  confirmed_by uuid references public.admins(id),
  confirmed_at timestamptz,
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now(),
  primary key (doc_kind, doc_id),
  check (portal_status = 'not_uploaded' or (portal_uuid is not null and uploaded_at is not null and recorded_by is not null)),
  check (portal_status <> 'uploaded' or (confirmed_by is not null and confirmed_by <> recorded_by))
);
create unique index invoice_tax_portal_uuid on clinic_finance.invoice_tax_status (lower(portal_uuid)) where portal_uuid is not null and portal_status <> 'not_uploaded';
create table clinic_finance.invoice_tax_ops (actor uuid not null, token uuid not null, payload jsonb not null, result jsonb not null, primary key (actor, token));
alter table clinic_finance.tax_settings enable row level security;
alter table clinic_finance.invoice_tax_status enable row level security;
alter table clinic_finance.invoice_tax_ops enable row level security;
revoke all on clinic_finance.tax_settings, clinic_finance.invoice_tax_status, clinic_finance.invoice_tax_ops from public, anon, authenticated;

-- the document itself: date, number, party, amount (null when it does not exist)
create function clinic_finance.tax_doc(p_kind text, p_id uuid) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select case p_kind
    when 'visit_invoice' then (select jsonb_build_object('date', v.opened_at, 'no', coalesce(v.invoice_no, 'زيارة ' || v.visit_no), 'party', p.name,
        'amount', coalesce((select sum(i.amount) from clinic_reception.invoices i where i.visit_id = v.id), 0))
        from clinic_reception.visits v join clinic_reception.patients p on p.id = v.patient_id
        join clinic_reception.workspaces w on w.id = v.workspace_id and w.mode = 'live' where v.id = p_id)
    when 'finance_invoice' then (select jsonb_build_object('date', f.created_at, 'no', f.reference, 'party', f.patient_ref, 'amount', f.amount)
        from clinic_finance.invoices f where f.id = p_id and not coalesce(f.voided, false))
    when 'purchase_invoice' then (select jsonb_build_object('date', r.invoice_date, 'no', r.reference, 'party', s.name, 'amount', r.invoice_total)
        from clinic_finance.supplier_receipts r left join public.inventory_suppliers s on s.id = r.supplier_id where r.id = p_id)
  end $$;

-- effective flags: the invoice's own choice, else «from the start date»
create function clinic_finance.tax_effective(p_kind text, p_date timestamptz, p_row clinic_finance.invoice_tax_status) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'is_tax_invoice', coalesce(p_row.is_tax_invoice, s.tax_invoices_from is not null and (p_date at time zone 'Africa/Cairo')::date >= s.tax_invoices_from),
    'is_e_invoice', coalesce(p_row.is_e_invoice, p_kind <> 'purchase_invoice' and s.e_invoices_from is not null and (p_date at time zone 'Africa/Cairo')::date >= s.e_invoices_from),
    'tax_auto', p_row.is_tax_invoice is null, 'e_auto', p_row.is_e_invoice is null,
    'portal_status', coalesce(p_row.portal_status, 'not_uploaded'), 'uploaded_at', p_row.uploaded_at, 'portal_uuid', p_row.portal_uuid,
    'portal_ref', p_row.portal_ref, 'note', coalesce(p_row.note, ''),
    'recorded_by', (select coalesce(nullif(trim(a.name), ''), 'المحاسب') from public.admins a where a.id = p_row.recorded_by), 'recorded_by_id', p_row.recorded_by,
    'recorded_at', p_row.recorded_at,
    'confirmed_by', (select coalesce(nullif(trim(a.name), ''), 'المدير المالي') from public.admins a where a.id = p_row.confirmed_by), 'confirmed_at', p_row.confirmed_at)
  from clinic_finance.tax_settings s $$;

create function public.clinic_finance_tax_settings_save(p_payload jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('review'); s clinic_finance.tax_settings%rowtype; r numeric;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'راجع إعدادات الضرائب'; end if;
  begin r := nullif(p_payload->>'doctor_withholding_rate', '')::numeric; exception when others then raise exception 'نسبة الخصم لازم تكون رقم'; end;
  if r is not null and (r < 0 or r > 100 or r <> round(r, 2)) then raise exception 'نسبة الخصم من 0 لـ 100'; end if;
  update clinic_finance.tax_settings set tax_invoices_from = nullif(p_payload->>'tax_invoices_from', '')::date,
    e_invoices_from = nullif(p_payload->>'e_invoices_from', '')::date, doctor_withholding_rate = r, updated_by = me, updated_at = now()
   where id returning * into s;
  insert into clinic_finance.audit(actor, action, detail) values (me, 'tax_settings', to_jsonb(s));
  return to_jsonb(s);
end $$;

create function public.clinic_finance_invoice_tax(p_kind text, p_id uuid, p_action text, p_payload jsonb, p_token uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('create'); op clinic_finance.invoice_tax_ops%rowtype; t clinic_finance.invoice_tax_status%rowtype;
  doc jsonb; pl jsonb; reason text := btrim(coalesce(p_payload->>'reason', p_payload->>'note', '')); res jsonb; at timestamptz; uuidv text;
begin
  if p_token is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'طلب غير صالح'; end if;
  pl := jsonb_build_object('kind', p_kind, 'id', p_id, 'action', p_action, 'payload', coalesce(p_payload, '{}'::jsonb));
  select * into op from clinic_finance.invoice_tax_ops where actor = me and token = p_token;
  if found then if op.payload <> pl then raise exception 'مفتاح مكرر لبيانات مختلفة'; end if; return op.result; end if;
  doc := clinic_finance.tax_doc(p_kind, p_id);
  if doc is null then raise exception 'الفاتورة مش موجودة'; end if;
  insert into clinic_finance.invoice_tax_status(doc_kind, doc_id) values (p_kind, p_id) on conflict do nothing;
  select * into t from clinic_finance.invoice_tax_status where doc_kind = p_kind and doc_id = p_id for update;
  if p_action = 'set_type' then
    if p_payload ? 'is_tax_invoice' then t.is_tax_invoice := case when p_payload->>'is_tax_invoice' in ('true', 'false') then (p_payload->>'is_tax_invoice')::boolean end; end if;
    if p_payload ? 'is_e_invoice' then t.is_e_invoice := case when p_payload->>'is_e_invoice' in ('true', 'false') then (p_payload->>'is_e_invoice')::boolean end; end if;
    if t.portal_status <> 'not_uploaded' and (t.is_tax_invoice is false) then raise exception 'الفاتورة متسجّلة على البوابة — ارجع حالة البوابة الأول'; end if;
    update clinic_finance.invoice_tax_status set is_tax_invoice = t.is_tax_invoice, is_e_invoice = t.is_e_invoice, updated_by = me, updated_at = now()
     where doc_kind = p_kind and doc_id = p_id;
  elsif p_action = 'record_upload' then
    if t.portal_status <> 'not_uploaded' then raise exception 'الفاتورة متسجّلة على البوابة بالفعل'; end if;
    uuidv := btrim(coalesce(p_payload->>'portal_uuid', ''));
    if length(uuidv) < 4 then raise exception 'اكتب رقم الفاتورة على البوابة (UUID)'; end if;
    begin at := coalesce(nullif(p_payload->>'uploaded_at', '')::timestamptz, now()); exception when others then raise exception 'راجع تاريخ الرفع'; end;
    if at > now() + interval '1 day' then raise exception 'تاريخ الرفع في المستقبل'; end if;
    if exists (select 1 from clinic_finance.invoice_tax_status x where lower(x.portal_uuid) = lower(uuidv) and x.portal_status <> 'not_uploaded'
               and (x.doc_kind, x.doc_id) <> (p_kind, p_id)) then raise exception 'رقم البوابة ده متسجّل على فاتورة تانية'; end if;
    update clinic_finance.invoice_tax_status set portal_status = 'pending', portal_uuid = uuidv, portal_ref = nullif(btrim(coalesce(p_payload->>'portal_ref', '')), ''),
      uploaded_at = at, note = left(reason, 500), recorded_by = me, recorded_at = now(), confirmed_by = null, confirmed_at = null, updated_by = me, updated_at = now()
     where doc_kind = p_kind and doc_id = p_id;
  elsif p_action in ('confirm', 'refuse') then
    perform clinic_finance.require_access('review');
    if t.portal_status <> 'pending' then raise exception 'مفيش رفع مستني تأكيد على الفاتورة دي'; end if;
    if t.recorded_by = me then raise exception 'التأكيد لازم يكون من شخص غير اللي سجّل الرفع'; end if;
    if p_action = 'confirm' then
      update clinic_finance.invoice_tax_status set portal_status = 'uploaded', confirmed_by = me, confirmed_at = now(), updated_by = me, updated_at = now()
       where doc_kind = p_kind and doc_id = p_id;
    else
      if length(reason) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.invoice_tax_status set portal_status = 'not_uploaded', portal_uuid = null, portal_ref = null, uploaded_at = null,
        recorded_by = null, recorded_at = null, note = left('رفض التأكيد: ' || reason, 500), updated_by = me, updated_at = now()
       where doc_kind = p_kind and doc_id = p_id;
    end if;
  elsif p_action = 'unmark' then
    perform clinic_finance.require_access('review');
    if t.portal_status <> 'uploaded' then raise exception 'الفاتورة مش متأكد رفعها'; end if;
    if length(reason) < 3 then raise exception 'اكتب سبب الرجوع (مثلاً الفاتورة اتلغت على البوابة)'; end if;
    update clinic_finance.invoice_tax_status set portal_status = 'not_uploaded', portal_uuid = null, portal_ref = null, uploaded_at = null, recorded_by = null,
      recorded_at = null, confirmed_by = null, confirmed_at = null, note = left('رجوع: ' || reason, 500), updated_by = me, updated_at = now()
     where doc_kind = p_kind and doc_id = p_id;
  else raise exception 'إجراء غير معروف';
  end if;
  select * into t from clinic_finance.invoice_tax_status where doc_kind = p_kind and doc_id = p_id;
  res := clinic_finance.tax_effective(p_kind, (doc->>'date')::timestamptz, t) || jsonb_build_object('doc_kind', p_kind, 'doc_id', p_id);
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'invoice_tax_' || p_action, p_id, res);
  insert into clinic_finance.invoice_tax_ops values (me, p_token, pl, res);
  return res;
end $$;

create function public.clinic_finance_invoice_tax_get(p_kind text, p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('view');
begin
  return jsonb_build_object('can_edit', clinic_finance.allowed('create'), 'can_review', clinic_finance.allowed('review'), 'me', me,
    'docs', coalesce((select jsonb_agg(clinic_finance.tax_effective(p_kind, (d.doc->>'date')::timestamptz, t) || jsonb_build_object('doc_id', x.id) || d.doc)
      from unnest(p_ids) x(id) cross join lateral (select clinic_finance.tax_doc(p_kind, x.id) doc) d
      left join clinic_finance.invoice_tax_status t on t.doc_kind = p_kind and t.doc_id = x.id where d.doc is not null), '[]'::jsonb));
end $$;

create function public.clinic_finance_tax_report(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('view'); rows jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'اختار فترة صحيحة (لحد سنة)'; end if;
  with docs as (
    select 'visit_invoice'::text kind, v.id from clinic_reception.visits v join clinic_reception.workspaces w on w.id = v.workspace_id and w.mode = 'live'
     where (v.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to and exists (select 1 from clinic_reception.invoices i where i.visit_id = v.id)
    union all select 'finance_invoice', f.id from clinic_finance.invoices f
     where (f.created_at at time zone 'Africa/Cairo')::date between p_from and p_to and not coalesce(f.voided, false)
    union all select 'purchase_invoice', r.id from clinic_finance.supplier_receipts r where r.invoice_date between p_from and p_to)
  select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) into rows from (
    select clinic_finance.tax_effective(d.kind, (dd.doc->>'date')::timestamptz, t) || dd.doc || jsonb_build_object('doc_kind', d.kind, 'doc_id', d.id) x
      from docs d cross join lateral (select clinic_finance.tax_doc(d.kind, d.id) doc) dd
      left join clinic_finance.invoice_tax_status t on t.doc_kind = d.kind and t.doc_id = d.id where dd.doc is not null) q;
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', rows, 'can_edit', clinic_finance.allowed('create'), 'can_review', clinic_finance.allowed('review'), 'me', me,
    'settings', (select to_jsonb(s) - 'id' from clinic_finance.tax_settings s),
    'totals', (select jsonb_build_object(
      'tax_count', count(*) filter (where (r->>'is_tax_invoice')::boolean), 'tax_amount', coalesce(sum((r->>'amount')::numeric) filter (where (r->>'is_tax_invoice')::boolean), 0),
      'uploaded_count', count(*) filter (where r->>'portal_status' = 'uploaded'), 'uploaded_amount', coalesce(sum((r->>'amount')::numeric) filter (where r->>'portal_status' = 'uploaded'), 0),
      'pending_count', count(*) filter (where r->>'portal_status' = 'pending'),
      'not_uploaded_count', count(*) filter (where (r->>'is_tax_invoice')::boolean and r->>'portal_status' <> 'uploaded'),
      'not_uploaded_amount', coalesce(sum((r->>'amount')::numeric) filter (where (r->>'is_tax_invoice')::boolean and r->>'portal_status' <> 'uploaded'), 0))
      from jsonb_array_elements(rows) r));
end $$;

create function public.clinic_finance_doctor_tax_suggest(p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('view'); rate numeric; up numeric := 0; pend numeric := 0; n int := 0; np int := 0;
begin
  select doctor_withholding_rate into rate from clinic_finance.tax_settings;
  select coalesce(sum(o.doctor_fee) filter (where e->>'portal_status' = 'uploaded'), 0), coalesce(sum(o.doctor_fee) filter (where e->>'portal_status' <> 'uploaded'), 0),
         count(distinct o.visit_id) filter (where e->>'portal_status' = 'uploaded'), count(distinct o.visit_id) filter (where e->>'portal_status' <> 'uploaded')
    into up, pend, n, np
    from clinic_reception.orders o join clinic_reception.providers p on p.id = o.provider_id join clinic_reception.visits v on v.id = o.visit_id
    join clinic_reception.workspaces w on w.id = v.workspace_id and w.mode = 'live'
    left join clinic_finance.invoice_tax_status t on t.doc_kind = 'visit_invoice' and t.doc_id = v.id
    cross join lateral (select clinic_finance.tax_effective('visit_invoice', v.opened_at, t) e) z
   where p.doctor_key = p_doctor and o.status = 'completed' and o.doctor_fee > 0
     and (coalesce(o.completed_at, v.opened_at) at time zone 'Africa/Cairo')::date between coalesce(p_from, '-infinity'::date) and coalesce(p_to, 'infinity'::date)
     and (e->>'is_e_invoice')::boolean;
  return jsonb_build_object('rate', rate, 'uploaded_fees', up, 'uploaded_visits', n, 'pending_fees', pend, 'pending_visits', np,
    'suggested', case when rate is null then null else round(up * rate / 100, 2) end);
end $$;

revoke all on function clinic_finance.tax_doc(text, uuid), clinic_finance.tax_effective(text, timestamptz, clinic_finance.invoice_tax_status) from public, anon, authenticated;
revoke all on function public.clinic_finance_tax_settings_save(jsonb), public.clinic_finance_invoice_tax(text, uuid, text, jsonb, uuid),
  public.clinic_finance_invoice_tax_get(text, uuid[]), public.clinic_finance_tax_report(date, date), public.clinic_finance_doctor_tax_suggest(text, date, date) from public, anon;
grant execute on function public.clinic_finance_tax_settings_save(jsonb), public.clinic_finance_invoice_tax(text, uuid, text, jsonb, uuid),
  public.clinic_finance_invoice_tax_get(text, uuid[]), public.clinic_finance_tax_report(date, date), public.clinic_finance_doctor_tax_suggest(text, date, date) to authenticated;

-- ===== test =====
do $$
declare acc uuid; fm uuid; v uuid; dk text; r jsonb; rep jsonb; sug jsonb; e0 bigint; d0 date := (now() at time zone 'Africa/Cairo')::date - 30;
begin
  -- recorder: an accountant, else the financial manager (no accountant user yet); confirmer: another reviewer (owner / GM / FM)
  select user_id into acc from public.admins where active and user_id is not null and role in ('accountant', 'financial_manager')
   order by case role when 'accountant' then 0 else 1 end, id limit 1;
  select user_id into fm from public.admins where active and user_id is not null and role in ('super_admin', 'general_manager', 'financial_manager') and user_id is distinct from acc
   order by case role when 'super_admin' then 0 when 'general_manager' then 1 else 2 end, id limit 1;
  if acc is null or fm is null then raise exception 'Need a recorder (accountant / financial manager) and another reviewer (owner / GM) with logins'; end if;
  select vv.id, p.doctor_key into v, dk from clinic_reception.visits vv join clinic_reception.workspaces w on w.id = vv.workspace_id and w.mode = 'live'
    join clinic_reception.orders o on o.visit_id = vv.id and o.status = 'completed' and o.doctor_fee > 0 join clinic_reception.providers p on p.id = o.provider_id
   where exists (select 1 from clinic_reception.invoices i where i.visit_id = vv.id) and p.doctor_key is not null order by vv.opened_at desc limit 1;
  if v is null then raise exception 'No live visit invoice with a doctor fee'; end if;
  e0 := (select count(*) from clinic_finance.entries);
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  perform public.clinic_finance_tax_settings_save(jsonb_build_object('tax_invoices_from', d0, 'e_invoices_from', d0, 'doctor_withholding_rate', '5'));
  perform set_config('request.jwt.claim.sub', acc::text, true);
  r := public.clinic_finance_invoice_tax_get('visit_invoice', array[v]);
  if not ((r->'docs'->0->>'is_tax_invoice')::boolean and (r->'docs'->0->>'is_e_invoice')::boolean) then raise exception 'Start-date defaults not applied: %', r; end if;
  r := public.clinic_finance_invoice_tax('visit_invoice', v, 'record_upload', jsonb_build_object('portal_uuid', 'ROLLBACK-' || gen_random_uuid()), gen_random_uuid());
  if r->>'portal_status' <> 'pending' then raise exception 'Record failed: %', r; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true);
  r := public.clinic_finance_invoice_tax('visit_invoice', v, 'confirm', '{}', gen_random_uuid());
  if r->>'portal_status' <> 'uploaded' then raise exception 'Confirm failed: %', r; end if;
  rep := public.clinic_finance_tax_report(d0, (now() at time zone 'Africa/Cairo')::date);
  if (rep->'totals'->>'uploaded_count')::int < 1 then raise exception 'Report does not count the upload'; end if;
  sug := public.clinic_finance_doctor_tax_suggest(dk, d0, (now() at time zone 'Africa/Cairo')::date);
  if (sug->>'uploaded_fees')::numeric <= 0 or (sug->>'suggested')::numeric <> round((sug->>'uploaded_fees')::numeric * 0.05, 2) then raise exception 'Doctor suggestion wrong: %', sug; end if;
  execute 'reset role';
  if (select count(*) from clinic_finance.entries) <> e0 then raise exception 'A finance entry was posted (must be metadata only)'; end if;
  raise notice 'tax invoices live rollback OK: report rows %, uploaded %, doctor % suggested % on fees %', jsonb_array_length(rep->'rows'), rep->'totals'->>'uploaded_count', dk, sug->>'suggested', sug->>'uploaded_fees';
end $$;
rollback;
select jsonb_build_object('test', 'tax invoices portal live rollback passed',
  'migration_left_applied', to_regprocedure('public.clinic_finance_invoice_tax(text,uuid,text,jsonb,uuid)') is not null);
