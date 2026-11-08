-- Online doctor contracts: signature request + doctor acceptance, recorded only (NOTHING about accruals changes).
-- Flow: contracts are approved first (existing maker-checker) -> accountant/manager SENDS a group of ACTIVE contracts (same doctor_key + reference) for signature ->
-- the doctor, signed in with the admin account linked to his doctor_key (clinic_people.people.admin_id <-> doctor_key), reads the rendered contract
-- (versioned lawyer template + a table generated from his contracts) and accepts or rejects with a reason. The result is shown on the contract rows.
-- Accruals/payouts are NOT blocked by acceptance (open owner question).
-- Tables (all RLS closed, no direct grants): contract_templates (versioned text, kind contract|consent), signature_requests (immutable snapshot of the rendered text + sha256),
-- acceptances (who/when/which version/sha256/user agent only, no IP). Decisions are append-only; one decision per request; one consent acceptance per (doctor, template).
-- Staleness: a pending request can no longer be accepted when a NEWER published contract template exists, or when its contracts changed (not active / different terms).
-- Seeded templates are PLACEHOLDERS (unpublished drafts): nothing can be sent until the owner/lawyer text is published (template_publish).
-- Owner decisions 2026-11-09: (1) neither rule blocks anything by default; the owner sets an enforcement START DATE per rule (contract_settings, default NULL = off);
--   this file records the dates and computes compliance (doctor_blocked) but wires NO block into accruals/work (a later, separately approved step).
-- (2) texts are editable by the owner: title + intro + a list of clauses (add/remove/reorder), every save is a new VERSION, acceptances record the version + sha256.
-- (3) accepting needs a signature: drawn (canvas PNG) or uploaded image (PNG/JPEG), stored with the acceptance (+ its sha256) and shown on the signed document.
-- ADDITIVE: 4 tables, helper + public functions. No existing table/function is touched.
-- Rollback: supabase/rollbacks/20261108280000_online_contracts.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.doctor_contracts') is null then raise exception 'doctor_contracts غير موجود؛ طبّق ملفات الحسابات أولًا'; end if;
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموظفين غير موجود؛ طبّق ملف الموارد البشرية أولًا'; end if;
  if to_regclass('clinic_finance.contract_templates') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.contract_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contract', 'consent')),
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) between 3 and 200),
  body text not null check (length(btrim(body)) >= 20),
  clauses text[] not null default '{}',
  published boolean not null default false,
  placeholder boolean not null default false,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (kind, version),
  check (not published or published_at is not null)
);

create table clinic_finance.signature_requests (
  id uuid primary key default gen_random_uuid(),
  doctor_key text not null check (length(btrim(doctor_key)) >= 2),
  doctor_name text not null,
  reference text not null,
  contract_ids uuid[] not null check (cardinality(contract_ids) > 0),
  template_id uuid not null references clinic_finance.contract_templates(id),
  template_version integer not null,
  schedule jsonb not null,
  rendered_text text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'void')),
  created_by uuid not null references public.admins(id),
  token uuid not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_reason text,
  unique (created_by, token)
);
create index signature_requests_doctor on clinic_finance.signature_requests (doctor_key, created_at desc);

create table clinic_finance.acceptances (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contract', 'consent')),
  request_id uuid references clinic_finance.signature_requests(id),
  doctor_key text not null,
  admin_id uuid not null references public.admins(id),
  template_id uuid not null references clinic_finance.contract_templates(id),
  template_version integer not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('accepted', 'rejected')),
  reason text,
  user_agent text,
  signature_kind text check (signature_kind in ('drawn', 'uploaded')),
  signature_image text,
  signature_sha256 text,
  decided_at timestamptz not null default now(),
  check (decision <> 'accepted' or (signature_kind is not null and signature_image is not null and signature_sha256 ~ '^[0-9a-f]{64}$')),
  check ((kind = 'contract' and request_id is not null) or (kind = 'consent' and request_id is null and decision = 'accepted')),
  check (decision = 'accepted' or length(btrim(coalesce(reason, ''))) >= 3)
);
create unique index acceptances_one_per_request on clinic_finance.acceptances (request_id) where kind = 'contract';
create unique index acceptances_one_consent on clinic_finance.acceptances (doctor_key, template_id) where kind = 'consent';

