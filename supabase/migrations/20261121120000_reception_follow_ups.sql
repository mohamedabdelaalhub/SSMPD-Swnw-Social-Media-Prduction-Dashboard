-- «متابعة مطلوبة» (owner 2026-11-21 «طبقه»; mockup docs/ui-references/mockups/followups-*; reminder window «أسبوعين»).
-- Replaces fake no-time bookings for «تعالى بعد ٣ شهور»: a follow-up is a reminder, NOT an appointment — it takes no
-- slot in the doctor's schedule until reception books it.
-- * clinic_reception.follow_ups: patient (reception patient), doctor (provider), optional service, due date, note, status
--   open / booked / closed, call attempts; clinic_reception.follow_up_events: every action with who + when.
-- * public.clinic_reception_follow_ups(workspace, action, payload):
--     list     {scope: due (late + due within 14 days, default) | late | all | booked}
--     create   {patient_id, provider_id, service_id?, due_date | months | weeks, note?, source_appointment_id?}
--     attempt  {id, note?}            «اتصلت — مردتش»
--     postpone {id, due_date}         «أجّل»
--     close    {id, reason}           «مش محتاجة»
--   view = reception «view»; changes = reception «execute» or «book» (reception, nursing, doctors).
-- * Booking links itself: when a booked appointment is created for the same patient + doctor between 30 days before and
--   60 days after the due date, the open follow-up becomes «اتحجزت» with that appointment (trigger, any booking path).
-- Rollback: supabase/rollbacks/20261121120000_reception_follow_ups.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.follow_ups') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.follow_ups(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id),
  provider_id uuid not null references clinic_reception.providers(id),
  service_id uuid references clinic_reception.services(id),
  due_date date not null,
  note text check (note is null or length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'booked', 'closed')),
  close_reason text,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  source_appointment_id uuid references clinic_reception.appointments(id),
  booked_appointment_id uuid references clinic_reception.appointments(id),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index follow_ups_open_idx on clinic_reception.follow_ups(workspace_id, status, due_date);
create index follow_ups_patient_idx on clinic_reception.follow_ups(patient_id, provider_id) where status = 'open';
create table clinic_reception.follow_up_events(
  id bigserial primary key,
  follow_up_id uuid not null references clinic_reception.follow_ups(id) on delete cascade,
  kind text not null check (kind in ('created', 'attempt', 'postponed', 'booked', 'closed')),
  note text, actor_id uuid references public.admins(id), at timestamptz not null default now()
);
alter table clinic_reception.follow_ups enable row level security;
alter table clinic_reception.follow_up_events enable row level security;
revoke all on clinic_reception.follow_ups, clinic_reception.follow_up_events from public, anon, authenticated;

