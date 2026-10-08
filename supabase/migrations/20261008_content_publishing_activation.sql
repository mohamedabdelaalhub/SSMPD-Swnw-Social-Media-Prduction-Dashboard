-- Activate publication text, website queue, and pre-publication revision in the CONTENT dashboard project.
begin;
create or replace function public.publication_text(p_caption text,p_body text,p_title text,p_cta text,p_hook text,p_brand text) returns text
language plpgsql immutable set search_path=public as $$
declare t text; c text; h text; contact text[]='{}';
begin
 t=coalesce(nullif(regexp_replace(coalesce(p_caption,''),'^[[:space:]]+|[[:space:]]+$','','g'),''),nullif(regexp_replace(coalesce(p_body,''),'^[[:space:]]+|[[:space:]]+$','','g'),''),regexp_replace(coalesce(p_title,''),'^[[:space:]]+|[[:space:]]+$','','g'));
 c=regexp_replace(coalesce(p_cta,''),'^[[:space:]]+|[[:space:]]+$','','g');
 h=regexp_replace(coalesce(p_hook,''),'^[[:space:]]+|[[:space:]]+$','','g');
 if h<>'' and strpos(lower(regexp_replace(t,'[[:space:]]+',' ','g')),lower(regexp_replace(h,'[[:space:]]+',' ','g')))=0 then t=h||case when t='' then '' else E'\n\n'||t end; end if;
 if c<>'' and strpos(lower(regexp_replace(t,'[[:space:]]+',' ','g')),lower(regexp_replace(c,'[[:space:]]+',' ','g')))=0 then t=case when t='' then c else t||E'\n\n'||c end; end if;
 if p_brand in ('sono','dr_dina') then
  if t !~ '45[[:space:]]*ع?(.|[[:space:]]){0,100}الخزان' or strpos(t,'الأهرام')=0 then contact=array_append(contact,'العنوان: الجيزة، حدائق الأهرام، 45ع شارع الخزان.'); end if;
  if strpos(regexp_replace(t,'[[:space:]()-]','','g'),'0236230005')=0 then contact=array_append(contact,'التليفون: 0236230005'); end if;
  if strpos(t,'https://wa.me/201010686264')=0 then contact=array_append(contact,'واتساب: https://wa.me/201010686264'); end if;
  if cardinality(contact)>0 then t=t||case when t='' then '' else E'\n\n' end||array_to_string(contact,E'\n'); end if;
 end if;
 return t;
end; $$;
create table if not exists public.website_publications (
 content_id uuid primary key references public.content_items(id) on delete cascade,
 website_publish_status text not null default 'queued' check (website_publish_status in ('queued','processing','retry','published','pending_review','unpublished','failed')),
 action text not null check(action in ('upsert','unpublish')),
 revision bigint not null default 1, payload jsonb not null,
 attempts int not null default 0, next_attempt_at timestamptz not null default now(),
 lease_until timestamptz, claim_token uuid, public_path text, last_error text,
 updated_at timestamptz not null default now()
);
create table if not exists public.website_publish_attempts (
 id bigint generated always as identity primary key,
 content_id uuid not null references public.website_publications(content_id) on delete cascade,
 revision bigint not null, attempted_at timestamptz not null default now(),
 http_status int, outcome text not null
);
create or replace function public.website_can_publish(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('approver')
 or (public.has_role('page_manager') and exists(select 1 from public.content_items where id=p_id and created_by=public.my_admin_id()));
$$;
alter table public.website_publications enable row level security;
alter table public.website_publish_attempts enable row level security;
drop policy if exists website_publications_read on public.website_publications;
create policy website_publications_read on public.website_publications for select to authenticated using(public.website_can_publish(content_id));
drop policy if exists website_attempts_read on public.website_publish_attempts;
create policy website_attempts_read on public.website_publish_attempts for select to authenticated using(public.website_can_publish(content_id));
grant select on public.website_publications,public.website_publish_attempts to authenticated;

create or replace function public.website_enqueue(p_id uuid,p_action text default 'upsert') returns void
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
  data=jsonb_build_object('id',c.id,'title',c.title,'captionText',public.publication_text(c.caption_text,c.body,c.title,c.cta_text,c.hook_text,c.brand),'platforms',case when coalesce(c.publish_platforms,'[]'::jsonb)?'website' then c.publish_platforms else coalesce(c.publish_platforms,'[]'::jsonb)||'["website"]'::jsonb end,'publishedUrl',c.published_url,'publishedAt',coalesce(c.published_at,(old.payload->>'publishedAt')::timestamptz,now()),'_imageUrl',c.design_file_url);
 else
  if old.content_id is null then raise exception 'لا يوجد نشر للموقع'; end if;
  data=jsonb_build_object('id',c.id,'action','unpublish');
 end if;
 -- Repeated confirmations with the same snapshot are idempotent; failed jobs can be retried explicitly.
 if old.payload=data and old.action=p_action and old.website_publish_status <> 'failed' then return; end if;
 insert into public.website_publications(content_id,action,payload) values(p_id,p_action,data)
 on conflict(content_id) do update set revision=website_publications.revision+1,action=excluded.action,payload=excluded.payload,attempts=0,next_attempt_at=now(),last_error=null,updated_at=now(),
 website_publish_status=case when website_publications.website_publish_status='processing' then 'processing' else 'queued' end;
end $$;
create or replace function public.website_content_changed() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.website_publications where content_id=new.id and action='upsert')
 and (new.title,new.caption_text,new.body,new.cta_text,new.hook_text,new.brand,new.design_file_url,new.published_url,new.publish_platforms,new.publish_platform,new.stage)
 is distinct from (old.title,old.caption_text,old.body,old.cta_text,old.hook_text,old.brand,old.design_file_url,old.published_url,old.publish_platforms,old.publish_platform,old.stage) then
  if new.stage not in ('ready_to_publish','scheduled','published') or not(coalesce(new.publish_platforms,'[]'::jsonb)?'website' or new.publish_platform='website') then
   perform public.website_enqueue(new.id,'unpublish');
  else perform public.website_enqueue(new.id,'upsert'); end if;
 end if;
 return new;