create table clinic_finance.contract_settings (
  rule text primary key check (rule in ('contract_signature', 'consent')),
  start_date date,  -- NULL = not enforced (default). Set by the owner.
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now()
);
insert into clinic_finance.contract_settings (rule) values ('contract_signature'), ('consent');

do $$ declare t text; begin
  foreach t in array array['contract_templates', 'signature_requests', 'acceptances', 'contract_settings'] loop
    execute format('alter table clinic_finance.%I enable row level security', t);
    execute format('revoke all on clinic_finance.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Placeholder drafts (NOT published). The consent text is the draft prepared for the lawyer; the contract text is a neutral skeleton. Both need the lawyer's final wording.
insert into clinic_finance.contract_templates (kind, version, title, body, clauses, published, placeholder) values
('contract', 1, 'عقد أتعاب الطبيب (نص مؤقت بانتظار المستشار القانوني)',
 E'عقد أتعاب طبيب — مركز عيادات Swnw التخصصية\n\nالطبيب: {{doctor_name}} (كود {{doctor_key}})\nمرجع الاتفاق: {{reference}}\nرقم نسخة النص: {{template_version}}\n\nيقر الطرفان بأن الشروط المالية بين المركز والطبيب هي الموضحة في الجدول أدناه، وهي الشروط المعتمدة في نظام المركز.',
 array['[نص قانوني نهائي يضيفه المستشار القانوني هنا]', 'بالتوقيع و«أوافق» يقر الطبيب بأنه قرأ العقد وفهمه وقبله طوعًا، وتُحفظ موافقته (الاسم، كود الطبيب، التاريخ والوقت، رقم نسخة النص، التوقيع).'], false, true),
('consent', 1, 'إقرار وتعهد الطبيب بالمسؤولية المهنية (مسودة بانتظار المستشار القانوني)',
 E'إقرار وتعهد الطبيب بالمسؤولية المهنية — مسودة للعرض على المستشار القانوني',
 array['أقر بأنني مرخّص لي بمزاولة المهنة، وأن قيدي بالنقابة سارٍ، وألتزم بإخطار المركز فورًا بأي إيقاف أو قيد أو تغيير في الترخيص.',
  'أقر بأنني المسؤول مهنيًا وقانونيًا عن كل إجراء طبي أجريه أو أقرره أو أوقّع عليه، وعن دقة التشخيص واختيار العلاج، في حدود القانون وأصول المهنة.',
  'لا أجري إجراءً خارج نطاق تخصصي أو خبرتي أو ترخيصي، وأحيل المريض لمن يختص عند الحاجة.',
  'أحصل على موافقة المريض المستنيرة قبل أي إجراء وأوثقها في ملفه.',
  'أوثّق كل زيارة بدقة، وأحافظ على سرية بيانات المرضى.',
  'أبلّغ الإدارة فورًا (خلال 24 ساعة) عن أي حادث أو مضاعفة غير متوقعة أو خطأ أو شبه خطأ.',
  'أحتفظ بوثيقة تأمين مسؤولية مهنية سارية طوال مدة العقد.',
  '[الصياغة النهائية وحدود الرجوع والتأمين يحسمها المستشار القانوني]'], false, true);

-- ---------- helpers (not exposed) ----------
create function clinic_finance.contract_scope_label(p_scope text) returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare n text;
begin
  if p_scope like 'قسم:%' then return 'كل خدمات قسم ' || substr(p_scope, 5); end if;
  begin
    execute 'select x.name from public.pricing_services x where btrim(x.booking_code) = $1 order by x.active desc limit 1' into n using btrim(p_scope);
  exception when others then n := null;
  end;
  return case when n is null or btrim(n) = '' then p_scope else n || ' (' || p_scope || ')' end;
end $$;

-- The schedule is generated from the contract rows (works with or without the fixed-fee columns: they are read through to_jsonb).
create function clinic_finance.contract_schedule(p_ids uuid[]) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'contract_id', c.id, 'service_scope', c.service_scope, 'service', clinic_finance.contract_scope_label(c.service_scope),
    'fee_kind', coalesce(to_jsonb(c)->>'fee_kind', 'percent'), 'rate', c.rate, 'fixed_amount', nullif(to_jsonb(c)->>'fixed_amount', '')::numeric,
    'valid_from', c.valid_from, 'valid_to', c.valid_to, 'basis', c.basis, 'base_scope', c.base_scope, 'deduction', c.deduction
  ) order by c.service_scope, c.valid_from, c.id), '[]'::jsonb)
  from clinic_finance.doctor_contracts c where c.id = any(p_ids);
