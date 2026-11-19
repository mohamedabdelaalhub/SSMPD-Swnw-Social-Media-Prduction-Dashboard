-- Owner 2026-11-18 (website chat): «عايز اشيل مواعيد العيادات اليومية من المحتوي، وماتنزلش تاني علي الموقع لان فيه سكشن أطباء اليوم ودا كفاية».
-- Daily clinic schedule items (agent_raw_output.content_kind = 'daily_clinics') keep going to social platforms,
-- but are never upserted to the website. 'unpublish' stays allowed so existing ones can be removed.
-- website_auto_enqueue() already swallows exceptions (warning only), so publishing to social is unaffected.
begin;

create or replace function public.website_is_daily_clinics(p_raw text) returns boolean
language plpgsql immutable set search_path to 'public' as $$
begin
 if p_raw is null or p_raw not like '%daily_clinics%' then return false; end if;
 return (p_raw::jsonb)->>'content_kind' = 'daily_clinics';
exception when others then return false;
end $$;

create or replace function public.website_enqueue(p_id uuid, p_action text default 'upsert'::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c public.content_items; old public.website_publications; data jsonb;
begin
 if auth.role() <> 'service_role' and not public.website_can_publish(p_id) then raise exception 'غير مسموح بالنشر'; end if;
 select * into c from public.content_items where id=p_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 select * into old from public.website_publications where content_id=p_id for update;
 if p_action not in ('upsert','unpublish') then raise exception 'إجراء غير صالح'; end if;
 if p_action='upsert' then
  if public.website_is_daily_clinics(c.agent_raw_output) then raise exception 'مواعيد العيادات اليومية لا تُنشر على الموقع؛ قسم «أطباء اليوم» يعرضها'; end if;
  if c.stage not in ('ready_to_publish','scheduled','published') then raise exception 'اعتمد المادة أولًا'; end if;
  if not (coalesce(c.publish_platforms,'[]'::jsonb) ? 'website' or c.publish_platform='website') then raise exception 'اختر منصة الموقع أولًا واحفظ الاختيار'; end if;
  data=jsonb_build_object('id',c.id,'title',c.title,
   'captionText',public.publication_text(c.caption_text,c.body,c.title,c.cta_text,c.hook_text,c.brand),
   'platforms',case when coalesce(c.publish_platforms,'[]'::jsonb)?'website' then c.publish_platforms else coalesce(c.publish_platforms,'[]'::jsonb)||'["website"]'::jsonb end,
   'publishedUrl',c.published_url,'publishedAt',coalesce(c.published_at,(old.payload->>'publishedAt')::timestamptz,now()),
   'format',case when c.content_format in ('carousel','video') then c.content_format else 'image' end,
   '_imageUrl',case when c.content_format='video' then null else c.design_file_url end,
   '_slides',case when c.content_format='carousel' then c.carousel_slides else null end,
   '_videoUrl',case when c.content_format='video' then c.design_file_url else null end);
 else
  if old.content_id is null then raise exception 'لا يوجد نشر للموقع'; end if;
  data=jsonb_build_object('id',c.id,'action','unpublish');
 end if;
 if old.payload=data and old.action=p_action and old.website_publish_status <> 'failed' then return; end if;
 insert into public.website_publications(content_id,action,payload) values(p_id,p_action,data)
 on conflict(content_id) do update set revision=website_publications.revision+1,action=excluded.action,payload=excluded.payload,attempts=0,next_attempt_at=now(),last_error=null,updated_at=now(),
 website_publish_status=case when website_publications.website_publish_status='processing' then 'processing' else 'queued' end;
end $function$;

-- website_content_changed(): a daily-clinics item edited after removal must not be re-upserted.
create or replace function public.website_content_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
 -- أرشفة الوسائط على الدرايف ما تعتبرش تعديل محتوى يستدعي إعادة نشر على الموقع
 if coalesce(current_setting('ssmpd.media_archive', true), '') = '1' then return new; end if;
 if exists(select 1 from public.website_publications where content_id=new.id and action='upsert')
 and (new.title,new.caption_text,new.body,new.cta_text,new.hook_text,new.brand,new.design_file_url,new.published_url,new.publish_platforms,new.publish_platform,new.stage,new.content_format,new.carousel_slides)
 is distinct from (old.title,old.caption_text,old.body,old.cta_text,old.hook_text,old.brand,old.design_file_url,old.published_url,old.publish_platforms,old.publish_platform,old.stage,old.content_format,old.carousel_slides) then
  if new.stage not in ('ready_to_publish','scheduled','published') or not(coalesce(new.publish_platforms,'[]'::jsonb)?'website' or new.publish_platform='website')
     or public.website_is_daily_clinics(new.agent_raw_output) then
   perform public.website_enqueue(new.id,'unpublish');
  else perform public.website_enqueue(new.id,'upsert'); end if;
 end if;
 return new;
end $function$;

commit;
