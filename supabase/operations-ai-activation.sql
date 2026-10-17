-- Keep external AI transfer disabled until the owner approves that data flow.
create or replace function public.operations_ai_enabled() returns boolean
language sql stable set search_path='' as $$select false$$;
revoke all on function public.operations_ai_enabled() from public,anon;
grant execute on function public.operations_ai_enabled() to authenticated;
