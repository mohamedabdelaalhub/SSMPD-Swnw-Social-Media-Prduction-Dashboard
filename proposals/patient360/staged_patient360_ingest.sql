-- PHASE 2 DRAFT. NOT APPLIED TO SUPABASE.
-- Reconciled with Issue #332 Windows contract rev 2.
-- No existing contact/message rows are rewritten or automatically linked to a patient.
alter table public.patient360_contacts
  add column if not exists tenant_id text,
  add column if not exists channel_account_id text;
alter table public.patient360_messages
  add column if not exists tenant_id text,
  add column if not exists channel_account_id text,
  add column if not exists meta_message_id text,
  add column if not exists message_type text,
  add column if not exists structured_content jsonb,
  add column if not exists attempt_id text,
  add column if not exists accepted_at timestamptz,
  add column if not exists source_occurred_at timestamptz,
  add column if not exists received_at timestamptz;
-- The legacy UNIQUE(channel,external_key) and UNIQUE(source_key) remain untouched.
-- New contact external_key is an opaque hash of the scoped sender, never a bare phone.
create unique index if not exists p360_scoped_message_meta_unique
  on public.patient360_messages(tenant_id,channel_account_id,direction,meta_message_id)
  where meta_message_id is not null and tenant_id is not null and channel_account_id is not null;

create table if not exists public.patient360_ingest_receipts (
 event_key text primary key check(event_key ~ '^[0-9a-f]{64}$'),
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 tenant_id text not null, channel_account_id text not null,
 event_kind text not null,
 message_id uuid references public.patient360_messages(id) on delete set null,
 committed_at timestamptz not null default now()
);
create table if not exists public.patient360_ingest_evidence (
 event_key text primary key references public.patient360_ingest_receipts(event_key) on delete restrict,
 tenant_id text not null, channel_account_id text not null,
 event_kind text not null, meta_message_id text,
 attempt_id text, outcome text, provider_status text,
 error_codes jsonb not null default '[]'::jsonb,
 source_occurred_at timestamptz, received_at timestamptz not null default now(),
 message_id uuid references public.patient360_messages(id) on delete set null
);
create index if not exists p360_ingest_evidence_by_meta
 on public.patient360_ingest_evidence(tenant_id,channel_account_id,meta_message_id)
 where meta_message_id is not null;
create index if not exists p360_ingest_evidence_by_attempt
 on public.patient360_ingest_evidence(tenant_id,channel_account_id,attempt_id)
 where attempt_id is not null;
alter table public.patient360_ingest_receipts enable row level security;
alter table public.patient360_ingest_evidence enable row level security;
revoke all on public.patient360_ingest_receipts from public,anon,authenticated;
revoke all on public.patient360_ingest_evidence from public,anon,authenticated;
grant select,insert,update on public.patient360_ingest_receipts to service_role;
grant select,insert,update on public.patient360_ingest_evidence to service_role;

create or replace function public.patient360_ingest_event(
 p_event_key text, p_digest text, p_tenant text, p_account text,
 p_kind text, p_meta_id text, p_contact_hash text,
 p_source_key text, p_direction text, p_message_type text,
 p_structured_content jsonb, p_body text, p_attempt_id text,
 p_outcome text, p_status text, p_error_codes jsonb,
 p_occurred_at timestamptz
) returns jsonb
language plpgsql security invoker
set search_path=public,pg_temp
as $function$
declare
 v_old public.patient360_ingest_receipts%rowtype;
 v_contact uuid; v_message uuid; v_event_message uuid; v_existing public.patient360_messages%rowtype;
 v_source text; v_status text; v_rank integer;
