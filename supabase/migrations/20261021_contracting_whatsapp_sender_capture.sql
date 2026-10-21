-- Reuse the WhatsApp sender already seen by the live webhook for contracting document delivery.
alter table public.contracting_partnership_settings
  add column if not exists whatsapp_phone_number_id text;
