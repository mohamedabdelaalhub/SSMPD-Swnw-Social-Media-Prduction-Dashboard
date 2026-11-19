-- «أجازات المركز الرسمية» (owner 2026-11-15): official holidays when the whole center closes (emergency included) and
-- everyone is off, PAID. Added by HR managers, the general manager or a super admin; takes effect ONLY after a DIFFERENT
-- person (super admin or general manager) approves it. Once approved, for every day in the range:
--   * attendance: clinic_people.attendance_eval reports everyone as 'leave' (excused) → no «غايب» on the live board,
--     reports or the fingerprint sheet (hr_attendance_from_punches only creates on_time/late/absent rows);
--   * payroll: hr_payroll_calculate never counts an absence on a closed day (defence in depth for hand-entered rows);
--   * booking: clinic_reception_command refuses 'book' / 'reschedule' on a closed day (Cairo date);
--   * the reception snapshot returns the approved closures so the timeline shows the day as «أجازة رسمية».
-- Existing bookings on those days are NOT changed: reception sees them and reschedules (center_closure_bookings counts them).
-- Additive: one table, helpers, two RPCs, and wrappers that keep every existing signature.
begin;

do $$ begin
  if to_regclass('clinic_people.audit') is null then raise exception 'جدول تدقيق الموارد البشرية غير موجود'; end if;
  if to_regprocedure('clinic_people.attendance_eval(date, timestamptz)') is null then raise exception 'طبّق shift_schedules أولًا'; end if;
  if to_regclass('clinic_people.center_closures') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.center_closures(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  from_date date not null,
  to_date date not null,
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  review_note text,
  cancelled_by uuid references public.admins(id),
  cancelled_at timestamptz,
  check (to_date >= from_date and to_date - from_date <= 30),
  check (reviewed_by is null or reviewed_by <> created_by)
);
create index center_closures_days on clinic_people.center_closures(from_date, to_date) where status = 'approved';
alter table clinic_people.center_closures enable row level security;
revoke all on clinic_people.center_closures from public, anon, authenticated;

create function clinic_people.center_closed_on(p_day date) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from clinic_people.center_closures c where c.status = 'approved' and p_day between c.from_date and c.to_date)
$$;
revoke all on function clinic_people.center_closed_on(date) from public, anon, authenticated;

create function clinic_people.closure_reviewer() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('general_manager'))
$$;
revoke all on function clinic_people.closure_reviewer() from public, anon, authenticated;

-- List: managers see every request; any other signed-in staff member sees the approved holidays only.
create function public.center_closures(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); m boolean := clinic_people.manage(); rv boolean := clinic_people.closure_reviewer();
begin
  if me is null then raise exception 'سجّل الدخول'; end if;
  return jsonb_build_object('me', me, 'can_add', m, 'can_review', rv, 'closures', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'from_date', c.from_date, 'to_date', c.to_date, 'note', c.note, 'status', c.status,
      'created_by', c.created_by, 'created_by_name', a.name, 'created_at', c.created_at, 'reviewed_by_name', r.name, 'reviewed_at', c.reviewed_at,
      'review_note', c.review_note, 'mine', c.created_by = me) order by c.from_date desc, c.created_at desc)
    from clinic_people.center_closures c left join public.admins a on a.id = c.created_by left join public.admins r on r.id = c.reviewed_by
    where (m or c.status = 'approved') and (p_from is null or c.to_date >= p_from) and (p_to is null or c.from_date <= p_to)), '[]'::jsonb));
end $$;
revoke all on function public.center_closures(date, date) from public, anon;
grant execute on function public.center_closures(date, date) to authenticated;