end $$;
drop trigger if exists website_content_changed on public.content_items;
create trigger website_content_changed after update on public.content_items for each row execute function public.website_content_changed();

create or replace function public.website_content_deleting() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.website_publications where content_id=old.id and website_publish_status<>'unpublished') then
  raise exception 'اسحب المادة من الموقع وانتظر تأكيد السحب قبل حذفها';
 end if;return old;
end $$;
drop trigger if exists website_content_deleting on public.content_items;
create trigger website_content_deleting before delete on public.content_items for each row execute function public.website_content_deleting();
revoke all on function public.website_content_deleting() from public,anon,authenticated;

create or replace function public.website_claim() returns setof public.website_publications
language plpgsql security definer set search_path=public as $$
declare chosen uuid;
begin
 select content_id into chosen from public.website_publications
 where (website_publish_status in ('queued','retry') and next_attempt_at<=now())
 or (website_publish_status='processing' and lease_until<now())
 order by next_attempt_at for update skip locked limit 1;
 return query update public.website_publications set website_publish_status='processing',lease_until=now()+interval '10 minutes',claim_token=gen_random_uuid(),attempts=attempts+1 where content_id=chosen returning *;
end $$;
create or replace function public.website_finish(p_id uuid,p_revision bigint,p_token uuid,p_status text,p_http int,p_error text,p_path text) returns void
language plpgsql security definer set search_path=public as $$
declare job public.website_publications;
begin
 select * into job from public.website_publications where content_id=p_id for update;
 if job.claim_token is distinct from p_token then return; end if;
 insert into public.website_publish_attempts(content_id,revision,http_status,outcome) values(p_id,p_revision,p_http,coalesce(p_error,p_status));
 update public.website_publications set website_publish_status=case when revision<>p_revision then 'queued' when p_status='retry' and attempts>=5 then 'failed' else p_status end,
 next_attempt_at=case when revision<>p_revision then now() else now()+make_interval(secs => least(3600,30*power(2,least(attempts,7)))::int) end,
 lease_until=null,claim_token=null,last_error=case when revision<>p_revision then null else p_error end,public_path=coalesce(p_path,public_path),updated_at=now() where content_id=p_id;
end $$;
revoke all on function public.website_can_publish(uuid),public.website_enqueue(uuid,text),public.website_claim(),public.website_finish(uuid,bigint,uuid,text,int,text,text),public.website_content_changed() from public,anon,authenticated;
grant execute on function public.website_can_publish(uuid),public.website_enqueue(uuid,text) to authenticated;
grant execute on function public.website_claim(),public.website_finish(uuid,bigint,uuid,text,int,text,text) to service_role;
commit;


