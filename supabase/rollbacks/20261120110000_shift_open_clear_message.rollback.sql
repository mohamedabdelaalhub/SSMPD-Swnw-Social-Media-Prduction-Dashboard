begin;
drop trigger if exists shift_single_active_message on clinic_finance.shifts;
drop function if exists clinic_finance.shift_single_active_message();
commit;
