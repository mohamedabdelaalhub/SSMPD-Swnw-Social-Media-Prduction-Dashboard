-- Live check for the Messenger flow v2, run as the function would (service role). EVERYTHING is rolled back:
-- one simulated conversation → state row → lead through ingest_lead at phone capture → completion update → reminder column → ROLLBACK.
-- Uses a temporary phone and conversation id; no message is sent, no notification survives.
begin;
  -- the migration under test
  alter table public.messenger_flow_state add column if not exists reminded_at timestamptz;

  -- 1) first message: state row without a phone
  insert into public.messenger_flow_state(conversation_id, platform, brand, sender_id, stage, service, expect, unclear)
  values ('t_flow_v2_check', 'facebook', 'sono', 'psid_test', 'collecting', 'physiotherapy', 'phone', 0);

  -- 2) phone captured → lead at once (placeholder name), exactly as messages.ts calls it
  select (select count(*) from public.ingest_lead('facebook:flow:t_flow_v2_check', 'messenger', 'عميل ماسنجر', '01000000099',
         'حجز علاج طبيعي', now(), null, null, null)) as lead_calls;
  select l.id as lead_id, l.customer_name, l.source, l.current_status, l.phone_normalized
    from public.leads l where l.phone_normalized = public.normalize_phone_eg('01000000099');

  -- 3) idempotent: the same event does not create a second lead
  select count(*) as leads_after_second_call from public.ingest_lead('facebook:flow:t_flow_v2_check', 'messenger', 'عميل ماسنجر', '01000000099', 'x', now(), null, null, null);
  select count(*) as leads_for_phone from public.leads where phone_normalized = public.normalize_phone_eg('01000000099');

  -- 4) name + time arrive: only the placeholder name and this flow's own lead are completed
  update public.leads set customer_name = 'منى (اختبار)', updated_at = now()
   where phone_normalized = public.normalize_phone_eg('01000000099') and customer_name = 'عميل ماسنجر';
  update public.leads set message_text = 'حجز علاج طبيعي — الوقت المفضل: بكرة', updated_at = now()
   where phone_normalized = public.normalize_phone_eg('01000000099') and source = 'messenger';
  select customer_name, message_text from public.leads where phone_normalized = public.normalize_phone_eg('01000000099');

  -- 5) the reminder query the function runs (a conversation with no phone and no reminder yet)
  update public.messenger_flow_state set phone = null, updated_at = now() - interval '3 hours' where conversation_id = 't_flow_v2_check';
  select conversation_id from public.messenger_flow_state
   where brand = 'sono' and stage = 'collecting' and phone is null and reminded_at is null
     and updated_at between now() - interval '20 hours' and now() - interval '2 hours' and conversation_id = 't_flow_v2_check';
  update public.messenger_flow_state set reminded_at = now() where conversation_id = 't_flow_v2_check';
  select count(*) as still_selected_after_reminder from public.messenger_flow_state
   where phone is null and reminded_at is null and conversation_id = 't_flow_v2_check';
rollback;
select count(*) as leftover_state_rows from public.messenger_flow_state where conversation_id = 't_flow_v2_check';
