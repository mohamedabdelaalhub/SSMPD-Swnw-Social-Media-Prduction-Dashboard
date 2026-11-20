-- «تسجيل موعد يدوي» — overbook on top of a doctor's full schedule (owner 2026-11-20, mockup
-- docs/ui-references/mockups/manual-overbook.html approved «تصور تسجيل موعد يدوي موافق عليه»).
-- clinic_reception_command('overbook', {patient_id, provider_id, service_id, starts_at, reason_kind, reason}):
--   * reception 'book' capability; reason required (≥ 3 letters); inside the doctor's availability that day;
--   * limits per doctor: 2 overbooks in the same Cairo hour, 6 in the same Cairo day — beyond that only a member
--     with the reception 'manage' capability (the reception manager);
--   * stored as a normal 'booked' appointment flagged overbook (who / why), lasting 5 minutes from the chosen time,
--     so it never takes the doctor's next free slot. The doctor-overlap, gap and fallback-hold checks skip overbook
--     rows (the same-patient guard still applies); audit row 'overbook'.
-- In-place patches use exact text anchors (each must occur once). Rollback restores the saved bodies.
-- Rollback: supabase/rollbacks/20261120210000_reception_manual_overbook.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.appointments') is null or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.command_before_overbook(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

alter table clinic_reception.appointments
  add column if not exists overbook boolean not null default false,
  add column if not exists overbook_reason text,
  add column if not exists overbook_by uuid references public.admins(id);
create index if not exists appointments_overbook_idx on clinic_reception.appointments(provider_id, starts_at) where overbook;

-- saved bodies for the rollback
create table if not exists clinic_reception.overbook_saved_defs(name text primary key, def text not null);

-- gap / fallback triggers: an overbook row neither checks nor blocks
do $$
declare n text; d text; a text := $a$if new.status in ('cancelled','no_show') then return new; end if;$a$;
begin
  foreach n in array array['clinic_reception.appointments_respect_gap()', 'clinic_reception.appointments_respect_fallback()'] loop
    if to_regprocedure(n) is null then continue; end if;
    d := pg_get_functiondef(n::regprocedure);
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط مش موجودة مرة واحدة في %', n; end if;
    insert into clinic_reception.overbook_saved_defs values (n, d) on conflict (name) do update set def = excluded.def;
    execute replace(d, a, a || ' if new.overbook then return new; end if;');
  end loop;
  d := pg_get_functiondef('clinic_reception.appointments_respect_gap()'::regprocedure);
  a := $a$where a.provider_id = new.provider_id and a.id is distinct from new.id and a.status not in ('cancelled','no_show')$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط (gap) مش موجودة مرة واحدة'; end if;
  execute replace(d, a, a || ' and not a.overbook');
end $$;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_overbook;
  alter function public.command_before_overbook(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_overbook(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function clinic_reception.overbook_can_manage(p_workspace uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin perform clinic_reception.access(p_workspace, 'manage'); return true;
exception when others then return false; end $$;
revoke all on function clinic_reception.overbook_can_manage(uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; prev jsonb; t timestamptz; e timestamptz; pid uuid; prv uuid; svc uuid; why text; kind text; nh int; nd int; v uuid; out jsonb; day date;
begin
  if p_action <> 'overbook' then
    return clinic_reception.command_before_overbook(p_workspace, p_action, p_payload, p_token);
  end if;
  me := clinic_reception.access(p_workspace, 'book');
  select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
  if found then return prev; end if;
  pid := nullif(p_payload->>'patient_id', '')::uuid; prv := nullif(p_payload->>'provider_id', '')::uuid;
  svc := nullif(p_payload->>'service_id', '')::uuid; t := nullif(p_payload->>'starts_at', '')::timestamptz;
  kind := nullif(btrim(coalesce(p_payload->>'reason_kind', '')), ''); why := btrim(coalesce(p_payload->>'reason', ''));
  if pid is null or prv is null or svc is null or t is null then raise exception 'اختار المريض والدكتور والخدمة والوقت'; end if;
  if not exists (select 1 from clinic_reception.patients where id = pid and workspace_id = p_workspace)
     or not exists (select 1 from clinic_reception.providers where id = prv and workspace_id = p_workspace)
     or not exists (select 1 from clinic_reception.services where id = svc and workspace_id = p_workspace and active) then
    raise exception 'المريض أو الدكتور أو الخدمة مش متاحين';
  end if;
  why := btrim(concat_ws(' — ', kind, nullif(why, '')));
  if length(why) < 3 then raise exception 'اكتب سبب الحجز الإضافي'; end if;
  e := t + interval '5 minutes';
  if t < now() - interval '2 hours' then raise exception 'الوقت ده فات — اختار وقت جاي'; end if;
  if not exists (select 1 from clinic_reception.availability a where a.provider_id = prv and a.starts_at <= t and a.ends_at >= e) then
    raise exception 'الدكتور مش متواجد في الوقت ده — الموعد الإضافي لازم يكون جوه مواعيد تواجده';
  end if;
  day := (t at time zone 'Africa/Cairo')::date;
  select count(*) filter (where date_trunc('hour', x.starts_at at time zone 'Africa/Cairo') = date_trunc('hour', t at time zone 'Africa/Cairo')),
         count(*) into nh, nd
    from clinic_reception.appointments x
    where x.provider_id = prv and x.overbook and x.status not in ('cancelled', 'no_show') and (x.starts_at at time zone 'Africa/Cairo')::date = day;
  if (nh >= 2 or nd >= 6) and not clinic_reception.overbook_can_manage(p_workspace) then
    raise exception 'وصلت لحد المواعيد الإضافية للدكتور ده (٢ في الساعة و٦ في اليوم) — كلّم مدير الاستقبال' using hint = 'overbook_limit';
  end if;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, source, source_evidence,
      created_by, overbook, overbook_reason, overbook_by)
    values (p_workspace, pid, prv, svc, t, e, 'overbook', 'unknown', me, true, left(why, 300), me) returning id into v;
  out := jsonb_build_object('id', v, 'overbook', true, 'hour_count', nh + 1, 'day_count', nd + 1);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail) values (p_workspace, me, 'overbook', v, out || jsonb_build_object('reason', why));
  insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
