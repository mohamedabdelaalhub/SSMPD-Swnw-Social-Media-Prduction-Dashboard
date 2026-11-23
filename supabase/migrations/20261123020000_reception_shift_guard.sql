-- «وردية الخزينة — قفل بعد ساعة» (owner 2026-11-23 «طبقه» + «كل حاجة»; mockup docs/ui-references/mockups/reception-shift-guard.*).
-- A reception / customer-service account (not super admin / general manager) whose HR shift started more than ONE hour ago
-- (punched or not) and who has no open reception cash shift is LOCKED out of desk work until the shift is opened:
--   booking   : book, walk_in, overbook, agent_booking_register, booking_discount
--   arrival   : arrive (reception command and the today-board journey command)
--   collection: collect, collect_multi, collect_split, credit_apply, package_sell, installment_bill
--   services  : order_add, execute (reception command), request_service (journey command)
-- An own shift left open from an earlier day (opened > 16 hours ago) locks the same actions until it is handed over / closed.
-- Everything else stays open: reading, shift_open / shift_close / handovers, reviews (request_review, discount_review, shift_review,
-- cross_payment_review …), rescheduling, cancel, patient edits, messages. Trial workspaces are never locked.
-- Not locked when: no linked HR person, no schedule today, leave day, shift already over, punched out, or a shift closed today.
-- Read-only RPCs: public.clinic_reception_shift_guard() (own state, for the lock card) and public.clinic_reception_shift_watch()
-- (super admin / general manager / financial manager: who is locked, stale shifts, shifts open more than an hour after the HR shift end).
-- Outer wrappers only (old bodies renamed into clinic_reception.*_before_shift_guard). Nothing moves money; nothing is deducted.
-- Rollback: supabase/rollbacks/20261123020000_reception_shift_guard.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then raise exception 'أمر الاستقبال غير موجود'; end if;
  if to_regprocedure('clinic_reception.command_before_shift_guard(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_people.attendance_eval(date,timestamptz)') is null then raise exception 'طبّق حضور الموارد البشرية أولًا'; end if;
end $$;

-- own lock state (current account only)
create function clinic_reception.shift_guard_state() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); pid uuid; d date := (now() at time zone 'Africa/Cairo')::date; e record; s record;
  last_in timestamptz; last_out timestamptz;
begin
  if me is null or not (public.has_role('reception') or public.has_role('customer_service'))
     or public.has_role('super_admin') or public.has_role('general_manager') then return jsonb_build_object('locked', false); end if;
  select sh.id, sh.opened_at, sh.expected, r.name as register into s from clinic_reception.shifts sh
    join clinic_reception.workspaces w on w.id = sh.workspace_id and w.mode = 'live'
    left join clinic_reception.registers r on r.id = sh.register_id
   where sh.cashier_id = me and sh.status = 'open' order by sh.opened_at desc limit 1;
  if found then
    if s.opened_at < now() - interval '16 hours' then
      return jsonb_build_object('locked', true, 'reason', 'stale', 'shift_id', s.id, 'opened_at', s.opened_at, 'register', s.register,
        'expected', s.expected);
    end if;
    return jsonb_build_object('locked', false, 'reason', 'open');
  end if;
  select p.id into pid from clinic_people.people p where p.admin_id = me and p.status <> 'ended' limit 1;
  if pid is null then return jsonb_build_object('locked', false, 'why', 'no_person'); end if;
  select x.first_in, x.exp_start, x.exp_end, x.status into e from clinic_people.attendance_eval(d, now()) x where x.person_id = pid limit 1;
  if not found or e.exp_start is null or coalesce(e.status, '') = 'leave' or (e.exp_end is not null and now() >= e.exp_end)
     or now() < e.exp_start + interval '1 hour' then
    return jsonb_build_object('locked', false, 'why', 'not_due');
  end if;
  if exists (select 1 from clinic_reception.shifts sh where sh.cashier_id = me and sh.status <> 'open' and sh.opened_at >= now() - interval '16 hours') then
    return jsonb_build_object('locked', false, 'why', 'closed');
  end if;
  if to_regclass('clinic_people.device_punches') is not null then
    execute 'select max(dp.ts) filter (where dp.punch in (0,3,4)), max(dp.ts) filter (where dp.punch in (1,5))
               from clinic_people.device_punches dp join clinic_people.device_user_map m on m.device_id = dp.device_id and m.device_user_id = dp.device_user_id
              where m.person_id = $1 and dp.ts >= $2' into last_in, last_out using pid, now() - interval '16 hours';
    if last_out is not null and (last_in is null or last_out > last_in) then return jsonb_build_object('locked', false, 'why', 'punched_out'); end if;
  end if;
  return jsonb_build_object('locked', true, 'reason', 'need_open', 'exp_start', e.exp_start, 'first_in', e.first_in, 'exp_end', e.exp_end);
end $$;
revoke all on function clinic_reception.shift_guard_state() from public, anon, authenticated;

