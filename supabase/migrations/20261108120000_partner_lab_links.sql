-- Partner-lab price items + staff-reviewed links to the center's lab services (Phase 3 / lab link review).
-- ADDITIVE ONLY: new schema clinic_labs, two public RPCs. Nothing existing is altered. Rollback: supabase/rollbacks/20261108120000_partner_lab_links.rollback.sql
-- Access: same gate as the price-list workspace (clinic_prices.manage()). Every decision is recorded per user; nothing is auto-confirmed.
begin;

create schema if not exists clinic_labs;
revoke all on schema clinic_labs from public, anon, authenticated;

-- One row per imported price list of a partner lab (e.g. "Dream 2024 Lab to Lab", version 1).
create table clinic_labs.price_versions (
  id uuid primary key default gen_random_uuid(),
  lab_name text not null check (length(trim(lab_name)) >= 2),
  source_name text not null check (length(trim(source_name)) >= 2),
  version integer not null check (version > 0),
  note text not null default '',
  imported_at timestamptz not null default now(),
  unique (lab_name, version)
);

-- cost = what the partner lab charges the center (NOT the center's selling price). NULL = the source had no price: staff must fill it.
create table clinic_labs.price_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references clinic_labs.price_versions(id) on delete cascade,
  source_row integer not null,
  test_name text not null check (length(trim(test_name)) > 0),
  sample text,
  turnaround text,
  cost numeric(14,2) check (cost is null or (cost >= 0 and cost::text not in ('NaN', 'Infinity'))),
  import_flag text,
  unique (version_id, source_row)
);
create index price_items_version on clinic_labs.price_items (version_id);

-- Candidate / decision rows. 'suggested' rows come from the matcher (several per test, ranked); the other states are human decisions.
create table clinic_labs.item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references clinic_labs.price_items(id) on delete cascade,
  service_id uuid references public.pricing_services(id),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected', 'no_match')),
  confidence text not null default 'none' check (confidence in ('high', 'medium', 'low', 'none')),
  score numeric(5, 4) check (score is null or score between 0 and 1),
  rank integer check (rank is null or rank > 0),
  suggested_by text not null default 'manual',
  match_note text,
  reviewed_by uuid references public.admins(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'no_match') = (service_id is null)),
  check (status = 'suggested' or (reviewed_by is not null and reviewed_at is not null))
);
create unique index item_links_pair on clinic_labs.item_links (item_id, service_id) where service_id is not null;
create unique index item_links_one_confirmed on clinic_labs.item_links (item_id) where status = 'confirmed';
create unique index item_links_one_no_match on clinic_labs.item_links (item_id) where status = 'no_match';
create index item_links_service on clinic_labs.item_links (service_id) where status = 'confirmed';

create table clinic_labs.audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.admins(id),
  action text not null,
  item_id uuid references clinic_labs.price_items(id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table clinic_labs.price_versions enable row level security;
alter table clinic_labs.price_items enable row level security;
alter table clinic_labs.item_links enable row level security;
alter table clinic_labs.audit enable row level security;
revoke all on all tables in schema clinic_labs from public, anon, authenticated;

create function clinic_labs.manage() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_prices.manage()
$$;

-- Latest confirmed partner cost for a center service (used later by lab profit reports). NULL when no confirmed link or cost.
create function clinic_labs.service_cost(p_service uuid) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select i.cost from clinic_labs.item_links l
    join clinic_labs.price_items i on i.id = l.item_id
    join clinic_labs.price_versions v on v.id = i.version_id
   where l.service_id = p_service and l.status = 'confirmed' and i.cost is not null
   order by v.version desc, l.reviewed_at desc limit 1
$$;

create function public.lab_links_workspace(p_version uuid default null) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v clinic_labs.price_versions%rowtype;
begin
  if not clinic_labs.manage() then raise exception 'لا تملك مراجعة ربط التحاليل'; end if;
  if p_version is null then
    select * into v from clinic_labs.price_versions order by imported_at desc, version desc limit 1;
  else
    select * into v from clinic_labs.price_versions where id = p_version;
  end if;
  return jsonb_build_object(
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'lab_name', x.lab_name, 'source_name', x.source_name, 'version', x.version, 'imported_at', x.imported_at) order by x.imported_at desc), '[]') from clinic_labs.price_versions x),
    'version', to_jsonb(v),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'source_row', i.source_row, 'test_name', i.test_name, 'sample', i.sample, 'turnaround', i.turnaround, 'cost', i.cost, 'import_flag', i.import_flag,
        'links', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'service_id', l.service_id, 'status', l.status, 'confidence', l.confidence, 'score', l.score, 'rank', l.rank,
              'suggested_by', l.suggested_by, 'match_note', l.match_note, 'reviewed_by', l.reviewed_by, 'review_note', l.review_note, 'reviewed_at', l.reviewed_at) order by l.rank nulls last, l.created_at), '[]')
              from clinic_labs.item_links l where l.item_id = i.id)
      ) order by i.source_row), '[]') from clinic_labs.price_items i where i.version_id = v.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'base_price', s.base_price, 'code', s.canonical_code, 'category', s.category) order by s.name), '[]')
                   from public.pricing_services s where s.active and s.category in ('التحاليل', 'باقي التحاليل')),
    'reviewers', (select coalesce(jsonb_object_agg(a.id, a.name), '{}') from public.admins a where a.id in (select reviewed_by from clinic_labs.item_links where reviewed_by is not null))
  );
