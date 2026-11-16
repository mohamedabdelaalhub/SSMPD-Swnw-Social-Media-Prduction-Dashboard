-- Owner (2026-11-16): «خدمات الكشف والاستشارة تبقي مفتوحة لكل طبيب، دي خدمات أساسية لكل طبيب» + «والمتابعة كمان»,
-- «ربط تلقائي بالتخصص», «المحاسب يدخل العقود الحقيقية» (no placeholder fee agreements).
-- 1) Basic services (every service in «خدمات الكشف», and any service named كشف / استشارة / متابعة) are bookable and
--    executable by every active doctor of the live workspace — no per-doctor scope row needed.
-- 2) The graded consultations (0001371/0001372) stay limited to the doctor's grade when a graded contract exists;
--    a doctor with no graded contract can take both (open, as asked).
-- 3) clinic_reception_booking_readiness(workspace): per doctor — own-department services, basic services, fee agreement
--    valid today (Cairo), availability in the next 14 days — so nobody has to test doctors one by one.

create or replace function clinic_reception.norm_ar(p text) returns text language sql immutable set search_path=pg_catalog as $$
 select regexp_replace(translate(lower(coalesce(p,'')),'أإآٱىةؤئ','اااايهوي'),'\s+',' ','g')
$$;

create or replace function clinic_reception.is_basic_service(p_department text,p_name text) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p_department,'')='خدمات الكشف'
     or clinic_reception.norm_ar(p_name) ~ '^(ال)?(كشف|استشاره|متابعه)'
$$;

-- Wrap the existing per-doctor scope check (used by the booking and execution gates) so basic services pass.
do $$begin
 if to_regprocedure('clinic_reception.has_provider_service_scope_contract(uuid,text,date)') is null then
  alter function clinic_reception.has_provider_service_scope(uuid,text,date) rename to has_provider_service_scope_contract;
 end if;
end $$;
revoke all on function clinic_reception.has_provider_service_scope_contract(uuid,text,date) from public,anon,authenticated;
create or replace function clinic_reception.has_provider_service_scope(p_provider uuid,p_code text,p_day date)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select clinic_reception.has_provider_service_scope_contract(p_provider,p_code,p_day)
     or exists(select 1 from clinic_reception.providers p join clinic_reception.services s on s.workspace_id=p.workspace_id and s.code=p_code and s.active
               where p.id=p_provider and p.active and clinic_reception.is_basic_service(s.department,s.name))
$$;
revoke all on function clinic_reception.has_provider_service_scope(uuid,text,date) from public,anon,authenticated;

-- Graded consultations: open when the doctor has no graded contract.
do $$begin
 if to_regprocedure('clinic_reception.consultation_scopes_contract(text,date)') is null then
  alter function clinic_reception.consultation_scopes(text,date) rename to consultation_scopes_contract;
 end if;
end $$;
revoke all on function clinic_reception.consultation_scopes_contract(text,date) from public,anon,authenticated;
create or replace function clinic_reception.consultation_scopes(p_doctor_key text,p_day date) returns text[] language sql stable set search_path=pg_catalog,public as $$
 select case when cardinality(x)>0 then x else array['0001371','0001372'] end from (select clinic_reception.consultation_scopes_contract(p_doctor_key,p_day) x) t
$$;
revoke all on function clinic_reception.consultation_scopes(text,date) from public,anon,authenticated;

-- Readiness per doctor (managers / reviewers of the workspace).
create or replace function public.clinic_reception_booking_readiness(p_workspace uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');d date:=clinic_reception.today();basic int;
begin
 select count(*) into basic from clinic_reception.services s where s.workspace_id=p_workspace and s.active and clinic_reception.is_basic_service(s.department,s.name);
 return jsonb_build_object('day',d,'basic_services',basic,'doctors',coalesce((select jsonb_agg(x order by x->>'ready' , x->>'department', x->>'name') from (
  select jsonb_build_object('id',p.id,'name',p.name,'department',p.department,
   'own_services',(select count(*) from clinic_reception.services s where s.workspace_id=p_workspace and s.active and s.department=p.department and not clinic_reception.is_basic_service(s.department,s.name)),
   'basic_services',basic,
   'linked',p.doctor_key is not null,
   'agreements',(select count(*) from clinic_reception.doctor_agreements a where a.workspace_id=p_workspace and a.provider_id=p.id and a.status='active' and d between a.valid_from and a.valid_to),
   'availability_14d',(select count(*) from clinic_reception.availability v where v.workspace_id=p_workspace and v.provider_id=p.id and v.ends_at>now() and v.starts_at<now()+interval '14 days'),
   'ready',(exists(select 1 from clinic_reception.doctor_agreements a where a.workspace_id=p_workspace and a.provider_id=p.id and a.status='active' and d between a.valid_from and a.valid_to)
            and exists(select 1 from clinic_reception.availability v where v.workspace_id=p_workspace and v.provider_id=p.id and v.ends_at>now() and v.starts_at<now()+interval '14 days'))) x
  from clinic_reception.providers p where p.workspace_id=p_workspace and p.active) q),'[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_booking_readiness(uuid) from public,anon;
grant execute on function public.clinic_reception_booking_readiness(uuid) to authenticated;

-- The snapshot tells the booking form which services are basic (live only).
do $$begin
 if to_regprocedure('clinic_reception.snapshot_before_basic_services(uuid,date,date)') is null then
  alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_basic_services;
  alter function public.snapshot_before_basic_services(uuid,date,date) set schema clinic_reception;
 end if;
end $$;
revoke all on function clinic_reception.snapshot_before_basic_services(uuid,date,date) from public,anon,authenticated;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 r:=clinic_reception.snapshot_before_basic_services(p_workspace,p_from,p_to);
 if r#>>'{workspace,mode}'<>'live' then return r;end if;
 return r||jsonb_build_object('basic_service_ids',coalesce((select jsonb_agg(s.id) from clinic_reception.services s where s.workspace_id=p_workspace and s.active and clinic_reception.is_basic_service(s.department,s.name)),'[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