create function clinic_reception.follow_up_can_change(p_workspace uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid;
begin
  begin me := clinic_reception.access(p_workspace, 'execute'); exception when others then me := null; end;
  if me is null then me := clinic_reception.access(p_workspace, 'book'); end if;   -- raises the normal access error
  return me;
end $$;

create function public.clinic_reception_follow_ups(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; f clinic_reception.follow_ups%rowtype; v_id uuid; d date; today date := (now() at time zone 'Africa/Cairo')::date;
  sc text := coalesce(nullif(p_payload->>'scope', ''), 'due');
begin
  if p_action = 'list' then
    me := clinic_reception.access(p_workspace, 'view');
    return jsonb_build_object('today', today, 'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'patient_id', x.patient_id, 'patient_name', p.name, 'phone', p.phone, 'file_no', p.file_no,
        'provider_id', x.provider_id, 'doctor_name', pr.name, 'service_id', x.service_id, 'service_name', s.name, 'due_date', x.due_date,
        'days', x.due_date - today, 'note', x.note, 'status', x.status, 'close_reason', x.close_reason, 'attempts', x.attempts,
        'last_attempt_at', x.last_attempt_at, 'booked_appointment_id', x.booked_appointment_id, 'created_at', x.created_at)
        order by x.due_date, p.name)
      from clinic_reception.follow_ups x
      join clinic_reception.patients p on p.id = x.patient_id
      join clinic_reception.providers pr on pr.id = x.provider_id
      left join clinic_reception.services s on s.id = x.service_id
      where x.workspace_id = p_workspace and case sc
        when 'late' then x.status = 'open' and x.due_date < today
        when 'booked' then x.status = 'booked'
        when 'all' then true
        else x.status = 'open' and x.due_date <= today + 14 end), '[]'::jsonb),
      'counts', (select jsonb_build_object('late', count(*) filter (where due_date < today), 'today', count(*) filter (where due_date = today),
                  'soon', count(*) filter (where due_date > today and due_date <= today + 14))
                 from clinic_reception.follow_ups where workspace_id = p_workspace and status = 'open'));
  end if;

  me := clinic_reception.follow_up_can_change(p_workspace);
  if p_action = 'create' then
    if not exists (select 1 from clinic_reception.patients where id = (p_payload->>'patient_id')::uuid and workspace_id = p_workspace) then raise exception 'اختار المريض'; end if;
    if not exists (select 1 from clinic_reception.providers where id = (p_payload->>'provider_id')::uuid and workspace_id = p_workspace and active) then raise exception 'اختار الطبيب'; end if;
    if nullif(p_payload->>'service_id', '') is not null and not exists (select 1 from clinic_reception.services
         where id = (p_payload->>'service_id')::uuid and workspace_id = p_workspace and active) then raise exception 'الخدمة غير متاحة'; end if;
    d := coalesce(nullif(p_payload->>'due_date', '')::date,
                  today + make_interval(months => coalesce(nullif(p_payload->>'months', '')::int, 0), weeks => coalesce(nullif(p_payload->>'weeks', '')::int, 0)));
    if d <= today then raise exception 'اختار ميعاد المتابعة (بعد النهارده)'; end if;
    if d > today + 730 then raise exception 'ميعاد المتابعة بعيد جدًا (أقصى سنتين)'; end if;
    insert into clinic_reception.follow_ups(workspace_id, patient_id, provider_id, service_id, due_date, note, source_appointment_id, created_by)
      values (p_workspace, (p_payload->>'patient_id')::uuid, (p_payload->>'provider_id')::uuid, nullif(p_payload->>'service_id', '')::uuid, d,
              left(nullif(btrim(p_payload->>'note'), ''), 300),
              (select a.id from clinic_reception.appointments a where a.id = nullif(p_payload->>'source_appointment_id', '')::uuid and a.workspace_id = p_workspace), me)
      returning id into v_id;
    insert into clinic_reception.follow_up_events(follow_up_id, kind, note, actor_id) values (v_id, 'created', to_char(d, 'YYYY-MM-DD'), me);
    return jsonb_build_object('id', v_id, 'due_date', d);
  end if;

  select * into f from clinic_reception.follow_ups where id = (p_payload->>'id')::uuid and workspace_id = p_workspace for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;
  if f.status <> 'open' then raise exception 'المتابعة دي اتقفلت بالفعل'; end if;
  if p_action = 'attempt' then
    update clinic_reception.follow_ups set attempts = attempts + 1, last_attempt_at = now(), updated_at = now() where id = f.id;
    insert into clinic_reception.follow_up_events(follow_up_id, kind, note, actor_id) values (f.id, 'attempt', left(nullif(btrim(p_payload->>'note'), ''), 200), me);
  elsif p_action = 'postpone' then
    d := nullif(p_payload->>'due_date', '')::date;
    if d is null or d <= today then raise exception 'اختار تاريخ جديد بعد النهارده'; end if;
    update clinic_reception.follow_ups set due_date = d, updated_at = now() where id = f.id;
    insert into clinic_reception.follow_up_events(follow_up_id, kind, note, actor_id) values (f.id, 'postponed', to_char(f.due_date, 'YYYY-MM-DD') || ' → ' || to_char(d, 'YYYY-MM-DD'), me);
  elsif p_action = 'close' then
    if length(btrim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب سبب قفل المتابعة'; end if;
    update clinic_reception.follow_ups set status = 'closed', close_reason = left(btrim(p_payload->>'reason'), 200), updated_at = now() where id = f.id;
    insert into clinic_reception.follow_up_events(follow_up_id, kind, note, actor_id) values (f.id, 'closed', left(btrim(p_payload->>'reason'), 200), me);
  else
    raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object('id', f.id, 'ok', true);
end $$;
revoke all on function public.clinic_reception_follow_ups(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_follow_ups(uuid, text, jsonb) to authenticated;
revoke all on function clinic_reception.follow_up_can_change(uuid) from public, anon, authenticated;

-- a booking for the same patient + doctor near the due date closes the follow-up as «اتحجزت»
create function clinic_reception.follow_up_link_booking() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid;
begin
  if new.status <> 'booked' then return new; end if;
  select id into v from clinic_reception.follow_ups
   where workspace_id = new.workspace_id and patient_id = new.patient_id and provider_id = new.provider_id and status = 'open'
     and (new.starts_at at time zone 'Africa/Cairo')::date between due_date - 30 and due_date + 60
   order by abs((new.starts_at at time zone 'Africa/Cairo')::date - due_date) limit 1 for update;
  if v is not null then
    update clinic_reception.follow_ups set status = 'booked', booked_appointment_id = new.id, updated_at = now() where id = v;
    insert into clinic_reception.follow_up_events(follow_up_id, kind, note, actor_id) values (v, 'booked', new.id::text, public.my_admin_id());
  end if;
  return new;
exception when others then
  raise warning 'follow-up link skipped: %', sqlerrm;   -- never block a booking
  return new;
end $$;
revoke all on function clinic_reception.follow_up_link_booking() from public, anon, authenticated;
create trigger follow_up_link_booking after insert on clinic_reception.appointments
  for each row execute function clinic_reception.follow_up_link_booking();

commit;
