-- Live rollback test for 20261127270000_execute_all.sql («تنفيذ الكل» + clear execute messages + last reading + «عدد النبضات»).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — nothing executed, nothing kept.
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb) on the LIVE reception workspace. Prints flags / counts only.
-- Rows: 1 info (can_execute, pulse codes) · 2 single execute on a counter device with empty readings → «اكتب قراءة العداد قبل وبعد»,
-- nothing executed · 3 «عدد النبضات» 0 → «أكبر من صفر» · 4 execute_many with 1 service → refused; with services of 2 visits → refused ·
-- 5 last reading of a counter device (read only) · 6 execute_many on a real open visit with ≥2 waiting services (only if one exists now:
-- all executed or one clear refusal naming the service, then rolled back) · 7 grants · 8 rollback body.
do $$ begin
  if to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') is not null then
    raise exception '20261127270000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
create temp table xa_live(n serial, step text, expected text, actual text, ok boolean);
create temp table xa_fx(sub uuid, me uuid, w uuid, dev uuid);
do $$ declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; dv uuid;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if me is null or w is null then raise exception 'Mazen / live workspace missing'; end if;
  select d.id into dv from clinic_reception.devices d where d.workspace_id = w and d.meter_kind <> 'none' order by (d.meter_kind = 'shots') desc, d.name limit 1;
  insert into xa_fx values (sub, me, w, dv);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  insert into xa_live(step, expected, actual, ok) values ('fixture', 'Mazen + live workspace + a counter device', 'device found ' || (dv is not null), true);
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261127270000_execute_all.sql (between its begin; / commit;) >>>

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regclass('clinic_reception.devices') is null
     or to_regclass('clinic_reception.orders') is null then raise exception 'clinic_reception_command / devices / orders غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_execute_all;
alter function public.command_before_execute_all(uuid, text, jsonb, uuid) set schema clinic_reception;

-- clear, field-named checks before the existing execute (never weaker than it: it still runs afterwards)
create function clinic_reception.execute_precheck(p_workspace uuid, p jsonb) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; dev clinic_reception.devices%rowtype; b numeric; a numeric; has_mat boolean;
begin
  begin select * into o from clinic_reception.orders where workspace_id = p_workspace and id = nullif(p->>'id', '')::uuid;
  exception when others then return; end;
  if not found then return; end if;
  if nullif(p->>'device_id', '') is not null then
    begin select * into dev from clinic_reception.devices where workspace_id = p_workspace and id = (p->>'device_id')::uuid; exception when others then return; end;
    if found then
      if nullif(btrim(coalesce(p->>'minutes', '')), '') is null or (p->>'minutes') !~ '^\s*[0-9]+\s*$' or (p->>'minutes')::numeric <= 0 then
        raise exception 'اكتب دقايق تشغيل الجهاز (رقم صحيح أكبر من صفر)'; end if;
      if dev.meter_kind <> 'none' then
        if nullif(btrim(coalesce(p->>'meter_before', '')), '') is null or nullif(btrim(coalesce(p->>'meter_after', '')), '') is null then
          raise exception 'اكتب قراءة العداد قبل وبعد'; end if;
        begin b := (p->>'meter_before')::numeric; a := (p->>'meter_after')::numeric; exception when others then raise exception 'قراءة العداد لازم تبقى رقم'; end;
        if b < 0 or a < 0 or b <> round(b, 3) or a <> round(a, 3) then raise exception 'قراءة العداد لازم تبقى رقم موجب (لحد 3 أرقام بعد العلامة)'; end if;
        if a < b then raise exception 'قراءة بعد لازم تبقى أكبر من قراءة قبل'; end if;
      end if;
    end if;
  end if;
  has_mat := case when jsonb_typeof(p->'materials') = 'array' then exists (select 1 from jsonb_array_elements(p->'materials') m where coalesce(nullif(m->>'quantity', '')::numeric, 0) > 0)
                  else jsonb_array_length(coalesce(o.snapshot->'bom', '[]'::jsonb)) > 0 end;
  if has_mat and nullif(p->>'location_id', '') is null then raise exception 'اختار مخزن الصرف'; end if;
