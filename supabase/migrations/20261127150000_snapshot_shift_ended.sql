-- Owner 2026-11-27 (reception: collect refused «انتهت الوردية وهي بانتظار التسليم: لا تسجل تحصيلاً جديداً»):
-- after a handover the finance shift keeps status 'open' with ended_at set until the main treasury confirms the receipt, but the
-- reception snapshot's «shifts» rows had no ended_at — so the collect window offered (and picked) the handed-over shift.
-- READ-ONLY addition: public.clinic_reception_snapshot now adds `ended_at` (from clinic_finance.shifts) to every «shifts» row.
-- Outer wrapper only; the previous body is kept as clinic_reception.snapshot_before_shift_ended (same grants). Nothing else changes.
-- Rollback: supabase/rollbacks/20261127150000_snapshot_shift_ended.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null then raise exception 'clinic_reception_snapshot غير موجودة'; end if;
  if to_regprocedure('clinic_reception.snapshot_before_shift_ended(uuid,date,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_shift_ended;
alter function public.snapshot_before_shift_ended(uuid, date, date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_shift_ended(uuid, date, date) from public, anon, authenticated;

create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  result := clinic_reception.snapshot_before_shift_ended(p_workspace, p_from, p_to);   -- access check first
  if jsonb_typeof(result->'shifts') = 'array' then
    result := jsonb_set(result, '{shifts}', coalesce((
      select jsonb_agg(e.s || jsonb_build_object('ended_at', f.ended_at) order by e.n)
        from jsonb_array_elements(result->'shifts') with ordinality e(s, n)
        left join clinic_finance.shifts f on f.id = coalesce(nullif(e.s->>'finance_shift_id', ''), e.s->>'id')::uuid), '[]'::jsonb));
  end if;
  return result;
end $$;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated, service_role;

commit;