$$;

-- full text of a template = intro + numbered clauses (what the doctor reads and what the sha256 covers)
create function clinic_finance.template_text(t clinic_finance.contract_templates) returns text language sql immutable set search_path = pg_catalog as $$
  select t.body || coalesce((select E'\n\n' || string_agg(x.n || E'. ' || x.c, E'\n' order by x.n) from unnest(t.clauses) with ordinality as x(c, n) where btrim(x.c) <> ''), '')
$$;

create function clinic_finance.contract_render(p_template uuid, p_doctor_key text, p_doctor_name text, p_reference text, p_schedule jsonb) returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare t clinic_finance.contract_templates%rowtype; head text; tbl text := ''; r jsonb; i int := 0;
begin
  select * into t from clinic_finance.contract_templates where id = p_template;
  if not found then raise exception 'نص العقد غير موجود'; end if;
  head := replace(replace(replace(replace(clinic_finance.template_text(t), '{{doctor_name}}', p_doctor_name), '{{doctor_key}}', p_doctor_key), '{{reference}}', p_reference), '{{template_version}}', t.version::text);
  for r in select value from jsonb_array_elements(p_schedule) loop
    i := i + 1;
    tbl := tbl || E'\n' || i || E'. ' || (r->>'service') || E' — '
      || case when r->>'fee_kind' = 'fixed' then 'مبلغ ثابت ' || (r->>'fixed_amount') || ' ج' else 'نسبة ' || (r->>'rate') || '%' end
      || E' — الفترة من ' || (r->>'valid_from') || ' إلى ' || (r->>'valid_to')
      || E' — الاستحقاق: ' || case r->>'basis' when 'performed' then 'عند تنفيذ الخدمة' else 'حسب التحصيل' end
      || E' — الوعاء: ' || case r->>'base_scope' when 'service' then 'الخدمة دون بنود المستلزمات' else 'إجمالي الفاتورة' end
      || E' — خصم المستلزمات: ' || case r->>'deduction' when 'none' then 'بدون خصم' when 'cost' then 'خصم تكلفة المستلزمات' else 'خصم سعر بيع المستلزمات' end;
  end loop;
  return head || E'\n\nجدول الشروط المالية' || tbl;
end $$;

create function clinic_finance.contract_sha(p_text text) returns text language sql immutable set search_path = pg_catalog as $$ select encode(sha256(convert_to(p_text, 'UTF8')), 'hex') $$;

create function clinic_finance.current_template(p_kind text) returns clinic_finance.contract_templates language sql stable security definer set search_path = pg_catalog, public as $$
  select t from clinic_finance.contract_templates t where t.kind = p_kind and t.published order by t.version desc limit 1;
$$;

-- stale = a newer published contract template exists, or the contracts changed (no longer active, or the generated text differs from the snapshot)
create function clinic_finance.request_stale(r clinic_finance.signature_requests) returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare cur clinic_finance.contract_templates%rowtype;
begin
  select * into cur from clinic_finance.current_template('contract');
  if found and cur.version > r.template_version then return true; end if;
  if (select count(*) from clinic_finance.doctor_contracts where id = any(r.contract_ids) and status = 'active') <> cardinality(r.contract_ids) then return true; end if;
  return clinic_finance.contract_sha(clinic_finance.contract_render(r.template_id, r.doctor_key, r.doctor_name, r.reference, clinic_finance.contract_schedule(r.contract_ids))) <> r.text_sha256;
end $$;

