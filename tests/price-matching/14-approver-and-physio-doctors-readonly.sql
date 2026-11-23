-- READ ONLY. (1) Can محمود / Dr. Dina approve the center master review? (2) Where are the physio doctors?
begin read only;
select 'approvers', jsonb_agg(jsonb_build_object('name',a.name,'role',a.role,'active',a.active,'has_price_lists_access',to_jsonb(a)->'has_price_lists_access'))
 from public.admins a where a.id in ('cfa7a0c3-c310-4dc4-9cd6-e2d7c51eb989','fefb0277-bc1b-4cfe-a4a2-91a4d9d5689c')
union all
select 'providers_physio_like', jsonb_agg(jsonb_build_object('name',p.name,'department',p.department,'active',p.active,'doctor_key',p.doctor_key,
   'extra',(select jsonb_agg(department) from clinic_reception.provider_departments d where d.provider_id=p.id)) order by p.active desc,p.name)
 from clinic_reception.providers p
 where translate(p.department||' '||p.name,'ىةأإآ','يهااا') ~ 'علاج طبيعي|تاهيل|تخسيس|تغذيه|physio|rehab'
    or exists(select 1 from clinic_reception.provider_departments d where d.provider_id=p.id and translate(d.department,'ىةأإآ','يهااا') ~ 'علاج طبيعي|تاهيل|تخسيس|تغذيه')
union all
select 'all_provider_departments', jsonb_agg(jsonb_build_array(department,n,act) order by n desc)
 from (select department,count(*) n,count(*) filter(where active) act from clinic_reception.providers group by 1) q
union all
select 'services_in_dept_nutrition', jsonb_agg(jsonb_build_array(booking_code,name,category)) from public.pricing_services where active and booking_department='التغذية والتخسيس';
rollback;
