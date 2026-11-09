-- Rollback of 20261109160000_hr_offboarding.sql.
-- WARNING: drops cases, sheet lines and template versions. Export first if anything was recorded:
--   select * from clinic_people.offboarding_cases;  select * from clinic_people.offboarding_lines;  select * from clinic_people.offboarding_templates;
-- NOT undone by design (they were real events): contracts already ended, people already set to «ended», accounts already locked, insurance already stopped.
-- To reopen an account: update public.admins set active = true where id = '<admin id>'. clinic_people.audit rows (action like 'offboarding_%') are kept.
begin;
drop trigger if exists offboarding_guard_business_request on clinic_finance.business_requests;
drop trigger if exists offboarding_guard_doctor_payout on clinic_finance.doctor_payouts;
drop function if exists public.hr_offboarding_workspace();
drop function if exists public.hr_offboarding_command(text, jsonb);
drop function if exists public.hr_offboarding_template(text, jsonb);
drop function if exists public.hr_offboarding_lock_due();
drop function if exists clinic_finance.offboarding_guard_payout();
drop function if exists clinic_people.in_settlement(uuid);
drop function if exists clinic_people.offboarding_net(uuid);
drop function if exists clinic_people.offboarding_view();
drop table if exists clinic_people.offboarding_lines;
drop table if exists clinic_people.offboarding_cases;
drop table if exists clinic_people.offboarding_templates;
commit;
