-- HR «تبديل وردية» (shift swap). Owner approval 2026-11-15 («موافق» in the main chat).
-- Flow: request (the employee, or HR on their behalf) → the colleague accepts/declines (or HR on behalf of a colleague
-- without an account) → an HR manager approves/rejects. The approver must be neither the requester (created_by) nor the
-- person who accepted (four eyes) → it applies. Cancel while pending; reverse after approval with a reason. Audited.
--   same_day : on day A the two people exchange their shift times.
--   cross_day: «I work your day, you work mine» — the requester is off on day A (his working day) and works day B with the
--              colleague's shift; the colleague is off on day B (her working day) and works day A with the requester's shift.
-- Applying = per-day overrides (clinic_people.shift_overrides) that win over the weekly person_shifts for that date only.
-- clinic_people.attendance_eval (single source for the live board, the reports and hr_attendance_from_punches) now reads the
-- overrides: a person off because of a swap shows as leave «إجازة بتبديل» (never absent, no deduction, no attendance row);
-- a person working an extra day is scheduled with that day's shift. Fingerprint punches stay the source of actual times.
-- attendance_eval keeps its exact signature; its body = 20261113100000 + the override step (drift-check before applying).
-- Rollback: supabase/rollbacks/20261115200000_hr_shift_swaps.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.person_shifts') is null then raise exception 'طبّق shift_schedules أولًا'; end if;
  if to_regclass('clinic_people.shift_swaps') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.shift_swaps(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('same_day', 'cross_day')),
  requester_id uuid not null references clinic_people.people(id),
  partner_id uuid not null references clinic_people.people(id),
  day_a date not null,
  day_b date,
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending_partner'
    check (status in ('pending_partner', 'pending_manager', 'approved', 'declined', 'rejected', 'cancelled', 'reversed')),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  partner_by uuid references public.admins(id), partner_at timestamptz, partner_note text,
  decided_by uuid references public.admins(id), decided_at timestamptz, decision_note text,
  reversed_by uuid references public.admins(id), reversed_at timestamptz, reverse_reason text,
  check (requester_id <> partner_id),
  check ((kind = 'same_day' and day_b is null) or (kind = 'cross_day' and day_b is not null and day_b <> day_a)));
create index shift_swaps_people on clinic_people.shift_swaps(requester_id, partner_id, status);

create table clinic_people.shift_overrides(
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references clinic_people.people(id),
  day date not null,
  template_id uuid references clinic_people.shift_templates(id),   -- null = off that day because of the swap
  swap_id uuid not null references clinic_people.shift_swaps(id),
  active boolean not null default true,
  created_at timestamptz not null default now());
create unique index shift_overrides_one_active on clinic_people.shift_overrides(person_id, day) where active;

alter table clinic_people.shift_swaps enable row level security;
alter table clinic_people.shift_overrides enable row level security;
revoke all on clinic_people.shift_swaps, clinic_people.shift_overrides from public, anon, authenticated;

-- The weekly slot of a person on a date: scheduled = has a weekly pattern that day; template_id null = weekly day off.
create function clinic_people.weekly_slot(p_person uuid, p_day date, out scheduled boolean, out template_id uuid)
language sql stable security definer set search_path = pg_catalog, public as $$
  select count(x.*) > 0, max(x.template_id::text)::uuid from (
    select ps.template_id from clinic_people.person_shifts ps
     where ps.person_id = p_person and ps.dow = extract(dow from p_day)::int and ps.valid_from <= p_day and (ps.valid_to is null or ps.valid_to >= p_day)
     order by ps.valid_from desc, ps.id desc limit 1) x
$$;