-- signature: PNG/JPEG data URL (<= ~300 KB), magic bytes checked; returns its sha256
create function clinic_finance.check_signature(p_kind text, p_image text) returns text language plpgsql immutable set search_path = pg_catalog, public as $$
declare b bytea;
begin
  if p_kind is null or p_kind not in ('drawn', 'uploaded') then raise exception 'اختر طريقة التوقيع (رسم أو رفع صورة)'; end if;
  if p_image is null or p_image !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+=*$' then raise exception 'صورة التوقيع غير صالحة (PNG أو JPEG فقط)'; end if;
  if length(p_image) > 400000 then raise exception 'صورة التوقيع كبيرة؛ استخدم صورة أصغر من 300 كيلوبايت'; end if;
  b := decode(substr(p_image, strpos(p_image, ',') + 1), 'base64');
  if length(b) < 100 or not (substr(b, 1, 4) = '\x89504e47'::bytea or substr(b, 1, 3) = '\xffd8ff'::bytea) then raise exception 'صورة التوقيع غير صالحة (PNG أو JPEG فقط)'; end if;
  return encode(sha256(b), 'hex');
end $$;

-- owner-set enforcement start date per rule (NULL = off). Used for display and by doctor_blocked(); nothing in accruals/work is blocked by this file.
create function clinic_finance.enforcement_active(p_rule text) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select start_date <= (now() at time zone 'Africa/Cairo')::date from clinic_finance.contract_settings where rule = p_rule), false)
$$;

create function clinic_finance.doctor_compliance(p_doctor_key text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare cons clinic_finance.contract_templates%rowtype; c_ok boolean; k_ok boolean; n_active int;
begin
  select count(*) into n_active from clinic_finance.doctor_contracts where doctor_key = p_doctor_key and status = 'active';
  -- contract signed = every ACTIVE contract is in an accepted request that is not stale
  c_ok := n_active = 0 or not exists (
    select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor_key and c.status = 'active'
      and not exists (select 1 from clinic_finance.signature_requests r where r.doctor_key = p_doctor_key and r.status = 'accepted' and c.id = any(r.contract_ids) and not clinic_finance.request_stale(r)));
  select * into cons from clinic_finance.current_template('consent');
  k_ok := not found or cons.id is null or exists (select 1 from clinic_finance.acceptances a where a.kind = 'consent' and a.doctor_key = p_doctor_key and a.template_id = cons.id);
  return jsonb_build_object('contract_ok', c_ok, 'consent_ok', k_ok,
    'contract_blocked', clinic_finance.enforcement_active('contract_signature') and not c_ok,
    'consent_blocked', clinic_finance.enforcement_active('consent') and not k_ok);
end $$;

create function clinic_finance.my_doctor_key() returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); k text;
begin
  if me is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  select p.doctor_key into k from clinic_people.people p where p.admin_id = me and p.doctor_key is not null and p.status <> 'ended';
  return k;  -- null = this account is not linked to a doctor
end $$;

