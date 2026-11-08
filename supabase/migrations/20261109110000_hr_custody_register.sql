-- HR custody register (سجل العهد) — phase 1 of the offboarding/settlement work (design: offboarding-design-20261109.md, owner decisions 6-ب).
-- A permanent register of items the center hands to people: item, description, value, who holds it now, who it came from, issue date, return date, status.
-- Unreturned custody (with a holder / lost / damaged) is exposed through hr_custody_outstanding(person) so the later settlement (phase 4) can list it and deduct its value.
-- ADDITIVE ONLY: 2 new tables + 1 sequence in clinic_people (RLS on, no policies, no direct grants) and 3 new SECURITY DEFINER functions. Nothing existing is changed.
-- Access: HR managers (clinic_people.manage()) write. Reading all rows: HR managers + accountant / financial_manager roles (read-only, they need it for the settlement).
--         Everyone else sees only the items they hold themselves (their own HR file). Nothing is ever deleted: every change is a movement row + a clinic_people.audit row.
-- Rollback: supabase/rollbacks/20261109110000_hr_custody_register.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.audit') is null then raise exception 'سجل المراجعة للموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.custody_items') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create sequence clinic_people.custody_code;

create table clinic_people.custody_items(
  id uuid primary key default gen_random_uuid(),
  code text not null unique default 'CUS-' || lpad(nextval('clinic_people.custody_code')::text, 6, '0'),
  request_id uuid unique,
  item_name text not null check (length(trim(item_name)) between 2 and 200),
  category text not null default 'other' check (category in ('device', 'keys', 'card', 'tools', 'document', 'other')),
  description text not null default '' check (length(description) <= 2000),
  serial_ref text not null default '' check (length(serial_ref) <= 200),
  value numeric(14, 2) not null default 0 check (value >= 0 and value < 100000000 and value::text not in ('NaN', 'Infinity')),
  status text not null default 'in_store' check (status in ('in_store', 'with_holder', 'lost', 'damaged')),
  holder_id uuid references clinic_people.people(id),
  came_from_id uuid references clinic_people.people(id),
  came_from_note text not null default '' check (length(came_from_note) <= 500),
  issued_on date,
  returned_on date,
  note text not null default '' check (length(note) <= 2000),
  revision integer not null default 1,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'with_holder' or (holder_id is not null and issued_on is not null)),
  check (status <> 'in_store' or holder_id is null),
  check (returned_on is null or issued_on is null or returned_on >= issued_on)
);
create index custody_items_holder on clinic_people.custody_items(holder_id, status);
create index custody_items_status on clinic_people.custody_items(status);