end $$;
revoke all on function clinic_reception.execute_precheck(uuid, jsonb) from public, anon, authenticated;

-- «عدد النبضات» (owner 2026-11-27): the user may type the number of pulses instead of «من / إلى»; the counter after = before + pulses
-- (the same columns are stored, so reports and pricing are unchanged). The number must be > 0.
create function clinic_reception.execute_pulses(p jsonb) returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare n numeric; b numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' or nullif(btrim(coalesce(p->>'pulses', '')), '') is null then return p; end if;
  begin n := (p->>'pulses')::numeric; exception when others then raise exception 'عدد النبضات لازم يبقى رقم'; end;
  if n <= 0 or n <> round(n, 3) then raise exception 'عدد النبضات لازم يبقى أكبر من صفر'; end if;
  if nullif(btrim(coalesce(p->>'meter_before', '')), '') is null then raise exception 'اكتب قراءة العداد قبل'; end if;
  begin b := (p->>'meter_before')::numeric; exception when others then raise exception 'قراءة العداد لازم تبقى رقم'; end;
  return (p - 'pulses') || jsonb_build_object('meter_after', b + n);
end $$;
revoke all on function clinic_reception.execute_pulses(jsonb) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); items jsonb; it jsonb; pl jsonb; o clinic_reception.orders%rowtype; v_visit uuid; ids uuid[];
  n int; i int := 0; res jsonb := '[]'::jsonb; r jsonb; nm text; msg text; tok uuid; pulse boolean;
begin
  if p_action = 'execute' and jsonb_typeof(p_payload) = 'object' then
    pl := clinic_reception.execute_pulses(p_payload);
    perform clinic_reception.execute_precheck(p_workspace, pl);
    return clinic_reception.command_before_execute_all(p_workspace, p_action, pl, p_token);
  end if;
  if p_action <> 'execute_many' then
    return clinic_reception.command_before_execute_all(p_workspace, p_action, p_payload, p_token);
  end if;

  -- «تنفيذ الكل»
  if me is null then raise exception 'سجل الدخول'; end if;
  if p_token is null then raise exception 'حاول تاني'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'orders') is distinct from 'array' then raise exception 'اختار الخدمات'; end if;
  items := p_payload->'orders'; n := jsonb_array_length(items);
  if n < 2 then raise exception 'اختار خدمتين على الأقل — لخدمة واحدة استخدم «تنفيذ»'; end if;
  if n > 20 then raise exception 'أقصى 20 خدمة في المرة'; end if;
  begin v_visit := nullif(p_payload->>'visit_id', '')::uuid;
    select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(items) x;
  exception when others then raise exception 'راجع الخدمات المختارة'; end;
  if ids is null or cardinality(ids) <> (select count(distinct u) from unnest(ids) u) then raise exception 'خدمة متكررة في الاختيار'; end if;
  if v_visit is null then raise exception 'الزيارة مش محددة'; end if;
  if (select count(*) from clinic_reception.orders x where x.workspace_id = p_workspace and x.id = any(ids) and x.visit_id = v_visit) <> n then
    raise exception 'كل الخدمات لازم تبقى من نفس الزيارة'; end if;
  for it in select x from jsonb_array_elements(items) x loop
    i := i + 1;
    select * into o from clinic_reception.orders where workspace_id = p_workspace and id = (it->>'id')::uuid;
    nm := coalesce(o.snapshot->>'name', 'خدمة');
    pl := jsonb_strip_nulls(jsonb_build_object('id', o.id,
            'provider_id', coalesce(nullif(it->>'provider_id', ''), nullif(p_payload->>'provider_id', '')),
            'location_id', nullif(p_payload->>'location_id', ''),
            'device_id', nullif(p_payload->>'device_id', ''),
            'minutes', it->'minutes', 'meter_before', it->'meter_before', 'meter_after', it->'meter_after', 'pulses', it->'pulses',
            'material_note', nullif(p_payload->>'material_note', ''),
            'additional_confirmed', coalesce((p_payload->>'additional_confirmed')::boolean, false),
            'materials', it->'materials'));
    -- a service priced per pulse keeps its OWN counter (its price depends on it), never a share of the session
    if to_regclass('clinic_reception.laser_pulse_services') is not null and coalesce((it->>'own_meter')::boolean, false) is not true then
      execute 'select exists (select 1 from clinic_reception.laser_pulse_services where service_code = $1)' into pulse using o.snapshot->>'code';
      if pulse then raise exception '%: البند ده بيتحسب بالنبضة — اكتب العداد بتاعه لوحده', nm using errcode = 'P0001', hint = 'execute_many_item'; end if;
    end if;
    -- one stable token per service inside this «تنفيذ الكل» (replay → the stored answer, never a second execution)
    tok := (md5(p_token::text || ':' || o.id::text))::uuid;
    begin
      pl := clinic_reception.execute_pulses(pl);
      perform clinic_reception.execute_precheck(p_workspace, pl);
      r := clinic_reception.command_before_execute_all(p_workspace, 'execute', pl, tok);
    exception when others then
      get stacked diagnostics msg = message_text;
      raise exception '%: %', nm, msg using errcode = 'P0001', hint = 'execute_many_item', detail = jsonb_build_object('order_id', o.id, 'index', i)::text;
    end;
    res := res || jsonb_build_array(jsonb_build_object('order_id', o.id, 'name', nm, 'result', r));
  end loop;
  return jsonb_build_object('executed', n, 'visit_id', v_visit, 'items', res);
