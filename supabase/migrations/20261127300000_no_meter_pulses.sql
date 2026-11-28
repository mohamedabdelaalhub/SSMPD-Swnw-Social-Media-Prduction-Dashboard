-- «نبضات من غير عداد» — temporary (owner 2026-11-27 «موافق على النبضات من غير عداد مؤقتاً», until the count is read from the lasers).
-- In «تنفيذ» and «تنفيذ الكل» a counter device can be used with ONLY «عدد النبضات» when the employee picks «مش عارف قراية العداد»
-- (or the device has no reading yet): payload no_meter = true + pulses (> 0) [+ evidence = a photo path in shift-expense-receipts,
-- the caller's own folder, optional]. The wrapper stores meter_before = 0 / meter_after = pulses (so pricing and the pulse-package
-- deduction use exactly that count, the same as the counter difference), then marks the device row no_meter = true with the pulses,
-- the evidence and who, and writes an audit row. Every existing guard (role, doctor, store, pulse > 0, package balance) still runs.
--   * public.clinic_reception_device_last_reading ignores no_meter rows → the auto-fill from the last REAL reading returns by itself
--     as soon as one real reading is recorded on that device.
--   * public.clinic_reception_no_meter_sessions(workspace, from, to): the report for the owner / managers (super admin, general manager,
--     financial manager, or a workspace manager): device, employee, date, pulses, service, evidence.
-- One more outer wrapper on public.clinic_reception_command (previous kept as clinic_reception.command_before_no_meter). Nothing removed.
-- Rollback: supabase/rollbacks/20261127300000_no_meter_pulses.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regclass('clinic_reception.device_uses') is null
     or to_regprocedure('public.clinic_reception_device_last_reading(uuid,uuid)') is null then
    raise exception 'طبّق 20261127270000 الأول'; end if;
  if to_regprocedure('clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.device_uses add column if not exists no_meter boolean not null default false;
alter table clinic_reception.device_uses add column if not exists no_meter_pulses numeric(14,3);
alter table clinic_reception.device_uses add column if not exists no_meter_evidence text;
alter table clinic_reception.device_uses add column if not exists no_meter_by uuid references public.admins(id);
alter table clinic_reception.device_uses add column if not exists no_meter_at timestamptz;

-- validate + turn «عدد النبضات من غير عداد» into the stored before / after; null when not a no-meter payload
create function clinic_reception.no_meter_payload(p_workspace uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare n numeric; dev clinic_reception.devices%rowtype; ev text;
begin
  if jsonb_typeof(p) is distinct from 'object' or coalesce((p->>'no_meter')::boolean, false) is not true then return null; end if;
  if nullif(btrim(coalesce(p->>'pulses', '')), '') is null then raise exception 'اكتب عدد النبضات'; end if;
  begin n := (p->>'pulses')::numeric; exception when others then raise exception 'عدد النبضات لازم يبقى رقم'; end;
  if n <= 0 or n <> round(n, 3) then raise exception 'عدد النبضات لازم يبقى أكبر من صفر'; end if;
  if nullif(p->>'device_id', '') is null then raise exception 'اختار الجهاز'; end if;
  begin select * into dev from clinic_reception.devices where workspace_id = p_workspace and id = (p->>'device_id')::uuid; exception when others then raise exception 'اختار الجهاز'; end;
  if not found then raise exception 'اختار الجهاز'; end if;
  if dev.meter_kind = 'none' then raise exception 'الجهاز ده مالوش عداد — مش محتاج «من غير عداد»'; end if;
  ev := nullif(btrim(coalesce(p->>'evidence', '')), '');
  if ev is not null then
    if split_part(ev, '/', 1) <> auth.uid()::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'shift-expense-receipts' and o.name = ev) then
      raise exception 'صورة شاشة الجهاز مش مرفوعة — ارفعها تاني أو كمّل من غيرها'; end if;
  end if;
  return (p - 'no_meter' - 'pulses' - 'evidence') || jsonb_build_object('meter_before', 0, 'meter_after', n, '_nm_pulses', n, '_nm_evidence', ev);
end $$;
revoke all on function clinic_reception.no_meter_payload(uuid, jsonb) from public, anon, authenticated;

create function clinic_reception.no_meter_mark(p_workspace uuid, p_order uuid, p_pulses numeric, p_evidence text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  update clinic_reception.device_uses set no_meter = true, no_meter_pulses = p_pulses, no_meter_evidence = p_evidence, no_meter_by = me, no_meter_at = now()
   where workspace_id = p_workspace and order_id = p_order;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'execute_no_meter', p_order, jsonb_build_object('pulses', p_pulses, 'evidence', p_evidence is not null));
end $$;
revoke all on function clinic_reception.no_meter_mark(uuid, uuid, numeric, text) from public, anon, authenticated;

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_no_meter;
alter function public.command_before_no_meter(uuid, text, jsonb, uuid) set schema clinic_reception;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare pl jsonb; out jsonb; it jsonb; items jsonb := '[]'::jsonb; marks jsonb := '[]'::jsonb; top boolean; x jsonb; replay boolean := false;
begin
  if p_action = 'execute' and jsonb_typeof(p_payload) = 'object' and coalesce((p_payload->>'no_meter')::boolean, false) then
    pl := clinic_reception.no_meter_payload(p_workspace, p_payload);
    if public.my_admin_id() is not null and p_token is not null then
      select exists (select 1 from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = public.my_admin_id() and c.token = p_token) into replay;
    end if;
    out := clinic_reception.command_before_no_meter(p_workspace, p_action, pl - '_nm_pulses' - '_nm_evidence', p_token);
    if not replay then perform clinic_reception.no_meter_mark(p_workspace, (pl->>'id')::uuid, (pl->>'_nm_pulses')::numeric, pl->>'_nm_evidence'); end if;
    return out;
  end if;
  if p_action = 'execute_many' and jsonb_typeof(p_payload) = 'object' and coalesce((p_payload->>'no_meter')::boolean, false)
     and jsonb_typeof(p_payload->'orders') = 'array' then
    for it in select e from jsonb_array_elements(p_payload->'orders') e loop
      x := clinic_reception.no_meter_payload(p_workspace, it || jsonb_build_object('no_meter', true, 'device_id', p_payload->'device_id', 'evidence', p_payload->'evidence'));
      items := items || jsonb_build_array(x - '_nm_pulses' - '_nm_evidence');
      marks := marks || jsonb_build_array(jsonb_build_object('id', x->>'id', 'pulses', x->'_nm_pulses', 'evidence', x->>'_nm_evidence'));
    end loop;
    out := clinic_reception.command_before_no_meter(p_workspace, p_action, (p_payload - 'no_meter' - 'evidence') || jsonb_build_object('orders', items), p_token);
    for x in select e from jsonb_array_elements(marks) e loop
      if not exists (select 1 from clinic_reception.device_uses u where u.order_id = (x->>'id')::uuid and u.no_meter) then
        perform clinic_reception.no_meter_mark(p_workspace, (x->>'id')::uuid, (x->>'pulses')::numeric, x->>'evidence'); end if;
    end loop;
    return out;
  end if;
  return clinic_reception.command_before_no_meter(p_workspace, p_action, p_payload, p_token);
end $$;

-- the auto-fill reads the last REAL reading only
create or replace function public.clinic_reception_device_last_reading(p_workspace uuid, p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_after numeric; v_at timestamptz; v_by uuid; nm int;
begin
  perform clinic_reception.access(p_workspace, 'execute');
  select u.meter_after, o.completed_at, o.executed_by into v_after, v_at, v_by
    from clinic_reception.device_uses u join clinic_reception.orders o on o.id = u.order_id
   where u.workspace_id = p_workspace and u.device_id = p_device and u.meter_after is not null and not u.no_meter
   order by o.completed_at desc nulls last, u.meter_after desc limit 1;
  select count(*) into nm from clinic_reception.device_uses u where u.workspace_id = p_workspace and u.device_id = p_device and u.no_meter;
  if v_after is null then return jsonb_build_object('device_id', p_device, 'meter_after', null, 'no_meter_sessions', nm); end if;
  return jsonb_build_object('device_id', p_device, 'meter_after', v_after, 'at', v_at, 'no_meter_sessions', nm,
    'by', (select coalesce(nullif(trim(to_jsonb(a)->>'name'), ''), 'موظف') from public.admins a where a.id = v_by));
end $$;

-- the report for the owner / managers
create function public.clinic_reception_no_meter_sessions(p_workspace uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ok boolean := public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('financial_manager');
  f date := coalesce(p_from, (now() at time zone 'Africa/Cairo')::date - 30); t date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
begin
  if not ok then begin perform clinic_reception.access(p_workspace, 'manage'); ok := true; exception when others then ok := false; end; end if;
  if not ok then return jsonb_build_object('allowed', false, 'rows', '[]'::jsonb); end if;
  if t < f or t - f > 92 then raise exception 'اختار فترة لحد 3 شهور'; end if;
  return jsonb_build_object('allowed', true, 'from', f, 'to', t, 'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'at', coalesce(u.no_meter_at, o.completed_at), 'device', d.name, 'device_id', d.id,
      'service', coalesce(o.snapshot->>'name', 'خدمة'), 'pulses', u.no_meter_pulses, 'file_no', pt.file_no,
      'by', (select coalesce(nullif(trim(to_jsonb(a)->>'name'), ''), 'موظف') from public.admins a where a.id = coalesce(u.no_meter_by, o.executed_by)),
      'evidence', u.no_meter_evidence) order by coalesce(u.no_meter_at, o.completed_at) desc)
    from clinic_reception.device_uses u join clinic_reception.orders o on o.id = u.order_id
    join clinic_reception.devices d on d.id = u.device_id
    left join clinic_reception.visits v on v.id = o.visit_id left join clinic_reception.patients pt on pt.id = v.patient_id
   where u.workspace_id = p_workspace and u.no_meter
     and (coalesce(u.no_meter_at, o.completed_at) at time zone 'Africa/Cairo')::date between f and t), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_no_meter_sessions(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_no_meter_sessions(uuid, date, date) to authenticated;

-- the wrapper gets exactly the privileges of the function it wraps
do $$ declare r record; begin
  execute 'revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public, anon, authenticated';
  for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)'::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function public.clinic_reception_command(uuid,text,jsonb,uuid) to %s', r.privilege_type,
                   case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
  execute 'revoke all on function clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid) from public, anon, authenticated';
end $$;

commit;