-- Same as 20261113100000, plus: active swap overrides win over the weekly pattern for that date.
create or replace function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
  device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with wk as (
    select distinct on (ps.person_id) ps.person_id, ps.template_id
    from clinic_people.person_shifts ps
    join clinic_people.people p on p.id = ps.person_id and p.status <> 'ended' and p.kind <> 'doctor'
    where ps.dow = extract(dow from p_day)::int and ps.valid_from <= p_day and (ps.valid_to is null or ps.valid_to >= p_day)
    order by ps.person_id, ps.valid_from desc, ps.id desc),
  ov as (
    select o.person_id, o.template_id
    from clinic_people.shift_overrides o
    join clinic_people.people p on p.id = o.person_id and p.status <> 'ended' and p.kind <> 'doctor'
    where o.day = p_day and o.active),
  pat as (
    select coalesce(ov.person_id, wk.person_id) as person_id,
      (ov.person_id is not null and ov.template_id is null) as swap_off,
      case when ov.person_id is null then wk.template_id
           when ov.template_id is null then wk.template_id      -- off by swap: keep his usual times for display
           else ov.template_id end as template_id
    from wk full join ov on ov.person_id = wk.person_id),
  sched as (
    select pat.person_id, pat.swap_off, t.id as template_id,
      case when pat.swap_off then 'إجازة بتبديل' else t.name end as template_name, t.color, t.grace_minutes as grace,
      ((p_day + t.start_time) at time zone 'Africa/Cairo') as exp_start,
      ((p_day + t.end_time + case when t.end_time <= t.start_time then interval '1 day' else interval '0' end) at time zone 'Africa/Cairo') as exp_end
    from pat join clinic_people.shift_templates t on t.id = pat.template_id),
  joined as (
    select s.*, m.device_user_id,
      (select min(d.ts) from clinic_people.device_punches d
        where d.device_id = m.device_id and d.device_user_id = m.device_user_id and d.punch in (0, 3, 4)
          and d.ts between s.exp_start - interval '3 hours' and s.exp_end) as first_in
    from sched s left join clinic_people.device_user_map m on m.person_id = s.person_id),
  lv as (
    select r.person_id, bool_or(r.kind = 'leave') as leave, bool_or(r.kind = 'permission') as perm
    from clinic_people.requests r
    where r.status = 'approved' and r.kind in ('leave', 'permission') and p_day between r.from_date and r.to_date
    group by r.person_id)
  select j.person_id, j.template_id, j.template_name, j.color, j.grace, j.exp_start, j.exp_end, j.device_user_id, j.first_in,
    case
      when j.swap_off then 'leave'
      when coalesce(lv.leave, false) then 'leave'
      when j.device_user_id is null then 'unmapped'
      when j.first_in is not null then case when j.first_in > j.exp_start + make_interval(mins => j.grace) then 'late' else 'on_time' end
      when p_now < j.exp_start then 'upcoming'
      when p_now <= j.exp_start + make_interval(mins => j.grace) then 'waiting'
      else 'absent' end,
    case when not j.swap_off and j.first_in is not null and j.first_in > j.exp_start then floor(extract(epoch from (j.first_in - j.exp_start)) / 60)::integer else 0 end,
    case when p_now > j.exp_start then floor(extract(epoch from (p_now - j.exp_start)) / 60)::integer else null end,
    coalesce(lv.perm, false)
  from joined j left join lv on lv.person_id = j.person_id
$$;

-- The overrides a swap would write: (person, day, template or null = off). Validates the weekly slots.
create function clinic_people.swap_plan(s clinic_people.shift_swaps) returns table(person_id uuid, day date, template_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ra record; pa record; rb record; pb record;
begin
  select * into ra from clinic_people.weekly_slot(s.requester_id, s.day_a);
  select * into pa from clinic_people.weekly_slot(s.partner_id, s.day_a);
  if not ra.scheduled or not pa.scheduled then raise exception 'لازم يكون للطرفين جدول ورديات في يوم التبديل'; end if;
  if s.kind = 'same_day' then
    if ra.template_id is not distinct from pa.template_id then raise exception 'نفس الوردية للطرفين؛ لا يوجد ما يُبدَّل'; end if;
    return query select s.requester_id, s.day_a, pa.template_id union all select s.partner_id, s.day_a, ra.template_id;
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

create function clinic_people.swap_conflict(s clinic_people.shift_swaps) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from (values (s.requester_id, s.day_a), (s.partner_id, s.day_a), (s.requester_id, s.day_b), (s.partner_id, s.day_b)) v(pid, d)
    where v.d is not null and (
      exists (select 1 from clinic_people.shift_overrides o where o.active and o.person_id = v.pid and o.day = v.d)
      or exists (select 1 from clinic_people.shift_swaps x where x.id <> s.id and x.status in ('pending_partner', 'pending_manager', 'approved')
                   and v.pid in (x.requester_id, x.partner_id) and v.d in (x.day_a, x.day_b))))
