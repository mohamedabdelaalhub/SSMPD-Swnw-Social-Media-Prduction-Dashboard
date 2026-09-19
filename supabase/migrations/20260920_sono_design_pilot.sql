begin;
alter table public.design_jobs add column if not exists request_key uuid unique;
alter table public.design_jobs add column if not exists render_settings jsonb not null default '{}'::jsonb;
insert into public.design_templates(brand,name,template_key,settings)
values('sono','سونو — الصورة العلوية','sono-white-v1','{"overlay":"assets/design-templates/sono-white/overlay.png"}')
on conflict(template_key) do nothing;
insert into storage.buckets(id,name,public) values('design-scenes','design-scenes',false) on conflict(id) do nothing;
create or replace function public.reserve_design_scene(p_content_id uuid,p_request_key uuid,p_prompt text,p_quality text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := public.my_admin_id(); job public.design_jobs%rowtype; reserve numeric;
begin
 if me is null then raise exception 'غير مسموح'; end if;
 if not exists(select 1 from public.content_items where id=p_content_id and brand='sono' and stage not in ('published','scheduled','ready_to_publish') and
 (created_by=me or assigned_designer=me or public.can_manage_all_content())) then raise exception 'غير مسموح لهذه المادة'; end if;
 if p_request_key is null or p_prompt is null or p_quality is null or p_quality not in ('medium','high') or length(trim(p_prompt)) not between 10 and 3000 then raise exception 'وصف الصورة أو الجودة غير صالح'; end if;
 -- Serialize all account reservations, including different users, before checking the monthly cap.
 perform pg_advisory_xact_lock(20260920,1080);
 select * into job from public.design_jobs where request_key=p_request_key;
 if found then
   if job.content_id<>p_content_id or job.created_by<>me then raise exception 'طلب غير مطابق'; end if;
   return jsonb_build_object('job',to_jsonb(job),'new',false);
 end if;
 if exists(select 1 from public.design_jobs where content_id=p_content_id and status in ('pending','generating_scene')) then
   raise exception 'يوجد توليد قيد التنفيذ. انتظر أو راجع آخر محاولة';
 end if;
 if (select count(*) from public.design_jobs where content_id=p_content_id and attempt_count>0)>=3 then raise exception 'وصلت لحد ٣ محاولات لهذه المادة'; end if;
 -- Conservative reservation, not an exact OpenAI bill. Failed/ambiguous requests stay charged against the cap.
 reserve := case when p_quality='high' then 0.30 else 0.10 end;
 if coalesce((select sum(estimated_cost_usd) from public.design_jobs where created_at>=date_trunc('month',now())),0)+reserve>5 then
   raise exception 'تم بلوغ حد التجربة الشهري: ٥ دولارات';
 end if;
 insert into public.design_jobs(content_id,created_by,template_id,request_key,status,scene_prompt,image_model,image_quality,attempt_count,estimated_cost_usd)
 values(p_content_id,me,(select id from public.design_templates where template_key='sono-white-v1'),p_request_key,'generating_scene',p_prompt,'gpt-image-1.5',p_quality,1,reserve)
 returning * into job;
 return jsonb_build_object('job',to_jsonb(job),'new',true);
end; $$;
revoke all on function public.reserve_design_scene(uuid,uuid,text,text) from public;
grant execute on function public.reserve_design_scene(uuid,uuid,text,text) to authenticated;
create table if not exists public.design_versions (
 id uuid primary key default gen_random_uuid(),
 content_id uuid not null references public.content_items(id) on delete cascade,
 created_by uuid not null references public.admins(id),
 scene_job_id uuid references public.design_jobs(id),
 source_file_url text,
 output_file_url text not null,
 settings jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.design_versions enable row level security;
drop policy if exists "staff read design versions" on public.design_versions;
create policy "staff read design versions" on public.design_versions for select to authenticated using(public.my_admin_id() is not null);
grant select on public.design_versions to authenticated;
create or replace function public.save_design_version(p_content_id uuid,p_output_url text,p_source_url text,p_scene_job_id uuid,p_settings jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid:=public.my_admin_id(); version_id uuid;
begin
 if me is null or not exists(select 1 from public.content_items where id=p_content_id and brand='sono' and stage not in ('published','scheduled','ready_to_publish') and
 (created_by=me or assigned_designer=me or public.can_manage_all_content())) then raise exception 'غير مسموح'; end if;
 if p_output_url !~ '^https://' or jsonb_typeof(p_settings)<>'object' then raise exception 'بيانات النسخة غير صالحة'; end if;
 if p_scene_job_id is not null and not exists(select 1 from public.design_jobs where id=p_scene_job_id and scene_storage_path like 'sono/%') then raise exception 'الصورة غير موجودة'; end if;
 insert into public.design_versions(content_id,created_by,scene_job_id,source_file_url,output_file_url,settings)
 values(p_content_id,me,p_scene_job_id,p_source_url,p_output_url,p_settings) returning id into version_id;
 return version_id;
end; $$;
revoke all on function public.save_design_version(uuid,text,text,uuid,jsonb) from public;
grant execute on function public.save_design_version(uuid,text,text,uuid,jsonb) to authenticated;
commit;
