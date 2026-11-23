-- Rollback for 20261122230000_tips_coach_progress.sql
begin;
drop function if exists public.tip_progress_team();
drop function if exists public.tip_progress_mark(text, text);
drop function if exists public.tip_progress_mine();
drop table if exists public.tip_progress;
commit;