create function clinic_reception.shift_guard_check(p_workspace uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare g jsonb;
begin
  if exists (select 1 from clinic_reception.workspaces w where w.id = p_workspace and w.mode <> 'live') then return; end if;
  g := clinic_reception.shift_guard_state();
  if coalesce((g->>'locked')::boolean, false) then
    if g->>'reason' = 'stale' then
      raise exception 'ورديتك من يوم قبل كده لسه مفتوحة — سلّمها الأول وافتح وردية النهارده' using errcode = 'P0001', hint = 'shift_guard:stale';
    end if;
    raise exception 'افتح وردية الخزينة الأول — الحجز والتحصيل وتسجيل الوصول وطلب الخدمات واقفين لحد ما تفتح ورديتك' using errcode = 'P0001', hint = 'shift_guard:need_open';
  end if;
end $$;
revoke all on function clinic_reception.shift_guard_check(uuid) from public, anon, authenticated;

create function public.clinic_reception_shift_guard() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$ select clinic_reception.shift_guard_state() $$;
revoke all on function public.clinic_reception_shift_guard() from public, anon;
grant execute on function public.clinic_reception_shift_guard() to authenticated;

-- reception command: desk actions need an open shift
do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_shift_guard;
  alter function public.command_before_shift_guard(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_shift_guard(uuid, text, jsonb, uuid) from public, anon, authenticated;
create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_action in ('book', 'walk_in', 'overbook', 'agent_booking_register', 'booking_discount', 'arrive', 'collect', 'collect_multi',
                  'collect_split', 'credit_apply', 'package_sell', 'installment_bill', 'order_add', 'execute') then
    perform clinic_reception.shift_guard_check(p_workspace);
  end if;
  return clinic_reception.command_before_shift_guard(p_workspace, p_action, p_payload, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- today-board journey command: arrival + service request
do $$ begin
  if to_regprocedure('public.clinic_reception_journey_command(uuid,text,jsonb,uuid)') is null then return; end if;
  alter function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) rename to journey_command_before_shift_guard;
  alter function public.journey_command_before_shift_guard(uuid, text, jsonb, uuid) set schema clinic_reception;
  revoke all on function clinic_reception.journey_command_before_shift_guard(uuid, text, jsonb, uuid) from public, anon, authenticated;
  execute $f$
    create function public.clinic_reception_journey_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
    returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $b$
    begin
      if p_action in ('arrive', 'request_service') then perform clinic_reception.shift_guard_check(p_workspace); end if;
      return clinic_reception.journey_command_before_shift_guard(p_workspace, p_action, p_payload, p_token);
    end $b$;
  $f$;
  revoke all on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) from public, anon;
  grant execute on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) to authenticated;
end $$;

-- managers: who is locked, stale shifts, shifts left open after the HR shift
create function public.clinic_reception_shift_watch() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := (now() at time zone 'Africa/Cairo')::date; rows jsonb := '[]'::jsonb; ids uuid[]; more uuid[];
  a record; pid uuid; s record; stale boolean; e_start timestamptz; e_end timestamptz; e_in timestamptz; e_status text;
begin
  if not (public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('financial_manager')) then
    return jsonb_build_object('visible', false, 'items', '[]'::jsonb); end if;
  select coalesce(array_agg(x.id), '{}') into ids from public.admins x where x.active and x.role in ('reception', 'customer_service');
  if to_regclass('public.admin_extra_roles') is not null then
    execute 'select coalesce(array_agg(distinct r.admin_id), ''{}'') from public.admin_extra_roles r join public.admins x on x.id = r.admin_id and x.active
              where r.role in (''reception'', ''customer_service'')' into more;
    ids := ids || more;
  end if;
  for a in select x.id, coalesce(nullif(trim(x.name), ''), x.email) as name from public.admins x where x.id = any(ids) order by 2 loop
    pid := null; e_start := null; e_end := null; e_in := null; e_status := null;
    select p.id into pid from clinic_people.people p where p.admin_id = a.id and p.status <> 'ended' limit 1;
    if pid is not null then
      select x.first_in, x.exp_start, x.exp_end, x.status into e_in, e_start, e_end, e_status from clinic_people.attendance_eval(d, now()) x where x.person_id = pid limit 1;
    end if;
    select sh.opened_at, sh.expected, r.name as register into s from clinic_reception.shifts sh
      join clinic_reception.workspaces w on w.id = sh.workspace_id and w.mode = 'live'
      left join clinic_reception.registers r on r.id = sh.register_id
     where sh.cashier_id = a.id and sh.status = 'open' order by sh.opened_at desc limit 1;
    if found then
      stale := s.opened_at < now() - interval '16 hours';
      if stale or (e_end is not null and now() >= e_end + interval '1 hour' and s.opened_at < e_end) then
        rows := rows || jsonb_build_object('kind', case when stale then 'stale' else 'after_end' end, 'admin_id', a.id, 'name', a.name,
          'opened_at', s.opened_at, 'expected', s.expected, 'register', s.register, 'exp_end', e_end);
      end if;
    elsif e_start is not null and coalesce(e_status, '') <> 'leave' and now() >= e_start + interval '1 hour'
          and (e_end is null or now() < e_end)
          and not exists (select 1 from clinic_reception.shifts sh where sh.cashier_id = a.id and sh.opened_at >= now() - interval '16 hours') then
      rows := rows || jsonb_build_object('kind', 'missing', 'admin_id', a.id, 'name', a.name, 'exp_start', e_start, 'first_in', e_in);
    end if;
  end loop;
  return jsonb_build_object('visible', true, 'items', rows);
end $$;
revoke all on function public.clinic_reception_shift_watch() from public, anon;
grant execute on function public.clinic_reception_shift_watch() to authenticated;

commit;
