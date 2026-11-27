-- Rollback of 20261127030000. The clinic-knowledge function falls back to its one-line entity output when the RPC is
-- missing, so this is safe before or after rolling the function back. Safe to run twice.
begin;
drop function if exists public.clinic_knowledge_feed();
commit;
