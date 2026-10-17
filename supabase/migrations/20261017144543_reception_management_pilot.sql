-- A real, source-integrated management pilot is distinct from a clinic-wide cutover.
-- No fabricated UAT approval, training data copy, price or financial transaction.
alter table clinic_reception.settings add column pilot_only boolean not null default false;
create table clinic_reception.pilot_participants(admin_id uuid primary key references public.admins(id));
alter table clinic_reception.pilot_participants enable row level security;
revoke all on clinic_reception.pilot_participants from public,anon,authenticated;
create function clinic_reception.is_pilot_participant() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from clinic_reception.pilot_participants p join public.admins a on a.id=p.admin_id where a.id=public.my_admin_id() and a.active and a.role in ('super_admin','general_manager'));
$$;
revoke all on function clinic_reception.is_pilot_participant() from public,anon,authenticated;

alter function clinic_reception.access(uuid,text) rename to access_before_management_pilot;
create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then raise exception 'الاختبار المتصل متاح للحسابين المحددين فقط' using errcode='42501';end if;
  if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'استخدم الاختبار المتصل بالبيانات الفعلية بدل مساحة التدريب';end if;
 end if;
 return clinic_reception.access_before_management_pilot(p_workspace,p_action);
end $$;
revoke all on function clinic_reception.access(uuid,text),clinic_reception.access_before_management_pilot(uuid,text) from public,anon,authenticated;

alter function public.clinic_reception_workspaces() rename to workspaces_before_management_pilot;
alter function public.workspaces_before_management_pilot() set schema clinic_reception;
revoke all on function clinic_reception.workspaces_before_management_pilot() from public,anon,authenticated;
create function public.clinic_reception_workspaces() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if public.my_admin_id() is null then raise exception 'سجل الدخول' using errcode='42501';end if;
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then return '[]'::jsonb;end if;
  return(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'mode',w.mode,'is_owner',w.owner_id=public.my_admin_id(),'management_pilot',true)),'[]') from clinic_reception.workspaces w where w.mode='live' and (select live_enabled from clinic_reception.settings where id));
 end if;
 return clinic_reception.workspaces_before_management_pilot();
end $$;
alter function public.clinic_reception_bootstrap() rename to bootstrap_before_management_pilot;
alter function public.bootstrap_before_management_pilot() set schema clinic_reception;
revoke all on function clinic_reception.bootstrap_before_management_pilot() from public,anon,authenticated;
create function public.clinic_reception_bootstrap() returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare w uuid;begin
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then raise exception 'الاختبار المتصل متاح لصاحب الحساب ومدير المركز فقط' using errcode='42501';end if;
  select id into w from clinic_reception.workspaces where mode='live' and (select live_enabled from clinic_reception.settings where id);if w is null then raise exception 'الاختبار المتصل غير مفعّل';end if;return w;
 end if;
 return clinic_reception.bootstrap_before_management_pilot();
end $$;
revoke all on function public.clinic_reception_workspaces(),public.clinic_reception_bootstrap() from public,anon,authenticated;
grant execute on function public.clinic_reception_workspaces(),public.clinic_reception_bootstrap() to authenticated;

create or replace function clinic_reception.guard_legacy_booking() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if (select live_enabled and not pilot_only from clinic_reception.settings where id) then raise exception 'انتقل التشغيل إلى نظام الاستقبال والخدمات؛ الحجز القديم للقراءة فقط';end if;
 return new;
end $$;
revoke all on function clinic_reception.guard_legacy_booking() from public,anon,authenticated;

