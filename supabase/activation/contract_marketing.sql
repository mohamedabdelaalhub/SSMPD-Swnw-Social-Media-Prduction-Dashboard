begin;
create schema if not exists contract_marketing;
revoke all on schema contract_marketing from public,anon,authenticated;
create table if not exists contract_marketing.profiles(
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('doctor','entity')), source_key text not null,
 facts jsonb not null default '{}', asset_path text, website_enabled boolean not null default false,
 auto_announce boolean not null default false, platforms jsonb not null default '["facebook","instagram"]',
 publication_state text not null default 'active' check(publication_state in ('active','suspended','ended')),
 created_by uuid not null references public.admins(id), updated_at timestamptz not null default now(), revision bigint not null default 1,
 unique(kind,source_key),check(jsonb_typeof(facts)='object'),check(platforms <@ '["facebook","instagram"]'::jsonb and (not auto_announce or jsonb_array_length(platforms)>0))
);
create table if not exists contract_marketing.jobs(
 id uuid primary key default gen_random_uuid(),profile_id uuid not null unique references contract_marketing.profiles(id) on delete cascade,
 status text not null default 'queued',lease uuid,lease_until timestamptz,revision bigint,generation_started boolean not null default false,idea jsonb,content_id uuid references public.content_items(id),
 attempts int not null default 0,last_error text,next_attempt_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table contract_marketing.profiles enable row level security;
alter table contract_marketing.jobs enable row level security;
create or replace function contract_marketing.allowed(k text,s text) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.my_admin_id() is null then return false;end if;
 if k='doctor' then return (clinic_finance.allowed('create') or clinic_finance.allowed('review')) and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=s);end if;
 return k='entity' and public.can_manage_contracting_entities() and exists(select 1 from public.contracting_entities where id::text=s);
end $$;
create or replace function contract_marketing.source(k text,s text) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select case when k='doctor' then jsonb_build_object('name',(select doctor_name from clinic_finance.doctor_contracts where doctor_key=s order by (status='active' and (now() at time zone 'Africa/Cairo')::date between valid_from and valid_to) desc,valid_from desc,id desc limit 1),'eligible',exists(select 1 from clinic_finance.doctor_contracts where doctor_key=s and status='active' and (now() at time zone 'Africa/Cairo')::date between valid_from and valid_to))
 else (select jsonb_build_object('name',e.name,'eligible',exists(select 1 from public.contracting_entity_contracts c where c.entity_id=e.id and c.status='active' and c.start_date<=(now() at time zone 'Africa/Cairo')::date and (c.end_date is null or c.end_date>=(now() at time zone 'Africa/Cairo')::date))) from public.contracting_entities e where e.id::text=s) end;
$$;
create or replace function public.contract_marketing_profile(p_kind text,p_key text,p_settings jsonb default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p contract_marketing.profiles%rowtype; s jsonb; j jsonb;
begin
 if not contract_marketing.allowed(p_kind,p_key) then raise exception 'لا تملك صلاحية إعداد نشر هذا التعاقد';end if;
 s:=contract_marketing.source(p_kind,p_key);
 if p_settings is not null then
  if jsonb_typeof(p_settings)<>'object' or length(p_settings::text)>20000 then raise exception 'إعدادات غير صالحة';end if;
  if p_settings?'facts' and (jsonb_typeof(p_settings->'facts')<>'object' or ((p_settings->'facts')-array['prefix','title','department','days','time_from','time_to','qualifications','experience','site_match','website','announcement'])<>'{}'::jsonb) then raise exception 'بيانات العرض غير صالحة';end if;
  insert into contract_marketing.profiles(kind,source_key,created_by) values(p_kind,p_key,public.my_admin_id()) on conflict do nothing;
  select * into p from contract_marketing.profiles where kind=p_kind and source_key=p_key for update;
  if p_settings ? 'asset_path' and p_settings->>'asset_path' is not null and (p_settings->>'asset_path' not like p.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='contract-marketing' and name=p_settings->>'asset_path')) then raise exception 'الصورة غير صالحة';end if;
  update contract_marketing.profiles set facts=coalesce(p_settings->'facts',facts),asset_path=case when p_settings?'asset_path' then p_settings->>'asset_path' else asset_path end,
   website_enabled=coalesce((p_settings->>'website_enabled')::boolean,website_enabled),auto_announce=coalesce((p_settings->>'auto_announce')::boolean,auto_announce),
   platforms=coalesce(p_settings->'platforms',platforms),publication_state=coalesce(p_settings->>'publication_state',publication_state),revision=revision+1,updated_at=now()
   where id=p.id returning * into p;
  -- Changing facts invalidates an in-flight render; scheduled announcements are never duplicated.
  update contract_marketing.jobs set status='queued',lease=null,lease_until=null,idea=null,generation_started=false,attempts=0,last_error=null,next_attempt_at=now() where profile_id=p.id and status<>'scheduled' and content_id is null;
 end if;
 select * into p from contract_marketing.profiles where kind=p_kind and source_key=p_key;
 select jsonb_build_object('status',status,'error',last_error,'content_id',content_id) into j from contract_marketing.jobs where profile_id=p.id;
 return jsonb_build_object('profile',to_jsonb(p),'source',s,'job',j);
