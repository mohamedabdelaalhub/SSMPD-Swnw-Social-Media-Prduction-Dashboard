-- Ads ROI per campaign: spend -> leads -> bookings -> paid invoices.
-- READ-ONLY objects (a function). Creates no table, changes no data, touches no existing object.
-- Owner target (plan 2026-11-13): cost per booking PHY1 = 120 EGP, LZF1-F = 45 EGP.
--
-- Definitions (from live data 2026-11-18):
--   spend          = sum(meta_ads_daily.spend) for days in [p_from, p_to]
--   attributed lead = lead whose meta_campaign_id, or the campaign of its meta_ad_id, is known
--   booked         = current_status in ('booked_on_system','service_done') OR booking_date/booking_reference is set (owner chose the wide definition, 2026-11-18)
--   attended       = current_status = 'service_done' (the patient actually came; shown next to bookings)
--   revenue        = sum(lead_invoices.amount) of attributed leads (a lead may have several invoices; counted once each)
-- Leads are filtered by received_at in the same window. Campaigns with spend but no leads still appear.
-- RLS: security invoker, so each caller only sees what meta_ads_daily / leads already allow them.

create or replace function public.ads_roi_by_campaign(p_from date default null, p_to date default null)
returns table(
  campaign_id text, campaign_name text, brand text,
  first_day date, last_day date,
  spend numeric, msg_started bigint, form_leads bigint,
  attributed_leads bigint, booked_leads bigint, attended_leads bigint, paid_leads bigint, revenue numeric,
  cost_per_lead numeric, cost_per_booking numeric, cost_per_attended numeric, roas numeric
)
language sql stable security invoker set search_path to 'public' as $$
  with ad_campaign as (
    select distinct on (ad_id) ad_id, campaign_id from public.meta_ads_daily order by ad_id, day desc
  ),
  spend as (
    select d.campaign_id,
           max(d.campaign_name) as campaign_name,
           max(d.brand) as brand,
           min(d.day) as first_day, max(d.day) as last_day,
           sum(d.spend) as spend, sum(d.msg_started)::bigint as msg_started, sum(d.leads)::bigint as form_leads
    from public.meta_ads_daily d
    where (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
    group by d.campaign_id
  ),
  inv as (select lead_id, sum(amount) as amt from public.lead_invoices group by lead_id),
  lead_c as (
    select coalesce(l.meta_campaign_id, ac.campaign_id) as campaign_id,
           l.id as lead_id,
           (l.current_status in ('booked_on_system','service_done')
              or l.booking_date is not null or l.booking_reference is not null) as booked,
           (l.current_status = 'service_done') as attended,
           coalesce(i.amt, 0) as amt
    from public.leads l
    left join ad_campaign ac on ac.ad_id = l.meta_ad_id
    left join inv i on i.lead_id = l.id
    where coalesce(l.meta_campaign_id, ac.campaign_id) is not null
      and (p_from is null or l.received_at >= p_from::timestamptz)
      and (p_to is null or l.received_at < (p_to + 1)::timestamptz)
  ),
  leads_agg as (
    select campaign_id,
           count(*)::bigint as attributed_leads,
           count(*) filter (where booked)::bigint as booked_leads,
           count(*) filter (where attended)::bigint as attended_leads,
           count(*) filter (where amt > 0)::bigint as paid_leads,
           sum(amt) as revenue
    from lead_c group by campaign_id
  )
  select coalesce(s.campaign_id, a.campaign_id),
         s.campaign_name, s.brand, s.first_day, s.last_day,
         coalesce(s.spend, 0), coalesce(s.msg_started, 0), coalesce(s.form_leads, 0),
         coalesce(a.attributed_leads, 0), coalesce(a.booked_leads, 0), coalesce(a.attended_leads, 0), coalesce(a.paid_leads, 0), coalesce(a.revenue, 0),
         case when coalesce(a.attributed_leads, 0) > 0 then round(coalesce(s.spend, 0) / a.attributed_leads, 2) end,
         case when coalesce(a.booked_leads, 0) > 0 then round(coalesce(s.spend, 0) / a.booked_leads, 2) end,
         case when coalesce(a.attended_leads, 0) > 0 then round(coalesce(s.spend, 0) / a.attended_leads, 2) end,
         case when coalesce(s.spend, 0) > 0 then round(coalesce(a.revenue, 0) / s.spend, 2) end
  from spend s
  full join leads_agg a on a.campaign_id = s.campaign_id
  order by coalesce(s.spend, 0) desc, coalesce(a.revenue, 0) desc;
$$;

revoke all on function public.ads_roi_by_campaign(date, date) from public, anon;
grant execute on function public.ads_roi_by_campaign(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
