-- «مؤشرات الحجز من الليدز» by source / campaign (owner 2026-11-22: «الليد دا بيبقي ليه مصدر ولازم يتذكر علشان المؤشرات
-- تبقي دقيقة بعدين»). public.lead_booking_funnel_by(from, to, group): group 'agent' (same as lead_booking_funnel),
-- 'source' or 'campaign'. A booked lead is counted under the source / campaign frozen in its booking attribution
-- (clinic_reception.attributions — copied from the lead at booking time, so later lead edits don't move it); a lead
-- not booked yet uses the lead's current source / campaign. Campaign = utm_campaign, else the Meta campaign id, else
-- «بدون حملة». Same access as lead_booking_funnel: managers see all; others only their own leads (agent = them).
-- Rollback: supabase/rollbacks/20261122131000_lead_funnel_by_source.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.lead_booking_funnel(date,date)') is null then raise exception 'طبّق 20261122130000 الأول'; end if;
end $$;

create function public.lead_booking_funnel_by(p_from date, p_to date, p_group text default 'agent') returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); boss boolean; g text := coalesce(nullif(p_group, ''), 'agent');
begin
  if me is null or not public.can_access_leads() then raise exception 'لا توجد صلاحية' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then raise exception 'اختار فترة حتى سنة'; end if;
  if g not in ('agent', 'source', 'campaign') then raise exception 'اختار التقسيم: الموظف أو المصدر أو الحملة'; end if;
  boss := public.has_role('super_admin') or public.has_role('general_manager');
  return coalesce((select jsonb_agg(jsonb_build_object('key', k, 'label', case when g = 'agent' then coalesce(ad.name, ad.email, '—') else k end,
      'leads', n_leads, 'booked', n_booked, 'attended', n_att, 'paid', n_paid) order by n_leads desc, k)
    from (
      select case g when 'agent' then x.agent::text when 'source' then x.src else x.camp end k,
             count(*) n_leads, count(*) filter (where x.booked) n_booked,
             count(*) filter (where x.attended) n_att, count(*) filter (where x.paid) n_paid
        from (
          select l.id, coalesce(l.assigned_to, bk.created_by) agent, bk.id is not null booked,
                 coalesce(bk.attended, false) attended, coalesce(bk.paid, false) paid,
                 coalesce(nullif(case when bk.id is not null then bk.source else to_jsonb(l)->>'source' end, ''), 'غير معروف') src,
                 coalesce(nullif(case when bk.id is not null then coalesce(bk.utm_campaign, bk.campaign_id)
                                      else coalesce(to_jsonb(l)->>'utm_campaign', to_jsonb(l)->>'meta_campaign_id') end, ''), 'بدون حملة') camp
            from public.leads l
            left join lateral (
              select a.id, a.created_by, t.source, t.campaign_id, t.utm_campaign, a.status in ('arrived', 'completed') attended,
                     exists (select 1 from clinic_reception.visits v join clinic_reception.invoices i on i.visit_id = v.id
                               join clinic_reception.allocations al on al.invoice_id = i.id where v.appointment_id = a.id) paid
                from clinic_reception.attributions t join clinic_reception.appointments a on a.id = t.appointment_id
               where t.lead_id = l.id and a.status not in ('cancelled')
               order by (a.status in ('arrived', 'completed')) desc, a.created_at limit 1) bk on true
           where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) x
       where boss or x.agent = me
       group by 1) gr
    left join public.admins ad on g = 'agent' and ad.id::text = gr.k), '[]'::jsonb);
end $$;
revoke all on function public.lead_booking_funnel_by(date, date, text) from public, anon;
grant execute on function public.lead_booking_funnel_by(date, date, text) to authenticated;

commit;