-- add (HR manager / GM / super admin) → pending; review (GM / super admin, never the creator) → approved | rejected;
-- cancel: a pending request by its creator or a reviewer; an approved holiday by a reviewer only, with a reason.
create function public.center_closure_command(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); c clinic_people.center_closures%rowtype; v_from date; v_to date; v_name text; v_note text; v_ok boolean;
begin
  if me is null then raise exception 'سجّل الدخول'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'طلب غير صالح'; end if;
  if p_action = 'add' then
    if not clinic_people.manage() then raise exception 'إضافة الأجازات للموارد البشرية والمدير العام والسوبر أدمن'; end if;
    v_name := trim(coalesce(p_payload->>'name', '')); v_note := trim(coalesce(p_payload->>'note', ''));
    v_from := nullif(p_payload->>'from_date', '')::date; v_to := coalesce(nullif(p_payload->>'to_date', '')::date, v_from);
    if length(v_name) < 2 then raise exception 'اكتب اسم الأجازة (مثلًا عيد الأضحى)'; end if;
    if v_from is null or v_to < v_from then raise exception 'راجع تاريخ البداية والنهاية'; end if;
    if v_to - v_from > 30 then raise exception 'الأجازة الواحدة لا تزيد عن ٣١ يوم'; end if;
    if exists(select 1 from clinic_people.center_closures x where x.status in ('pending','approved') and x.from_date <= v_to and x.to_date >= v_from) then
      raise exception 'فيه أجازة متسجلة بتتقاطع مع الأيام دي'; end if;
    insert into clinic_people.center_closures(name, from_date, to_date, note, created_by) values (v_name, v_from, v_to, v_note, me) returning * into c;
  elsif p_action in ('review', 'cancel') then
    select * into c from clinic_people.center_closures where id = nullif(p_payload->>'id', '')::uuid for update;
    if not found then raise exception 'الأجازة غير موجودة'; end if;
    v_note := trim(coalesce(p_payload->>'note', ''));
    if p_action = 'review' then
      if not clinic_people.closure_reviewer() then raise exception 'الاعتماد للسوبر أدمن أو المدير العام'; end if;
      if c.created_by = me then raise exception 'لازم شخص تاني غير اللي أضاف الأجازة يعتمدها'; end if;
      if c.status <> 'pending' then raise exception 'الأجازة دي اتراجعت قبل كده'; end if;
      v_ok := coalesce((p_payload->>'approve')::boolean, false);
      if not v_ok and length(v_note) < 2 then raise exception 'اكتب سبب الرفض'; end if;
      if v_ok and exists(select 1 from clinic_people.center_closures x where x.id <> c.id and x.status = 'approved' and x.from_date <= c.to_date and x.to_date >= c.from_date) then
        raise exception 'فيه أجازة معتمدة بتتقاطع مع الأيام دي'; end if;
      update clinic_people.center_closures set status = case when v_ok then 'approved' else 'rejected' end, reviewed_by = me, reviewed_at = now(), review_note = nullif(v_note, '')
        where id = c.id returning * into c;
    else
      if c.status = 'pending' then
        if c.created_by <> me and not clinic_people.closure_reviewer() then raise exception 'إلغاء الطلب لصاحبه أو للسوبر أدمن أو المدير العام'; end if;
      elsif c.status = 'approved' then
        if not clinic_people.closure_reviewer() then raise exception 'إلغاء أجازة معتمدة للسوبر أدمن أو المدير العام'; end if;
        if length(v_note) < 2 then raise exception 'اكتب سبب إلغاء الأجازة'; end if;
      else raise exception 'الأجازة دي مش قابلة للإلغاء'; end if;
      update clinic_people.center_closures set status = 'cancelled', cancelled_by = me, cancelled_at = now(), review_note = coalesce(nullif(v_note, ''), review_note)
        where id = c.id returning * into c;
    end if;
  else raise exception 'إجراء غير متاح'; end if;
  insert into clinic_people.audit(actor_id, action, record_id, after_data) values (me, 'center_closure_' || p_action, c.id, to_jsonb(c));
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;
revoke all on function public.center_closure_command(text, jsonb) from public, anon;
grant execute on function public.center_closure_command(text, jsonb) to authenticated;

