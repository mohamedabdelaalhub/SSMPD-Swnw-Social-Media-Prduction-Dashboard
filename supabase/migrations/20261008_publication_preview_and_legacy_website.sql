begin;
create or replace function public.publication_text(p_caption text,p_body text,p_title text,p_cta text) returns text
language plpgsql immutable set search_path=public as $$
declare t text; c text;
begin
 t=coalesce(nullif(regexp_replace(coalesce(p_caption,''),'^[[:space:]]+|[[:space:]]+$','','g'),''),nullif(regexp_replace(coalesce(p_body,''),'^[[:space:]]+|[[:space:]]+$','','g'),''),regexp_replace(coalesce(p_title,''),'^[[:space:]]+|[[:space:]]+$','','g'));
 c=regexp_replace(coalesce(p_cta,''),'^[[:space:]]+|[[:space:]]+$','','g');
 if c<>'' and strpos(lower(regexp_replace(t,'[[:space:]]+',' ','g')),lower(regexp_replace(c,'[[:space:]]+',' ','g')))=0 then t=case when t='' then c else t||E'\n\n'||c end; end if;
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
  data=jsonb_build_object('id',c.id,'title',c.title,'captionText',public.publication_text(c.caption_text,c.body,c.title,c.cta_text),'platforms',case when coalesce(c.publish_platforms,'[]'::jsonb)?'website' then c.publish_platforms else coalesce(c.publish_platforms,'[]'::jsonb)||'["website"]'::jsonb end,'publishedUrl',c.published_url,'publishedAt',coalesce(c.published_at,(old.payload->>'publishedAt')::timestamptz,now()),'_imageUrl',c.design_file_url);
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
 and (new.title,new.caption_text,new.body,new.cta_text,new.design_file_url,new.published_url,new.publish_platforms,new.publish_platform,new.stage)
 is distinct from (old.title,old.caption_text,old.body,old.cta_text,old.design_file_url,old.published_url,old.publish_platforms,old.publish_platform,old.stage) then
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

