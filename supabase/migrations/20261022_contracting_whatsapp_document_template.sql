alter table public.contracting_partnership_settings
  add column if not exists whatsapp_waba_id text,
  add column if not exists whatsapp_template_id text,
  add column if not exists whatsapp_template_name text,
  add column if not exists whatsapp_template_language text default 'ar';

update public.contracting_partnership_settings
set whatsapp_waba_id = '1064311139425175',
    whatsapp_template_id = '1099965362926464',
    whatsapp_template_name = 'swnw_partnership_document_ar_v1',
    whatsapp_template_language = coalesce(nullif(whatsapp_template_language, ''), 'ar'),
    updated_at = now();
