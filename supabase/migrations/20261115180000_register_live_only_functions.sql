-- Register functions that existed only on live (owner: "سجلهم"). Bodies copied verbatim from
-- live pg_get_functiondef on 2026-11-15, ACLs as live after #480. Applying this on live is a
-- no-op; it makes a rebuild from the repo produce the same functions.
-- kpi_hub_aggregates depends on public.kpi_norm_name(text), registered separately once its live
-- body is captured (see 20261115180100 if present).

create or replace function public.patient_portal_service_reports()
 returns jsonb language sql stable security definer set search_path to 'pg_catalog', 'public'
as $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'service',o.snapshot->>'name','uploaded_at',r.uploaded_at,'file_name',r.file_name,'mime',r.mime_type,'path',r.storage_path) order by r.uploaded_at desc),'[]'::jsonb)
 from clinic_reception.order_reports r
 join clinic_reception.orders o on o.id=r.order_id
 join clinic_reception.visits v on v.id=o.visit_id
 join clinic_reception.patients p on p.id=v.patient_id
 join public.patient_account_access a on a.patient_id=p.patient_id
 join public.patient_accounts pa on pa.id=a.account_id
 where r.patient_visible and pa.auth_user_id=auth.uid() and pa.status='active' and a.verification_status='approved'
   and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()) $function$;
revoke all on function public.patient_portal_service_reports() from public, anon;
grant execute on function public.patient_portal_service_reports() to authenticated, service_role;

create or replace function public.kpi_hub_aggregates(p_weeks integer default 12)
 returns jsonb language sql stable security definer set search_path to 'public', 'clinic_reception', 'auth'
as $function$
with w as (
  select generate_series(date_trunc('week', (now() at time zone 'Africa/Cairo')::date) - make_interval(weeks => greatest(1, least(p_weeks, 52)) - 1),
                         date_trunc('week', (now() at time zone 'Africa/Cairo')::date), interval '1 week')::date as wk),
c as (select date_trunc('week', (published_at at time zone 'Africa/Cairo'))::date wk, coalesce(brand, '-') brand from content_items where stage = 'published' and published_at is not null),
pi as (select date_trunc('week', (published_at at time zone 'Africa/Cairo'))::date wk,
         coalesce(fb_reach,0) + coalesce(ig_reach,0) reach,
         coalesce(fb_reactions,0) + coalesce(fb_comments,0) + coalesce(fb_shares,0) + coalesce(ig_interactions,0) inter from post_insights where published_at is not null),
l as (select date_trunc('week', (coalesce(received_at, created_at) at time zone 'Africa/Cairo'))::date wk, current_status, coalesce(nullif(source,''), 'غير محدد') source from leads),
v as (select date_trunc('week', (created_at at time zone 'Africa/Cairo'))::date wk, public.kpi_norm_name(doctor_name) doctor_name from patient_visits),
a as (select date_trunc('week', (starts_at at time zone 'Africa/Cairo'))::date wk, status, arrived_at from clinic_reception.appointments)
select jsonb_build_object(
  'generated_at', now(),
  'weeks', (select jsonb_agg(jsonb_build_object(
      'wk', w.wk,
      'published', (select count(*) from c where c.wk = w.wk),
      'published_sono', (select count(*) from c where c.wk = w.wk and c.brand = 'sono'),
      'published_dina', (select count(*) from c where c.wk = w.wk and c.brand = 'dr_dina'),
      'reach', (select coalesce(sum(reach),0) from pi where pi.wk = w.wk),
      'interactions', (select coalesce(sum(inter),0) from pi where pi.wk = w.wk),
      'leads', (select count(*) from l where l.wk = w.wk),
      'leads_done', (select count(*) from l where l.wk = w.wk and l.current_status = 'service_done'),
      'leads_booked', (select count(*) from l where l.wk = w.wk and l.current_status in ('service_done','booked_on_system')),
      'visits_recorded', (select count(*) from v where v.wk = w.wk),
      'doctors_recording', (select count(distinct doctor_name) from v where v.wk = w.wk),
      'appointments', (select count(*) from a where a.wk = w.wk),
      'appointments_arrived', (select count(*) from a where a.wk = w.wk and a.arrived_at is not null)
    ) order by w.wk) from w),
  'leads_status', (select jsonb_object_agg(coalesce(current_status,'-'), n) from (select current_status, count(*) n from leads group by 1) s),
  'leads_source', (select jsonb_object_agg(source, n) from (select coalesce(nullif(source,''),'غير محدد') source, count(*) n from leads group by 1 order by 2 desc limit 8) s),
  'leads_total', (select count(*) from leads),
  'content_published_total', (select count(*) from content_items where stage = 'published'),
  'visits_total', (select count(*) from patient_visits),
  'visits_bulk_import', (select count(*) from patient_visits where created_at < '2026-09-07'),
  'visits_missing_specialty_pct', (select round(100.0 * count(*) filter (where nullif(trim(specialty),'') is null) / greatest(count(*),1), 1) from patient_visits),
  'visits_bad_dates', (select count(*) from patient_visits where visit_date < '2020-01-01' or visit_date > current_date + 1),
  'top_doctors_30d', (select coalesce(jsonb_agg(jsonb_build_object('name', doctor_name, 'n', n) order by n desc), '[]'::jsonb) from (
      select coalesce(public.kpi_norm_name(doctor_name),'غير مكتوب') doctor_name, count(*) n from patient_visits where created_at > now() - interval '30 days' group by 1 order by 2 desc limit 10) d),
  'followups', (select jsonb_object_agg(coalesce(follow_up_status,'-'), n) from (select follow_up_status, count(*) n from patient_visits where follow_up_date is not null and follow_up_date <= current_date group by 1) f),
  'followups_upcoming_7d', (select count(*) from patient_visits where follow_up_date > current_date and follow_up_date <= current_date + 7),
  'appointments_status', (select coalesce(jsonb_object_agg(coalesce(status,'-'), n), '{}'::jsonb) from (select status, count(*) n from clinic_reception.appointments group by 1) s),
  'staff_active', (select count(*) from admins where active),
  'staff_seen_7d', (select count(*) from admins ad join auth.users u on u.id = ad.user_id where ad.active and u.last_sign_in_at > now() - interval '7 days'),
  'staff_seen_30d', (select count(*) from admins ad join auth.users u on u.id = ad.user_id where ad.active and u.last_sign_in_at > now() - interval '30 days'),
  'finance_live', (select exists (select 1 from clinic_finance.invoices) or exists (select 1 from clinic_finance.payments))
);
$function$;
revoke all on function public.kpi_hub_aggregates(integer) from public, anon, authenticated;
grant execute on function public.kpi_hub_aggregates(integer) to service_role, postgres;
