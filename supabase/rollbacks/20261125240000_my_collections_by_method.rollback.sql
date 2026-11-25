-- Rollback of 20261125240000_my_collections_by_method.sql (read-only function).
begin;
drop function public.clinic_finance_my_collections();
commit;
