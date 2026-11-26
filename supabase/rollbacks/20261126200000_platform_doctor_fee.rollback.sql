-- Rollback of 20261126200000_platform_doctor_fee.sql: restores clinic_reception.service_operation (fee on the full net again) and
-- clinic_reception.referral_try (referrals on platform visits again), and drops
-- platform_cut. The one-time corrections are NOT undone (the journal is never deleted, and the corrected fees are the owner's rule);
-- clinic_finance.platform_fee_fixes is kept (renamed) as their record. Reverse a correction only with a reviewed manual entry.
begin;
do $$ begin execute (select def from clinic_finance.platform_fee_saved_defs where name = 'service_operation'); end $$;
do $$ begin if exists (select 1 from clinic_finance.platform_fee_saved_defs where name = 'referral_try') then
  execute (select def from clinic_finance.platform_fee_saved_defs where name = 'referral_try'); end if; end $$;
drop function clinic_reception.platform_cut(uuid, numeric);
alter table clinic_finance.platform_fee_fixes rename to platform_fee_fixes_rolled_back;
drop table clinic_finance.platform_fee_saved_defs;
commit;
