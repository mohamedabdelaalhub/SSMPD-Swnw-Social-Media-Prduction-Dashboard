-- Owner 2026-11-19 (approved mockup docs/ui-references/mockups/home-visit-booking.html):
--   * a service can be marked «خدمة منزلية»; a home-visit booking carries the full address + location link so whoever books or is on
--     shift can reach the patient (area, street, building, floor, apartment, landmark, how to reach the door, phone, maps link).
--     The address is kept on the patient file and pre-filled next time; each booking keeps its own snapshot.
--   * patient notes: ONE permanent note on the patient file (shown on every booking/board card until removed) and a temporary note on
--     one booking. Any reception employee can write the permanent note when empty; changing or deleting an existing one is a
--     REQUEST that the workspace manager approves (owner: «أي موظف استقبال يطلب المسح ومديره يعتمد الحذف»).
-- Everything goes through public.clinic_reception_patient_extras(workspace, action, payload); no direct table access.
-- Rollback: supabase/rollbacks/20261119130000_reception_home_visit_notes.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.access(uuid,text)') is null then raise exception 'مكونات الاستقبال غير موجودة'; end if;
  if to_regclass('clinic_reception.patient_profile') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.services add column is_home boolean not null default false;

create table clinic_reception.patient_profile (
  patient_id uuid primary key references clinic_reception.patients(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  address jsonb not null default '{}'::jsonb,
  note text,
  note_by uuid references public.admins(id),
  note_at timestamptz,
  updated_at timestamptz not null default now()
);
create table clinic_reception.appointment_extras (
  appointment_id uuid primary key references clinic_reception.appointments(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  home boolean not null default false,
  address jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid not null references public.admins(id),
  updated_at timestamptz not null default now()
);
create table clinic_reception.patient_note_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id) on delete cascade,
  old_note text,
  new_note text,
  reason text not null,
  requested_by uuid not null references public.admins(id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  review_note text
);
create unique index patient_note_requests_one_pending on clinic_reception.patient_note_requests(patient_id) where status = 'pending';
alter table clinic_reception.patient_profile enable row level security;
alter table clinic_reception.appointment_extras enable row level security;
alter table clinic_reception.patient_note_requests enable row level security;
revoke all on clinic_reception.patient_profile, clinic_reception.appointment_extras, clinic_reception.patient_note_requests from public, anon, authenticated;

-- clean, bounded address object; maps link must be a Google Maps link
create function clinic_reception.clean_address(p jsonb) returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text; out jsonb := '{}'::jsonb; v text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  foreach k in array array['area','street','building','floor','apartment','landmark','directions','phone','maps_url'] loop
    v := nullif(trim(coalesce(p->>k, '')), '');
    if v is null then continue; end if;
    if length(v) > 300 then raise exception 'بيانات العنوان أطول من اللازم'; end if;
    if k = 'maps_url' and v !~* '^https://((www\.)?google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)(/|\?|$)' then
      raise exception 'لينك اللوكيشن لازم يكون لينك خرائط جوجل (يبدأ بـ https://maps.app.goo.gl أو https://www.google.com/maps)'; end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;
end $$;
revoke all on function clinic_reception.clean_address(jsonb) from public, anon, authenticated;

create function clinic_reception.can_manage(p_workspace uuid) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.has_role('super_admin') then return true; end if;
  begin perform clinic_reception.access(p_workspace, 'manage'); return true; exception when others then return false; end;
end $$;
revoke all on function clinic_reception.can_manage(uuid) from public, anon, authenticated;

create function public.clinic_reception_patient_extras(p_workspace uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid; pid uuid := nullif(p_payload->>'patient_id','')::uuid; aid uuid := nullif(p_payload->>'appointment_id','')::uuid;
  prof clinic_reception.patient_profile%rowtype; r clinic_reception.patient_note_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_payload->>'note','')), ''); v_tnote text := nullif(trim(coalesce(p_payload->>'appointment_note','')), '');
  addr jsonb; v_home boolean := coalesce((p_payload->>'home')::boolean, false); res jsonb;
