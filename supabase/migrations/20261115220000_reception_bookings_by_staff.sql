-- Owner (2026-11-15): managers want to see the bookings each employee made during a day, another day or a period.
-- Read-only report for super_admin / general_manager. Filters by when the booking was CREATED (Cairo date),
-- not by the appointment date. No phone numbers or national ids are returned; admin email is never exposed.
create or replace function public.clinic_reception_bookings_by_staff(p_workspace uuid, p_from date, p_to date, p_staff uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows jsonb;
  v_staff jsonb;
begin
  perform clinic_reception.access(p_workspace,'view');
  if not (public.has_role('super_admin') or public.has_role('general_manager')) then
    raise exception 'حجوزات الموظفين متاحة للمدير العام والسوبر أدمن فقط' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'اختار فترة صحيحة (من قبل إلى)';
  end if;
  if p_to - p_from > 92 then
    raise exception 'أقصى فترة ٩٣ يوم';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.created_by, 'name', s.name, 'count', s.n) order by s.n desc, s.name), '[]'::jsonb)
    into v_staff
  from (
    select a.created_by, coalesce(nullif(trim(ad.name),''),'موظف بدون اسم') as name, count(*) as n
    from clinic_reception.appointments a
    left join public.admins ad on ad.id = a.created_by
    where a.workspace_id = p_workspace
      and (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    group by a.created_by, ad.name
  ) s;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select a.id, a.created_at, a.created_by,
           coalesce(nullif(trim(ad.name),''),'موظف بدون اسم') as created_by_name,
           p.name as patient_name, p.file_no, pr.name as provider_name, s.name as service_name,
           a.starts_at, a.status, a.source
    from clinic_reception.appointments a
    join clinic_reception.patients p on p.id = a.patient_id
    join clinic_reception.providers pr on pr.id = a.provider_id
    join clinic_reception.services s on s.id = a.service_id
    left join public.admins ad on ad.id = a.created_by
    where a.workspace_id = p_workspace
      and (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
      and (p_staff is null or a.created_by = p_staff)
    order by a.created_at desc
    limit 2000
  ) x;

  return jsonb_build_object('from', p_from, 'to', p_to, 'staff', v_staff, 'rows', v_rows, 'capped', jsonb_array_length(v_rows) >= 2000);
end $$;

revoke all on function public.clinic_reception_bookings_by_staff(uuid,date,date,uuid) from public, anon;
grant execute on function public.clinic_reception_bookings_by_staff(uuid,date,date,uuid) to authenticated;