end $$;
revoke all on function public.contract_marketing_profile(text,text,jsonb) from public,anon;
grant execute on function public.contract_marketing_profile(text,text,jsonb) to authenticated;
create or replace function contract_marketing.refresh() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare p contract_marketing.profiles%rowtype; valid boolean;j contract_marketing.jobs%rowtype;
begin
 for p in select * from contract_marketing.profiles loop
  valid:=coalesce((contract_marketing.source(p.kind,p.source_key)->>'eligible')::boolean,false) and p.publication_state='active';
  if valid and p.auto_announce then
   insert into contract_marketing.jobs(profile_id) values(p.id) on conflict do nothing;
  end if;
  select * into j from contract_marketing.jobs where profile_id=p.id for update;
  if not valid or not p.auto_announce then
   if j.content_id is not null then
    update public.meta_publish_jobs set status='cancelled' where content_id=j.content_id and status='pending';
    update public.content_items set claude_hold=true where id=j.content_id and stage<>'published';
   end if;
   update contract_marketing.jobs set status='cancelled',lease=null,lease_until=null,last_error='التعاقد غير ساري أو تم إيقاف الإعلان' where profile_id=p.id and status<>'cancelled';
  elsif j.status not in ('scheduled','cancelled','processing','waiting_template') then
   update contract_marketing.jobs set status=case when p.asset_path is null then 'waiting_asset' else case when status in ('waiting_asset','waiting_template') then 'queued' else status end end where profile_id=p.id;
  end if;
 end loop;