-- Clinical availability links reference the real approved physician contract.
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to command_before_management_pilot;
alter function public.command_before_management_pilot(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.command_before_management_pilot(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare me uuid;begin
 me:=clinic_reception.access(p_workspace,'view');
 if p_action='provider' and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') and not exists(select 1 from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token) then
  perform clinic_reception.access(p_workspace,'manage');
  if not exists(select 1 from clinic_finance.doctor_contracts c join clinic_reception.services s on s.workspace_id=p_workspace and s.active and s.code=c.service_scope and s.department=p_payload->>'department' where c.doctor_key=p_payload->>'doctor_key' and c.doctor_name=p_payload->>'name' and c.status='active' and clinic_reception.today() between c.valid_from and c.valid_to and c.basis='performed' and c.base_scope='service' and c.deduction in ('none','cost')) then raise exception 'اختر طبيبًا من عقد أتعاب معتمد لنفس قسم الخدمة في الحسابات';end if;
 end if;
 return clinic_reception.command_before_management_pilot(p_workspace,p_action,p_payload,p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;

alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_management_pilot;
alter function public.snapshot_before_management_pilot(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_management_pilot(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 perform clinic_reception.access(p_workspace,'view');v:=clinic_reception.snapshot_before_management_pilot(p_workspace,p_from,p_to);
 return v||jsonb_build_object('management_pilot',(select pilot_only from clinic_reception.settings where id) and v->'workspace'->>'mode'='live',
 'native_doctor_options',case when (v->>'can_manage')::boolean then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select distinct c.doctor_key,c.doctor_name,s.department from clinic_finance.doctor_contracts c join clinic_reception.services s on s.workspace_id=p_workspace and s.active and s.code=c.service_scope where c.status='active' and clinic_reception.today() between c.valid_from and c.valid_to and c.basis='performed' and c.base_scope='service' and c.deduction in ('none','cost'))x) else '[]'::jsonb end);
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;

-- Deployment-only activation, explicitly authorized by the owner's request.
-- This does not approve a readiness plan or stop the legacy booking writer.
create function clinic_reception.enable_management_pilot(p_owner uuid,p_manager uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare target uuid;begin
 perform pg_advisory_xact_lock(927311);
 if p_owner=p_manager or not exists(select 1 from public.admins where id=p_owner and active and role='super_admin') or not exists(select 1 from public.admins where id=p_manager and active and role='general_manager') then raise exception 'حدد حساب المالك ومدير المركز النشطين';end if;
 if (select live_enabled and not pilot_only from clinic_reception.settings where id) then raise exception 'التشغيل العام مفعّل؛ لا تحول التشغيل إلى اختبار';end if;
 if exists(select 1 from clinic_reception.workspaces where mode='live' and owner_id<>p_owner) or (select count(*) from clinic_reception.workspaces where mode='live')>1 then raise exception 'راجع مساحة التشغيل الموجودة';end if;
 if exists(select 1 from clinic_reception.pilot_participants where admin_id not in(p_owner,p_manager)) then raise exception 'قائمة المشاركين مختلفة؛ لا تغيرها ضمن التهيئة';end if;
 select id into target from clinic_reception.workspaces where mode='live';
 if target is null then insert into clinic_reception.workspaces(name,mode,owner_id) values('الاستقبال والخدمات — اختبار الإدارة المتصل','live',p_owner) returning id into target;end if;
 insert into clinic_reception.pilot_participants(admin_id) values(p_owner),(p_manager) on conflict do nothing;
 insert into clinic_reception.members(workspace_id,admin_id,capabilities) values(target,p_manager,array['manage']) on conflict(workspace_id,admin_id) do update set capabilities=excluded.capabilities;
 update clinic_reception.settings set live_enabled=true,pilot_only=true,communications_enabled=false,cutover_at=coalesce(cutover_at,now()) where id;
 perform clinic_reception.sync_catalog(target);
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail) values(target,p_owner,'management_pilot_enabled',target,jsonb_build_object('participants',jsonb_build_array(p_owner,p_manager),'authorization','explicit owner request for real integrated testing','readiness_approved',false,'legacy_booking_stopped',false,'seeded_transactions',false));
 return target;
end $$;
revoke all on function clinic_reception.enable_management_pilot(uuid,uuid) from public,anon,authenticated;