end $$;

create function public.lab_links_command(p_action text, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  v_item uuid := nullif(p_payload->>'item_id', '')::uuid;
  v_service uuid := nullif(p_payload->>'service_id', '')::uuid;
  note text := trim(coalesce(p_payload->>'note', ''));
  it clinic_labs.price_items%rowtype;
  l clinic_labs.item_links%rowtype;
  ids uuid[];
  n integer := 0;
  m integer := 0;
  skipped jsonb := '[]';
  r record;
begin
  if not clinic_labs.manage() then raise exception 'لا تملك مراجعة ربط التحاليل'; end if;
  -- Decisions on the same list are serialized, like price-list approval.
  perform pg_advisory_xact_lock(712241108);

  if p_action = 'bulk_confirm' then
    if jsonb_typeof(p_payload->'item_ids') is distinct from 'array' or jsonb_array_length(p_payload->'item_ids') = 0 or jsonb_array_length(p_payload->'item_ids') > 200 then
      raise exception 'اختر من 1 إلى 200 تحليلًا للتأكيد الجماعي';
    end if;
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(p_payload->'item_ids') x;
    for r in select i.id item_id, i.test_name from clinic_labs.price_items i where i.id = any(ids) order by i.source_row for update loop
      select * into l from clinic_labs.item_links where item_id = r.item_id and status = 'suggested' and rank = 1 and confidence = 'high';
      if not found or exists (select 1 from clinic_labs.item_links where item_id = r.item_id and status in ('confirmed', 'no_match')) then
        skipped := skipped || jsonb_build_array(jsonb_build_object('item_id', r.item_id, 'reason', 'ليس تطابقًا عالي الثقة معلقًا'));
        continue;
      end if;
      if not exists (select 1 from public.pricing_services where id = l.service_id and active) then
        skipped := skipped || jsonb_build_array(jsonb_build_object('item_id', r.item_id, 'reason', 'الخدمة غير نشطة'));
        continue;
      end if;
      update clinic_labs.item_links set status = 'confirmed', reviewed_by = me, reviewed_at = now(), review_note = coalesce(nullif(note, ''), 'تأكيد جماعي لتطابق عالي الثقة') where id = l.id;
      insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'bulk_confirm', r.item_id, jsonb_build_object('link_id', l.id, 'service_id', l.service_id, 'score', l.score));
      n := n + 1;
    end loop;
    return jsonb_build_object('confirmed', n, 'skipped', skipped);
  end if;

  if v_item is null then raise exception 'اختر التحليل'; end if;
  select * into it from clinic_labs.price_items where id = v_item for update;
  if not found then raise exception 'التحليل غير موجود'; end if;

  if p_action in ('confirm', 'choose') then
    if v_service is null then raise exception 'اختر خدمة المركز'; end if;
    if not exists (select 1 from public.pricing_services where id = v_service and active) then raise exception 'خدمة المركز غير نشطة أو غير موجودة'; end if;
    if exists (select 1 from clinic_labs.item_links where item_id = v_item and status = 'confirmed') then raise exception 'التحليل مربوط بالفعل؛ أعد فتحه أولًا'; end if;
    if exists (select 1 from clinic_labs.item_links where item_id = v_item and status = 'no_match') then raise exception 'التحليل مسجل بلا مقابل؛ أعد فتحه أولًا'; end if;
    select * into l from clinic_labs.item_links where item_id = v_item and service_id = v_service for update;
    if p_action = 'choose' and length(note) < 3 then raise exception 'اكتب سبب اختيار هذه الخدمة'; end if;
    if p_action = 'confirm' and (not found or l.status <> 'suggested') then raise exception 'اقتراح غير معلق؛ استخدم اختيار خدمة أخرى'; end if;
    if found then
      update clinic_labs.item_links set status = 'confirmed', reviewed_by = me, reviewed_at = now(), review_note = nullif(note, '') where id = l.id;
    else
      insert into clinic_labs.item_links(item_id, service_id, status, confidence, suggested_by, reviewed_by, reviewed_at, review_note)
      values (v_item, v_service, 'confirmed', 'none', 'manual', me, now(), note);
    end if;
  elsif p_action = 'reject' then
    if length(note) < 3 then raise exception 'اكتب سبب رفض الاقتراح'; end if;
    select * into l from clinic_labs.item_links where item_id = v_item and service_id = v_service for update;
    if not found or l.status <> 'suggested' then raise exception 'لا يوجد اقتراح معلق لرفضه'; end if;
    update clinic_labs.item_links set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = note where id = l.id;
  elsif p_action = 'restore' then
    select * into l from clinic_labs.item_links where item_id = v_item and service_id = v_service and status = 'rejected' for update;
    if not found then raise exception 'لا يوجد اقتراح مرفوض لاسترجاعه'; end if;
    update clinic_labs.item_links set status = 'suggested', reviewed_by = null, reviewed_at = null, review_note = null where id = l.id;
  elsif p_action = 'no_match' then
    if length(note) < 3 then raise exception 'اكتب سبب عدم وجود مقابل'; end if;
    if exists (select 1 from clinic_labs.item_links where item_id = v_item and status = 'confirmed') then raise exception 'التحليل مربوط بالفعل؛ أعد فتحه أولًا'; end if;
    insert into clinic_labs.item_links(item_id, status, suggested_by, reviewed_by, reviewed_at, review_note)
    values (v_item, 'no_match', 'manual', me, now(), note) on conflict (item_id) where status = 'no_match' do update set reviewed_by = me, reviewed_at = now(), review_note = note;
  elsif p_action = 'reopen' then
    if length(note) < 3 then raise exception 'اكتب سبب إعادة الفتح'; end if;
    update clinic_labs.item_links set status = 'suggested', reviewed_by = null, reviewed_at = null, review_note = null where item_id = v_item and status = 'confirmed';
    get diagnostics n = row_count;
    delete from clinic_labs.item_links where item_id = v_item and status = 'no_match';
    get diagnostics m = row_count;
    if n + m = 0 then raise exception 'لا يوجد قرار لإعادة فتحه'; end if;
  elsif p_action = 'set_cost' then
    if it.cost is not null then raise exception 'التكلفة مسجلة؛ التعديل يتم باستيراد إصدار جديد'; end if;
    if length(note) < 3 or (p_payload->>'cost')::numeric is null or (p_payload->>'cost')::numeric < 0 or (p_payload->>'cost')::numeric::text in ('NaN', 'Infinity') then raise exception 'أدخل تكلفة صحيحة وسبب التسجيل'; end if;
    update clinic_labs.price_items set cost = round((p_payload->>'cost')::numeric, 2) where id = v_item;
  else
    raise exception 'إجراء غير متاح';
  end if;

  insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, p_action, v_item, p_payload);
  return jsonb_build_object('ok', true, 'item_id', v_item);
end $$;

revoke all on all functions in schema clinic_labs from public, anon, authenticated;
revoke all on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) from public, anon;
grant execute on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) to authenticated;

commit;
