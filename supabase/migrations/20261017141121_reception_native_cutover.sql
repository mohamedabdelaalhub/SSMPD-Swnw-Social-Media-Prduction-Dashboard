-- Readiness fingerprints include the actual native masters. Training catalogs are never deployed.
alter function clinic_reception.configuration(uuid) rename to configuration_before_native;
create function clinic_reception.configuration(p_workspace uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select clinic_reception.configuration_before_native(p_workspace)||jsonb_build_object('native',jsonb_build_object(
 'services',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.pricing_services s where active and booking_enabled),
 'supplies',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.pricing_supplies s where active),
 'packages',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.pricing_packages s where active and booking_enabled),
 'doctor_contracts',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from clinic_finance.doctor_contracts s where status='active'),
 'entity_contracts',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.contracting_entity_contracts s where status='active'),
 'registers',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from clinic_finance.registers s)));
$$;
create or replace function clinic_reception.prepare_cutover(p_plan uuid,p_mappings jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare plan clinic_reception.cutovers%rowtype;me uuid:=public.my_admin_id();target uuid;trial clinic_reception.workspaces%rowtype;provider clinic_reception.providers%rowtype;device clinic_reception.devices%rowtype;entry record;provider_id uuid;ids jsonb:='{}';row jsonb;native_name text;asset text;begin
 if me is null or not exists(select 1 from public.admins where id=me and active) or not(public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'مدير معتمد مطلوب';end if;
 perform pg_advisory_xact_lock(927311);select * into plan from clinic_reception.cutovers where id=p_plan for update;
 if not found or plan.status<>'approved' or plan.reviewed_by=plan.created_by or plan.configuration_hash<>md5(clinic_reception.configuration(plan.trial_workspace_id)::text) or not plan.checks @> '{"sql":true,"accounting":true,"inventory":true,"permissions":true,"visual":true,"staff_uat":true,"opening_reconciled":true,"legacy_worker_stopped":true,"backup":true}' then raise exception 'المحضر غير مكتمل أو تغيرت التعريفات الأصلية؛ أعد المراجعة';end if;
 if exists(select 1 from clinic_reception.workspaces where mode='live') or (select live_enabled from clinic_reception.settings where id) then raise exception 'مساحة التشغيل موجودة؛ لا تعاد تهيئتها';end if;
 select * into trial from clinic_reception.workspaces where id=plan.trial_workspace_id;
 if me not in(trial.owner_id,plan.reviewed_by) then raise exception 'المحضر خارج مسؤوليتك';end if;
 if p_mappings is null or jsonb_typeof(p_mappings)<>'object' or exists(select 1 from jsonb_object_keys(p_mappings) k where k not in ('providers','devices','members','availability')) then raise exception 'التعريفات من موديولاتها الأصلية؛ لا تنقل خدمات أو أصناف أو باكجز التدريب';end if;
 insert into clinic_reception.workspaces(name,mode,owner_id) values('الاستقبال والخدمات — التشغيل', 'live',trial.owner_id) returning id into target;
 perform clinic_reception.sync_catalog(target);
 if not exists(select 1 from clinic_reception.services where workspace_id=target and active) then raise exception 'فعّل خدمة حجز واحدة على الأقل في التسعير الأصلي';end if;
 for entry in select * from jsonb_each_text(coalesce(p_mappings->'providers','{}')) loop
  select * into provider from clinic_reception.providers where id=entry.key::uuid and workspace_id=trial.id;
  if not found then raise exception 'الطبيب خارج إعدادات المحضر';end if;
  select c.doctor_name into native_name from clinic_finance.doctor_contracts c join clinic_reception.services s on s.workspace_id=target and s.code=c.service_scope and s.department=provider.department and s.active where c.doctor_key=entry.value and c.status='active' and clinic_reception.today() between c.valid_from and c.valid_to and c.basis='performed' and c.base_scope='service' and c.deduction in ('none','cost') order by c.id limit 1;
  if native_name is null then raise exception 'اربط الطبيب بكوده وعقد خدمته المعتمد داخل الحسابات';end if;
  insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values(target,native_name,entry.value,provider.department,provider.branch) returning id into provider_id;ids:=ids||jsonb_build_object(entry.key,provider_id);
 end loop;
 if not exists(select 1 from clinic_reception.providers where workspace_id=target) then raise exception 'حدد أطباء التشغيل المرتبطين بعقود الحسابات';end if;
 for entry in select * from jsonb_each_text(coalesce(p_mappings->'devices','{}')) loop
  select * into device from clinic_reception.devices where id=entry.key::uuid and workspace_id=trial.id;
  if not found then raise exception 'الجهاز خارج المحضر';end if;asset:=entry.value;
  if not exists(select 1 from clinic_finance.business_requests where id::text=asset and kind='asset' and status='approved') then raise exception 'الجهاز يجب أن يرتبط بأصل معتمد بالحسابات';end if;
  insert into clinic_reception.devices(workspace_id,code,name,meter_kind,asset_key) values(target,device.code,device.name,device.meter_kind,asset);
 end loop;
 for row in select * from jsonb_array_elements(coalesce(p_mappings->'availability','[]')) loop
  provider_id:=(ids->>(row->>'provider_id'))::uuid;
  if provider_id is null or (row->>'starts_at')::timestamptz<now() or (row->>'ends_at')::timestamptz<=(row->>'starts_at')::timestamptz or (row->>'ends_at')::timestamptz-(row->>'starts_at')::timestamptz>interval '24 hours' then raise exception 'راجع تواجد التشغيل الفعلي؛ لا تنقل ساعات التدريب';end if;
  insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values(target,provider_id,(row->>'starts_at')::timestamptz,(row->>'ends_at')::timestamptz);
 end loop;
 insert into clinic_reception.members(workspace_id,admin_id,capabilities) select target,m.admin_id,m.capabilities from clinic_reception.members m where m.workspace_id=trial.id and coalesce(p_mappings->'members','[]') ? m.admin_id::text;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(target,me,'prepare_native_cutover',plan.id);
 return target;
end $$;
revoke all on function clinic_reception.prepare_cutover(uuid,jsonb),clinic_reception.configuration(uuid),clinic_reception.configuration_before_native(uuid) from public,anon,authenticated;