-- ---------- accountant / manager side ----------
create function clinic_finance.contract_signature_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v_id uuid; q clinic_finance.signature_requests%rowtype; tpl clinic_finance.contract_templates%rowtype; ids uuid[]; sched jsonb; txt text; nm text; ref text; nver int; k text; cl text[]; d date;
begin
  perform clinic_finance.lock_day();
  if p_action = 'send' then
    me := clinic_finance.require_access('create');
    select * into q from clinic_finance.signature_requests where created_by = me and token = p_token;
    if found then return q.id; end if;
    k := btrim(coalesce(p_payload->>'doctor_key', '')); ref := btrim(coalesce(p_payload->>'reference', ''));
    if k = '' or ref = '' then raise exception 'حدد الطبيب ومرجع الاتفاق'; end if;
    if exists (select 1 from clinic_finance.doctor_contracts where doctor_key = k and reference = ref and status = 'pending') then raise exception 'في عقود لسه قيد الاعتماد في نفس المجموعة؛ اعتمدها الأول'; end if;
    select array_agg(id order by service_scope, valid_from, id), max(doctor_name) into ids, nm from clinic_finance.doctor_contracts where doctor_key = k and reference = ref and status = 'active';
    if ids is null then raise exception 'مفيش عقود معتمدة للطبيب في المرجع ده'; end if;
    select * into tpl from clinic_finance.current_template('contract');
    if not found or tpl.id is null then raise exception 'لا يوجد نص عقد منشور؛ انشر نص العقد المعتمد أولًا'; end if;
    sched := clinic_finance.contract_schedule(ids);
    txt := clinic_finance.contract_render(tpl.id, k, nm, ref, sched);
    update clinic_finance.signature_requests set status = 'void', decided_at = now(), decision_reason = 'استُبدل بطلب أحدث' where doctor_key = k and reference = ref and status = 'pending';
    insert into clinic_finance.signature_requests (doctor_key, doctor_name, reference, contract_ids, template_id, template_version, schedule, rendered_text, text_sha256, created_by, token)
      values (k, nm, ref, ids, tpl.id, tpl.version, sched, txt, clinic_finance.contract_sha(txt), me, p_token) returning id into v_id;
  elsif p_action = 'void' then
    me := clinic_finance.require_access('create');
    update clinic_finance.signature_requests set status = 'void', decided_at = now(), decision_reason = coalesce(nullif(btrim(p_payload->>'note'), ''), 'أُلغي') where id = (p_payload->>'id')::uuid and status = 'pending' returning id into v_id;
    if v_id is null then raise exception 'الطلب غير متاح للإلغاء'; end if;
  elsif p_action = 'template_save' then
    -- the owner/financial manager edits the text: intro + clauses; every save is a NEW version (draft, or published at once with publish=true). A draft can be re-saved (updated) until published.
    me := clinic_finance.require_access('review');
    if p_payload->>'kind' not in ('contract', 'consent') then raise exception 'نوع النص غير صحيح'; end if;
    if length(btrim(coalesce(p_payload->>'title', ''))) < 3 then raise exception 'اكتب عنوان النص'; end if;
    if length(btrim(coalesce(p_payload->>'body', ''))) < 20 then raise exception 'مقدمة النص قصيرة'; end if;
    cl := coalesce((select array_agg(btrim(x) order by n) from jsonb_array_elements_text(coalesce(p_payload->'clauses', '[]'::jsonb)) with ordinality as e(x, n) where btrim(x) <> ''), '{}');
    if cardinality(cl) > 60 then raise exception 'عدد البنود كبير'; end if;
    select id into v_id from clinic_finance.contract_templates where kind = p_payload->>'kind' and not published and id is not distinct from nullif(p_payload->>'id', '')::uuid for update;
    if v_id is not null then
      update clinic_finance.contract_templates set title = btrim(p_payload->>'title'), body = p_payload->>'body', clauses = cl, placeholder = false, created_by = me where id = v_id;
    else
      select coalesce(max(version), 0) + 1 into nver from clinic_finance.contract_templates where kind = p_payload->>'kind';
      insert into clinic_finance.contract_templates (kind, version, title, body, clauses, created_by) values (p_payload->>'kind', nver, btrim(p_payload->>'title'), p_payload->>'body', cl, me) returning id into v_id;
    end if;
    if coalesce((p_payload->>'publish')::boolean, false) then
      update clinic_finance.contract_templates set published = true, published_at = now() where id = v_id;
    end if;
  elsif p_action = 'template_publish' then
    me := clinic_finance.require_access('review');
    update clinic_finance.contract_templates set published = true, published_at = now() where id = (p_payload->>'id')::uuid and not published returning id into v_id;
    if v_id is null then raise exception 'النص غير موجود أو منشور من قبل'; end if;
  elsif p_action = 'set_enforcement' then
    -- owner decision: WHEN each rule starts to be enforced. NULL date = off (default). A past date is refused (no retroactive effect).
    me := clinic_finance.require_access('review');
    if p_payload->>'rule' not in ('contract_signature', 'consent') then raise exception 'القاعدة غير معروفة'; end if;
    d := nullif(btrim(coalesce(p_payload->>'start_date', '')), '')::date;
    if d is not null and d < (now() at time zone 'Africa/Cairo')::date then raise exception 'تاريخ البدء لا يمكن أن يكون في الماضي'; end if;
    update clinic_finance.contract_settings set start_date = d, updated_by = me, updated_at = now() where rule = p_payload->>'rule';
  else
    raise exception 'إجراء غير معروف';
  end if;
  return v_id;
end $$;

