-- Patient Portal: store patient height in the shared medical profile.
-- Live database change was applied manually in Supabase SQL Editor on 2026-09-10.
alter table public.patient_medical_profile
  add column if not exists height text;
