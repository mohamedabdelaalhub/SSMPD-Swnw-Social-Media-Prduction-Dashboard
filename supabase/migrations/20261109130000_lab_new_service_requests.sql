-- Add a NEW center service straight from a partner-lab test that has no counterpart (lab-link review screen).
-- ADDITIVE ONLY: one new table (clinic_labs.service_requests) + two new public RPCs. No existing function or table is replaced or altered.
-- Rollback: supabase/rollbacks/20261109130000_lab_new_service_requests.rollback.sql
--
-- How it reuses the existing mechanism: the request is created through the SAME service-proposal flow as the price-list workspace
-- (public.price_import_command 'service_propose' / 'service_review' -> clinic_prices.service_proposals), so the maker-checker rule is the
-- existing one: the creator cannot approve, and a written reason is required. Nothing is written to public.pricing_services until a SECOND
-- person approves. On approval the existing review action creates the service (price 0, booking off); this migration then fills ONLY that
-- just-created row's selling price (and the booking setup when staff asked for it) and confirms the link to the lab test.
begin;

do $$ begin
  if to_regclass('clinic_labs.item_links') is null then raise exception 'apply 20261108120000_partner_lab_links first'; end if;
  if to_regclass('clinic_prices.service_proposals') is null or to_regprocedure('public.price_import_command(text,jsonb)') is null then
    raise exception 'the price-list workspace (service proposals) must exist first';
  end if;
  if to_regclass('clinic_labs.service_requests') is not null then raise exception 'already applied'; end if;
end $$;

create table clinic_labs.service_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references clinic_labs.price_items(id) on delete cascade,
  proposal_id uuid not null unique references clinic_prices.service_proposals(id),
  name text not null check (length(trim(name)) between 3 and 200),
  category text not null check (category in ('التحاليل', 'باقي التحاليل')),
  sample text,
  selling_price numeric(14,2) not null check (selling_price > 0 and selling_price <= 10000000),
  cost_price numeric(14,2) check (cost_price is null or cost_price >= 0),   -- partner cost when the request was made (the live cost stays on price_items)
  booking_enabled boolean not null default true,
  note text not null check (length(trim(note)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  service_id uuid references public.pricing_services(id),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  review_note text,
  reviewed_at timestamptz,
  check ((status = 'approved') = (service_id is not null)),
  check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null and length(trim(coalesce(review_note, ''))) >= 3))
);
create unique index service_requests_one_pending on clinic_labs.service_requests (item_id) where status = 'pending';
create index service_requests_item on clinic_labs.service_requests (item_id);
alter table clinic_labs.service_requests enable row level security;
revoke all on clinic_labs.service_requests from public, anon, authenticated;

-- Read: pending requests + the latest decided ones, with names. Same gate as the lab-link screen.
create function public.lab_links_service_requests() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not clinic_labs.manage() then raise exception 'لا تملك مراجعة ربط التحاليل'; end if;
  return jsonb_build_object('me', public.my_admin_id(), 'requests', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', r.item_id, 'name', r.name, 'category', r.category, 'sample', r.sample, 'selling_price', r.selling_price,
        'cost_price', r.cost_price, 'booking_enabled', r.booking_enabled, 'note', r.note, 'status', r.status, 'service_id', r.service_id,
        'created_by', r.created_by, 'created_by_name', a.name, 'created_at', r.created_at, 'reviewed_by_name', b.name, 'review_note', r.review_note, 'reviewed_at', r.reviewed_at)
      order by (r.status = 'pending') desc, r.created_at desc)
    from (select * from clinic_labs.service_requests order by (status = 'pending') desc, created_at desc limit 300) r
    join public.admins a on a.id = r.created_by left join public.admins b on b.id = r.reviewed_by), '[]'));
end $$;