create table clinic_people.custody_movements(
  id bigint generated always as identity primary key,
  item_id uuid not null references clinic_people.custody_items(id),
  action text not null check (action in ('create', 'issue', 'transfer', 'return', 'lost', 'damaged', 'update')),
  from_person_id uuid references clinic_people.people(id),
  to_person_id uuid references clinic_people.people(id),
  on_date date not null,
  note text not null default '',
  actor_id uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
create index custody_movements_item on clinic_people.custody_movements(item_id, id desc);

alter table clinic_people.custody_items enable row level security;
alter table clinic_people.custody_movements enable row level security;
revoke all on clinic_people.custody_items, clinic_people.custody_movements from public, anon, authenticated;
revoke all on sequence clinic_people.custody_code from public, anon, authenticated;

-- who may read the whole register (HR managers + accounting roles); everyone else only sees what they hold
create function clinic_people.custody_view_all() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (clinic_people.manage() or public.has_role('accountant') or public.has_role('financial_manager'))
$$;

create function public.hr_custody_command(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  it clinic_people.custody_items%rowtype;
  hp clinic_people.people%rowtype;
  v uuid := nullif(p_payload->>'id', '')::uuid;
  hid uuid := nullif(p_payload->>'holder_id', '')::uuid;
  rid uuid := nullif(p_payload->>'request_id', '')::uuid;
  act text := p_action;
  nt text := trim(coalesce(p_payload->>'note', ''));
  d date;
  val numeric;
  prior jsonb;
  afterj jsonb;
  mv_from uuid;
  mv_to uuid;
  mv_date date;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'سجل العهد لإدارة الموارد البشرية'; end if;
  if act not in ('create', 'issue', 'transfer', 'return', 'lost', 'damaged', 'update') then raise exception 'إجراء غير متاح'; end if;

  if act = 'create' then
    if rid is not null then select id into v from clinic_people.custody_items where request_id = rid; if found then return v; end if; end if;
    if length(trim(coalesce(p_payload->>'item_name', ''))) < 2 then raise exception 'اكتب اسم البند'; end if;
    val := coalesce(nullif(p_payload->>'value', '')::numeric, 0);
    if val < 0 or val >= 100000000 or val::text in ('NaN', 'Infinity') then raise exception 'راجع قيمة العهدة'; end if;
    insert into clinic_people.custody_items(request_id, item_name, category, description, serial_ref, value, note, created_by)
      values (rid, trim(p_payload->>'item_name'), coalesce(nullif(p_payload->>'category', ''), 'other'), coalesce(p_payload->>'description', ''), coalesce(p_payload->>'serial_ref', ''), val, coalesce(p_payload->>'note', ''), me)
      returning * into it;
    v := it.id;
    insert into clinic_people.custody_movements(item_id, action, on_date, note, actor_id) values (v, 'create', today, nt, me);
    if hid is null then
      insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'custody_create', v, null, to_jsonb(it));
      return v;
    end if;
    -- created together with its first holder: continue as an issue
    act := 'issue';
    prior := to_jsonb(it);
  else
    if v is null then raise exception 'اختر البند'; end if;
    select * into it from clinic_people.custody_items where id = v for update;
    if not found then raise exception 'البند غير موجود'; end if;
    if it.revision <> coalesce((p_payload->>'revision')::int, 0) then raise exception 'البند تغير؛ أعد تحميله قبل الحفظ'; end if;
    prior := to_jsonb(it);
  end if;

  if act = 'issue' or act = 'transfer' then
    if act = 'issue' and it.status <> 'in_store' then raise exception 'البند ليس في المخزن؛ استخدم التحويل أو الإرجاع'; end if;
    if act = 'transfer' and it.status <> 'with_holder' then raise exception 'التحويل من عهدة قائمة فقط'; end if;
    select * into hp from clinic_people.people where id = hid;
    if not found or hp.status = 'ended' then raise exception 'اختر موظفًا مستمرًا في العمل'; end if;
    if hid is not distinct from it.holder_id then raise exception 'البند عند نفس الشخص بالفعل'; end if;
    d := coalesce(nullif(p_payload->>'issued_on', '')::date, today);
    if d > today then raise exception 'تاريخ التسليم لا يكون في المستقبل'; end if;
    mv_from := it.holder_id; mv_to := hid; mv_date := d;
    update clinic_people.custody_items set status = 'with_holder', holder_id = hid, came_from_id = it.holder_id,
      came_from_note = case when it.holder_id is null then coalesce(nullif(trim(p_payload->>'came_from_note'), ''), 'المخزن') else '' end,
      issued_on = d, returned_on = null, revision = revision + 1, updated_at = now() where id = v;
  elsif act = 'return' then
    if it.status = 'in_store' then raise exception 'البند في المخزن بالفعل'; end if;
    d := coalesce(nullif(p_payload->>'returned_on', '')::date, today);
    if d > today then raise exception 'تاريخ الإرجاع لا يكون في المستقبل'; end if;
    if it.issued_on is not null and d < it.issued_on then raise exception 'تاريخ الإرجاع قبل تاريخ التسليم'; end if;
    mv_from := it.holder_id; mv_to := null; mv_date := d;
    update clinic_people.custody_items set status = 'in_store', holder_id = null, came_from_id = it.holder_id, came_from_note = '',
      returned_on = d, revision = revision + 1, updated_at = now() where id = v;
  elsif act in ('lost', 'damaged') then
    if it.status <> 'with_holder' then raise exception 'التسجيل من عهدة قائمة فقط'; end if;
    if length(nt) < 3 then raise exception 'اكتب سبب الفقد أو التلف'; end if;
    mv_from := it.holder_id; mv_to := it.holder_id; mv_date := today;
    update clinic_people.custody_items set status = act, revision = revision + 1, updated_at = now() where id = v;
  elsif act = 'update' then
    if length(trim(coalesce(p_payload->>'item_name', ''))) < 2 then raise exception 'اكتب اسم البند'; end if;
    val := coalesce(nullif(p_payload->>'value', '')::numeric, 0);
    if val < 0 or val >= 100000000 or val::text in ('NaN', 'Infinity') then raise exception 'راجع قيمة العهدة'; end if;
    if val is distinct from it.value and length(nt) < 3 then raise exception 'اكتب سبب تغيير القيمة'; end if;
    mv_from := null; mv_to := null; mv_date := today;
    update clinic_people.custody_items set item_name = trim(p_payload->>'item_name'), category = coalesce(nullif(p_payload->>'category', ''), category),
      description = coalesce(p_payload->>'description', description), serial_ref = coalesce(p_payload->>'serial_ref', serial_ref), value = val,
      note = coalesce(p_payload->>'note', note), revision = revision + 1, updated_at = now() where id = v;
  end if;

  insert into clinic_people.custody_movements(item_id, action, from_person_id, to_person_id, on_date, note, actor_id) values (v, act, mv_from, mv_to, mv_date, nt, me);
  select to_jsonb(c) into afterj from clinic_people.custody_items c where id = v;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'custody_' || p_action, v, prior, afterj);
  return v;
