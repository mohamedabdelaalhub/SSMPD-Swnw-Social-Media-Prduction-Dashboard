-- Facebook/Instagram comments inbox — CONTENT dashboard project uuijfbpgvtdxgaosqpxo.
-- meta-comments Edge Function (service role) pulls comments on posts this system published and
-- sends approved replies. Staff read through RLS and change state only through the RPCs below.
-- Every reply is approved by a person before it is sent; nothing is auto-published.
create table if not exists public.social_comments (
 id text primary key,                         -- '<platform>:<platform comment id>'
 platform text not null check (platform in ('facebook','instagram')),
 platform_comment_id text not null,
 brand text not null,
 content_id uuid references public.content_items(id) on delete set null,
 job_id uuid,
 post_ref text not null,
 parent_comment_id text,                      -- platform id of the parent (replies only)
 author_name text,
 author_is_page boolean not null default false,
 message text not null default '',
 commented_at timestamptz,
 status text not null default 'new' check (status in ('new','drafted','approved','sending','replied','ignored','failed')),
 sensitive boolean not null default false,
 suggested_reply text,
 final_reply text,
 reply_platform_id text,
 replied_at timestamptz,
 handled_by uuid,
 last_error text,
 fetched_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists social_comments_status_idx on public.social_comments(status, commented_at desc);
create index if not exists social_comments_parent_idx on public.social_comments(parent_comment_id);
alter table public.social_comments add column if not exists auto_checked boolean not null default false;
alter table public.social_comments add column if not exists auto_template_id uuid;

-- Approved replies library: once a reply is added here, similar new comments get it automatically
-- (no per-comment approval). Sensitive comments are never auto-answered.
create table if not exists public.social_reply_templates (
 id uuid primary key default gen_random_uuid(),
 brand text not null,
 reply_text text not null,
 examples text[] not null default '{}',     -- comment texts this reply answers
 active boolean not null default true,
 uses_count int not null default 0,
 last_used_at timestamptz,
 created_by uuid,
 created_at timestamptz not null default now()
);
alter table public.social_reply_templates enable row level security;

create or replace function public.social_comments_access() returns boolean
language sql stable security definer set search_path=public as $$
 select public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('approver') or public.has_role('page_manager');
$$;
revoke all on function public.social_comments_access() from public,anon;
grant execute on function public.social_comments_access() to authenticated;

alter table public.social_comments enable row level security;
drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read on public.social_comments for select to authenticated using (public.social_comments_access());
grant select on public.social_comments to authenticated;
drop policy if exists social_reply_templates_read on public.social_reply_templates;
create policy social_reply_templates_read on public.social_reply_templates for select to authenticated using (public.social_comments_access());
grant select on public.social_reply_templates to authenticated;

-- Save a suggested reply (Claude's account or staff). Does not send anything.
create or replace function public.social_comment_draft(p_id text, p_reply text, p_sensitive boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.social_comments_access() then raise exception 'غير مسموح'; end if;
 if coalesce(trim(p_reply),'')='' then raise exception 'اكتب الرد'; end if;
 update public.social_comments set suggested_reply=trim(p_reply), sensitive=coalesce(p_sensitive,false),
  status=case when status in ('new','drafted','failed') then 'drafted' else status end, updated_at=now()
 where id=p_id and not author_is_page and status not in ('replied','sending');
 if not found then raise exception 'التعليق غير موجود أو تم الرد عليه'; end if;
end $$;

-- A person approves the final text; the Edge Function sends it.
create or replace function public.social_comment_approve(p_id text, p_reply text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.social_comments_access() then raise exception 'غير مسموح'; end if;
 if coalesce(trim(p_reply),'')='' then raise exception 'اكتب الرد'; end if;
 if length(p_reply)>2000 then raise exception 'الرد طويل جدًا'; end if;
 update public.social_comments set final_reply=trim(p_reply), status='approved', last_error=null,
  handled_by=public.my_admin_id(), updated_at=now()
 where id=p_id and not author_is_page and status in ('new','drafted','failed');
 if not found then raise exception 'التعليق غير متاح للرد'; end if;
end $$;

create or replace function public.social_comment_ignore(p_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.social_comments_access() then raise exception 'غير مسموح'; end if;
 update public.social_comments set status='ignored', handled_by=public.my_admin_id(), updated_at=now()
 where id=p_id and status in ('new','drafted','failed','approved');
 if not found then raise exception 'التعليق غير متاح'; end if;
end $$;

-- "إضافة للردود المعتمدة": from a comment already answered, save (comment → reply) as a standing approval.
-- Same reply text for the same page = one template that collects more example comments.
create or replace function public.social_reply_template_add(p_comment_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.social_comments; t uuid;
begin
 if not public.social_comments_access() then raise exception 'غير مسموح'; end if;
 select * into c from public.social_comments where id=p_comment_id;
 if not found or c.status<>'replied' or coalesce(c.final_reply,'')='' then raise exception 'الرد لازم يكون اتنشر الأول'; end if;
 if c.sensitive then raise exception 'تعليق حساس — مينفعش رده يبقى تلقائي'; end if;
 select id into t from public.social_reply_templates where brand=c.brand and reply_text=c.final_reply limit 1;
 if t is null then
  insert into public.social_reply_templates(brand,reply_text,examples,created_by)
  values(c.brand,c.final_reply,array[c.message],public.my_admin_id()) returning id into t;
 else
  update public.social_reply_templates set examples=case when c.message=any(examples) then examples else examples||c.message end, active=true where id=t;
 end if;
 update public.social_comments set auto_template_id=t where id=p_comment_id;
 return t;
end $$;

create or replace function public.social_reply_template_set(p_id uuid, p_active boolean, p_reply text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.social_comments_access() then raise exception 'غير مسموح'; end if;
 update public.social_reply_templates set active=coalesce(p_active,active),
  reply_text=coalesce(nullif(trim(p_reply),''),reply_text) where id=p_id;
 if not found then raise exception 'الرد غير موجود'; end if;
end $$;
revoke all on function public.social_reply_template_add(text) from public,anon;
revoke all on function public.social_reply_template_set(uuid,boolean,text) from public,anon;
grant execute on function public.social_reply_template_add(text) to authenticated;
grant execute on function public.social_reply_template_set(uuid,boolean,text) to authenticated;

revoke all on function public.social_comment_draft(text,text,boolean) from public,anon;
revoke all on function public.social_comment_approve(text,text) from public,anon;
revoke all on function public.social_comment_ignore(text) from public,anon;
grant execute on function public.social_comment_draft(text,text,boolean) to authenticated;
grant execute on function public.social_comment_approve(text,text) to authenticated;
grant execute on function public.social_comment_ignore(text) to authenticated;

do $$ begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='social_comments') then
  alter publication supabase_realtime add table public.social_comments;
 end if;
end $$;
