-- Run once in the CONTENT dashboard project: uuijfbpgvtdxgaosqpxo.
-- Requires the existing design pilot and AI routing migrations. No existing files are removed.
begin;
do $$ begin
 if to_regclass('public.design_versions') is null or to_regprocedure('public.can_manage_all_content()') is null then
 raise exception 'شغّل هذا الملف في مشروع إنتاج المحتوى بعد تفعيل ملفات التصميم السابقة'; end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('content-designs','content-designs',false,20971520,array['image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_write_private_design(p_content_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.my_admin_id() is not null and exists(
 select 1 from public.content_items c where c.id=p_content_id and c.content_format<>'video'
 and c.stage not in('published','scheduled','ready_to_publish')
 and (public.can_manage_all_content() or
 (public.has_role('page_manager') and c.created_by=public.my_admin_id()) or
 (public.has_role('designer') and (c.assigned_designer=public.my_admin_id() or c.created_by=public.my_admin_id())) or
 (public.has_role('approver') and c.design_execution='ai' and c.stage in('in_design','needs_revision','final_approval'))));
$$;
revoke all on function public.can_write_private_design(uuid) from public;
grant execute on function public.can_write_private_design(uuid) to authenticated;

-- Reading follows content visibility AND content module roles (not every logged-in account).
create or replace function public.can_read_private_design(p_content_id uuid)
returns boolean language sql stable security invoker set search_path=public as $$
 select public.my_admin_id() is not null and
 (public.can_manage_all_content() or public.has_role('page_manager') or public.has_role('designer') or public.has_role('approver'))
 and exists(select 1 from public.content_items where id=p_content_id);
$$;
revoke all on function public.can_read_private_design(uuid) from public;
grant execute on function public.can_read_private_design(uuid) to authenticated;

drop policy if exists "private design upload" on storage.objects;
create policy "private design upload" on storage.objects for insert to authenticated with check(
 bucket_id='content-designs' and owner_id=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(output|source)[.]png$'
 and public.can_write_private_design(case when split_part(name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name,'/',1)::uuid else null end));
drop policy if exists "private design view" on storage.objects;
create policy "private design view" on storage.objects for select to authenticated using(
 bucket_id='content-designs' and public.can_read_private_design(case when split_part(name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name,'/',1)::uuid else null end)
 and exists(select 1 from public.design_versions v where
 v.output_file_url='https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/'||name or
 v.source_file_url='https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/'||name));
-- No UPDATE/DELETE policy: saved versions are immutable.

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
 if p_scene_job_id is not null and not exists(select 1 from public.design_jobs where id=p_scene_job_id and scene_storage_path like 'sono/%') then raise exception 'مشهد غير صالح'; end if;
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