end $$;
create or replace function public.contract_marketing_worker(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p contract_marketing.profiles%rowtype;j contract_marketing.jobs%rowtype;v jsonb;slot timestamptz;c uuid;out_url text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only';end if;
 perform pg_advisory_xact_lock(7823041);
 perform contract_marketing.refresh();
 if p_action='snapshot' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'kind',pr.kind,'revision',pr.revision,'facts',pr.facts,'asset_path',pr.asset_path,'name',contract_marketing.source(pr.kind,pr.source_key)->>'name','visible',pr.website_enabled and pr.publication_state='active' and coalesce((contract_marketing.source(pr.kind,pr.source_key)->>'eligible')::boolean,false))) from contract_marketing.profiles pr),'[]');
 end if;
 if p_action='claim' then
  select * into j from contract_marketing.jobs where (status in ('queued','failed') and next_attempt_at<=now() and attempts<5) or (status='processing' and lease_until<now() and attempts<5) order by updated_at for update skip locked limit 1;
  if not found then return null;end if;
  select * into p from contract_marketing.profiles where id=j.profile_id;
  update contract_marketing.jobs set status='processing',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',revision=p.revision,attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j),'profile',to_jsonb(p),'source',contract_marketing.source(p.kind,p.source_key));
 end if;
 select * into j from contract_marketing.jobs where id=(p_data->>'id')::uuid and lease=(p_data->>'lease')::uuid and lease_until>now() and status='processing' for update;
 if not found then raise exception 'انتهت صلاحية الطلب';end if;
 select * into p from contract_marketing.profiles where id=j.profile_id;
 if p.revision<>j.revision then raise exception 'تغيرت بيانات التعاقد';end if;
 if p_action='get' then return jsonb_build_object('job',to_jsonb(j),'profile',to_jsonb(p),'source',contract_marketing.source(p.kind,p.source_key));end if;
 if p_action='begin_generation' then
  if j.idea is not null then return jsonb_build_object('idea',j.idea);end if;
  if j.generation_started then raise exception 'نتيجة توليد سابقة غير مؤكدة؛ راجع الطلب قبل إعادة المحاولة';end if;
  update contract_marketing.jobs set generation_started=true where id=j.id;return '{}'::jsonb;
 elsif p_action='idea' then
  if j.idea is null then update contract_marketing.jobs set idea=p_data->'idea' where id=j.id;end if;return '{}'::jsonb;
 elsif p_action='fail' then
  update contract_marketing.jobs set status=case when p_data->>'code'='TEMPLATE_NOT_READY' then 'waiting_template' else 'failed' end,last_error=left(p_data->>'error',500),lease=null,lease_until=null,next_attempt_at=now()+interval '15 minutes',updated_at=now() where id=j.id;return '{}'::jsonb;
 elsif p_action='finish' then
  if j.idea is null then raise exception 'المحتوى غير مكتمل';end if;
  -- Only a file uploaded by the worker under this exact job can be published.
  out_url:=p_data->>'output_url';
  if out_url not like 'https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/'||j.id::text||'/%/output.png' then raise exception 'ملف التصميم غير صالح';end if;
  if not exists(select 1 from storage.objects where bucket_id='content-designs' and name=split_part(out_url,'/content-designs/',2)) then raise exception 'ملف التصميم غير موجود';end if;
  slot:=date_trunc('minute',now())+interval '5 minutes';
  while exists(select 1 from public.meta_publish_jobs where brand='sono' and status in ('pending','processing','published','partial') and scheduled_at between slot-interval '2 hours' and slot+interval '2 hours') loop slot:=slot+interval '5 minutes';end loop;
  insert into public.content_items(id,title,body,caption_text,stage,created_by,brand,content_format,publish_platforms,agent_raw_output,design_file_url,scheduled_publish_at,scheduled_by)
   values(j.id,j.idea->>'title',j.idea->>'idea',j.idea->>'caption','scheduled',p.created_by,'sono','image_post',p.platforms,(j.idea||jsonb_build_object('contract_marketing_profile',p.id))::text,out_url,slot,p.created_by) returning id into c;
  insert into public.design_versions(content_id,created_by,output_file_url,settings) values(c,p.created_by,out_url,p_data->'settings');
  insert into public.meta_publish_jobs(content_id,brand,scheduled_at,publish_facebook,publish_instagram,created_by) values(c,'sono',slot,p.platforms?'facebook',p.platforms?'instagram',p.created_by);
  update contract_marketing.jobs set status='scheduled',content_id=c,lease=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
  return jsonb_build_object('content_id',c,'scheduled_at',slot);
 end if;
 raise exception 'Unknown action';
end $$;
revoke all on function public.contract_marketing_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.contract_marketing_worker(text,jsonb) to service_role;
-- Durable request is enqueued in the contract transaction; no network call blocks approval.
create or replace function contract_marketing.enqueue() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into contract_marketing.jobs(profile_id) select p.id from contract_marketing.profiles p where p.auto_announce and p.publication_state='active' and coalesce((contract_marketing.source(p.kind,p.source_key)->>'eligible')::boolean,false) on conflict do nothing;
 return null;
end $$;
drop trigger if exists contract_marketing_enqueued on clinic_finance.doctor_contracts;
create trigger contract_marketing_enqueued after insert or update or delete on clinic_finance.doctor_contracts for each statement execute function contract_marketing.enqueue();
drop trigger if exists contract_marketing_enqueued on public.contracting_entity_contracts;
create trigger contract_marketing_enqueued after insert or update or delete on public.contracting_entity_contracts for each statement execute function contract_marketing.enqueue();
-- Pending announcements are checked again at the actual publishing boundary.
create or replace function contract_marketing.guard_job() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p contract_marketing.profiles%rowtype;
begin
 select p0.* into p from contract_marketing.profiles p0 join contract_marketing.jobs j on j.profile_id=p0.id where j.content_id=new.content_id;
 if found and (p.publication_state<>'active' or not p.auto_announce or not coalesce((contract_marketing.source(p.kind,p.source_key)->>'eligible')::boolean,false)) then raise exception 'التعاقد غير ساري؛ الإعلان موقوف';end if;
 return new;
end $$;
drop trigger if exists contract_marketing_guard_job on public.meta_publish_jobs;
create trigger contract_marketing_guard_job before insert or update on public.meta_publish_jobs for each row when(new.status in ('pending','processing')) execute function contract_marketing.guard_job();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('contract-marketing','contract-marketing',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
revoke all on all functions in schema contract_marketing from public,anon,authenticated;
commit;