-- Bookings already on the closed days (live reception workspaces): counts per day only, no patient data, for managers.
create function public.center_closure_bookings(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c clinic_people.center_closures%rowtype;
begin
  if not clinic_people.manage() then raise exception 'للموارد البشرية والإدارة'; end if;
  select * into c from clinic_people.center_closures where id = p_id;
  if not found then raise exception 'الأجازة غير موجودة'; end if;
  if to_regclass('clinic_reception.appointments') is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', d, 'bookings', n) order by d) from (
    select (a.starts_at at time zone 'Africa/Cairo')::date d, count(*) n
    from clinic_reception.appointments a join clinic_reception.workspaces w on w.id = a.workspace_id and w.mode = 'live'
    where a.status = 'booked' and (a.starts_at at time zone 'Africa/Cairo')::date between c.from_date and c.to_date group by 1) x), '[]'::jsonb);
end $$;
revoke all on function public.center_closure_bookings(uuid) from public, anon;
grant execute on function public.center_closure_bookings(uuid) to authenticated;

-- Attendance: same signature; on an approved holiday everyone is on (excused) leave.
alter function clinic_people.attendance_eval(date, timestamptz) rename to attendance_eval_before_closures;
create function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
  device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.person_id, e.template_id, e.template_name, e.color, e.grace, e.exp_start, e.exp_end, e.device_user_id, e.first_in,
    case when h.closed and e.status not in ('unmapped') then 'leave' else e.status end,
    case when h.closed then 0 else e.late_min end,
    e.since_start,
    case when h.closed then true else e.excused end
  from clinic_people.attendance_eval_before_closures(p_day, p_now) e cross join (select clinic_people.center_closed_on(p_day) as closed) h
$$;
revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;
revoke all on function clinic_people.attendance_eval_before_closures(date, timestamptz) from public, anon, authenticated;

-- Payroll: an approved holiday is never an absence, whatever the attendance row says.
do $$ declare def text; patched text; begin
  if to_regprocedure('public.hr_payroll_calculate(uuid,date)') is null then return; end if;
  def := pg_get_functiondef('public.hr_payroll_calculate(uuid,date)'::regprocedure);
  patched := replace(def, 'and clinic_people.attendance.day between q.from_date and q.to_date))',
    'and clinic_people.attendance.day between q.from_date and q.to_date) and not clinic_people.center_closed_on(clinic_people.attendance.day))');
  if patched = def then raise exception 'Payroll absence filter changed — review before applying'; end if;
  execute patched;
end $$;

-- Booking: refuse book / reschedule on a closed day (Cairo date of starts_at).
do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then return; end if;
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_closures;
  alter function public.command_before_closures(uuid, text, jsonb, uuid) set schema clinic_reception;
  revoke all on function clinic_reception.command_before_closures(uuid, text, jsonb, uuid) from public, anon, authenticated;
  create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
  returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $f$
  declare d date; h text;
  begin
    if p_action in ('book', 'reschedule') and nullif(p_payload->>'starts_at', '') is not null then
      d := ((p_payload->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date;
      select c.name into h from clinic_people.center_closures c where c.status = 'approved' and d between c.from_date and c.to_date limit 1;
      if h is not null then raise exception 'المركز مقفول اليوم ده (أجازة رسمية: %) — اختار يوم تاني', h; end if;
    end if;
    return clinic_reception.command_before_closures(p_workspace, p_action, p_payload, p_token);
  end $f$;
  revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon, authenticated;
  grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
end $$;

-- Reception snapshot: add the approved closures overlapping the period (names and dates only).
do $$ begin
  if to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null then return; end if;
  alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_closures;
  alter function public.snapshot_before_closures(uuid, date, date) set schema clinic_reception;
  revoke all on function clinic_reception.snapshot_before_closures(uuid, date, date) from public, anon, authenticated;
  create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
  returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $f$
  begin
    return clinic_reception.snapshot_before_closures(p_workspace, p_from, p_to) || jsonb_build_object('closures', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'from_date', c.from_date, 'to_date', c.to_date) order by c.from_date)
      from clinic_people.center_closures c where c.status = 'approved' and c.from_date <= p_to and c.to_date >= p_from), '[]'::jsonb));
  end $f$;
  revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon, authenticated;
  grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;
end $$;

commit;