create function clinic_finance.contract_signature_status() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('create');
  return jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'version', t.version, 'title', t.title, 'body', t.body, 'clauses', to_jsonb(t.clauses), 'published', t.published, 'placeholder', t.placeholder) order by t.kind, t.version desc) from clinic_finance.contract_templates t), '[]'::jsonb),
    'enforcement', coalesce((select jsonb_object_agg(x.rule, jsonb_build_object('start_date', x.start_date, 'active', clinic_finance.enforcement_active(x.rule))) from clinic_finance.contract_settings x), '{}'::jsonb),
    'compliance', coalesce((select jsonb_object_agg(k.doctor_key, clinic_finance.doctor_compliance(k.doctor_key)) from (select distinct doctor_key from clinic_finance.doctor_contracts where status = 'active') k), '{}'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'doctor_key', r.doctor_key, 'reference', r.reference, 'status', r.status, 'stale', r.status = 'pending' and clinic_finance.request_stale(r),
        'template_version', r.template_version, 'contract_ids', r.contract_ids, 'created_at', r.created_at, 'decided_at', r.decided_at, 'reason', r.decision_reason,
        'linked', exists (select 1 from clinic_people.people p where p.doctor_key = r.doctor_key and p.admin_id is not null and p.status <> 'ended')) order by r.created_at desc) from clinic_finance.signature_requests r), '[]'::jsonb),
    'contracts', coalesce((select jsonb_object_agg(l.cid, l.s) from (
        select distinct on (cid) cid, jsonb_build_object('state', case when r.status = 'pending' and clinic_finance.request_stale(r) then 'stale' else r.status end, 'at', r.decided_at, 'reason', r.decision_reason, 'request_id', r.id, 'sent_at', r.created_at, 'acceptance_id', (select a.id from clinic_finance.acceptances a where a.request_id = r.id), 'signature_kind', (select a.signature_kind from clinic_finance.acceptances a where a.request_id = r.id)) s
        from clinic_finance.signature_requests r cross join lateral unnest(r.contract_ids) cid where r.status <> 'void' order by cid, r.created_at desc) l), '{}'::jsonb),
    'consents', coalesce((select jsonb_object_agg(a.doctor_key, jsonb_build_object('version', a.template_version, 'at', a.decided_at, 'acceptance_id', a.id, 'signature_kind', a.signature_kind)) from (
        select distinct on (doctor_key) * from clinic_finance.acceptances where kind = 'consent' order by doctor_key, template_version desc) a), '{}'::jsonb)
  );
end $$;

-- one signed document (text + signature image + metadata) for the accountant/manager; the status list never carries the images
create function clinic_finance.contract_signed_document(p_acceptance uuid) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.acceptances%rowtype; r clinic_finance.signature_requests%rowtype; t clinic_finance.contract_templates%rowtype; txt text;
begin
  perform clinic_finance.require_access('create');
  select * into a from clinic_finance.acceptances where id = p_acceptance;
  if not found then raise exception 'الموافقة غير موجودة'; end if;
  if a.kind = 'contract' then select * into r from clinic_finance.signature_requests where id = a.request_id; txt := r.rendered_text;
  else select * into t from clinic_finance.contract_templates where id = a.template_id; txt := clinic_finance.template_text(t); end if;
  return jsonb_build_object('kind', a.kind, 'doctor_key', a.doctor_key, 'decision', a.decision, 'reason', a.reason, 'template_version', a.template_version, 'text', txt, 'text_sha256', a.text_sha256,
    'signature_kind', a.signature_kind, 'signature_image', a.signature_image, 'signature_sha256', a.signature_sha256, 'decided_at', a.decided_at, 'user_agent', a.user_agent);
end $$;

