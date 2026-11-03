
-- Patient 360: additive, owner-reviewed contact memory. No changes to existing WhatsApp handlers.
create table if not exists public.patient360_contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','website','instagram','facebook','portal','other')),
  external_key text not null check (length(external_key) between 4 and 128),
  display_name text not null default 'عميل',
  lead_id uuid references public.leads(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  patient_link_verified_at timestamptz,
  contact_consent text not null default 'unknown' check(contact_consent in ('unknown','opt_in','opt_out')),
  do_not_contact boolean not null default false,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_key),
  check (patient_id is null or patient_link_verified_at is not null)
);
create index if not exists patient360_contacts_recent on public.patient360_contacts(last_message_at desc nulls last);

create table if not exists public.patient360_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.patient360_contacts(id) on delete cascade,
  source_key text not null unique check(length(source_key) between 5 and 255),
  direction text not null check(direction in ('inbound','outbound')),
  body text not null check(length(body) <= 8000),
  message_status text not null default 'recorded',
  source text not null check(source in ('legacy_social','agent','manual_import')),
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists patient360_messages_by_contact on public.patient360_messages(contact_id,sent_at desc);

create table if not exists public.patient360_insights (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.patient360_contacts(id) on delete cascade,
  insight_type text not null check(insight_type in ('interest','unanswered_question','possible_blocker','preference','confirmed_fact','service_feedback')),
  statement text not null check(length(btrim(statement)) between 3 and 1200),
  evidence_message_id uuid references public.patient360_messages(id) on delete set null,
  confidence numeric check(confidence between 0 and 1),
  status text not null default 'hypothesis' check(status in ('hypothesis','confirmed','rejected','outdated')),
  created_by uuid references public.admins(id) on delete set null,
  approved_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patient360_insights_contact on public.patient360_insights(contact_id,created_at desc);

create table if not exists public.patient360_followups (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.patient360_contacts(id) on delete cascade,
  related_message_id uuid references public.patient360_messages(id) on delete set null,
  reason text not null check(length(btrim(reason)) between 4 and 1500),
  draft_body text not null check(length(btrim(draft_body)) between 4 and 4000),
  due_at timestamptz,
  status text not null default 'draft' check(status in ('draft','approved','cancelled','completed')),
  consent_basis text,
  approved_by uuid references public.admins(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null and consent_basis is not null))
);
create index if not exists patient360_followups_contact on public.patient360_followups(contact_id,created_at desc);

