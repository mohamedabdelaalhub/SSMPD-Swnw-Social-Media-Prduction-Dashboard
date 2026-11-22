-- Rollback of 20261122250000_review_inbox.sql (read-only RPC; nothing else to undo).
begin;
drop function if exists public.clinic_review_inbox();
notify pgrst, 'reload schema';
commit;
