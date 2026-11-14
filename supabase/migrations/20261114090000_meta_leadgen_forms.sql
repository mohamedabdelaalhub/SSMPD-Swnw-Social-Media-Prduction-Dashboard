-- فورم فيسبوك (Lead Ads) ← الليدز في الداشبورد تلقائياً
-- الدالة meta-leadgen-sync (كل 5 دقايق) بتقرا ليدز فورمات صفحتي سونو ودينا من Meta وتسجلها عبر ingest_lead
-- (مصدر جديد facebook_form). القراءة بس من Meta — ما بتعدّلش أي فورم أو إعلان.

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source = any (array['whatsapp','messenger','instagram','facebook_form','phone','clinic','doctor_referral']));

create or replace function public.ingest_lead(
  p_event_id text, p_source text, p_name text, p_phone text, p_message text,
  p_received_at timestamptz default now(),
  p_ad_id text default null, p_adset_id text default null, p_campaign_id text default null
) returns table(lead_id uuid, was_new boolean)
 language plpgsql security definer set search_path to 'public' as $$
declare ph text; existing uuid; new_id uuid; ev record;
begin
  if p_source not in ('whatsapp','messenger','instagram','facebook_form') then raise exception 'bad source'; end if;
  if coalesce(p_event_id,'') = '' then raise exception 'event_id required'; end if;
  select * into ev from public.lead_ingest_events where event_id = p_event_id;
  if found then return query select ev.lead_id, false; return; end if;

  ph := public.normalize_phone_eg(p_phone);
  -- نفس الشخص، ليد لسه شغال (مش مقفول) آخر 30 يوم => ما نعملش ليد جديد، بس نكمّل معرّف الإعلان لو ناقص
  if ph is not null then
    select l.id into existing from public.leads l
     where l.phone_normalized = ph
       and l.current_status not in ('service_done','rejected','no_response','invalid_number')
       and l.received_at > now() - interval '30 days'
     order by l.received_at desc limit 1;
  end if;

  if existing is not null then
    update public.leads set
      meta_ad_id = coalesce(meta_ad_id, p_ad_id), meta_adset_id = coalesce(meta_adset_id, p_adset_id),
      meta_campaign_id = coalesce(meta_campaign_id, p_campaign_id),
      acquisition_type = coalesce(acquisition_type, case when p_ad_id is not null then 'ad' end)
     where id = existing;
    insert into public.lead_ingest_events(event_id, lead_id, source, was_new) values (p_event_id, existing, p_source, false);
    return query select existing, false; return;
  end if;

  insert into public.leads(customer_name, phone_raw, phone_normalized, source, message_text, received_at,
                           current_status, acquisition_type, meta_ad_id, meta_adset_id, meta_campaign_id)
  values (coalesce(nullif(trim(p_name),''), 'عميل جديد'), p_phone, ph, p_source, left(p_message, 1000),
          coalesce(p_received_at, now()), 'new',
          case when p_ad_id is not null then 'ad' end, p_ad_id, p_adset_id, p_campaign_id)
  returning id into new_id;
  insert into public.lead_ingest_events(event_id, lead_id, source, was_new) values (p_event_id, new_id, p_source, true);
  return query select new_id, true;
end $$;
revoke all on function public.ingest_lead(text,text,text,text,text,timestamptz,text,text,text) from public, anon, authenticated;
grant execute on function public.ingest_lead(text,text,text,text,text,timestamptz,text,text,text) to service_role;

-- آخر ليد اتقرا من كل فورم (عشان نكمل من عنده)، وحالة آخر تشغيل
create table if not exists public.meta_leadgen_sync_state (
  form_id         text primary key,
  page_id         text not null,
  brand           text check (brand is null or brand in ('sono','dr_dina')),
  form_name       text,
  last_lead_time  timestamptz,
  last_run_at     timestamptz,
  last_error      text
);
alter table public.meta_leadgen_sync_state enable row level security;
drop policy if exists meta_leadgen_sync_state_read on public.meta_leadgen_sync_state;
create policy meta_leadgen_sync_state_read on public.meta_leadgen_sync_state for select to authenticated using (public.can_manage_all_content());
