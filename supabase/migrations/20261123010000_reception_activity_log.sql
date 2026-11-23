-- «سجل نشاط الاستقبال» (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/reception-activity-log-*): who did what at
-- reception, read-only, for the general manager / super admin / financial manager.
--   public.clinic_reception_activity(p_workspace, p_filter {from,to,actor('auto'|uuid),provider,kind,q,limit,offset})
--   * one row per reception action from clinic_reception.audit (every reception command writes one), resolved to its patient /
--     doctor / appointment / visit / payment / request; kinds: book · reschedule · cancel · visit · service · pay · void.
--   * a 'collect_multi' row carries the payment note, the number of visits it covered (allocations) and «لأكتر من مريض» when the
--     same payment has a 'collect_multi_cross' audit row (20261122380000) — so a payments-vs-visits difference is explained.
--   * bookings by the auto-booking account (clinic_reception.auto_book_settings.system_admin_id) are «الحجز التلقائي».
--   * summary per employee for the period: visits, bookings, services, changes/cancels, collections, amount, visits paid.
-- Nothing is written. Rollback: supabase/rollbacks/20261123010000_reception_activity_log.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_activity(uuid,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.audit') is null or to_regclass('clinic_reception.appointments') is null then
    raise exception 'مكونات الاستقبال غير موجودة'; end if;
end $$;

create function clinic_reception.activity_kind(p_action text) returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_action in ('book', 'overbook') then 'book'
    when p_action in ('reschedule', 'manual_time', 'auto_booking_set_time') then 'reschedule'
    when p_action in ('cancel', 'no_show') then 'cancel'
    when p_action in ('arrive') then 'visit'
    when p_action in ('order_add', 'journey_request_service') then 'service'
    when p_action in ('collect', 'collect_multi') then 'pay'
    when p_action in ('request', 'visit_void_requested', 'visit_void_completed', 'request_review') then 'void'
  end
$$;
revoke all on function clinic_reception.activity_kind(text) from public, anon, authenticated;

create function public.clinic_reception_activity(p_workspace uuid, p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  f date; t date; auto uuid; lim int; off int; who text; prov uuid; k text; q text; result jsonb;
begin
  if me is null or not (public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('financial_manager')) then
    raise exception 'سجل نشاط الاستقبال للمدير العام والمدير المالي بس' using errcode = '42501'; end if;
  if not exists (select 1 from clinic_reception.workspaces where id = p_workspace) then raise exception 'مساحة الاستقبال غير موجودة'; end if;
  f := coalesce(nullif(p_filter->>'from', '')::date, (now() at time zone 'Africa/Cairo')::date);
  t := coalesce(nullif(p_filter->>'to', '')::date, f);
  if t < f or t - f > 92 then raise exception 'اختار فترة من يوم لـ 92 يوم'; end if;
  lim := least(greatest(coalesce(nullif(p_filter->>'limit', '')::int, 50), 1), 5000);
  off := greatest(coalesce(nullif(p_filter->>'offset', '')::int, 0), 0);
  who := nullif(p_filter->>'actor', ''); k := nullif(p_filter->>'kind', '');
  prov := case when p_filter->>'provider' ~* '^[0-9a-f-]{36}$' then (p_filter->>'provider')::uuid end;
  q := nullif(btrim(coalesce(p_filter->>'q', '')), '');
  begin execute 'select system_admin_id from clinic_reception.auto_book_settings limit 1' into auto; exception when others then auto := null; end;

  with base as (
    select a.id, a.created_at, a.actor_id, a.action, clinic_reception.activity_kind(a.action) as kind, a.detail,
           vis.visit_no, p.amount as pay_amount, p.method, p.reference, p.note as pay_note,
           o.snapshot->>'name' as order_service, r.kind as req_kind, r.amount as req_amount, r.reason as req_reason, r.status as req_status,
           coalesce(ap.patient_id, vis.patient_id, p.patient_id, iv.patient_id) as patient_id,
           coalesce(o.provider_id, ap.provider_id, vap.provider_id) as provider_id,
           coalesce(ap.starts_at, vap.starts_at) as starts_at,
           coalesce(ap.status, vap.status) as ap_status,
           (select count(*) from clinic_reception.allocations al where p.id is not null and al.payment_id = p.id) as visits_covered,
           exists (select 1 from clinic_reception.audit x where x.workspace_id = a.workspace_id and x.action = 'collect_multi_cross'
                    and x.entity_id = a.entity_id) as cross_patient
      from clinic_reception.audit a
      left join clinic_reception.appointments ap on ap.id = a.entity_id
      left join clinic_reception.payments p on p.id = a.entity_id
      left join clinic_reception.orders o on o.id = a.entity_id
      left join clinic_reception.requests r on r.id = a.entity_id
      left join clinic_reception.invoices iv on iv.id = r.subject_id
      left join clinic_reception.visits vis on vis.id = coalesce(
             (select v0.id from clinic_reception.visits v0 where v0.id = a.entity_id), o.visit_id, iv.visit_id,
             case when r.payload->>'visit_id' ~* '^[0-9a-f-]{36}$' then (r.payload->>'visit_id')::uuid end)
      left join clinic_reception.appointments vap on vap.id = vis.appointment_id
     where a.workspace_id = p_workspace
       and (a.created_at at time zone 'Africa/Cairo')::date between f and t
       and clinic_reception.activity_kind(a.action) is not null
  ), named as (
    select b.*, (auto is not null and b.actor_id = auto) as is_auto,
           case when auto is not null and b.actor_id = auto then 'الحجز التلقائي' else coalesce(nullif(trim(ad.name), ''), ad.email) end as actor_name,
           pt.name as patient, pt.file_no, pr.name as provider
      from base b
      left join public.admins ad on ad.id = b.actor_id
      left join clinic_reception.patients pt on pt.id = b.patient_id
      left join clinic_reception.providers pr on pr.id = b.provider_id
     where (prov is null or b.provider_id = prov)
       and (q is null or pt.name ilike '%' || q || '%' or pt.file_no ilike '%' || q || '%')
  ), filtered as (
    select * from named n
     where (who is null or (who = 'auto' and n.is_auto) or (who <> 'auto' and n.actor_id::text = who))
       and (k is null or n.kind = k)
  )
  select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'at', x.created_at, 'action', x.action, 'kind', x.kind, 'actor_id', x.actor_id, 'actor', x.actor_name, 'auto', x.is_auto,
          'patient', x.patient, 'file_no', x.file_no, 'provider', x.provider, 'starts_at', x.starts_at, 'appointment_status', x.ap_status,
          'visit_no', x.visit_no, 'service', x.order_service,
          'amount', case when x.kind = 'pay' then x.pay_amount when x.kind = 'void' then x.req_amount end,
          'method', x.method, 'reference', x.reference, 'note', x.pay_note, 'visits', x.visits_covered, 'cross_patient', x.cross_patient,
          'request_kind', x.req_kind, 'reason', coalesce(x.req_reason, x.detail->>'reason'), 'request_status', x.req_status)
          order by x.created_at desc, x.id desc)
        from (select * from filtered order by created_at desc, id desc limit lim offset off) x), '[]'::jsonb),
      'summary', coalesce((select jsonb_agg(to_jsonb(s) order by s.auto, s.name) from (
          select n.actor_id as id, n.actor_name as name, n.is_auto as auto,
                 count(*) filter (where n.kind = 'visit') as visits, count(*) filter (where n.kind = 'book') as bookings,
                 count(*) filter (where n.kind = 'service') as services,
                 count(*) filter (where n.kind in ('reschedule', 'cancel', 'void')) as changes,
                 count(*) filter (where n.kind = 'pay') as collections,
                 coalesce(sum(n.pay_amount) filter (where n.kind = 'pay'), 0) as amount,
                 coalesce(sum(n.visits_covered) filter (where n.kind = 'pay'), 0) as visits_paid
            from named n group by n.actor_id, n.actor_name, n.is_auto) s), '[]'::jsonb),
      'providers', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
          from clinic_reception.providers pr where pr.workspace_id = p_workspace and pr.active), '[]'::jsonb),
      'from', f, 'to', t, 'limit', lim, 'offset', off)
    into result;
  return result;
end $$;
revoke all on function public.clinic_reception_activity(uuid, jsonb) from public, anon;
grant execute on function public.clinic_reception_activity(uuid, jsonb) to authenticated;

commit;
