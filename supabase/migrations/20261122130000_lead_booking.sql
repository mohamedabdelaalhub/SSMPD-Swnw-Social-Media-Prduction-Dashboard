-- «الحجز من الليدز» (owner 2026-11-22 «طبق الحجز من الليدز وخلي كل الأرقام انجليزي»; mockup docs/ui-references/mockups/
-- lead-booking-* ). Customer service books from the lead with the normal booking screen (existing: lead modal → prepare lead
-- → «حجز موعد» with lead_id → attribution + lead 'booked_on_system'). This adds:
--   * every 'book' carrying a lead_id also logs a lead attempt «حجز: <doctor> — <YYYY-MM-DD HH:MI>» by the booking
--     employee (answered), so the lead history shows who booked and when;
--   * snapshot 'lead_bookings': for the shown appointments booked from a lead → {lead_id, agent (booking employee),
--     source} so الاستقبال tags the card «من الليدز · <agent>»; the «تشغيل اليوم» board RPC
--     (clinic_reception_journey_hub_snapshot, wrapped → clinic_reception.journey_hub_before_lead_booking) returns the same
--     'lead_bookings' for its day;
--   * public.lead_booking_funnel(from, to): per agent (lead owner, else the booking employee) leads → booked → attended
--     (arrived / completed) → paid (the visit invoice has any allocation). Managers see everyone; a customer-service /
--     reception employee sees only their own row.
-- Permissions unchanged: customer service can book / edit / cancel before arrival; arrival and collection stay with
-- reception (clinic_reception.access already enforces it).
-- Rollback: supabase/rollbacks/20261122130000_lead_booking.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null
     or to_regclass('clinic_reception.attributions') is null then raise exception 'مكونات الحجز غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_lead_booking(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_lead_booking;
  alter function public.command_before_lead_booking(uuid, text, jsonb, uuid) set schema clinic_reception;
  alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_lead_booking;
  alter function public.snapshot_before_lead_booking(uuid, date, date) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_lead_booking(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.snapshot_before_lead_booking(uuid, date, date) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare out jsonb; lead uuid; ap record; note text;
begin
  out := clinic_reception.command_before_lead_booking(p_workspace, p_action, p_payload, p_token);
  if p_action = 'book' and jsonb_typeof(p_payload) = 'object' and out ? 'id' then
    begin lead := nullif(p_payload->>'lead_id', '')::uuid; exception when others then lead := null; end;
    if lead is not null and to_regclass('public.lead_attempts') is not null then
      select a.starts_at, pr.name doctor into ap from clinic_reception.appointments a
        join clinic_reception.providers pr on pr.id = a.provider_id where a.id = (out->>'id')::uuid;
      note := 'حجز: ' || coalesce(ap.doctor, '') || ' — ' || to_char(ap.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI');
      if exists (select 1 from public.leads where id = lead)
         and not exists (select 1 from public.lead_attempts where lead_id = lead and notes = note) then
        insert into public.lead_attempts(lead_id, employee_id, result, notes) values (lead, public.my_admin_id(), 'answered', note);
      end if;
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  result := clinic_reception.snapshot_before_lead_booking(p_workspace, p_from, p_to);
  return result || jsonb_build_object('lead_bookings', coalesce((
    select jsonb_object_agg(a.id, jsonb_build_object('lead_id', t.lead_id, 'agent', coalesce(ad.name, ad.email), 'source', t.source))
      from clinic_reception.appointments a
      join clinic_reception.attributions t on t.appointment_id = a.id and t.lead_id is not null
      left join public.admins ad on ad.id = a.created_by
     where a.workspace_id = p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to), '{}'::jsonb));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;

-- «تشغيل اليوم» board: same lead tag data for that day (only where the board RPC exists)
do $hub$ begin
  if to_regprocedure('public.clinic_reception_journey_hub_snapshot(uuid,date)') is null then return; end if;
  alter function public.clinic_reception_journey_hub_snapshot(uuid, date) rename to journey_hub_before_lead_booking;
  alter function public.journey_hub_before_lead_booking(uuid, date) set schema clinic_reception;
  revoke all on function clinic_reception.journey_hub_before_lead_booking(uuid, date) from public, anon, authenticated;
  execute $f$create function public.clinic_reception_journey_hub_snapshot(p_workspace uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
begin
  result := clinic_reception.journey_hub_before_lead_booking(p_workspace, p_day);
  if jsonb_typeof(result) <> 'object' then return result; end if;
  return result || jsonb_build_object('lead_bookings', coalesce((
    select jsonb_object_agg(a.id, jsonb_build_object('lead_id', t.lead_id, 'agent', coalesce(ad.name, ad.email), 'source', t.source))
      from clinic_reception.appointments a
      join clinic_reception.attributions t on t.appointment_id = a.id and t.lead_id is not null
      left join public.admins ad on ad.id = a.created_by
     where a.workspace_id = p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date = d), '{}'::jsonb));
end $$;$f$;
  revoke all on function public.clinic_reception_journey_hub_snapshot(uuid, date) from public, anon;
  grant execute on function public.clinic_reception_journey_hub_snapshot(uuid, date) to authenticated;
end $hub$;

create function public.lead_booking_funnel(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); boss boolean;
begin
  if me is null or not public.can_access_leads() then raise exception 'لا توجد صلاحية' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then raise exception 'اختار فترة حتى سنة'; end if;
  boss := public.has_role('super_admin') or public.has_role('general_manager');
  return coalesce((select jsonb_agg(jsonb_build_object('agent_id', agent, 'agent', coalesce(ad.name, ad.email, '—'),
      'leads', n_leads, 'booked', n_booked, 'attended', n_att, 'paid', n_paid) order by n_leads desc)
    from (
      select x.agent, count(*) n_leads, count(*) filter (where x.booked) n_booked,
             count(*) filter (where x.attended) n_att, count(*) filter (where x.paid) n_paid
        from (
          select l.id, coalesce(l.assigned_to, bk.created_by) agent, bk.id is not null booked,
                 coalesce(bk.attended, false) attended, coalesce(bk.paid, false) paid
            from public.leads l
            left join lateral (
              select a.id, a.created_by, a.status in ('arrived', 'completed') attended,
                     exists (select 1 from clinic_reception.visits v join clinic_reception.invoices i on i.visit_id = v.id
                               join clinic_reception.allocations al on al.invoice_id = i.id where v.appointment_id = a.id) paid
                from clinic_reception.attributions t join clinic_reception.appointments a on a.id = t.appointment_id
               where t.lead_id = l.id and a.status not in ('cancelled')
               order by (a.status in ('arrived', 'completed')) desc, a.created_at limit 1) bk on true
           where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) x
       where boss or x.agent = me
       group by x.agent) g
    left join public.admins ad on ad.id = g.agent), '[]'::jsonb);
end $$;
revoke all on function public.lead_booking_funnel(date, date) from public, anon;
grant execute on function public.lead_booking_funnel(date, date) to authenticated;

commit;