create table if not exists public.patient360_cases (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.patient360_contacts(id) on delete cascade,
  related_message_id uuid references public.patient360_messages(id) on delete set null,
  patient_visit_id uuid references public.patient_visits(id) on delete set null,
  category text not null default 'service' check(category in ('wait_time','communication','service','billing','clinical','other')),
  severity text not null default 'normal' check(severity in ('normal','urgent','critical')),
  status text not null default 'new' check(status in ('new','investigating','action_required','resolved','closed')),
  description text not null check(length(btrim(description)) between 4 and 4000),
  clinical_review_required boolean not null default false,
  assigned_to uuid references public.admins(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(category <> 'clinical' or clinical_review_required = true)
);
create index if not exists patient360_cases_contact on public.patient360_cases(contact_id,created_at desc);
create index if not exists patient360_cases_open on public.patient360_cases(status,severity,created_at desc);

create table if not exists public.patient360_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  contact_id uuid,
  entity_type text not null,
  entity_id uuid,
  operation text not null,
  actor_auth_uid uuid,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists patient360_audit_contact on public.patient360_audit(contact_id,at desc);

-- Database-enforced access: business managers only, no unauthenticated access.
revoke all on public.patient360_contacts,public.patient360_messages,public.patient360_insights,public.patient360_followups,public.patient360_cases,public.patient360_audit from public,anon,authenticated;
grant select,insert,update on public.patient360_contacts,public.patient360_insights,public.patient360_followups,public.patient360_cases to authenticated;
grant select on public.patient360_messages,public.patient360_audit to authenticated;
alter table public.patient360_contacts enable row level security;
alter table public.patient360_messages enable row level security;
alter table public.patient360_insights enable row level security;
alter table public.patient360_followups enable row level security;
alter table public.patient360_cases enable row level security;
alter table public.patient360_audit enable row level security;

create policy "p360_manager_select" on public.patient360_contacts for select to authenticated using ((select public.business_manager()));
create policy "p360_manager_insert" on public.patient360_contacts for insert to authenticated with check ((select public.business_manager()));
create policy "p360_manager_update" on public.patient360_contacts for update to authenticated using ((select public.business_manager())) with check ((select public.business_manager()));
create policy "p360_messages_manager_read" on public.patient360_messages for select to authenticated using ((select public.business_manager()));
create policy "p360_insights_read" on public.patient360_insights for select to authenticated using ((select public.business_manager()));
create policy "p360_insights_insert" on public.patient360_insights for insert to authenticated with check ((select public.business_manager()));
create policy "p360_insights_update" on public.patient360_insights for update to authenticated using ((select public.business_manager())) with check ((select public.business_manager()));
create policy "p360_followups_read" on public.patient360_followups for select to authenticated using ((select public.business_manager()));
create policy "p360_followups_insert" on public.patient360_followups for insert to authenticated with check ((select public.business_manager()));
create policy "p360_followups_update" on public.patient360_followups for update to authenticated using ((select public.business_manager())) with check ((select public.business_manager()));
create policy "p360_cases_read" on public.patient360_cases for select to authenticated using ((select public.business_manager()));
create policy "p360_cases_insert" on public.patient360_cases for insert to authenticated with check ((select public.business_manager()));
create policy "p360_cases_update" on public.patient360_cases for update to authenticated using ((select public.business_manager())) with check ((select public.business_manager()));
create policy "p360_audit_read" on public.patient360_audit for select to authenticated using ((select public.business_manager()));

-- Record changes without storing message bodies in the audit log.
create or replace function public.patient360_log_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid;
begin
  if tg_table_name = 'patient360_contacts' then cid := new.id;
  else cid := new.contact_id; end if;
  insert into public.patient360_audit(contact_id,entity_type,entity_id,operation,actor_auth_uid,detail)
  values(cid,tg_table_name,new.id,tg_op,auth.uid(),jsonb_build_object('status',to_jsonb(new)->>'status'));
  return new;
end $$;
revoke all on function public.patient360_log_change() from public,anon,authenticated;
create trigger patient360_contact_audit after insert or update on public.patient360_contacts for each row execute function public.patient360_log_change();
create trigger patient360_insight_audit after insert or update on public.patient360_insights for each row execute function public.patient360_log_change();
create trigger patient360_followup_audit after insert or update on public.patient360_followups for each row execute function public.patient360_log_change();
create trigger patient360_case_audit after insert or update on public.patient360_cases for each row execute function public.patient360_log_change();

-- Read-only mirror of existing Supabase WhatsApp archive. It never touches the Webhook.
create or replace function public.patient360_sync_legacy_whatsapp() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare imported integer;
begin
  insert into public.patient360_contacts(channel,external_key,display_name)
  select distinct on (s.key) 'whatsapp',s.key,s.sender_name
  from (
    select left(coalesce(nullif(btrim(sender_id),''),nullif(regexp_replace(conversation_id,'^whatsapp:',''),'')),128) as key,
           coalesce(nullif(btrim(sender_name),''),'عميل') as sender_name,
           sent_at
    from public.social_messages
    where platform='whatsapp'
  ) s
  where s.key is not null and length(s.key) >= 4
  order by s.key,s.sent_at desc nulls last
  on conflict(channel,external_key) do nothing;

  insert into public.patient360_messages(contact_id,source_key,direction,body,message_status,source,sent_at)
  select c.id,left('social:'||s.id||':in',255),'inbound',left(coalesce(s.message,''),8000),
         coalesce(s.status,'recorded'),'legacy_social',coalesce(s.sent_at,now())
  from public.social_messages s
  join public.patient360_contacts c on c.channel='whatsapp'
    and c.external_key=left(coalesce(nullif(btrim(s.sender_id),''),nullif(regexp_replace(s.conversation_id,'^whatsapp:',''),'')),128)
  where s.platform='whatsapp'
  on conflict(source_key) do nothing;
  get diagnostics imported = row_count;

  insert into public.patient360_messages(contact_id,source_key,direction,body,message_status,source,sent_at)
  select c.id,left('social:'||s.id||':out',255),'outbound',left(s.reply_text,8000),
         coalesce(s.status,'recorded'),'legacy_social',coalesce(s.replied_at,s.sent_at,now())
  from public.social_messages s
  join public.patient360_contacts c on c.channel='whatsapp'
    and c.external_key=left(coalesce(nullif(btrim(s.sender_id),''),nullif(regexp_replace(s.conversation_id,'^whatsapp:',''),'')),128)
  where s.platform='whatsapp' and nullif(btrim(s.reply_text),'') is not null
  on conflict(source_key) do nothing;

  update public.patient360_contacts c set
    last_message_at=m.last_at,last_inbound_at=m.inbound_at,last_outbound_at=m.outbound_at,updated_at=now()
  from (
    select contact_id,max(sent_at) as last_at,max(sent_at) filter (where direction='inbound') as inbound_at,
           max(sent_at) filter (where direction='outbound') as outbound_at
    from public.patient360_messages where source='legacy_social'
    group by contact_id
  ) m where c.id=m.contact_id and (c.last_message_at is null or m.last_at>c.last_message_at);
  return imported;
end $$;
revoke all on function public.patient360_sync_legacy_whatsapp() from public,anon,authenticated;

-- No outbound sending. A scheduled mirror cannot block or delay incoming WhatsApp.
select public.patient360_sync_legacy_whatsapp();
select cron.schedule('patient360-legacy-mirror-10m','*/10 * * * *',$job$select public.patient360_sync_legacy_whatsapp()$job$);