begin
  if p_action in ('service_home','services','note_review','note_requests') then
    me := public.my_admin_id();
    if not clinic_reception.can_manage(p_workspace) then raise exception 'الإجراء ده لمدير الاستقبال بس'; end if;
  else
    me := clinic_reception.access(p_workspace, 'book');
  end if;
  if v_note is not null and length(v_note) > 500 or v_tnote is not null and length(v_tnote) > 500 then raise exception 'الملاحظة أطول من ٥٠٠ حرف'; end if;
  if pid is not null and not exists (select 1 from clinic_reception.patients where id = pid and workspace_id = p_workspace) then raise exception 'المريض خارج المساحة'; end if;

  if p_action = 'get' then
    select * into prof from clinic_reception.patient_profile where patient_id = pid;
    select * into r from clinic_reception.patient_note_requests where patient_id = pid and status = 'pending';
    return jsonb_build_object('address', coalesce(prof.address, '{}'::jsonb), 'note', prof.note, 'note_at', prof.note_at,
      'note_by', (select a.name from public.admins a where a.id = prof.note_by),
      'pending', case when r.id is null then null else jsonb_build_object('id', r.id, 'new_note', r.new_note, 'reason', r.reason, 'requested_at', r.requested_at,
        'requested_by', (select a.name from public.admins a where a.id = r.requested_by)) end,
      'can_manage', clinic_reception.can_manage(p_workspace));

  elsif p_action = 'save_booking' then
    if pid is null then raise exception 'اختار المريض'; end if;
    insert into clinic_reception.patient_profile(patient_id, workspace_id) values (pid, p_workspace) on conflict (patient_id) do nothing;
    select * into prof from clinic_reception.patient_profile where patient_id = pid for update;
    -- permanent note: free to write when empty; an existing different note is changed only through a manager-approved request
    if v_note is not null and prof.note is null then
      update clinic_reception.patient_profile set note = v_note, note_by = me, note_at = now(), updated_at = now() where patient_id = pid;
    elsif v_note is not null and v_note is distinct from prof.note then
      raise exception 'المريض عنده ملاحظة دائمة. لتغييرها أو مسحها اطلب التعديل ومديرك يعتمده';
    end if;
    if v_home then
      addr := clinic_reception.clean_address(p_payload->'address');
      if coalesce(addr->>'area','') = '' or coalesce(addr->>'building','') = '' then raise exception 'اكتب المنطقة ورقم العمارة للزيارة المنزلية'; end if;
      update clinic_reception.patient_profile set address = addr, updated_at = now() where patient_id = pid;
    end if;
    if aid is not null then
      if not exists (select 1 from clinic_reception.appointments where id = aid and workspace_id = p_workspace and patient_id = pid) then raise exception 'الحجز مش لنفس المريض'; end if;
      if v_home or v_tnote is not null then
        insert into clinic_reception.appointment_extras(appointment_id, workspace_id, home, address, note, created_by)
          values (aid, p_workspace, v_home, case when v_home then addr else '{}'::jsonb end, v_tnote, me)
          on conflict (appointment_id) do update set home = excluded.home, address = excluded.address, note = excluded.note, updated_at = now();
      else
        delete from clinic_reception.appointment_extras where appointment_id = aid;
      end if;
    end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'note_change_request' then
    select * into prof from clinic_reception.patient_profile where patient_id = pid;
    if prof.note is null then raise exception 'مفيش ملاحظة دائمة للمريض ده'; end if;
    if length(trim(coalesce(p_payload->>'reason',''))) < 3 then raise exception 'اكتب سبب التعديل أو المسح'; end if;
    if v_note is not distinct from prof.note then raise exception 'الملاحظة الجديدة زي القديمة'; end if;
    if exists (select 1 from clinic_reception.patient_note_requests where patient_id = pid and status = 'pending') then raise exception 'فيه طلب تعديل مستني اعتماد المدير'; end if;
    insert into clinic_reception.patient_note_requests(workspace_id, patient_id, old_note, new_note, reason, requested_by)
      values (p_workspace, pid, prof.note, v_note, trim(p_payload->>'reason'), me) returning * into r;
    return jsonb_build_object('id', r.id, 'status', r.status);

  elsif p_action = 'note_requests' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'patient_id', q.patient_id, 'patient', p.name, 'file_no', p.file_no, 'old_note', q.old_note,
        'new_note', q.new_note, 'reason', q.reason, 'requested_at', q.requested_at, 'requested_by', a.name) order by q.requested_at)
      from clinic_reception.patient_note_requests q join clinic_reception.patients p on p.id = q.patient_id join public.admins a on a.id = q.requested_by
      where q.workspace_id = p_workspace and q.status = 'pending'), '[]'::jsonb);

  elsif p_action = 'note_review' then
    select * into r from clinic_reception.patient_note_requests where id = nullif(p_payload->>'id','')::uuid and workspace_id = p_workspace for update;
    if not found or r.status <> 'pending' then raise exception 'الطلب مش موجود أو اتراجع قبل كده'; end if;
    if coalesce((p_payload->>'approve')::boolean, false) then
      update clinic_reception.patient_profile set note = r.new_note, note_by = case when r.new_note is null then null else r.requested_by end,
        note_at = case when r.new_note is null then null else now() end, updated_at = now() where patient_id = r.patient_id;
      update clinic_reception.patient_note_requests set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(coalesce(p_payload->>'review_note','')), '') where id = r.id;
    else
      update clinic_reception.patient_note_requests set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(coalesce(p_payload->>'review_note','')), '') where id = r.id;
    end if;
    return jsonb_build_object('id', r.id, 'status', case when coalesce((p_payload->>'approve')::boolean, false) then 'approved' else 'rejected' end);

  elsif p_action = 'service_home' then
    update clinic_reception.services set is_home = coalesce((p_payload->>'is_home')::boolean, false)
      where id = nullif(p_payload->>'service_id','')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الخدمة مش موجودة'; end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'services' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'department', department, 'is_home', is_home) order by department, name)
      from clinic_reception.services where workspace_id = p_workspace and active), '[]'::jsonb);

  elsif p_action = 'board' then
    -- extras for the given appointments (today board / booking list): home flag, address snapshot, temporary + permanent notes
    select coalesce(jsonb_object_agg(ap.id, jsonb_build_object('home', coalesce(x.home, false),
        'address', coalesce(x.address, '{}'::jsonb), 'note', x.note, 'patient_note', pf.note, 'service_home', s.is_home)), '{}'::jsonb)
      into res
      from clinic_reception.appointments ap join clinic_reception.services s on s.id = ap.service_id
      left join clinic_reception.appointment_extras x on x.appointment_id = ap.id
      left join clinic_reception.patient_profile pf on pf.patient_id = ap.patient_id
      where ap.workspace_id = p_workspace
        and ap.id in (select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'ids', '[]'::jsonb)) limit 500)
        and (x.appointment_id is not null or pf.note is not null);
    return jsonb_build_object('extras', res, 'home_services', coalesce((select jsonb_agg(id) from clinic_reception.services where workspace_id = p_workspace and is_home), '[]'::jsonb));

  else
    raise exception 'إجراء غير معروف';
  end if;
end $$;
revoke all on function public.clinic_reception_patient_extras(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_patient_extras(uuid, text, jsonb) to authenticated;

commit;
