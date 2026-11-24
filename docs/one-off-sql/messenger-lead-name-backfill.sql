-- DRY RUN FIRST. Not a migration (kept out of supabase/migrations on purpose); run by hand only after owner approval.
-- Leads created by the Messenger flow with the placeholder name, where the customer's Facebook/Instagram profile name is known.
select l.id, l.customer_name, m.sender_name as profile_name
from public.messenger_flow_state s
join public.leads l on l.id = s.lead_id
join lateral (
  select sender_name from public.social_messages
  where conversation_id = s.conversation_id and not is_page and sender_name is not null
  order by fetched_at desc limit 1
) m on true
where l.customer_name = 'عميل ماسنجر';

-- APPLY (only after the dry run looks right and the owner approves). Only 2–4 letter-only words are taken, same rule as the bot.
-- update public.leads l set customer_name = m.sender_name, customer_name_source = 'facebook', updated_at = now()
-- from public.messenger_flow_state s
-- join lateral (select sender_name from public.social_messages where conversation_id = s.conversation_id and not is_page and sender_name is not null order by fetched_at desc limit 1) m on true
-- where s.lead_id = l.id and l.customer_name = 'عميل ماسنجر'
--   and m.sender_name ~ '^[ء-يA-Za-z]{2,}( [ء-يA-Za-z]{2,}){1,3}$';
