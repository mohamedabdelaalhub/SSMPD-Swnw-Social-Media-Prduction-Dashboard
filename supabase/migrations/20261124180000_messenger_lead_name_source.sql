-- Lead name taken from the customer's Facebook/Instagram profile (owner 2026-11-24): marked as unconfirmed so reception checks it on the call.
alter table public.messenger_flow_state add column if not exists name_source text;
alter table public.leads add column if not exists customer_name_source text;
alter table public.leads drop constraint if exists leads_customer_name_source_check;
alter table public.leads add constraint leads_customer_name_source_check check (customer_name_source is null or customer_name_source = 'facebook');
