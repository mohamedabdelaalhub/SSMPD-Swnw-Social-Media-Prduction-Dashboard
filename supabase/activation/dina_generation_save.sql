begin;
insert into public.design_templates(brand,name,template_key,settings) values('dr_dina','د. دينا — القوالب الأصلية','dina-post-v1','{"variants":12,"assets":"assets/design-templates/dr-dina/"}') on conflict(template_key) do nothing;

create or replace function public.reserve_design_scene(p_content_id uuid,p_request_key uuid,p_prompt text,p_quality text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := public.my_admin_id(); job public.design_jobs%rowtype; reserve numeric;
begin
 if me is null then raise exception 'غير مسموح'; end if;
 if not public.can_write_private_design(p_content_id) or not exists(select 1 from public.content_items where id=p_content_id and brand in ('sono','dr_dina')) then raise exception 'غير مسموح لهذه المادة'; end if;
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
 values(p_content_id,me,(select id from public.design_templates where template_key=case when (select brand from public.content_items where id=p_content_id)='dr_dina' then 'dina-post-v1' else 'sono-white-v1' end),p_request_key,'generating_scene',p_prompt,'gpt-image-1.5',p_quality,1,reserve)
 returning * into job;
 return jsonb_build_object('job',to_jsonb(job),'new',true);
end; $$;
revoke all on function public.reserve_design_scene(uuid,uuid,text,text) from public;
grant execute on function public.reserve_design_scene(uuid,uuid,text,text) to authenticated;

create or replace function public.save_private_design_version(p_content_id uuid,p_output_url text,p_source_url text,p_scene_job_id uuid,p_settings jsonb,p_base_version uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.content_items%rowtype; newest uuid; version_id uuid; object_path text;
 prefix constant text:='https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/';
begin
 select * into item from public.content_items where id=p_content_id for update;
 if not found or not public.can_write_private_design(p_content_id) then raise exception 'غير مسموح بتعديل التصميم'; end if;
 select id into newest from public.design_versions where content_id=p_content_id order by created_at desc,id desc limit 1;
 if newest is distinct from p_base_version then raise exception 'تم حفظ نسخة أحدث من جهاز آخر. افتح التصميم مجددًا قبل الحفظ.'; end if;
 if p_output_url is null or p_output_url not like prefix||p_content_id::text||'/%/output.png'
 or p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'بيانات التصميم غير صالحة'; end if;
 object_path:=substr(p_output_url,length(prefix)+1);
 if object_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/output[.]png$' or not exists(
 select 1 from storage.objects where bucket_id='content-designs' and name=object_path and owner_id=auth.uid()::text)
 then raise exception 'ملف التصميم غير موجود أو ليس من رفعك'; end if;
 if p_source_url is not null and (p_source_url<>left(p_output_url,length(p_output_url)-length('output.png'))||'source.png' or not exists(
 select 1 from storage.objects where bucket_id='content-designs' and name=substr(p_source_url,length(prefix)+1) and owner_id=auth.uid()::text)) then raise exception 'الصورة الأصلية غير موجودة'; end if;
 if p_scene_job_id is not null and not exists(select 1 from public.design_jobs where id=p_scene_job_id and (content_id=p_content_id or scene_storage_path like item.brand::text||'/%')) then raise exception 'مشهد غير صالح'; end if;
 insert into public.design_versions(content_id,created_by,scene_job_id,source_file_url,output_file_url,settings)
 values(p_content_id,public.my_admin_id(),p_scene_job_id,p_source_url,p_output_url,p_settings) returning id into version_id;
 update public.content_items set design_file_url=p_output_url where id=p_content_id returning * into item;
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(p_content_id,public.my_admin_id(),'حفظ نسخة تصميم خاصة جديدة',item.stage,item.stage);
 return jsonb_build_object('version_id',version_id,'item',to_jsonb(item));
end $$;
revoke all on function public.save_private_design_version(uuid,text,text,uuid,jsonb,uuid) from public;
grant execute on function public.save_private_design_version(uuid,text,text,uuid,jsonb,uuid) to authenticated;

commit;
