-- Business Intelligence hardening: entity graph, default knowledge decay and AI cost controls.

create table if not exists public.business_entity_links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null check (from_type in ('knowledge','recommendation','decision','measurement','task','project','employee','content','campaign','service','audience')),
  from_key text not null check (length(trim(from_key)) between 1 and 240),
  relation_type text not null check (length(trim(relation_type)) between 1 and 80),
  to_type text not null check (to_type in ('knowledge','recommendation','decision','measurement','task','project','employee','content','campaign','service','audience')),
  to_key text not null check (length(trim(to_key)) between 1 and 240),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(from_type,from_key,relation_type,to_type,to_key),
  check (not (from_type=to_type and from_key=to_key))
);

create index if not exists business_entity_links_from_idx on public.business_entity_links(from_type,from_key);
create index if not exists business_entity_links_to_idx on public.business_entity_links(to_type,to_key);
create index if not exists business_entity_links_relation_idx on public.business_entity_links(relation_type,created_at desc);

alter table public.business_entity_links enable row level security;
grant select,insert,update on public.business_entity_links to authenticated;
grant all on public.business_entity_links to service_role;
create policy "business managers read graph" on public.business_entity_links for select to authenticated using (public.business_manager());
create policy "business managers create graph" on public.business_entity_links for insert to authenticated with check (public.business_manager());
create policy "business managers update graph" on public.business_entity_links for update to authenticated using (public.business_manager()) with check (public.business_manager());

-- Sensible defaults when an extractor or manager did not provide a specific review horizon.
create or replace function public.business_default_knowledge_decay()
returns trigger language plpgsql set search_path='public'
as $$
begin
  if new.review_after is null then
    new.review_after := case
      when new.knowledge_type='hypothesis' then now()+interval '30 days'
      when new.knowledge_type in ('content_insight','marketing_opportunity','competitor_insight') then now()+interval '45 days'
      when new.memory_layer='dynamic' then now()+interval '90 days'
      when new.memory_layer='stable' then now()+interval '180 days'
      else now()+interval '180 days'
    end;
  end if;
  if new.expires_at is null and new.memory_layer not in ('decision','result') then
    new.expires_at := case
      when new.knowledge_type='hypothesis' then now()+interval '90 days'
      when new.knowledge_type in ('content_insight','marketing_opportunity','competitor_insight') then now()+interval '120 days'
      when new.memory_layer='dynamic' then now()+interval '180 days'
      when new.memory_layer='stable' then now()+interval '365 days'
      else now()+interval '180 days'
    end;
  end if;
  return new;
end $$;

drop trigger if exists business_default_decay on public.business_knowledge_items;
create trigger business_default_decay before insert on public.business_knowledge_items
for each row execute function public.business_default_knowledge_decay();

-- Expiry never deletes knowledge. It changes its status so the audit trail remains intact.
create or replace function public.business_refresh_decay()
returns integer language plpgsql security definer set search_path='public'
as $$
declare changed integer;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  update public.business_knowledge_items
  set status='outdated',updated_at=now()
  where status in ('manager_approved','validated_by_data') and expires_at is not null and expires_at<=now();
  get diagnostics changed=row_count;
  return changed;
end $$;
revoke all on function public.business_refresh_decay() from public;
grant execute on function public.business_refresh_decay() to authenticated;

-- Cross-module knowledge graph. It stores references only, not duplicated business data.
create or replace function public.business_graph_from_knowledge()
returns trigger language plpgsql security definer set search_path='public'
as $$
begin
  if new.source_task_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('knowledge',new.id::text,'derived_from','task',new.source_task_id::text) on conflict do nothing;
  end if;
  if new.source_project_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('knowledge',new.id::text,'belongs_to','project',new.source_project_id::text) on conflict do nothing;
  end if;
  if new.source_author_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('employee',new.source_author_id::text,'contributed','knowledge',new.id::text) on conflict do nothing;
  end if;
  if trim(coalesce(new.service,''))<>'' then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('knowledge',new.id::text,'about','service',lower(trim(new.service))) on conflict do nothing;
  end if;
  if trim(coalesce(new.audience,''))<>'' then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('knowledge',new.id::text,'targets','audience',lower(trim(new.audience))) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists business_graph_knowledge on public.business_knowledge_items;
create trigger business_graph_knowledge after insert or update of source_task_id,source_project_id,source_author_id,service,audience
on public.business_knowledge_items for each row execute function public.business_graph_from_knowledge();

create or replace function public.business_graph_from_recommendation()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare kid uuid;
begin
  foreach kid in array coalesce(new.source_knowledge_ids,'{}'::uuid[]) loop
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('recommendation',new.id::text,'supported_by','knowledge',kid::text) on conflict do nothing;
  end loop;
  if new.task_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('recommendation',new.id::text,'implemented_as','task',new.task_id::text) on conflict do nothing;
  end if;
  if trim(coalesce(new.service,''))<>'' then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('recommendation',new.id::text,'targets','service',lower(trim(new.service))) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists business_graph_recommendation on public.business_recommendations;
