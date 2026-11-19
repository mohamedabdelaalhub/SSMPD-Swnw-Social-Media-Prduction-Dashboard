-- Shift swaps, second step. Owner decisions 2026-11-15:
--   * a swap is requested at least 24 hours before the first affected shift; an HR manager can file a same-day emergency;
--   * swaps only between people of the same department (استقبال مع استقبال، تمريض مع تمريض);
--   * no "max consecutive days" block;
--   * «يوم بديل»: when a colleague COVERS someone's day (no day back now), the one who covered earns a replacement day off,
--     valid 30 days at most from the covered date, used later with manager approval; unused → it lapses (no pay).
-- New kinds on clinic_people.shift_swaps:
--   cover      : the requester is off on day_a (his working day); the colleague (free that day) works it with his shift.
--                On approval the colleague earns one credit (clinic_people.shift_credits, expires day_a + 30).
--   credit_use : the person who holds a credit takes one of his working days off (day_a ≤ expiry). No colleague step;
--                a different HR manager approves; the oldest valid credit is consumed. Reversal gives it back.
-- Replaces swap_plan / swap_conflict / hr_shift_swap_command / hr_shift_swaps_list from 20261115200000 (same signatures).
-- Rollback: supabase/rollbacks/20261115210000_hr_shift_swap_rules_credit.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.shift_swaps') is null then raise exception 'طبّق hr_shift_swaps أولًا'; end if;
  if to_regclass('clinic_people.shift_credits') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_people.shift_swaps alter column partner_id drop not null;
alter table clinic_people.shift_swaps drop constraint if exists shift_swaps_kind_check;
alter table clinic_people.shift_swaps add constraint shift_swaps_kind_check check (kind in ('same_day', 'cross_day', 'cover', 'credit_use'));
alter table clinic_people.shift_swaps drop constraint if exists shift_swaps_check;
alter table clinic_people.shift_swaps drop constraint if exists shift_swaps_check1;
alter table clinic_people.shift_swaps add constraint shift_swaps_people_check check (
  (kind = 'credit_use' and partner_id is null) or (kind <> 'credit_use' and partner_id is not null and partner_id <> requester_id));
alter table clinic_people.shift_swaps add constraint shift_swaps_days_check check (
  (kind = 'cross_day' and day_b is not null and day_b <> day_a) or (kind <> 'cross_day' and day_b is null));
alter table clinic_people.shift_swaps add column emergency boolean not null default false;

create table clinic_people.shift_credits(
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references clinic_people.people(id),
  earned_swap_id uuid not null unique references clinic_people.shift_swaps(id),
  earned_day date not null,
  expires_on date not null,
  used_swap_id uuid references clinic_people.shift_swaps(id),
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  check (expires_on = earned_day + 30));
alter table clinic_people.shift_credits enable row level security;
revoke all on clinic_people.shift_credits from public, anon, authenticated;

create or replace function clinic_people.swap_plan(s clinic_people.shift_swaps) returns table(person_id uuid, day date, template_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ra record; pa record; rb record; pb record;
begin
  select * into ra from clinic_people.weekly_slot(s.requester_id, s.day_a);
  if not ra.scheduled then raise exception 'لازم يكون لصاحب الطلب جدول ورديات في يوم التبديل'; end if;
  if s.kind = 'credit_use' then
    if ra.template_id is null then raise exception 'اختر يوم شغل لاستخدام اليوم البديل'; end if;
    return query select s.requester_id, s.day_a, null::uuid;
    return;
  end if;
  select * into pa from clinic_people.weekly_slot(s.partner_id, s.day_a);
  if not pa.scheduled then raise exception 'لازم يكون للطرفين جدول ورديات في يوم التبديل'; end if;
  if s.kind = 'same_day' then
    if ra.template_id is not distinct from pa.template_id then raise exception 'نفس الوردية للطرفين؛ لا يوجد ما يُبدَّل'; end if;
    return query select s.requester_id, s.day_a, pa.template_id union all select s.partner_id, s.day_a, ra.template_id;
  elsif s.kind = 'cover' then
    if ra.template_id is null then raise exception 'صاحب الطلب ليس عنده وردية في هذا اليوم'; end if;
    if pa.template_id is not null then raise exception 'الزميل يعمل أصلًا في هذا اليوم'; end if;
    return query select s.requester_id, s.day_a, null::uuid union all select s.partner_id, s.day_a, ra.template_id;
  else
    select * into rb from clinic_people.weekly_slot(s.requester_id, s.day_b);
    select * into pb from clinic_people.weekly_slot(s.partner_id, s.day_b);
    if not rb.scheduled or not pb.scheduled then raise exception 'لازم يكون للطرفين جدول ورديات في اليومين'; end if;
    if ra.template_id is null then raise exception 'طالب التبديل ليس عنده وردية في اليوم الأول'; end if;
    if pb.template_id is null then raise exception 'الزميل ليس عنده وردية في اليوم الثاني'; end if;
    if pa.template_id is not null then raise exception 'الزميل يعمل أصلًا في اليوم الأول'; end if;
    if rb.template_id is not null then raise exception 'طالب التبديل يعمل أصلًا في اليوم الثاني'; end if;
    return query select s.requester_id, s.day_a, null::uuid union all select s.requester_id, s.day_b, pb.template_id
      union all select s.partner_id, s.day_b, null::uuid union all select s.partner_id, s.day_a, ra.template_id;
  end if;
end $$;

create or replace function clinic_people.swap_conflict(s clinic_people.shift_swaps) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from (values (s.requester_id, s.day_a), (s.partner_id, s.day_a), (s.requester_id, s.day_b), (s.partner_id, s.day_b)) v(pid, d)
    where v.d is not null and v.pid is not null and (
      exists (select 1 from clinic_people.shift_overrides o where o.active and o.person_id = v.pid and o.day = v.d)
      or exists (select 1 from clinic_people.shift_swaps x where x.id <> s.id and x.status in ('pending_partner', 'pending_manager', 'approved')
                   and (v.pid = x.requester_id or v.pid = x.partner_id) and (v.d = x.day_a or v.d = x.day_b))))
