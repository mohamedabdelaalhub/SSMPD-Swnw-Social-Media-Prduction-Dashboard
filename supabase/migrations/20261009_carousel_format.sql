-- Carousel posts (Instagram/Facebook multi-image) — CONTENT dashboard project uuijfbpgvtdxgaosqpxo.
-- Requires 20261006_private_design_files.sql. No existing rows or files are changed.
--
-- Model: each slide is saved exactly like a private design (content-designs/<content>/<uuid>/output.png
-- + a design_versions row), so the existing upload and view storage policies apply unchanged.
-- content_items.carousel_slides keeps the ordered slide URLs; design_file_url keeps the cover (slide 1)
-- so every existing preview, website and legacy path keeps working.
begin;
do $$ begin
 if to_regprocedure('public.can_write_private_design(uuid)') is null then
  raise exception 'شغّل ملف ملفات التصميم الخاصة (20261006_private_design_files.sql) أولاً';
 end if;
end $$;

alter table public.content_items drop constraint if exists content_items_content_format_check;
alter table public.content_items add constraint content_items_content_format_check
 check (content_format is null or content_format in ('video','image_post','link_post','carousel'));

alter table public.content_items add column if not exists carousel_slides jsonb not null default '[]'::jsonb;
alter table public.content_items drop constraint if exists content_items_carousel_slides_check;
alter table public.content_items add constraint content_items_carousel_slides_check
 check (jsonb_typeof(carousel_slides)='array' and jsonb_array_length(carousel_slides)<=10);

-- Slides may only change through save_private_carousel() (or the service role used by automation),
-- so a client cannot point a carousel at another item's private files.
create or replace function public.guard_carousel_slides() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.carousel_slides is distinct from old.carousel_slides
  and coalesce(current_setting('ssmpd.carousel_rpc', true),'') <> '1'
  and coalesce(auth.role(),'') <> 'service_role' then
  raise exception 'شرايح الكاروسيل بتتحفظ من شاشة رفع التصميم فقط';
 end if;
 return new;
end $$;
revoke all on function public.guard_carousel_slides() from public,anon,authenticated;
drop trigger if exists content_items_guard_carousel_slides on public.content_items;
create trigger content_items_guard_carousel_slides before update of carousel_slides on public.content_items
 for each row execute function public.guard_carousel_slides();

create or replace function public.save_private_carousel(p_content_id uuid, p_output_urls text[], p_settings jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.content_items%rowtype; n int; i int; u text; object_path text;
 prefix constant text:='https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/';
begin
 select * into item from public.content_items where id=p_content_id for update;
 if not found or not public.can_write_private_design(p_content_id) then raise exception 'غير مسموح بتعديل التصميم'; end if;
 if item.content_format is distinct from 'carousel' then raise exception 'المادة ليست كاروسيل'; end if;
 n:=coalesce(array_length(p_output_urls,1),0);
 if n<2 or n>10 then raise exception 'الكاروسيل لازم يكون من ٢ لـ ١٠ صور'; end if;
 if (select count(distinct x) from unnest(p_output_urls) x) <> n then raise exception 'فيه صورة مكررة في الكاروسيل'; end if;
 if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'بيانات التصميم غير صالحة'; end if;
 for i in 1..n loop
  u:=p_output_urls[i];
  if u is null or u not like prefix||p_content_id::text||'/%/output.png' then raise exception 'رابط شريحة غير صالح'; end if;
  object_path:=substr(u,length(prefix)+1);
  if object_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/output[.]png$' or not exists(
   select 1 from storage.objects where bucket_id='content-designs' and name=object_path and owner_id=auth.uid()::text)
  then raise exception 'ملف الشريحة % غير موجود أو ليس من رفعك', i; end if;
 end loop;
 for i in 1..n loop
  insert into public.design_versions(content_id,created_by,source_file_url,output_file_url,settings)
  values(p_content_id,public.my_admin_id(),null,p_output_urls[i],
   p_settings||jsonb_build_object('carousel_index',i,'carousel_count',n));
 end loop;
 perform set_config('ssmpd.carousel_rpc','1',true);
 update public.content_items set design_file_url=p_output_urls[1], carousel_slides=to_jsonb(p_output_urls)
  where id=p_content_id returning * into item;
 perform set_config('ssmpd.carousel_rpc','',true);
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(p_content_id,public.my_admin_id(),'حفظ كاروسيل ('||n||' شرايح)',item.stage,item.stage);
 return jsonb_build_object('item',to_jsonb(item));
end $$;
revoke all on function public.save_private_carousel(uuid,text[],jsonb) from public;
grant execute on function public.save_private_carousel(uuid,text[],jsonb) to authenticated;
commit;