create function public.lab_links_service_command(p_action text, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  v_item uuid := nullif(p_payload->>'item_id', '')::uuid;
  v_req uuid := nullif(p_payload->>'request_id', '')::uuid;
  v_note text := btrim(coalesce(p_payload->>'note', ''));
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_cat text := btrim(coalesce(p_payload->>'category', ''));
  v_price numeric;
  v_cost numeric;
  it clinic_labs.price_items%rowtype;
  r clinic_labs.service_requests%rowtype;
  v_prop uuid;
  sid uuid;
  v_dep text;
  v_min integer;
begin
  if not clinic_labs.manage() then raise exception 'لا تملك مراجعة ربط التحاليل'; end if;
  if me is null then raise exception 'سجّل الدخول أولًا'; end if;
  -- Same lock as the other lab-link decisions: a request cannot race a confirm / no_match on the same list.
  perform pg_advisory_xact_lock(712241108);

  if p_action = 'propose' then
    if v_item is null then raise exception 'اختر التحليل'; end if;
    select * into it from clinic_labs.price_items where id = v_item for update;
    if not found then raise exception 'التحليل غير موجود'; end if;
    if exists (select 1 from clinic_labs.item_links where item_id = v_item and status = 'confirmed') then raise exception 'التحليل مربوط بالفعل بخدمة؛ أعد فتحه أولًا'; end if;
    if exists (select 1 from clinic_labs.service_requests where item_id = v_item and status = 'pending') then raise exception 'يوجد طلب خدمة جديدة معلق لهذا التحليل'; end if;
    if length(v_name) < 3 or length(v_name) > 200 then raise exception 'اسم الخدمة من 3 إلى 200 حرفًا'; end if;
    if v_cat not in ('التحاليل', 'باقي التحاليل') then raise exception 'اختر قسم الخدمة: التحاليل أو باقي التحاليل'; end if;
    if length(v_note) < 3 then raise exception 'اكتب سبب إضافة الخدمة'; end if;
    begin v_price := (p_payload->>'selling_price')::numeric; exception when others then v_price := null; end;
    if v_price is null or v_price <= 0 or v_price > 10000000 or v_price::text in ('NaN', 'Infinity') then raise exception 'أدخل سعر بيع صحيحًا أكبر من صفر'; end if;
    if exists (select 1 from public.pricing_services where lower(btrim(name)) = lower(v_name) and category is not distinct from v_cat) then
      raise exception 'توجد خدمة بنفس الاسم في هذا القسم؛ اربط بها بدل إنشاء خدمة جديدة';
    end if;
    -- A missing partner cost can be filled right here (same rule as set_cost: only when empty), with the request note as the source.
    -- The cost typed in the form belongs to the NEW service (stored on the request). The lab item's own cost is never changed,
    -- except to fill it when it was empty.
    v_cost := it.cost;
    if nullif(p_payload->>'cost', '') is not null then
      begin v_cost := round((p_payload->>'cost')::numeric, 2); exception when others then v_cost := null; end;
      if v_cost is null or v_cost < 0 or v_cost::text in ('NaN', 'Infinity') then raise exception 'التكلفة غير صحيحة'; end if;
    end if;
    if it.cost is null and v_cost is not null then
      update clinic_labs.price_items set cost = v_cost where id = v_item;
      insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'set_cost', v_item, jsonb_build_object('cost', v_cost, 'note', v_note, 'via', 'propose_service'));
    end if;
    -- The existing proposal flow (creator is recorded; a different person must review).
    v_prop := public.price_import_command('service_propose', jsonb_build_object('name', v_name, 'category', v_cat, 'unit', '',
      'note', 'من ربط تحاليل المعمل: ' || it.test_name || coalesce(' / العينة: ' || nullif(btrim(coalesce(p_payload->>'sample', it.sample)), ''), '') || ' — ' || v_note));
    insert into clinic_labs.service_requests(item_id, proposal_id, name, category, sample, selling_price, cost_price, booking_enabled, note, created_by)
    values (v_item, v_prop, v_name, v_cat, nullif(btrim(coalesce(p_payload->>'sample', it.sample)), ''), round(v_price, 2), v_cost, coalesce((p_payload->>'booking_enabled')::boolean, true), v_note, me)
    returning id into v_req;
    insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'service_propose', v_item, jsonb_build_object('request_id', v_req, 'name', v_name, 'selling_price', round(v_price, 2), 'cost', v_cost));
    return jsonb_build_object('ok', true, 'request_id', v_req);

  elsif p_action = 'review' then
    if v_req is null then raise exception 'اختر الطلب'; end if;
    select * into r from clinic_labs.service_requests where id = v_req for update;
    if not found or r.status <> 'pending' then raise exception 'الطلب غير معلق'; end if;
    if r.created_by = me then raise exception 'يلزم مراجع آخر غير من أنشأ الطلب'; end if;
    if length(v_note) < 3 then raise exception 'اكتب سبب القرار'; end if;
    if p_payload->>'decision' not in ('approved', 'rejected') then raise exception 'قرار غير متاح'; end if;
    select * into it from clinic_labs.price_items where id = r.item_id for update;

    if p_payload->>'decision' = 'rejected' then
      perform public.price_import_command('service_review', jsonb_build_object('id', r.proposal_id, 'decision', 'rejected', 'review_note', v_note));
      update clinic_labs.service_requests set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = v_note where id = r.id;
      insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'service_reject', r.item_id, jsonb_build_object('request_id', r.id, 'note', v_note));
      return jsonb_build_object('ok', true, 'status', 'rejected');
    end if;

    if exists (select 1 from clinic_labs.item_links where item_id = r.item_id and status = 'confirmed') then raise exception 'التحليل صار مربوطًا بخدمة أخرى؛ ارفض الطلب'; end if;
    -- 1) the existing review action creates the service (price 0, booking off) and marks the proposal approved.
    perform public.price_import_command('service_review', jsonb_build_object('id', r.proposal_id, 'decision', 'approved', 'review_note', v_note));
    select service_id into sid from clinic_prices.service_proposals where id = r.proposal_id;
    if sid is null then raise exception 'تعذر إنشاء الخدمة'; end if;
    -- 2) fill ONLY the row that was just created (still price 0): selling price, and booking setup copied from the most common lab setup.
    if r.booking_enabled then
      select booking_department, booking_minutes into v_dep, v_min from public.pricing_services
       where category = r.category and booking_enabled and booking_department is not null and booking_minutes is not null
       group by booking_department, booking_minutes order by count(*) desc limit 1;
    end if;
    update public.pricing_services set base_price = r.selling_price,
      booking_enabled = r.booking_enabled,
      booking_code = case when r.booking_enabled then canonical_code end,
      booking_department = case when r.booking_enabled then coalesce(v_dep, r.category) end,
      booking_minutes = case when r.booking_enabled then coalesce(v_min, 15) end
     where id = sid and base_price = 0;
    if not found then raise exception 'تعذر ضبط سعر الخدمة الجديدة'; end if;
    -- 3) link the lab test to the new service (replaces a previous "no counterpart" decision), recorded under the approver.
    delete from clinic_labs.item_links where item_id = r.item_id and status = 'no_match';
    insert into clinic_labs.item_links(item_id, service_id, status, confidence, suggested_by, reviewed_by, reviewed_at, review_note)
    values (r.item_id, sid, 'confirmed', 'none', 'new-service', me, now(), 'خدمة جديدة أُضيفت من هذا التحليل — ' || v_note);
    update clinic_labs.service_requests set status = 'approved', service_id = sid, reviewed_by = me, reviewed_at = now(), review_note = v_note where id = r.id;
    insert into clinic_labs.audit(actor_id, action, item_id, details) values (me, 'service_approve', r.item_id, jsonb_build_object('request_id', r.id, 'service_id', sid, 'selling_price', r.selling_price, 'note', v_note));
    return jsonb_build_object('ok', true, 'status', 'approved', 'service_id', sid);
  end if;
  raise exception 'إجراء غير متاح';
end $$;

revoke all on function public.lab_links_service_requests(), public.lab_links_service_command(text, jsonb) from public, anon;
grant execute on function public.lab_links_service_requests(), public.lab_links_service_command(text, jsonb) to authenticated;

commit;
