-- «تنفيذ الكل» (owner 2026-11-27 «موافق على تنفيذ الكل», mockup docs/ui-references/mockups/execute-all.html) + clear execute messages
-- (reception report: an empty counter on a laser device ended with «راجع القيمة والوحدة والدقة»).
-- One outer wrapper on public.clinic_reception_command (the previous one is kept as clinic_reception.command_before_execute_all):
--   * 'execute' (and every service inside 'execute_many'): checks BEFORE the existing execute, with the field's name:
--       device with a counter → «اكتب قراءة العداد قبل وبعد» / «قراءة بعد لازم تبقى أكبر من قراءة قبل» (equal is allowed only when the
--       service is not priced per pulse — the existing pulse rule still refuses it); device used → «اكتب دقايق تشغيل الجهاز»;
--       materials to consume → «اختار مخزن الصرف». Then the SAME execute runs unchanged.
--   * 'execute_many' {visit_id, orders:[{id, provider_id?, minutes?, meter_before?, meter_after?, materials}], provider_id?, location_id,
--       device_id?, material_note?, additional_confirmed}: 2..20 ordered services of ONE open visit, each run through the SAME
--       'execute' (same access, same guards, its own derived idempotency token) inside this ONE call → all or nothing. A refusal is
--       re-raised as «<service name>: <reason>». A replayed token replays every inner answer (no double execution).
--       A service priced per pulse (clinic_reception.laser_pulse_services) must come with its own counter (own_meter = true).
--   * public.clinic_reception_execute_all_info(workspace): {can_execute, pulse_codes} for the screen (read only).
--   * «عدد النبضات»: payload.pulses (> 0) instead of meter_after → after = before + pulses (same stored columns).
--   * public.clinic_reception_device_last_reading(workspace, device): the last «قراءة بعد» on that device by anyone (read only).
-- Nothing removed. Rollback: supabase/rollbacks/20261127270000_execute_all.rollback.sql
begin;

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

commit;
