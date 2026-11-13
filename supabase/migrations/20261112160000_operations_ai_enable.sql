-- Owner approval 2026-11-12: «موافق نبعت بيانات المؤشرات لـ OpenAI».
-- Turns on the indicators advisor (operations-advisor): managers only, daily limit (operations_advice_limit),
-- sends the selected issue's KPIs, plan and outcomes to OpenAI and saves the advice as a draft. No patient data.
create or replace function public.operations_ai_enabled() returns boolean
language sql stable set search_path='' as $$select true$$;
revoke all on function public.operations_ai_enabled() from public, anon;
grant execute on function public.operations_ai_enabled() to authenticated;
