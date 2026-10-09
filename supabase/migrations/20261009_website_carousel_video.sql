-- Website publishing for carousels and reels — CONTENT dashboard project uuijfbpgvtdxgaosqpxo.
-- Requires 20261009_carousel_format.sql. The snapshot now carries the format and the private
-- slide/video locations; the worker turns them into short-lived download links for the studio.
-- Images-only posts are unchanged.
create or replace function public.website_enqueue(p_id uuid, p_action text default 'upsert') returns void
language plpgsql security definer set search_path=public as $$
declare c public.content_items; old public.website_publications; data jsonb;
begin
 if auth.role() <> 'service_role' and not public.website_can_publish(p_id) then raise exception 'غير مسموح بالنشر'; end if;
 select * into c from public.content_items where id=p_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 select * into old from public.website_publications where content_id=p_id for update;
 if p_action not in ('upsert','unpublish') then raise exception 'إجراء غير صالح'; end if;
 if p_action='upsert' then
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
end $$;

create or replace function public.website_content_changed() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.website_publications where content_id=new.id and action='upsert')
 and (new.title,new.caption_text,new.body,new.cta_text,new.hook_text,new.brand,new.design_file_url,new.published_url,new.publish_platforms,new.publish_platform,new.stage,new.content_format,new.carousel_slides)
 is distinct from (old.title,old.caption_text,old.body,old.cta_text,old.hook_text,old.brand,old.design_file_url,old.published_url,old.publish_platforms,old.publish_platform,old.stage,old.content_format,old.carousel_slides) then
  if new.stage not in ('ready_to_publish','scheduled','published') or not(coalesce(new.publish_platforms,'[]'::jsonb)?'website' or new.publish_platform='website') then
   perform public.website_enqueue(new.id,'unpublish');
  else perform public.website_enqueue(new.id,'upsert'); end if;
 end if;
 return new;
end $$;