-- ---------- doctor side: always scoped to the doctor_key linked to the caller's own admin account ----------
create function clinic_finance.doctor_contract_inbox() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare k text := clinic_finance.my_doctor_key(); cons clinic_finance.contract_templates%rowtype; got clinic_finance.acceptances%rowtype; consent jsonb := null;
begin
  if k is null then return jsonb_build_object('linked', false, 'requests', '[]'::jsonb, 'pending', 0); end if;
  select * into cons from clinic_finance.current_template('consent');
  if found and cons.id is not null then
    select * into got from clinic_finance.acceptances where kind = 'consent' and doctor_key = k and template_id = cons.id;
    consent := jsonb_build_object('template_id', cons.id, 'version', cons.version, 'title', cons.title, 'body', clinic_finance.template_text(cons), 'sha256', clinic_finance.contract_sha(clinic_finance.template_text(cons)), 'accepted_at', got.decided_at, 'signature_kind', got.signature_kind, 'signature_image', got.signature_image);
  end if;
  return jsonb_build_object('linked', true, 'doctor_key', k, 'consent', consent,
    'enforcement', (select jsonb_object_agg(x.rule, jsonb_build_object('start_date', x.start_date, 'active', clinic_finance.enforcement_active(x.rule))) from clinic_finance.contract_settings x),
    'compliance', clinic_finance.doctor_compliance(k),
    'pending', (select count(*) from clinic_finance.signature_requests r where r.doctor_key = k and r.status = 'pending' and not clinic_finance.request_stale(r)),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'stale', r.status = 'pending' and clinic_finance.request_stale(r),
        'template_version', r.template_version, 'schedule', r.schedule, 'text', r.rendered_text, 'sha256', r.text_sha256, 'created_at', r.created_at, 'decided_at', r.decided_at, 'reason', r.decision_reason,
        'signature_kind', (select a.signature_kind from clinic_finance.acceptances a where a.request_id = r.id), 'signature_image', (select a.signature_image from clinic_finance.acceptances a where a.request_id = r.id)) order by r.created_at desc)
      from clinic_finance.signature_requests r where r.doctor_key = k and r.status <> 'void'), '[]'::jsonb));
end $$;