end $$;

-- what the «تنفيذ الكل» screen needs: may this user execute here (the button shows only then), and which services are priced per pulse
create function public.clinic_reception_execute_all_info(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ok boolean := true; codes jsonb := '[]'::jsonb;
begin
  begin perform clinic_reception.access(p_workspace, 'execute'); exception when others then ok := false; end;
  if ok and to_regclass('clinic_reception.laser_pulse_services') is not null then
    execute 'select coalesce(jsonb_agg(service_code order by service_code), ''[]''::jsonb) from clinic_reception.laser_pulse_services' into codes;
  end if;
  return jsonb_build_object('can_execute', ok, 'pulse_codes', codes);
end $$;
revoke all on function public.clinic_reception_execute_all_info(uuid) from public, anon;
grant execute on function public.clinic_reception_execute_all_info(uuid) to authenticated;

-- «آخر قراءة» (owner 2026-11-27 «الرقم يقرا اخر رقم اتدخل علي النبضات من كل المستخدمين»): the last counter written on THIS device
-- (the laser device itself, by any employee), read fresh when an execute window opens. Read only.
create function public.clinic_reception_device_last_reading(p_workspace uuid, p_device uuid) returns jsonb
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
revoke all on function public.clinic_reception_device_last_reading(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_device_last_reading(uuid, uuid) to authenticated;

-- the wrapper gets exactly the privileges of the function it wraps
do $$ declare r record; begin
  execute 'revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public, anon, authenticated';
  for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)'::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function public.clinic_reception_command(uuid,text,jsonb,uuid) to %s', r.privilege_type,
                   case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
  execute 'revoke all on function clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid) from public, anon, authenticated';
end $$;

-- <<< END MIGRATION BODY <<<

-- 1) info
do $$ declare f xa_fx; r jsonb; err text := 'ok';
begin select * into f from xa_fx; execute 'set local role authenticated';
  begin r := public.clinic_reception_execute_all_info(f.w); exception when others then err := sqlerrm; end; execute 'reset role';
  insert into xa_live(step, expected, actual, ok) values ('1 info (Mazen)', 'can_execute true, pulse codes listed', err || ' · can ' || coalesce(r->>'can_execute', '-') || ' · pulse codes ' || coalesce(jsonb_array_length(r->'pulse_codes'), -1),
    err = 'ok' and (r->>'can_execute')::boolean is true and jsonb_typeof(r->'pulse_codes') = 'array');