create trigger business_graph_recommendation after insert or update of source_knowledge_ids,task_id,service
on public.business_recommendations for each row execute function public.business_graph_from_recommendation();

create or replace function public.business_graph_from_decision()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare kid uuid;
begin
  foreach kid in array coalesce(new.source_knowledge_ids,'{}'::uuid[]) loop
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('decision',new.id::text,'based_on','knowledge',kid::text) on conflict do nothing;
  end loop;
  if new.recommendation_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('decision',new.id::text,'approved_from','recommendation',new.recommendation_id::text) on conflict do nothing;
  end if;
  if new.task_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key)
    values('decision',new.id::text,'executed_by','task',new.task_id::text) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists business_graph_decision on public.business_decisions;
create trigger business_graph_decision after insert or update of source_knowledge_ids,recommendation_id,task_id
on public.business_decisions for each row execute function public.business_graph_from_decision();

create or replace function public.business_graph_from_measurement()
returns trigger language plpgsql security definer set search_path='public'
as $$
begin
  if new.knowledge_item_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key,metadata)
    values('measurement',new.id::text,'validates','knowledge',new.knowledge_item_id::text,jsonb_build_object('verdict',new.verdict,'metric',new.metric)) on conflict do nothing;
  end if;
  if new.recommendation_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key,metadata)
    values('measurement',new.id::text,'measures','recommendation',new.recommendation_id::text,jsonb_build_object('verdict',new.verdict,'metric',new.metric)) on conflict do nothing;
  end if;
  if new.decision_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key,metadata)
    values('measurement',new.id::text,'measures','decision',new.decision_id::text,jsonb_build_object('verdict',new.verdict,'metric',new.metric)) on conflict do nothing;
  end if;
  if new.task_id is not null then
    insert into public.business_entity_links(from_type,from_key,relation_type,to_type,to_key,metadata)
    values('measurement',new.id::text,'measures','task',new.task_id::text,jsonb_build_object('verdict',new.verdict,'metric',new.metric)) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists business_graph_measurement on public.business_measurements;
create trigger business_graph_measurement after insert on public.business_measurements
for each row execute function public.business_graph_from_measurement();

-- Revoke direct invocation of trigger helpers. They run only through their triggers.
revoke all on function public.business_default_knowledge_decay() from public,anon,authenticated;
revoke all on function public.business_graph_from_knowledge() from public,anon,authenticated;
revoke all on function public.business_graph_from_recommendation() from public,anon,authenticated;
revoke all on function public.business_graph_from_decision() from public,anon,authenticated;
revoke all on function public.business_graph_from_measurement() from public,anon,authenticated;
revoke all on function public.business_touch_updated_at() from public,anon,authenticated;
revoke all on function public.business_queue_completed_task() from public,anon,authenticated;

create or replace function public.business_graph_snapshot(p_limit integer default 80)
returns jsonb language sql stable security definer set search_path='public'
as $$
select case when public.business_manager() then jsonb_build_object(
  'counts',coalesce((select jsonb_object_agg(entity_type,cnt) from (
    select from_type entity_type,count(*) cnt from public.business_entity_links group by from_type
  ) q),'{}'::jsonb),
  'edges',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (
    select from_type,from_key,relation_type,to_type,to_key,metadata,created_at
    from public.business_entity_links order by created_at desc limit greatest(1,least(coalesce(p_limit,80),200))
  ) e),'[]'::jsonb)
) else '{}'::jsonb end;
$$;
revoke all on function public.business_graph_snapshot(integer) from public;
grant execute on function public.business_graph_snapshot(integer) to authenticated;

-- Cost / abuse control for future external AI activation.
create table if not exists public.business_ai_requests (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  mode text not null check (mode in ('owner_ask','extract_queue','extract_result')),
  created_at timestamptz not null default now()
);
create index if not exists business_ai_requests_admin_idx on public.business_ai_requests(admin_id,mode,created_at desc);
alter table public.business_ai_requests enable row level security;
grant select on public.business_ai_requests to authenticated;
grant all on public.business_ai_requests to service_role;
create policy "business managers read ai usage" on public.business_ai_requests for select to authenticated using (public.business_manager());

create or replace function public.business_ai_allow(p_mode text)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare actor uuid:=public.my_admin_id(); used integer; lim integer;
begin
  if actor is null or not public.business_manager() or not public.business_ai_enabled() then return false; end if;
  if p_mode not in ('owner_ask','extract_queue','extract_result') then return false; end if;
  lim:=case when p_mode='owner_ask' then 50 else 15 end;
  select count(*) into used from public.business_ai_requests where admin_id=actor and mode=p_mode and created_at>now()-interval '24 hours';
  if used>=lim then return false; end if;
  insert into public.business_ai_requests(admin_id,mode) values(actor,p_mode);
  return true;
end $$;
revoke all on function public.business_ai_allow(text) from public;
grant execute on function public.business_ai_allow(text) to authenticated;

comment on table public.business_entity_links is 'Cross-module knowledge graph references. Source data remains in its authoritative SSMPD table.';
comment on table public.business_ai_requests is 'Daily external AI usage log for owner copilot and task-report extraction.';