begin;
create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid; allowed boolean := false;
begin
  if auth.role() = 'service_role' then return new; end if;
  if public.can_manage_all_content() then return new; end if;
  me := public.my_admin_id();
  if old.stage in ('ready_to_publish','scheduled') and new.stage='final_approval'
    and (old.created_by=me or public.has_role('approver')) then return new; end if;

  if public.has_role('page_manager') and old.created_by = me and (
    (old.stage = 'idea_selection' and new.stage = 'initial_approval')
    or (old.stage = 'ready_to_publish' and new.stage = 'published')
    or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
    or (old.stage = 'scheduled' and new.stage = 'published')
    or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
    or (old.stage = 'needs_revision' and old.assigned_designer is null and new.stage = 'initial_approval')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and public.has_role('designer') and (old.assigned_designer is null or old.assigned_designer = me) and (
    (old.stage = 'in_design' and new.stage = 'final_approval')
    or (old.stage = 'needs_revision' and old.assigned_designer is not null and new.stage = 'final_approval')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and public.has_role('approver') and (
    (old.stage = 'initial_approval' and new.stage in ('in_design','needs_revision'))
    or (old.stage = 'final_approval' and new.stage in ('ready_to_publish','needs_revision'))
    or (old.stage = 'ready_to_publish' and new.stage = 'published')
    or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
    or (old.stage = 'scheduled' and new.stage = 'published')
    or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and old.design_execution = 'ai' and new.design_execution = 'ai'
    and old.stage in ('in_design','needs_revision') and new.stage = 'final_approval'
    and (old.created_by = me or public.has_role('approver'))
    and new.design_file_url is not null then allowed := true; end if;
  if allowed then return new; end if;
  raise exception 'انتقال مرحلة غير مسموح لدورك الحالي';
end $$;

create or replace function public.guard_prepublication_revision() returns trigger
language plpgsql security definer set search_path=public as $$
declare changed boolean; website_status text;
begin
 changed=(new.title,new.brand,new.specialty,new.body,new.caption_text,new.hook_text,new.cta_text,new.cta_type,new.script_text,new.design_file_url,new.content_format,new.content_angle,new.topic_service,new.advertising_objective,new.hypothesis_reason,new.video_template,new.target_duration_min_seconds,new.target_duration_max_seconds)
 is distinct from (old.title,old.brand,old.specialty,old.body,old.caption_text,old.hook_text,old.cta_text,old.cta_type,old.script_text,old.design_file_url,old.content_format,old.content_angle,old.topic_service,old.advertising_objective,old.hypothesis_reason,old.video_template,old.target_duration_min_seconds,old.target_duration_max_seconds);
 if old.stage not in ('ready_to_publish','scheduled') or not(changed or new.stage='final_approval') then return new; end if;
 if public.my_admin_id() is null or not(public.can_manage_all_content() or public.has_role('approver') or old.created_by=public.my_admin_id()) then raise exception 'غير مسموح بتعديل هذه المادة'; end if;
 -- Lock the same rows that the publisher claims, before changing the approved content.
 perform 1 from public.meta_publish_jobs where content_id=old.id for update;
 if exists(select 1 from public.meta_publish_jobs where content_id=old.id and status in ('processing','published','partial')) then raise exception 'النشر بدأ أو تم جزئيًا. حدّث الحالة قبل التعديل'; end if;
 if to_regclass('public.website_publications') is not null then
  execute 'select website_publish_status from public.website_publications where content_id=$1 for update' into website_status using old.id;
  if website_status='processing' then raise exception 'إرسال الموقع بدأ. حدّث الحالة قبل التعديل'; end if;
 end if;
 update public.meta_publish_jobs set status='cancelled' where content_id=old.id and status='pending';
 new.stage='final_approval';new.scheduled_publish_at=null;new.scheduled_by=null;
 return new;
end $$;
drop trigger if exists content_items_prepublication_revision on public.content_items;
create trigger content_items_prepublication_revision before update on public.content_items for each row execute function public.guard_prepublication_revision();
revoke all on function public.guard_prepublication_revision() from public,anon,authenticated;

create or replace function public.revise_content_before_publish(p_id uuid,p_patch jsonb,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current public.content_items; proposed public.content_items; updated public.content_items;
begin
 select * into current from public.content_items where id=p_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 if public.my_admin_id() is null or not(public.can_manage_all_content() or public.has_role('approver') or current.created_by=public.my_admin_id()) then raise exception 'غير مسموح بتعديل هذه المادة'; end if;
 if current.stage not in ('ready_to_publish','scheduled') then raise exception 'المادة لم تعد متاحة للتعديل قبل النشر'; end if;
 if p_expected_updated_at is null or current.updated_at is distinct from p_expected_updated_at then raise exception 'المادة اتغيرت منذ فتحها. حدّث القائمة وافتح التعديل مجددًا'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'مدخلات غير صالحة'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) as k(key) where key not in ('title','body','brand','specialty','advertising_objective','content_format','topic_service','hook_text','content_angle','script_text','caption_text','cta_type','cta_text','target_duration_min_seconds','target_duration_max_seconds','video_template','hypothesis_reason')) then raise exception 'حقل تعديل غير مسموح'; end if;
 proposed=jsonb_populate_record(current,p_patch);
 if nullif(btrim(proposed.title),'') is null or proposed.brand not in ('sono','dr_dina') or proposed.brand is null then raise exception 'العنوان والصفحة مطلوبان'; end if;
 if proposed.target_duration_max_seconds<proposed.target_duration_min_seconds then raise exception 'مدة الفيديو غير صالحة'; end if;
 update public.content_items set title=proposed.title,body=proposed.body,brand=proposed.brand,specialty=proposed.specialty,
 advertising_objective=proposed.advertising_objective,content_format=proposed.content_format,topic_service=proposed.topic_service,
 hook_text=proposed.hook_text,content_angle=proposed.content_angle,script_text=proposed.script_text,caption_text=proposed.caption_text,
 cta_type=proposed.cta_type,cta_text=proposed.cta_text,target_duration_min_seconds=proposed.target_duration_min_seconds,
 target_duration_max_seconds=proposed.target_duration_max_seconds,video_template=proposed.video_template,hypothesis_reason=proposed.hypothesis_reason,
 stage='final_approval',scheduled_publish_at=null,scheduled_by=null where id=p_id returning * into updated;
 return to_jsonb(updated);
end $$;
revoke all on function public.revise_content_before_publish(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.revise_content_before_publish(uuid,jsonb,timestamptz) to authenticated;
commit;
