begin;
create table if not exists public.design_budget_settings (
 singleton boolean primary key default true check(singleton),
 monthly_limit_usd numeric(12,2) not null default 5 check(monthly_limit_usd between 0 and 100000),
 updated_by uuid,
 updated_at timestamptz not null default now()
);
insert into public.design_budget_settings(singleton) values(true) on conflict do nothing;
alter table public.design_budget_settings enable row level security;
revoke all on public.design_budget_settings from public,anon,authenticated;
create or replace function public.get_design_monthly_budget()
returns jsonb language plpgsql security definer set search_path=public as $$
declare cap numeric; used numeric;
begin
 if public.my_admin_id() is null or not public.has_role('super_admin') then raise exception 'غير مسموح'; end if;
 select monthly_limit_usd into cap from public.design_budget_settings where singleton;
 select coalesce(sum(estimated_cost_usd),0) into used from public.design_jobs where created_at>=date_trunc('month',now());
 return jsonb_build_object('limit_usd',cap,'reserved_usd',used,'remaining_usd',greatest(0,cap-used));
end; $$;
create or replace function public.set_design_monthly_budget(p_limit_usd numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if public.my_admin_id() is null or not public.has_role('super_admin') then raise exception 'غير مسموح'; end if;
 if p_limit_usd is null or p_limit_usd<0 or p_limit_usd>100000 or p_limit_usd<>round(p_limit_usd,2) then raise exception 'اكتب ميزانية بالدولار من صفر إلى 100000 وبحد أقصى رقمين بعد العلامة'; end if;
 perform pg_advisory_xact_lock(20260920,1080);
 update public.design_budget_settings set monthly_limit_usd=p_limit_usd,updated_by=public.my_admin_id(),updated_at=now() where singleton;
 return public.get_design_monthly_budget();
end; $$;
revoke all on function public.get_design_monthly_budget() from public;
revoke all on function public.set_design_monthly_budget(numeric) from public;
grant execute on function public.get_design_monthly_budget() to authenticated;
grant execute on function public.set_design_monthly_budget(numeric) to authenticated;
create or replace function public.reserve_design_scene(p_content_id uuid,p_request_key uuid,p_prompt text,p_quality text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := public.my_admin_id(); job public.design_jobs%rowtype; reserve numeric; monthly_limit numeric;
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
 select monthly_limit_usd into monthly_limit from public.design_budget_settings where singleton;
 if monthly_limit is null then raise exception 'إعداد الميزانية غير موجود. راجع السوبر أدمن.'; end if;
 if coalesce((select sum(estimated_cost_usd) from public.design_jobs where created_at>=date_trunc('month',now())),0)+reserve>monthly_limit then
   raise exception 'تم بلوغ الميزانية الشهرية للتصميم: % دولار. راجع السوبر أدمن.',monthly_limit;
 end if;
 insert into public.design_jobs(content_id,created_by,template_id,request_key,status,scene_prompt,image_model,image_quality,attempt_count,estimated_cost_usd)
 values(p_content_id,me,(select id from public.design_templates where template_key=case when (select brand from public.content_items where id=p_content_id)='dr_dina' then 'dina-post-v1' else 'sono-white-v1' end),p_request_key,'generating_scene',p_prompt,'gpt-image-1.5',p_quality,1,reserve)
 returning * into job;
 return jsonb_build_object('job',to_jsonb(job),'new',true);
end; $$;
revoke all on function public.reserve_design_scene(uuid,uuid,text,text) from public;
grant execute on function public.reserve_design_scene(uuid,uuid,text,text) to authenticated;

commit;

