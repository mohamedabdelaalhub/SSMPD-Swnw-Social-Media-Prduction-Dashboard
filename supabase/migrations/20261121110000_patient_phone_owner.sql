-- «صاحب الرقم» — one phone on several patient files (owner batch 2026-11-21 item 3; mockup docs/ui-references/mockups/phone-owner-*;
-- owner rule: «المهم انه يحدد العلاقة بين الرقم والملف اللي مستخدم فيه نفس الرقم تاني»).
-- * public.patients.phone_owner: self / husband / wife / mother / father / other (+ phone_owner_note for «أخرى»). Null = not
--   recorded (old files). Shown next to the phone; does not change who can see the file.
-- * clinic_reception.require_phone_owner(phone, owner, exclude): raises «الرقم ده متسجّل على ملف تاني — اختار صاحب الرقم» when
--   another ACTIVE file already uses this phone and no relationship is given. Used by the staff paths that create a file on a
--   phone: the automatic-bookings «ملف جديد» choice (patients-create, the archive «مريض جديد» edge function, applies the
--   same rule in TypeScript).
--   Lead / psychology / auto-created Masa files (no other file on the phone) are unchanged.
-- * public.patient_phone_peers(phone, exclude): the other active files on a phone with their relationship, for the forms.
-- * public.clinic_reception_auto_book('resolve_patient', choice 'new'): accepts phone_owner / phone_owner_note (in-place patch,
--   anchors must occur once, old body saved).
-- Rollback: supabase/rollbacks/20261121110000_patient_phone_owner.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.require_phone_owner(text,text,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table public.patients add column if not exists phone_owner text
  check (phone_owner in ('self', 'husband', 'wife', 'mother', 'father', 'other'));
alter table public.patients add column if not exists phone_owner_note text check (phone_owner_note is null or length(phone_owner_note) <= 60);

create function clinic_reception.require_phone_owner(p_phone text, p_owner text, p_exclude uuid default null) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if nullif(btrim(coalesce(p_owner, '')), '') is not null then
    if p_owner not in ('self', 'husband', 'wife', 'mother', 'father', 'other') then raise exception 'صاحب الرقم غير معروف'; end if;
    return;
  end if;
  if exists (select 1 from public.patients x where x.status = 'active' and x.id is distinct from p_exclude
              and psychcare.phone(x.phone) = psychcare.phone(p_phone)) then
    raise exception 'الرقم ده متسجّل على ملف تاني — اختار صاحب الرقم (نفس المريض / الزوج / الزوجة / الأم / الأب / أخرى)';
  end if;
end $$;
revoke all on function clinic_reception.require_phone_owner(text, text, uuid) from public, anon, authenticated;

create function public.patient_phone_peers(p_phone text, p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if public.my_admin_id() is null or not (public.has_archive_access() or public.can_access_leads()
       or coalesce((select has_archive_reception_access from public.admins where id = public.my_admin_id()), false)) then
    raise exception 'لا توجد صلاحية' using errcode = '42501';
  end if;
  if length(psychcare.phone(p_phone)) < 8 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'patient_code', x.patient_code,
            'phone_owner', x.phone_owner, 'phone_owner_note', x.phone_owner_note) order by x.created_at)
           from public.patients x where x.status = 'active' and x.id is distinct from p_exclude
            and psychcare.phone(x.phone) = psychcare.phone(p_phone)), '[]'::jsonb);
end $$;
revoke all on function public.patient_phone_peers(text, uuid) from public, anon;
grant execute on function public.patient_phone_peers(text, uuid) to authenticated;

create table if not exists clinic_reception.phone_owner_saved_defs(name text primary key, def text not null);
revoke all on clinic_reception.phone_owner_saved_defs from public, anon, authenticated;
do $$
declare d text; n int;
  a1 constant text := E'      insert into public.patients(full_name, phone, phone_normalized, age, created_by)\n';
  b1 constant text := E'      perform clinic_reception.require_phone_owner(coalesce(nullif(p_payload->>''phone'', ''''), b.phone), p_payload->>''phone_owner'');\n'
                   || E'      insert into public.patients(full_name, phone, phone_normalized, age, created_by, phone_owner, phone_owner_note)\n';
  a2 constant text := $a$(p_payload->>'age')::int, me) returning id into pid;$a$;
  b2 constant text := $b$(p_payload->>'age')::int, me, nullif(p_payload->>'phone_owner', ''), left(nullif(btrim(p_payload->>'phone_owner_note'), ''), 60)) returning id into pid;$b$;
begin
  d := pg_get_functiondef('public.clinic_reception_auto_book(uuid,text,jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'auto-book resolve: insert anchor found % times', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'auto-book resolve: values anchor found % times', n; end if;
  insert into clinic_reception.phone_owner_saved_defs values ('clinic_reception_auto_book', d) on conflict (name) do update set def = excluded.def;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

commit;