$$;

create function clinic_people.swap_notify(p_person uuid, p_message text) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into public.task_notifications(recipient_id, task_id, kind, message)
  select p.admin_id, null, 'status', p_message from clinic_people.people p join public.admins a on a.id = p.admin_id and a.active where p.id = p_person
$$;

create function public.hr_shift_swap_command(p_action text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id(); hr boolean := clinic_people.manage();
  today date := (now() at time zone 'Africa/Cairo')::date;
  s clinic_people.shift_swaps%rowtype; v uuid := nullif(p_payload->>'id', '')::uuid; v_note text := btrim(coalesce(p_payload->>'note', ''));
  req clinic_people.people%rowtype; par clinic_people.people%rowtype; n integer;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  perform pg_advisory_xact_lock(712261115);

  if p_action = 'request' then
    select * into req from clinic_people.people where id = (p_payload->>'requester_id')::uuid and status <> 'ended' and kind <> 'doctor';
    select * into par from clinic_people.people where id = (p_payload->>'partner_id')::uuid and status <> 'ended' and kind <> 'doctor';
    if req.id is null or par.id is null then raise exception 'اختر موظفين إداريين مستمرين'; end if;
    if not hr and req.admin_id is distinct from me then raise exception 'تطلب التبديل لنفسك فقط؛ الموارد البشرية تطلبه نيابة عن غيرك'; end if;
    s.id := gen_random_uuid(); s.kind := p_payload->>'kind'; s.requester_id := req.id; s.partner_id := par.id;
    s.day_a := (p_payload->>'day_a')::date; s.day_b := nullif(p_payload->>'day_b', '')::date; s.note := left(v_note, 500);
    if s.kind not in ('same_day', 'cross_day') or s.day_a is null then raise exception 'اختر نوع التبديل واليوم'; end if;
    if s.kind = 'same_day' then s.day_b := null; elsif s.day_b is null or s.day_b = s.day_a then raise exception 'اختر يومين مختلفين'; end if;
    if least(s.day_a, coalesce(s.day_b, s.day_a)) < today - 31 then raise exception 'لا يمكن التبديل في يوم أقدم من 31 يومًا'; end if;
    perform 1 from clinic_people.swap_plan(s);                       -- validates the weekly slots
    if clinic_people.swap_conflict(s) then raise exception 'يوجد تبديل آخر لنفس الشخص في نفس اليوم'; end if;
    insert into clinic_people.shift_swaps(id, kind, requester_id, partner_id, day_a, day_b, note, created_by)
      values (s.id, s.kind, s.requester_id, s.partner_id, s.day_a, s.day_b, s.note, me);
    v := s.id;
    perform clinic_people.swap_notify(par.id, 'طلب تبديل وردية من ' || req.full_name || ' — يوم ' || s.day_a || coalesce(' و' || s.day_b, '') || '؛ وافق أو ارفض من «حضوري ووردياتي»');
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
      perform clinic_people.swap_notify(req.id, 'رد ' || par.full_name || ' على طلب تبديل الوردية: ' || case when (p_payload->>'accept')::boolean then 'موافق — في انتظار اعتماد الإدارة' else 'رفض' end);
    elsif p_action in ('approve', 'reject') then
      if not hr then raise exception 'الاعتماد للموارد البشرية'; end if;
      if s.status <> 'pending_manager' then raise exception 'الطلب ليس في انتظار الاعتماد'; end if;
      if me = s.created_by or me = s.partner_by then raise exception 'الاعتماد لمسؤول آخر غير مقدم الطلب ومن وافق عليه'; end if;
      if length(v_note) < 3 then raise exception 'اكتب سبب القرار'; end if;
      if p_action = 'approve' then
        if clinic_people.swap_conflict(s) then raise exception 'يوجد تبديل آخر معتمد لنفس الشخص في نفس اليوم'; end if;
        insert into clinic_people.shift_overrides(person_id, day, template_id, swap_id) select x.person_id, x.day, x.template_id, s.id from clinic_people.swap_plan(s) x;
      end if;
      update clinic_people.shift_swaps set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
        decided_by = me, decided_at = now(), decision_note = v_note where id = v;
      perform clinic_people.swap_notify(req.id, 'طلب تبديل الوردية ' || case when p_action = 'approve' then 'اعتُمد' else 'رُفض' end);
      perform clinic_people.swap_notify(par.id, 'طلب تبديل الوردية مع ' || req.full_name || ' ' || case when p_action = 'approve' then 'اعتُمد' else 'رُفض' end);
    elsif p_action = 'cancel' then
      if s.status not in ('pending_partner', 'pending_manager') then raise exception 'يمكن سحب الطلب قبل الاعتماد فقط'; end if;
      if me <> s.created_by and req.admin_id is distinct from me and not hr then raise exception 'السحب لمقدم الطلب أو الموارد البشرية'; end if;
      update clinic_people.shift_swaps set status = 'cancelled', decided_by = me, decided_at = now(), decision_note = left(coalesce(nullif(v_note, ''), 'سحب الطلب'), 500) where id = v;
    elsif p_action = 'reverse' then
      if not hr then raise exception 'إلغاء التبديل المعتمد للموارد البشرية'; end if;
      if s.status <> 'approved' then raise exception 'الطلب غير معتمد'; end if;
      if length(v_note) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
      update clinic_people.shift_overrides set active = false where swap_id = v and active;
      get diagnostics n = row_count;
      update clinic_people.shift_swaps set status = 'reversed', reversed_by = me, reversed_at = now(), reverse_reason = left(v_note, 500) where id = v;
      perform clinic_people.swap_notify(req.id, 'أُلغي تبديل الوردية: ' || left(v_note, 200));
      perform clinic_people.swap_notify(par.id, 'أُلغي تبديل الوردية: ' || left(v_note, 200));
    else raise exception 'إجراء غير متاح';
    end if;
  end if;
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (me, 'shift_swap_' || p_action, v, (select to_jsonb(x) from clinic_people.shift_swaps x where x.id = v));
  return v;
end $$;

-- What the screen shows: HR managers see every swap; an employee sees the swaps he is part of. Includes the plan preview.
create function public.hr_shift_swaps_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); hr boolean := clinic_people.manage(); mine uuid;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select id into mine from clinic_people.people where admin_id = me;
  return jsonb_build_object('can_manage', hr, 'me', me, 'my_person_id', mine,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'code', p.code, 'department', p.department) order by p.full_name), '[]'::jsonb)
       from clinic_people.people p where p.status <> 'ended' and p.kind <> 'doctor' and exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id)),
    'swaps', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
        'requester_name', r.full_name, 'partner_name', q.full_name, 'partner_admin', q.admin_id, 'requester_admin', r.admin_id,
        'plan', (select coalesce(jsonb_agg(jsonb_build_object('person_id', o.person_id, 'day', o.day, 'off', o.template_id is null,
                   'shift', (select t.name || ' ' || to_char(t.start_time, 'HH24:MI') || '–' || to_char(t.end_time, 'HH24:MI') from clinic_people.shift_templates t where t.id = o.template_id))
                   order by o.day), '[]'::jsonb) from clinic_people.shift_overrides o where o.swap_id = x.id))
        order by x.created_at desc), '[]'::jsonb)
       from clinic_people.shift_swaps x join clinic_people.people r on r.id = x.requester_id join clinic_people.people q on q.id = x.partner_id
       where hr or r.admin_id = me or q.admin_id = me));
end $$;

revoke all on function clinic_people.weekly_slot(uuid, date), clinic_people.swap_plan(clinic_people.shift_swaps),
  clinic_people.swap_conflict(clinic_people.shift_swaps), clinic_people.swap_notify(uuid, text) from public, anon, authenticated;
revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;
revoke all on function public.hr_shift_swap_command(text, jsonb), public.hr_shift_swaps_list() from public, anon;
grant execute on function public.hr_shift_swap_command(text, jsonb), public.hr_shift_swaps_list() to authenticated;

commit;
