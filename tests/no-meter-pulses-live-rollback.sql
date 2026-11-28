-- Live rollback test for 20261127300000_no_meter_pulses.sql («مش عارف قراية العداد» — pulses only, temporary).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — nothing executed, nothing kept.
-- Reception = Mazen (auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb); manager = an active financial manager (else super admin).
-- Rows: 1 refusals (pulses 0 / missing) · 2 a real waiting service executed with pulses only (only if one exists now on an open visit
-- AND a counter device exists): executed, stored 0 → pulses, marked + audit · 3 last reading ignores it · 4 report: Mazen not allowed,
-- the manager sees the row · 5 grants · 6 rollback body puts the previous command back.
do $$ begin
  if to_regprocedure('clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)') is not null then
    raise exception '20261127300000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
create temp table nm_live(n serial, step text, expected text, actual text, ok boolean);
create temp table nm_fx(sub uuid, me uuid, w uuid, dev uuid, asub uuid, oid uuid);
do $$ declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; dv uuid; asub uuid;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if me is null or w is null then raise exception 'Mazen / live workspace missing'; end if;
  select d.id into dv from clinic_reception.devices d where d.workspace_id = w and d.meter_kind <> 'none' order by (d.meter_kind = 'shots') desc, d.name limit 1;
  select a.user_id into asub from public.admins a where a.active and a.id <> me and a.user_id is not null and a.role in ('financial_manager', 'super_admin') order by a.role = 'financial_manager' desc limit 1;
  insert into nm_fx values (sub, me, w, dv, asub, null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  insert into nm_live(step, expected, actual, ok) values ('fixture', 'Mazen + live workspace + counter device + manager', 'device ' || (dv is not null) || ' · manager ' || (asub is not null), true);
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261127300000_no_meter_pulses.sql (between its begin; / commit;) >>>

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

-- <<< END MIGRATION BODY <<<

-- 1) refusals
do $$ declare f nm_fx; e1 text := 'ok'; e2 text := 'ok';
begin select * into f from nm_fx; execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'execute', jsonb_build_object('id', gen_random_uuid(), 'device_id', f.dev, 'no_meter', true, 'pulses', 0), gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.clinic_reception_command(f.w, 'execute', jsonb_build_object('id', gen_random_uuid(), 'device_id', f.dev, 'no_meter', true), gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  execute 'reset role';
  insert into nm_live(step, expected, actual, ok) values ('1 refusals', 'pulses 0 → «أكبر من صفر»; missing → «اكتب عدد النبضات»', e1 || ' · ' || e2,
    (f.dev is null) or (e1 like 'عدد النبضات لازم يبقى أكبر من صفر%' and e2 like 'اكتب عدد النبضات%'));
end $$;

-- 2) a real waiting service with pulses only
do $$ declare f nm_fx; v_order uuid; err text := 'ok'; u record; na int;
begin select * into f from nm_fx;
  select o.id into v_order from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id and v.status = 'open'
   where o.workspace_id = f.w and o.status = 'ordered' and coalesce((o.snapshot->>'requires_device')::boolean, false) order by o.created_at desc limit 1;
  if v_order is null then select o.id into v_order from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id and v.status = 'open'
   where o.workspace_id = f.w and o.status = 'ordered' order by o.created_at desc limit 1; end if;
  if v_order is null or f.dev is null then insert into nm_live(step, expected, actual, ok) values ('2 execute with pulses only', 'executed + marked', 'skipped: no waiting service or no counter device now', true); return; end if;
  update nm_fx set oid = v_order;
  execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'execute', jsonb_build_object('id', v_order, 'device_id', f.dev, 'minutes', 5, 'no_meter', true, 'pulses', 123, 'materials', '[]'::jsonb), gen_random_uuid());
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  select * into u from clinic_reception.device_uses where order_id = v_order;
  select count(*) into na from clinic_reception.audit where action = 'execute_no_meter' and entity_id = v_order;
  insert into nm_live(step, expected, actual, ok) values ('2 execute with pulses only (Mazen)', 'executed, 0 → 123, marked, audited — or a clear refusal from the existing guards',
    case when err = 'ok' then 'stored ' || coalesce(u.meter_before::text, '-') || ' → ' || coalesce(u.meter_after::text, '-') || ' · marked ' || coalesce(u.no_meter::text, '-') || ' · audit ' || na else 'refused: ' || left(err, 140) end,
    (err = 'ok' and u.meter_before = 0 and u.meter_after = 123 and u.no_meter and na = 1) or (err <> 'ok' and err !~ 'راجع القيمة والوحدة والدقة'));
end $$;

