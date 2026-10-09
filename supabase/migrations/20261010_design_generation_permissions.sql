begin;
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

commit;
