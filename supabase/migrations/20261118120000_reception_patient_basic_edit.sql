-- Owner 2026-11-18: reception may edit a patient's BASIC data (name, phone, gender, age) without archive access and without touching
-- medical files. Until now «تعديل بيانات المريض» opened the archive editor, which needs has_archive_access (0 of 6 reception/CS staff have it).
-- One SECURITY DEFINER entry point, gated by the reception workspace capability 'book'. It updates the reception file and, when linked,
-- the archive patient row's basic columns only (the existing patient_basics_guard trigger still validates name/phone/age and duplicates).
-- No medical tables, files, national id or visit data are read or written. Every change is audited in clinic_reception.audit
-- (old/new values). Rollback: supabase/rollbacks/20261118120000_reception_patient_basic_edit.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.access(uuid,text)') is null or to_regclass('clinic_reception.audit') is null then
    raise exception 'مكونات الاستقبال غير موجودة';
  end if;
  if to_regprocedure('public.clinic_reception_patient_basic(uuid,text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.clinic_reception_patient_basic(p_workspace uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; rp clinic_reception.patients%rowtype; ap record; nm text; ph text; gd text; ag int; before jsonb;
begin
  me := clinic_reception.access(p_workspace, 'book');
  select * into rp from clinic_reception.patients where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace for update;
  if not found then raise exception 'ملف المريض غير موجود'; end if;
  if rp.patient_id is not null then
    select full_name, phone, gender, age into ap from public.patients where id = rp.patient_id;
  end if;
  before := jsonb_build_object('name', coalesce(ap.full_name, rp.name), 'phone', coalesce(ap.phone, rp.phone), 'gender', coalesce(ap.gender, rp.gender),
    'age', coalesce(ap.age, case when rp.birth_date is not null then extract(year from age(rp.birth_date))::int end));
  if p_action = 'get' then
    return before || jsonb_build_object('id', rp.id, 'file_no', rp.file_no, 'linked', rp.patient_id is not null);
  elsif p_action <> 'update' then
    raise exception 'إجراء غير معروف';
  end if;
  nm := regexp_replace(trim(coalesce(p_payload->>'name', '')), '\s+', ' ', 'g');
  ph := trim(coalesce(p_payload->>'phone', ''));
  gd := nullif(p_payload->>'gender', '');
  ag := nullif(p_payload->>'age', '')::int;
  if array_length(regexp_split_to_array(nm, ' '), 1) < 2 or length(nm) > 180 then raise exception 'اكتب اسم المريض من كلمتين على الأقل'; end if;
  if regexp_replace(ph, '\D', '', 'g') !~ '^[0-9]{8,15}$' then raise exception 'رقم التليفون غير صحيح'; end if;
  if gd is not null and gd not in ('male', 'female') then raise exception 'النوع غير صحيح'; end if;
  if ag is not null and (ag < 0 or ag > 130) then raise exception 'السن من صفر إلى 130 سنة'; end if;
  update clinic_reception.patients set name = nm, phone = ph, gender = coalesce(gd, gender) where id = rp.id;
  if rp.patient_id is not null then
    update public.patients set full_name = nm, phone = ph, gender = coalesce(gd, gender), age = coalesce(ag, age), updated_at = now() where id = rp.patient_id;
  end if;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'patient_basic_update', rp.id, jsonb_build_object('before', before, 'after', jsonb_build_object('name', nm, 'phone', ph, 'gender', gd, 'age', ag)));
  return jsonb_build_object('id', rp.id, 'name', nm, 'phone', ph, 'gender', coalesce(gd, rp.gender), 'age', ag, 'linked', rp.patient_id is not null);
end $$;
revoke all on function public.clinic_reception_patient_basic(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_patient_basic(uuid, text, jsonb) to authenticated;

commit;