-- 3) last reading ignores no-meter rows
do $$ declare f nm_fx; r jsonb; err text := 'ok';
begin select * into f from nm_fx;
  if f.dev is null then insert into nm_live(step, expected, actual, ok) values ('3 last reading', 'ignores no-meter', 'skipped: no counter device', true); return; end if;
  execute 'set local role authenticated';
  begin r := public.clinic_reception_device_last_reading(f.w, f.dev); exception when others then err := sqlerrm; end; execute 'reset role';
  insert into nm_live(step, expected, actual, ok) values ('3 last reading', 'never the no-meter 123', err || ' · reading ' || coalesce(r->>'meter_after', 'none') || ' · no-meter sessions ' || coalesce(r->>'no_meter_sessions', '-'),
    err = 'ok' and coalesce(r->>'meter_after', '') <> '123');
end $$;

-- 4) report
do $$ declare f nm_fx; a jsonb; b jsonb; e1 text := 'ok'; e2 text := 'ok';
begin select * into f from nm_fx; execute 'set local role authenticated';
  begin a := public.clinic_reception_no_meter_sessions(f.w, null, null); exception when others then e1 := sqlerrm; end; execute 'reset role';
  if f.asub is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', f.asub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', f.asub::text, true);
    execute 'set local role authenticated';
    begin b := public.clinic_reception_no_meter_sessions(f.w, null, null); exception when others then e2 := sqlerrm; end; execute 'reset role';
    perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', f.sub::text, true);
  end if;
  insert into nm_live(step, expected, actual, ok) values ('4 report', 'Mazen not allowed (unless he manages the workspace); manager allowed, row of step 2 listed',
    e1 || ' · Mazen allowed ' || coalesce(a->>'allowed', '-') || ' · ' || e2 || ' · manager allowed ' || coalesce(b->>'allowed', '-') || ' rows ' || coalesce(jsonb_array_length(b->'rows'), -1),
    e1 = 'ok' and e2 = 'ok' and (b->>'allowed')::boolean is true and (f.oid is null or exists (select 1 from jsonb_array_elements(b->'rows') x where x->>'order_id' = f.oid::text) or not exists (select 1 from clinic_reception.device_uses where order_id = f.oid)));
end $$;

-- 5) grants
insert into nm_live(step, expected, actual, ok)
select '5 grants', 'authenticated yes / anon no (command, report)',
  'auth ' || (has_function_privilege('authenticated', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_no_meter_sessions(uuid,date,date)', 'execute'))
  || ' · anon ' || (has_function_privilege('anon', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_no_meter_sessions(uuid,date,date)', 'execute')),
  has_function_privilege('authenticated', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_no_meter_sessions(uuid,date,date)', 'execute')
  and not (has_function_privilege('anon', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_no_meter_sessions(uuid,date,date)', 'execute'));

-- 6) rollback body (supabase/rollbacks/20261127300000_no_meter_pulses.rollback.sql)
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists public.clinic_reception_no_meter_sessions(uuid, date, date);
drop function if exists clinic_reception.no_meter_payload(uuid, jsonb);
drop function if exists clinic_reception.no_meter_mark(uuid, uuid, numeric, text);
alter function clinic_reception.command_before_no_meter(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_no_meter(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
create or replace function public.clinic_reception_device_last_reading(p_workspace uuid, p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  perform clinic_reception.access(p_workspace, 'execute');
  select u.meter_after, o.completed_at, o.executed_by into r
    from clinic_reception.device_uses u join clinic_reception.orders o on o.id = u.order_id
   where u.workspace_id = p_workspace and u.device_id = p_device and u.meter_after is not null
   order by o.completed_at desc nulls last, u.meter_after desc limit 1;
  if not found then return jsonb_build_object('device_id', p_device, 'meter_after', null); end if;
  return jsonb_build_object('device_id', p_device, 'meter_after', r.meter_after, 'at', r.completed_at,
    'by', (select coalesce(nullif(trim(to_jsonb(a)->>'name'), ''), 'موظف') from public.admins a where a.id = r.executed_by));
end $$;
insert into nm_live(step, expected, actual, ok)
select '6 rollback body', 'previous command back (execute-all wrapper), report gone',
  'command ' || (to_regprocedure('clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)') is null and to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') is not null)
  || ' · report ' || (to_regprocedure('public.clinic_reception_no_meter_sessions(uuid,date,date)') is null),
  to_regprocedure('clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)') is null and to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is not null
  and to_regprocedure('public.clinic_reception_no_meter_sessions(uuid,date,date)') is null;

select step, expected, actual, ok from nm_live order by n;
rollback;