end $$;

-- the register as the caller may see it
create function public.hr_custody_workspace() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); allv boolean := clinic_people.custody_view_all(); mine uuid;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select id into mine from clinic_people.people where admin_id = me;
  return jsonb_build_object(
    'can_manage', clinic_people.manage(), 'can_view_all', allv, 'today', (now() at time zone 'Africa/Cairo')::date,
    'items', (select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object('holder_name', h.full_name, 'holder_code', h.code, 'came_from_name', f.full_name) order by i.created_at desc), '[]'::jsonb)
      from clinic_people.custody_items i left join clinic_people.people h on h.id = i.holder_id left join clinic_people.people f on f.id = i.came_from_id
      where allv or (mine is not null and i.holder_id = mine)),
    'movements', (select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
      select m.id, m.item_id, m.action, m.on_date, m.note, m.created_at, a.full_name as from_name, b.full_name as to_name
      from clinic_people.custody_movements m join clinic_people.custody_items i on i.id = m.item_id
      left join clinic_people.people a on a.id = m.from_person_id left join clinic_people.people b on b.id = m.to_person_id
      where allv or (mine is not null and i.holder_id = mine) order by m.id desc limit 2000) x),
    'people', case when clinic_people.manage() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name) order by p.full_name), '[]'::jsonb) from clinic_people.people p where p.status <> 'ended') else '[]'::jsonb end);
end $$;

-- what a person still owes the center: used by the settlement (phase 4)
create function public.hr_custody_outstanding(p_person uuid) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.custody_view_all() then raise exception 'سجل العهد للموارد البشرية والحسابات'; end if;
  return jsonb_build_object('person_id', p_person,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'item_name', i.item_name, 'category', i.category, 'description', i.description, 'serial_ref', i.serial_ref, 'value', i.value, 'status', i.status, 'issued_on', i.issued_on) order by i.issued_on), '[]'::jsonb)
      from clinic_people.custody_items i where i.holder_id = p_person and i.status in ('with_holder', 'lost', 'damaged')),
    'total_value', (select coalesce(sum(i.value), 0) from clinic_people.custody_items i where i.holder_id = p_person and i.status in ('with_holder', 'lost', 'damaged')));
end $$;

revoke all on function clinic_people.custody_view_all() from public, anon, authenticated;
revoke all on function public.hr_custody_command(text, jsonb), public.hr_custody_workspace(), public.hr_custody_outstanding(uuid) from public, anon;
grant execute on function public.hr_custody_command(text, jsonb), public.hr_custody_workspace(), public.hr_custody_outstanding(uuid) to authenticated;

commit;