begin
 if p_event_key !~ '^[0-9a-f]{64}$' or p_digest !~ '^[0-9a-f]{64}$' then
  raise exception 'INVALID_FINGERPRINT' using errcode='22023';
 end if;
 if p_tenant !~ '^[a-zA-Z0-9._-]{1,64}$' or p_account !~ '^[a-zA-Z0-9._-]{1,128}$' then
  raise exception 'INVALID_SCOPE' using errcode='22023';
 end if;
 if p_kind not in ('inbound','outbound_attempt','outbound_outcome','status') then
  raise exception 'INVALID_EVENT_KIND' using errcode='22023';
 end if;
 if p_kind='status' and (nullif(p_meta_id,'') is null or p_status not in ('sent','delivered','read','failed')) then
  raise exception 'INVALID_STATUS_EVENT' using errcode='22023';
 end if;
 if p_kind in ('outbound_attempt','outbound_outcome') and
    (p_attempt_id is null or p_attempt_id !~ '^[0-9a-f]{32}$') then
  raise exception 'INVALID_ATTEMPT' using errcode='22023';
 end if;
 if p_kind='outbound_outcome' and p_outcome not in ('accepted','unconfirmed','uncertain_or_rejected') then
  raise exception 'INVALID_OUTCOME' using errcode='22023';
 end if;
 if length(coalesce(p_body,''))>8000 then
  raise exception 'BODY_TOO_LONG' using errcode='22023';
 end if;
 -- These locks only serialize identical events and identical Meta message identities.
 perform pg_advisory_xact_lock(hashtextextended(p_event_key,271));
 select * into v_old from public.patient360_ingest_receipts where event_key=p_event_key;
 if found then
  if v_old.digest<>p_digest or v_old.tenant_id<>p_tenant or
     v_old.channel_account_id<>p_account or v_old.event_kind<>p_kind then
    raise exception 'EVENT_KEY_COLLISION' using errcode='23505';
  end if;
  return jsonb_build_object('event_key',p_event_key,'digest',p_digest,'committed',true);
 end if;
 if p_kind in ('inbound','outbound_outcome') and
    (p_kind='inbound' or p_outcome='accepted') then
  if nullif(p_meta_id,'') is null or nullif(p_source_key,'') is null or
    p_direction not in ('inbound','outbound') or p_contact_hash !~ '^[0-9a-f]{64}$' or
    p_source_key !~ '^p360:v1:[0-9a-f]{64}$' or
    p_structured_content is null then
    raise exception 'INVALID_MESSAGE_EVENT' using errcode='22023';
  end if;
  if (p_kind='inbound' and p_direction<>'inbound') or
     (p_kind='outbound_outcome' and p_direction<>'outbound') then
    raise exception 'INVALID_DIRECTION' using errcode='22023';
  end if;
  -- Prefix differs from legacy raw phone keys, so old contact rows are not merged.
  insert into public.patient360_contacts(channel,external_key,display_name,tenant_id,channel_account_id)
    values('whatsapp','p360:v1:'||p_contact_hash,'عميل',p_tenant,p_account)
    on conflict (channel,external_key) do update
       set updated_at=now()
       where public.patient360_contacts.tenant_id=excluded.tenant_id
         and public.patient360_contacts.channel_account_id=excluded.channel_account_id
    returning id into v_contact;
  if v_contact is null then
    raise exception 'CONTACT_SCOPE_COLLISION' using errcode='23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_source_key,272));
  select * into v_existing from public.patient360_messages
   where tenant_id=p_tenant and channel_account_id=p_account
     and direction=p_direction and meta_message_id=p_meta_id
   for update;
  if found then
   if v_existing.contact_id<>v_contact or v_existing.body<>coalesce(p_body,'') or
      v_existing.structured_content is distinct from p_structured_content or
      v_existing.source_key<>p_source_key then
     raise exception 'META_MESSAGE_ID_COLLISION' using errcode='23505';
   end if;
   v_message:=v_existing.id;
  else
   insert into public.patient360_messages
     (contact_id,source_key,direction,body,message_status,source,sent_at,
      tenant_id,channel_account_id,meta_message_id,message_type,structured_content,
      attempt_id,accepted_at,source_occurred_at,received_at)
   values
     (v_contact,p_source_key,p_direction,coalesce(p_body,''),
      case when p_direction='inbound' then 'received' else 'accepted' end,
      'agent',coalesce(p_occurred_at,now()),p_tenant,p_account,p_meta_id,
      p_message_type,p_structured_content,p_attempt_id,
      case when p_direction='outbound' then now() else null end,p_occurred_at,now())
   returning id into v_message;
  end if;
  update public.patient360_contacts
   set last_inbound_at=case when p_direction='inbound'
        then greatest(coalesce(last_inbound_at,'-infinity'::timestamptz),coalesce(p_occurred_at,now()))
        else last_inbound_at end,
       last_outbound_at=case when p_direction='outbound'
        then greatest(coalesce(last_outbound_at,'-infinity'::timestamptz),coalesce(p_occurred_at,now()))
        else last_outbound_at end,
       last_message_at=greatest(coalesce(last_message_at,'-infinity'::timestamptz),coalesce(p_occurred_at,now())),
       updated_at=now()
   where id=v_contact;
 end if;
 v_event_message:=v_message;
 -- Insert receipt and evidence in the SAME database transaction.
 insert into public.patient360_ingest_receipts
  (event_key,digest,tenant_id,channel_account_id,event_kind,message_id)
 values(p_event_key,p_digest,p_tenant,p_account,p_kind,v_message);
 insert into public.patient360_ingest_evidence
  (event_key,tenant_id,channel_account_id,event_kind,meta_message_id,attempt_id,
   outcome,provider_status,error_codes,source_occurred_at,message_id)
 values(p_event_key,p_tenant,p_account,p_kind,p_meta_id,p_attempt_id,
   p_outcome,p_status,coalesce(p_error_codes,'[]'::jsonb),p_occurred_at,v_message);
 -- Status evidence can arrive BEFORE its Meta message; project all committed evidence.
 if p_meta_id is not null then
   select m.id into v_message from public.patient360_messages m
   where m.tenant_id=p_tenant and m.channel_account_id=p_account
     and m.meta_message_id=p_meta_id and m.direction='outbound'
   limit 1;
   if v_message is not null then
    select max(case e.provider_status when 'read' then 3 when 'delivered' then 2
      when 'sent' then 1 else 0 end) into v_rank
    from public.patient360_ingest_evidence e
    where e.tenant_id=p_tenant and e.channel_account_id=p_account
      and e.meta_message_id=p_meta_id and e.event_kind='status';
    if coalesce(v_rank,0)>0 then
     v_status:=case v_rank when 3 then 'read' when 2 then 'delivered' else 'sent' end;
     update public.patient360_messages set message_status=v_status
       where id=v_message and
         (case message_status when 'read' then 3 when 'delivered' then 2
         when 'sent' then 1 else 0 end)<v_rank;
    elsif exists(select 1 from public.patient360_ingest_evidence e
        where e.tenant_id=p_tenant and e.channel_account_id=p_account
          and e.meta_message_id=p_meta_id and e.event_kind='status'
          and e.provider_status='failed') then
       update public.patient360_messages set message_status='failed'
       where id=v_message and message_status in ('accepted','recorded');
    end if;
    update public.patient360_ingest_evidence set message_id=v_message
     where tenant_id=p_tenant and channel_account_id=p_account
      and meta_message_id=p_meta_id and message_id is null;
   end if;
 end if;
 insert into public.patient360_audit(contact_id,entity_type,entity_id,operation,detail)
 values(v_contact,'patient360_ingest',coalesce(v_event_message,v_message),p_kind,
 jsonb_build_object('event_key',p_event_key,'source','windows_spool','tenant',p_tenant,
 'account',p_account,'has_provider_receipt',p_kind='status'));
 return jsonb_build_object('event_key',p_event_key,'digest',p_digest,'committed',true);
end
$function$;
revoke all on function public.patient360_ingest_event(
 text,text,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,jsonb,timestamptz
) from public,anon,authenticated;
grant execute on function public.patient360_ingest_event(
 text,text,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,jsonb,timestamptz
) to service_role;
comment on function public.patient360_ingest_event(
 text,text,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,jsonb,timestamptz
) is 'Phase2 storage-only, service-role-only atomic event receiver. No messaging/booking/clinical writes.';
