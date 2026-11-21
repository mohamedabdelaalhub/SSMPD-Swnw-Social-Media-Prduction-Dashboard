-- «تذكيرات بكرة» (owner approved mockup docs/ui-references/mockups/tomorrow-reminders.*).
-- Reception reminds each of tomorrow's patients BY HAND on WhatsApp. The dashboard only prepares the wa.me link; opening
-- WhatsApp is NOT sending. A reminder counts as «اتبعت» only when the employee presses «✓ اتبعت» (recorded with who + when).
-- * clinic_reception.booking_reminders: one row per (booking ref, booking day) once marked «اتبعت» or «مردش».
--   No row = «لسه ماتبعتش». ref = 'cb:<customer_bookings.id>' (agent / WhatsApp) or 'masa:<official_booking_id>'.
-- * public.clinic_reception_reminders(workspace, action, payload):
--     list {day?}   day defaults to tomorrow (Africa/Cairo). Bookings from public.customer_bookings (confirmed / rescheduled)
--                   + clinic_reception.masa_bookings (active; a Masa booking already mirrored in customer_bookings by its
--                   official booking id is shown once), each with its reminder state.
--     mark {ref, day, status: sent | no_answer | pending, note?}   pending = undo (deletes the row).
--   access = reception «book»; every mark is written to clinic_reception.audit.
-- Rollback: supabase/rollbacks/20261121160000_reception_tomorrow_reminders.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.booking_reminders') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.booking_reminders(
  ref text not null check (ref ~ '^(cb|masa):.+' and length(ref) <= 120),
  booking_day date not null,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  status text not null check (status in ('sent', 'no_answer')),
  note text check (note is null or length(note) <= 300),
  marked_by uuid not null references public.admins(id),
  marked_at timestamptz not null default now(),
  primary key (ref, booking_day)
);
create index booking_reminders_day_idx on clinic_reception.booking_reminders(workspace_id, booking_day);
alter table clinic_reception.booking_reminders enable row level security;
revoke all on clinic_reception.booking_reminders from public, anon, authenticated;

create function public.clinic_reception_reminders(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v_day date; v_ref text; v_status text; v_note text; v_rows jsonb;
begin
  me := clinic_reception.access(p_workspace, 'book');
  v_day := coalesce(nullif(p_payload->>'day', '')::date, (now() at time zone 'Africa/Cairo')::date + 1);

  if p_action = 'list' then
    with cb as (
      select 'cb:' || c.id::text as ref, c.customer_name as name, c.phone, c.doctor_name as doctor, c.specialty_name as service,
             nullif(btrim(c.appointment_time), '') as tm, coalesce(c.booking_reference, c.official_booking_id) as booking_ref,
             coalesce(c.channel, 'whatsapp') as source, false as day_only
        from public.customer_bookings c
       where c.appointment_date = v_day and c.status in ('confirmed', 'rescheduled')
    ), ms as (
      select 'masa:' || m.official_booking_id as ref, m.patient_name as name, m.phone, coalesce(pr.name, l.masa_name) as doctor,
             m.needed_service as service,
             case when m.day_only then null else to_char(m.starts_at at time zone 'Africa/Cairo', 'HH24:MI') end as tm,
             m.official_booking_id as booking_ref, 'masa'::text as source, m.day_only
        from clinic_reception.masa_bookings m
        left join clinic_reception.masa_doctor_links l on l.masa_doctor_id = m.masa_doctor_id
        left join clinic_reception.providers pr on pr.id = coalesce(m.provider_id, l.provider_id)
       where m.workspace_id = p_workspace and m.status = 'active'
         and (m.starts_at at time zone 'Africa/Cairo')::date = v_day
         and not exists (select 1 from public.customer_bookings c2
                          where c2.appointment_date = v_day and c2.status in ('confirmed', 'rescheduled')
                            and c2.official_booking_id = m.official_booking_id)
    ), x as (select * from cb union all select * from ms)
    select coalesce(jsonb_agg(jsonb_build_object('ref', x.ref, 'name', x.name, 'phone', x.phone, 'doctor', x.doctor, 'service', x.service,
             'time', x.tm, 'day_only', x.day_only, 'booking_ref', x.booking_ref, 'source', x.source,
             'status', coalesce(r.status, 'pending'), 'note', r.note, 'marked_by', r.marked_by, 'marked_by_name', a.name,
             'marked_at', r.marked_at, 'marked_time', to_char(r.marked_at at time zone 'Africa/Cairo', 'HH24:MI'))
             order by x.tm nulls last, x.name), '[]'::jsonb)
      into v_rows
      from x
      left join clinic_reception.booking_reminders r on r.ref = x.ref and r.booking_day = v_day and r.workspace_id = p_workspace
      left join public.admins a on a.id = r.marked_by;
    return jsonb_build_object('day', v_day, 'rows', v_rows, 'counts', jsonb_build_object(
      'pending', (select count(*) from jsonb_array_elements(v_rows) e where e->>'status' = 'pending'),
      'sent', (select count(*) from jsonb_array_elements(v_rows) e where e->>'status' = 'sent'),
      'no_answer', (select count(*) from jsonb_array_elements(v_rows) e where e->>'status' = 'no_answer'),
      'all', jsonb_array_length(v_rows)));
  end if;

  if p_action = 'mark' then
    v_ref := btrim(coalesce(p_payload->>'ref', ''));
    v_status := coalesce(nullif(p_payload->>'status', ''), 'sent');
    v_note := left(nullif(btrim(p_payload->>'note'), ''), 300);
    if v_ref !~ '^(cb|masa):.+' or length(v_ref) > 120 then raise exception 'الحجز غير معروف'; end if;
    if nullif(p_payload->>'day', '') is null then raise exception 'اختار اليوم'; end if;
    if v_status not in ('sent', 'no_answer', 'pending') then raise exception 'حالة التذكير غير معروفة'; end if;
    if (v_ref like 'cb:%' and not exists (select 1 from public.customer_bookings c
                                          where c.id::text = substring(v_ref from 4) and c.appointment_date = v_day))
       or (v_ref like 'masa:%' and not exists (select 1 from clinic_reception.masa_bookings m
                                               where m.official_booking_id = substring(v_ref from 6) and m.workspace_id = p_workspace
                                                 and (m.starts_at at time zone 'Africa/Cairo')::date = v_day)) then
      raise exception 'الحجز مش موجود في اليوم ده';
    end if;
    if v_status = 'pending' then
      delete from clinic_reception.booking_reminders where ref = v_ref and booking_day = v_day and workspace_id = p_workspace;
    else
      insert into clinic_reception.booking_reminders(ref, booking_day, workspace_id, status, note, marked_by, marked_at)
        values (v_ref, v_day, p_workspace, v_status, v_note, me, now())
        on conflict (ref, booking_day) do update set workspace_id = excluded.workspace_id, status = excluded.status,
          note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
    end if;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'reminder_' || v_status, null, jsonb_build_object('ref', v_ref, 'day', v_day, 'note', v_note));
    return jsonb_build_object('ref', v_ref, 'day', v_day, 'status', v_status, 'ok', true);
  end if;

  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_reminders(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_reminders(uuid, text, jsonb) to authenticated;

commit;