create function clinic_finance.doctor_contract_decide(p_request uuid, p_accept boolean, p_reason text, p_sha text, p_user_agent text, p_sig_kind text default null, p_sig_image text default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text := clinic_finance.my_doctor_key(); me uuid := public.my_admin_id(); r clinic_finance.signature_requests%rowtype; a clinic_finance.acceptances%rowtype; want text; sig text;
begin
  if k is null then raise exception 'حسابك غير مربوط بطبيب' using errcode = '42501'; end if;
  if p_accept is null then raise exception 'حدد القرار'; end if;
  want := case when p_accept then 'accepted' else 'rejected' end;
  select * into r from clinic_finance.signature_requests where id = p_request and doctor_key = k for update;
  if not found or r.status = 'void' then raise exception 'الطلب غير متاح'; end if;
  select * into a from clinic_finance.acceptances where request_id = r.id and kind = 'contract';
  if found then
    if a.decision = want then return jsonb_build_object('status', a.decision, 'decided_at', a.decided_at, 'repeated', true); end if;
    raise exception 'تم تسجيل قرارك على هذا الطلب من قبل';
  end if;
  if r.status <> 'pending' then raise exception 'الطلب غير متاح'; end if;
  if clinic_finance.request_stale(r) then raise exception 'نص العقد أو شروطه اتغيّرت؛ اطلب من الحسابات إعادة الإرسال'; end if;
  if p_sha is distinct from r.text_sha256 then raise exception 'النص المعروض لا يطابق النسخة المرسلة؛ حدّث الصفحة'; end if;
  if not p_accept and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
  if p_accept then sig := clinic_finance.check_signature(p_sig_kind, p_sig_image); end if;  -- accepting needs a signature; rejecting does not
  insert into clinic_finance.acceptances (kind, request_id, doctor_key, admin_id, template_id, template_version, text_sha256, decision, reason, user_agent, signature_kind, signature_image, signature_sha256)
    values ('contract', r.id, k, me, r.template_id, r.template_version, r.text_sha256, want, case when p_accept then null else btrim(p_reason) end, left(coalesce(p_user_agent, ''), 300),
      case when p_accept then p_sig_kind end, case when p_accept then p_sig_image end, sig) returning * into a;
  update clinic_finance.signature_requests set status = want, decided_at = a.decided_at, decision_reason = a.reason where id = r.id;
  return jsonb_build_object('status', want, 'decided_at', a.decided_at, 'repeated', false);
end $$;

create function clinic_finance.doctor_consent_accept(p_template uuid, p_sha text, p_user_agent text, p_sig_kind text default null, p_sig_image text default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text := clinic_finance.my_doctor_key(); me uuid := public.my_admin_id(); t clinic_finance.contract_templates%rowtype; a clinic_finance.acceptances%rowtype; sig text;
begin
  if k is null then raise exception 'حسابك غير مربوط بطبيب' using errcode = '42501'; end if;
  select * into t from clinic_finance.contract_templates where id = p_template and kind = 'consent' and published;
  if not found then raise exception 'نص الإقرار غير متاح'; end if;
  if t.version < (select version from clinic_finance.current_template('consent')) then raise exception 'فيه نسخة أحدث من الإقرار؛ حدّث الصفحة'; end if;
  if p_sha is distinct from clinic_finance.contract_sha(clinic_finance.template_text(t)) then raise exception 'النص المعروض لا يطابق النسخة المنشورة؛ حدّث الصفحة'; end if;
  select * into a from clinic_finance.acceptances where kind = 'consent' and doctor_key = k and template_id = t.id;
  if found then return jsonb_build_object('accepted_at', a.decided_at, 'repeated', true); end if;
  sig := clinic_finance.check_signature(p_sig_kind, p_sig_image);
  insert into clinic_finance.acceptances (kind, doctor_key, admin_id, template_id, template_version, text_sha256, decision, user_agent, signature_kind, signature_image, signature_sha256) values ('consent', k, me, t.id, t.version, p_sha, 'accepted', left(coalesce(p_user_agent, ''), 300), p_sig_kind, p_sig_image, sig) returning * into a;
  return jsonb_build_object('accepted_at', a.decided_at, 'repeated', false);
end $$;

-- ---------- public wrappers (PostgREST) ----------
create function public.clinic_finance_contract_signature_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language sql security definer set search_path = pg_catalog, public as $$ select clinic_finance.contract_signature_command(p_action, p_payload, p_token) $$;
create function public.clinic_finance_contract_signature_status() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$ select clinic_finance.contract_signature_status() $$;
create function public.doctor_contract_inbox() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$ select clinic_finance.doctor_contract_inbox() $$;
create function public.doctor_contract_decide(p_request uuid, p_accept boolean, p_reason text, p_sha text, p_user_agent text, p_sig_kind text default null, p_sig_image text default null) returns jsonb language sql security definer set search_path = pg_catalog, public as $$ select clinic_finance.doctor_contract_decide(p_request, p_accept, p_reason, p_sha, p_user_agent, p_sig_kind, p_sig_image) $$;
create function public.doctor_consent_accept(p_template uuid, p_sha text, p_user_agent text, p_sig_kind text default null, p_sig_image text default null) returns jsonb language sql security definer set search_path = pg_catalog, public as $$ select clinic_finance.doctor_consent_accept(p_template, p_sha, p_user_agent, p_sig_kind, p_sig_image) $$;
create function public.clinic_finance_contract_signed_document(p_acceptance uuid) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$ select clinic_finance.contract_signed_document(p_acceptance) $$;

revoke all on function clinic_finance.contract_scope_label(text), clinic_finance.contract_schedule(uuid[]), clinic_finance.template_text(clinic_finance.contract_templates), clinic_finance.contract_render(uuid, text, text, text, jsonb), clinic_finance.contract_sha(text), clinic_finance.current_template(text),
  clinic_finance.request_stale(clinic_finance.signature_requests), clinic_finance.check_signature(text, text), clinic_finance.enforcement_active(text), clinic_finance.doctor_compliance(text), clinic_finance.my_doctor_key(),
  clinic_finance.contract_signature_command(text, jsonb, uuid), clinic_finance.contract_signature_status(), clinic_finance.contract_signed_document(uuid), clinic_finance.doctor_contract_inbox(),
  clinic_finance.doctor_contract_decide(uuid, boolean, text, text, text, text, text), clinic_finance.doctor_consent_accept(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.clinic_finance_contract_signature_command(text, jsonb, uuid), public.clinic_finance_contract_signature_status(), public.clinic_finance_contract_signed_document(uuid), public.doctor_contract_inbox(),
  public.doctor_contract_decide(uuid, boolean, text, text, text, text, text), public.doctor_consent_accept(uuid, text, text, text, text) from public, anon;
grant execute on function public.clinic_finance_contract_signature_command(text, jsonb, uuid), public.clinic_finance_contract_signature_status(), public.clinic_finance_contract_signed_document(uuid), public.doctor_contract_inbox(),
  public.doctor_contract_decide(uuid, boolean, text, text, text, text, text), public.doctor_consent_accept(uuid, text, text, text, text) to authenticated;

commit;