end $$;

-- 2) single execute, counter device, empty readings
do $$ declare f xa_fx; oid uuid; err text := 'ok'; n0 int; n1 int;
begin select * into f from xa_fx;
  select o.id into oid from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id and v.status = 'open' where o.workspace_id = f.w and o.status = 'ordered' order by o.created_at desc limit 1;
  if oid is null or f.dev is null then insert into xa_live(step, expected, actual, ok) values ('2 empty counter message', '«اكتب قراءة العداد قبل وبعد»', 'skipped: no waiting service or no counter device now', true); return; end if;
  select count(*) into n0 from clinic_reception.orders where workspace_id = f.w and status = 'completed';
  execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'execute', jsonb_build_object('id', oid, 'device_id', f.dev, 'minutes', 5, 'materials', '[]'::jsonb), gen_random_uuid());
  exception when others then err := sqlerrm; end; execute 'reset role';
  select count(*) into n1 from clinic_reception.orders where workspace_id = f.w and status = 'completed';
  insert into xa_live(step, expected, actual, ok) values ('2 empty counter message', '«اكتب قراءة العداد قبل وبعد», nothing executed', err || ' · executed ' || (n1 - n0), err = 'اكتب قراءة العداد قبل وبعد' and n1 = n0);
end $$;

-- 3) «عدد النبضات» must be > 0
do $$ declare f xa_fx; err text := 'ok';
begin select * into f from xa_fx; execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'execute', jsonb_build_object('id', gen_random_uuid(), 'meter_before', 100, 'pulses', 0), gen_random_uuid()); exception when others then err := sqlerrm; end;
  execute 'reset role';
  insert into xa_live(step, expected, actual, ok) values ('3 pulses 0', '«عدد النبضات لازم يبقى أكبر من صفر»', err, err like 'عدد النبضات لازم يبقى أكبر من صفر%');
end $$;