$$;

-- The earliest shift start (Cairo) the swap touches, before or after it: used for the 24-hour rule.
create function clinic_people.swap_first_start(s clinic_people.shift_swaps) returns timestamptz
language sql stable security definer set search_path = pg_catalog, public as $$
  select min((x.day + t.start_time) at time zone 'Africa/Cairo')
  from (select p.person_id, p.day, p.template_id as tid from clinic_people.swap_plan(s) p
        union all select p.person_id, p.day, (clinic_people.weekly_slot(p.person_id, p.day)).template_id from clinic_people.swap_plan(s) p) x
  join clinic_people.shift_templates t on t.id = x.tid
$$;

create function clinic_people.credit_available(p_person uuid, p_day date) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id from clinic_people.shift_credits c
   where c.person_id = p_person and not c.voided and c.used_swap_id is null and c.expires_on >= p_day and c.earned_day <= p_day
     and c.expires_on >= (now() at time zone 'Africa/Cairo')::date
   order by c.expires_on, c.created_at limit 1
$$;

create or replace function public.hr_shift_swap_command(p_action text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id(); hr boolean := clinic_people.manage();
  today date := (now() at time zone 'Africa/Cairo')::date;
  s clinic_people.shift_swaps%rowtype; v uuid := nullif(p_payload->>'id', '')::uuid; v_note text := btrim(coalesce(p_payload->>'note', ''));
  req clinic_people.people%rowtype; par clinic_people.people%rowtype; n integer; c uuid; first_start timestamptz;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  perform pg_advisory_xact_lock(712261115);

  if p_action = 'request' then
    s.id := gen_random_uuid(); s.kind := p_payload->>'kind';
    if s.kind not in ('same_day', 'cross_day', 'cover', 'credit_use') then raise exception 'اختر نوع التبديل'; end if;
    select * into req from clinic_people.people where id = (p_payload->>'requester_id')::uuid and status <> 'ended' and kind <> 'doctor';
    if req.id is null then raise exception 'اختر موظفًا إداريًا مستمرًا'; end if;
    if s.kind <> 'credit_use' then
      select * into par from clinic_people.people where id = (p_payload->>'partner_id')::uuid and status <> 'ended' and kind <> 'doctor';
      if par.id is null then raise exception 'اختر زميلًا إداريًا مستمرًا'; end if;
      if lower(btrim(coalesce(req.department, ''))) is distinct from lower(btrim(coalesce(par.department, ''))) or btrim(coalesce(req.department, '')) = '' then
        raise exception 'التبديل بين موظفين من نفس القسم فقط'; end if;
    end if;
    if not hr and req.admin_id is distinct from me then raise exception 'تطلب التبديل لنفسك فقط؛ الموارد البشرية تطلبه نيابة عن غيرك'; end if;
    s.requester_id := req.id; s.partner_id := par.id;
    s.day_a := (p_payload->>'day_a')::date; s.day_b := nullif(p_payload->>'day_b', '')::date; s.note := left(v_note, 500);
    s.emergency := coalesce((p_payload->>'emergency')::boolean, false);
    if s.day_a is null then raise exception 'اختر اليوم'; end if;
    if s.kind <> 'cross_day' then s.day_b := null; elsif s.day_b is null or s.day_b = s.day_a then raise exception 'اختر يومين مختلفين'; end if;
    if least(s.day_a, coalesce(s.day_b, s.day_a)) < today - 31 then raise exception 'لا يمكن التبديل في يوم أقدم من 31 يومًا'; end if;
    perform 1 from clinic_people.swap_plan(s);
    first_start := clinic_people.swap_first_start(s);
    if first_start is not null and first_start < now() + interval '24 hours' then
      if not s.emergency then raise exception 'التبديل يُطلب قبل الوردية بـ24 ساعة على الأقل؛ الحالات الطارئة يسجلها مسؤول الموارد البشرية'; end if;
      if not hr then raise exception 'الطلب الطارئ يسجله مسؤول الموارد البشرية فقط'; end if;
    end if;
    if s.kind = 'credit_use' and clinic_people.credit_available(req.id, s.day_a) is null then raise exception 'لا يوجد يوم بديل صالح لهذا التاريخ'; end if;
    if clinic_people.swap_conflict(s) then raise exception 'يوجد تبديل آخر لنفس الشخص في نفس اليوم'; end if;
    insert into clinic_people.shift_swaps(id, kind, requester_id, partner_id, day_a, day_b, note, created_by, emergency, status)
      values (s.id, s.kind, s.requester_id, s.partner_id, s.day_a, s.day_b, s.note, me, s.emergency,
              case when s.kind = 'credit_use' then 'pending_manager' else 'pending_partner' end);
    v := s.id;
    if s.kind <> 'credit_use' then
      perform clinic_people.swap_notify(par.id, case when s.kind = 'cover' then 'طلب تغطية يوم من ' else 'طلب تبديل وردية من ' end || req.full_name
        || ' — يوم ' || s.day_a || coalesce(' و' || s.day_b, '') || '؛ وافق أو ارفض من «حضوري ووردياتي»');
    end if;
  else
    select * into s from clinic_people.shift_swaps where id = v for update;
    if not found then raise exception 'طلب التبديل غير موجود'; end if;
    select * into req from clinic_people.people where id = s.requester_id;
    select * into par from clinic_people.people where id = s.partner_id;

    if p_action = 'respond' then
      if s.status <> 'pending_partner' then raise exception 'الطلب ليس في انتظار موافقة الزميل'; end if;
      if par.admin_id is distinct from me and not (hr and me <> s.created_by) then raise exception 'الرد للزميل نفسه (أو الموارد البشرية نيابة عنه)'; end if;
      update clinic_people.shift_swaps set status = case when (p_payload->>'accept')::boolean then 'pending_manager' else 'declined' end,
        partner_by = me, partner_at = now(), partner_note = left(v_note, 500) where id = v;
      perform clinic_people.swap_notify(req.id, 'رد ' || par.full_name || ' على طلب التبديل: ' || case when (p_payload->>'accept')::boolean then 'موافق — في انتظار اعتماد الإدارة' else 'رفض' end);
    elsif p_action in ('approve', 'reject') then
      if not hr then raise exception 'الاعتماد للموارد البشرية'; end if;
      if s.status <> 'pending_manager' then raise exception 'الطلب ليس في انتظار الاعتماد'; end if;
      if me = s.created_by or me = s.partner_by then raise exception 'الاعتماد لمسؤول آخر غير مقدم الطلب ومن وافق عليه'; end if;
      if length(v_note) < 3 then raise exception 'اكتب سبب القرار'; end if;
      if p_action = 'approve' then
        if clinic_people.swap_conflict(s) then raise exception 'يوجد تبديل آخر معتمد لنفس الشخص في نفس اليوم'; end if;
        if s.kind = 'credit_use' then
          c := clinic_people.credit_available(s.requester_id, s.day_a);
          if c is null then raise exception 'لا يوجد يوم بديل صالح لهذا التاريخ'; end if;
          update clinic_people.shift_credits set used_swap_id = s.id where id = c;
        end if;
        insert into clinic_people.shift_overrides(person_id, day, template_id, swap_id) select x.person_id, x.day, x.template_id, s.id from clinic_people.swap_plan(s) x;
        if s.kind = 'cover' then
          insert into clinic_people.shift_credits(person_id, earned_swap_id, earned_day, expires_on) values (s.partner_id, s.id, s.day_a, s.day_a + 30);
          perform clinic_people.swap_notify(s.partner_id, 'لك يوم بديل عن تغطية يوم ' || s.day_a || ' — صالح حتى ' || (s.day_a + 30));
        end if;
      end if;
      update clinic_people.shift_swaps set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
        decided_by = me, decided_at = now(), decision_note = v_note where id = v;
      perform clinic_people.swap_notify(req.id, 'طلب ' || case s.kind when 'credit_use' then 'اليوم البديل' when 'cover' then 'التغطية' else 'تبديل الوردية' end || ' ' || case when p_action = 'approve' then 'اعتُمد' else 'رُفض' end);
      if s.partner_id is not null then
        perform clinic_people.swap_notify(par.id, 'طلب التبديل مع ' || req.full_name || ' ' || case when p_action = 'approve' then 'اعتُمد' else 'رُفض' end);
      end if;
    elsif p_action = 'cancel' then
      if s.status not in ('pending_partner', 'pending_manager') then raise exception 'يمكن سحب الطلب قبل الاعتماد فقط'; end if;
      if me <> s.created_by and req.admin_id is distinct from me and not hr then raise exception 'السحب لمقدم الطلب أو الموارد البشرية'; end if;
      update clinic_people.shift_swaps set status = 'cancelled', decided_by = me, decided_at = now(), decision_note = left(coalesce(nullif(v_note, ''), 'سحب الطلب'), 500) where id = v;
    elsif p_action = 'reverse' then
      if not hr then raise exception 'إلغاء التبديل المعتمد للموارد البشرية'; end if;
      if s.status <> 'approved' then raise exception 'الطلب غير معتمد'; end if;
      if length(v_note) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
      if s.kind = 'cover' then
        if exists (select 1 from clinic_people.shift_credits where earned_swap_id = s.id and used_swap_id is not null) then
          raise exception 'اليوم البديل الناتج عن هذه التغطية استُخدم؛ ألغِ استخدامه أولًا'; end if;
        update clinic_people.shift_credits set voided = true where earned_swap_id = s.id;
      elsif s.kind = 'credit_use' then
        update clinic_people.shift_credits set used_swap_id = null where used_swap_id = s.id;
      end if;
      update clinic_people.shift_overrides set active = false where swap_id = v and active;
      get diagnostics n = row_count;
      update clinic_people.shift_swaps set status = 'reversed', reversed_by = me, reversed_at = now(), reverse_reason = left(v_note, 500) where id = v;
      perform clinic_people.swap_notify(req.id, 'أُلغي التبديل: ' || left(v_note, 200));
      if s.partner_id is not null then perform clinic_people.swap_notify(par.id, 'أُلغي التبديل: ' || left(v_note, 200)); end if;
    else raise exception 'إجراء غير متاح';
    end if;
  end if;
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (me, 'shift_swap_' || p_action, v, (select to_jsonb(x) from clinic_people.shift_swaps x where x.id = v));
  return v;
end $$;

create or replace function public.hr_shift_swaps_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); hr boolean := clinic_people.manage(); mine uuid; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select id into mine from clinic_people.people where admin_id = me;
  return jsonb_build_object('can_manage', hr, 'me', me, 'my_person_id', mine, 'today', today,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'code', p.code, 'department', p.department) order by p.full_name), '[]'::jsonb)
       from clinic_people.people p where p.status <> 'ended' and p.kind <> 'doctor' and exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id)),
    'swaps', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
        'requester_name', r.full_name, 'partner_name', q.full_name, 'partner_admin', q.admin_id, 'requester_admin', r.admin_id,
        'plan', (select coalesce(jsonb_agg(jsonb_build_object('person_id', o.person_id, 'day', o.day, 'off', o.template_id is null,
                   'shift', (select t.name || ' ' || to_char(t.start_time, 'HH24:MI') || '–' || to_char(t.end_time, 'HH24:MI') from clinic_people.shift_templates t where t.id = o.template_id))
                   order by o.day), '[]'::jsonb) from clinic_people.shift_overrides o where o.swap_id = x.id))
        order by x.created_at desc), '[]'::jsonb)
       from clinic_people.shift_swaps x join clinic_people.people r on r.id = x.requester_id left join clinic_people.people q on q.id = x.partner_id
       where hr or r.admin_id = me or q.admin_id = me),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'person_id', c.person_id, 'full_name', p.full_name, 'earned_day', c.earned_day,
        'expires_on', c.expires_on, 'state', case when c.voided then 'voided' when c.used_swap_id is not null then 'used' when c.expires_on < today then 'expired' else 'available' end)
        order by c.expires_on), '[]'::jsonb)
       from clinic_people.shift_credits c join clinic_people.people p on p.id = c.person_id where hr or p.admin_id = me));
end $$;

revoke all on function clinic_people.swap_first_start(clinic_people.shift_swaps), clinic_people.credit_available(uuid, date) from public, anon, authenticated;

commit;
