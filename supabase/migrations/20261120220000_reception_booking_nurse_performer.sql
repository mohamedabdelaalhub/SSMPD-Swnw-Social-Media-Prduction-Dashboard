-- Home nursing, phase 1 (owner 2026-11-20 approved mockup docs/ui-references/mockups/home-nursing-booking.html):
-- the booking records who performs the service — the doctor (default), a nurse alone, or a nurse with a doctor —
-- and which nurse. The nurse's time is held: the same nurse cannot have two active bookings that overlap.
-- No money here: the nurse's share on reception visits is phase 2 (an accounting decision first).
--   * appointments.performer_mode ('doctor' | 'nurse_alone' | 'nurse_with_doctor'), appointments.nurse_admin_id.
--   * public.clinic_reception_nurses(workspace): active admins whose role or extra role is nursing / head_nursing
--     (name + HR code from clinic_people.people when present). Needs the reception 'book' capability.
--   * public.clinic_reception_command wraps 'book' / 'walk_in' / 'reschedule': validates performer_mode / nurse_admin_id,
--     strips them before the inner command, then stores them and checks the nurse's overlap on the saved times.
-- Rollback: supabase/rollbacks/20261120220000_reception_booking_nurse_performer.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.appointments') is null or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.command_before_nurse(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

alter table clinic_reception.appointments
  add column if not exists performer_mode text not null default 'doctor',
  add column if not exists nurse_admin_id uuid references public.admins(id);
alter table clinic_reception.appointments drop constraint if exists appointments_performer_check;
alter table clinic_reception.appointments add constraint appointments_performer_check check (
  performer_mode in ('doctor', 'nurse_alone', 'nurse_with_doctor')
  and ((performer_mode = 'doctor') = (nurse_admin_id is null)));
create index if not exists appointments_nurse_idx on clinic_reception.appointments(nurse_admin_id, starts_at) where nurse_admin_id is not null;

create function clinic_reception.is_nurse(p_admin uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.admins a where a.id = p_admin and a.active
    and (a.role in ('nursing', 'head_nursing')
         or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('nursing', 'head_nursing'))))
$$;
revoke all on function clinic_reception.is_nurse(uuid) from public, anon, authenticated;

create function public.clinic_reception_nurses(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare people boolean := to_regclass('clinic_people.people') is not null; out jsonb;
begin
  perform clinic_reception.access(p_workspace, 'book');
  if people then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', coalesce(p.full_name, a.name, a.email), 'code', p.code) order by coalesce(p.full_name, a.name, a.email)), '[]')
      from public.admins a left join clinic_people.people p on p.admin_id = a.id where clinic_reception.is_nurse(a.id)$q$ into out;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', coalesce(a.name, a.email), 'code', null) order by coalesce(a.name, a.email)), '[]')
      into out from public.admins a where clinic_reception.is_nurse(a.id);
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_nurses(uuid) from public, anon;
grant execute on function public.clinic_reception_nurses(uuid) to authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_nurse;
  alter function public.command_before_nurse(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_nurse(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare out jsonb; mode text; nurse uuid; a record; clash record;
begin
  if p_action not in ('book', 'walk_in', 'reschedule') or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'performer_mode' or p_payload ? 'nurse_admin_id') then
    return clinic_reception.command_before_nurse(p_workspace, p_action, p_payload, p_token);
  end if;
  mode := coalesce(nullif(p_payload->>'performer_mode', ''), 'doctor');
  nurse := nullif(p_payload->>'nurse_admin_id', '')::uuid;
  if mode not in ('doctor', 'nurse_alone', 'nurse_with_doctor') then raise exception 'اختار مين اللي هينفّذ الخدمة'; end if;
  if mode = 'doctor' then nurse := null;
  elsif nurse is null then raise exception 'اختار الممرض/ة اللي هينفّذ';
  elsif not clinic_reception.is_nurse(nurse) then raise exception 'الشخص ده مش متسجّل في التمريض';
  end if;

  out := clinic_reception.command_before_nurse(p_workspace, p_action, p_payload - 'performer_mode' - 'nurse_admin_id', p_token);
  if nullif(out->>'id', '') is null then return out; end if;
  update clinic_reception.appointments x set performer_mode = mode, nurse_admin_id = nurse
    where x.workspace_id = p_workspace and x.id = (out->>'id')::uuid
    returning x.id, x.starts_at, x.ends_at into a;
  if nurse is not null and a.id is not null then
    select x.starts_at, coalesce(ad.name, 'الممرض/ة') as who into clash
      from clinic_reception.appointments x left join public.admins ad on ad.id = x.nurse_admin_id
      where x.nurse_admin_id = nurse and x.id <> a.id and x.status in ('booked', 'arrived')
        and x.starts_at < a.ends_at and x.ends_at > a.starts_at
      order by x.starts_at limit 1;
    if found then
      raise exception '% عنده/عندها زيارة تانية في نفس الوقت (الساعة %) — اختار وقت أو ممرض/ة تاني', clash.who,
        to_char(clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI') using hint = 'nurse_overlap';
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