-- 4) execute_many refusals (before anything runs)
do $$ declare f xa_fx; e1 text := 'ok'; e2 text := 'ok'; a uuid; b uuid; va uuid;
begin select * into f from xa_fx;
  select o.id, o.visit_id into a, va from clinic_reception.orders o where o.workspace_id = f.w order by o.created_at desc limit 1;
  select o.id into b from clinic_reception.orders o where o.workspace_id = f.w and o.visit_id <> va order by o.created_at desc limit 1;
  execute 'set local role authenticated';
  begin perform public.clinic_reception_command(f.w, 'execute_many', jsonb_build_object('visit_id', va, 'orders', jsonb_build_array(jsonb_build_object('id', a))), gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.clinic_reception_command(f.w, 'execute_many', jsonb_build_object('visit_id', va, 'orders', jsonb_build_array(jsonb_build_object('id', a), jsonb_build_object('id', b))), gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  execute 'reset role';
  insert into xa_live(step, expected, actual, ok) values ('4 execute_many refusals', 'one service → «خدمتين على الأقل»; two visits → «نفس الزيارة»', e1 || ' · ' || e2,
    e1 like 'اختار خدمتين على الأقل%' and (b is null or e2 like '%نفس الزيارة%'));
end $$;

-- 5) last reading (read only)
do $$ declare f xa_fx; r jsonb; err text := 'ok';
begin select * into f from xa_fx;
  if f.dev is null then insert into xa_live(step, expected, actual, ok) values ('5 last reading', 'object with meter_after', 'skipped: no counter device', true); return; end if;
  execute 'set local role authenticated';
  begin r := public.clinic_reception_device_last_reading(f.w, f.dev); exception when others then err := sqlerrm; end; execute 'reset role';
  insert into xa_live(step, expected, actual, ok) values ('5 last reading', 'ok, meter_after key present', err || ' · has reading ' || coalesce((r->>'meter_after' is not null)::text, '-'), err = 'ok' and r ? 'meter_after');
end $$;

-- 6) execute_many on a real open visit with ≥2 waiting services (rolled back)
do $$ declare f xa_fx; v uuid; items jsonb; r jsonb; err text := 'ok'; dv uuid; last numeric; cur numeric; rec record; i int := 0; cnt int;
begin select * into f from xa_fx;
  select o.visit_id, count(*) into v, cnt from clinic_reception.orders o join clinic_reception.visits vv on vv.id = o.visit_id and vv.status = 'open'
   where o.workspace_id = f.w and o.status = 'ordered' group by o.visit_id having count(*) >= 2 order by max(o.created_at) desc limit 1;
  if v is null then insert into xa_live(step, expected, actual, ok) values ('6 execute_many real visit', 'all executed or a named refusal', 'skipped: no open visit with 2+ waiting services now', true); return; end if;
  dv := f.dev; cur := coalesce((select max(u.meter_after) from clinic_reception.device_uses u where u.device_id = dv), 0);
  items := '[]'::jsonb;
  for rec in select x.* from clinic_reception.orders x where x.visit_id = v and x.status = 'ordered' order by x.created_at loop
    i := i + 1;
    items := items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', rec.id, 'minutes', case when dv is not null then 5 end,
      'meter_before', case when dv is not null then cur end, 'meter_after', case when dv is not null then cur + 10 end, 'own_meter', true)));
    cur := cur + 10;
  end loop;
  execute 'set local role authenticated';
  begin r := public.clinic_reception_command(f.w, 'execute_many', jsonb_strip_nulls(jsonb_build_object('visit_id', v, 'orders', items, 'device_id', dv, 'additional_confirmed', false)), gen_random_uuid());
  exception when others then err := sqlerrm; end; execute 'reset role';
  insert into xa_live(step, expected, actual, ok) values ('6 execute_many real visit', 'all executed, or one refusal that names the service',
    case when err = 'ok' then 'executed ' || (r->>'executed') else 'refused: ' || left(err, 160) end,
    (err = 'ok' and (r->>'executed')::int = cnt) or position(':' in err) > 0);
end $$;

-- 7) grants
insert into xa_live(step, expected, actual, ok)
select '7 grants', 'authenticated yes / anon no on command, info, last reading',
  'auth ' || (has_function_privilege('authenticated', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_execute_all_info(uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_device_last_reading(uuid,uuid)', 'execute'))
  || ' · anon ' || (has_function_privilege('anon', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_execute_all_info(uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_device_last_reading(uuid,uuid)', 'execute')),
  has_function_privilege('authenticated', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_execute_all_info(uuid)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_device_last_reading(uuid,uuid)', 'execute')
  and not (has_function_privilege('anon', 'public.clinic_reception_command(uuid,text,jsonb,uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_execute_all_info(uuid)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_device_last_reading(uuid,uuid)', 'execute'));

-- 8) rollback body (supabase/rollbacks/20261127270000_execute_all.rollback.sql)
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists clinic_reception.execute_precheck(uuid, jsonb);
drop function if exists public.clinic_reception_execute_all_info(uuid);
drop function if exists public.clinic_reception_device_last_reading(uuid, uuid);
drop function if exists clinic_reception.execute_pulses(jsonb);
alter function clinic_reception.command_before_execute_all(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_execute_all(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
insert into xa_live(step, expected, actual, ok)
select '8 rollback body', 'previous command back, new functions gone',
  'command ' || (to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') is null and to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is not null)
  || ' · info ' || (to_regprocedure('public.clinic_reception_execute_all_info(uuid)') is null) || ' · reading ' || (to_regprocedure('public.clinic_reception_device_last_reading(uuid,uuid)') is null),
  to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') is null and to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is not null
  and to_regprocedure('public.clinic_reception_execute_all_info(uuid)') is null and to_regprocedure('public.clinic_reception_device_last_reading(uuid,uuid)') is null;

select step, expected, actual, ok from xa_live order by n;
rollback;
