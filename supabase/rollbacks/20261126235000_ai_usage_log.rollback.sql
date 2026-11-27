-- Rollback for 20261126235000_ai_usage_log.sql (drops the usage log; nothing else depends on it).
begin;
drop view if exists public.ai_usage_monthly;
drop table if exists public.ai_usage_log;
commit;
