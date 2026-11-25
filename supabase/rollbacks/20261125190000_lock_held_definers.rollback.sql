-- Rollback for 20261125190000_lock_held_definers.sql — restores anon + authenticated EXECUTE (unsafe; only if a real caller broke).
do $$ declare f text; begin
  foreach f in array array[
    'public.claim_server_meta_publish_jobs(integer)',
    'public.storage_offload_mark_deleted(text,text[])',
    'public.storage_offload_candidates(integer)',
    'public.storage_offload_ready_for_delete(integer)',
    'public.claim_next_video_job(text)',
    'public.claim_next_video_job(text,integer)',
    'public.claude_cap_use(text,jsonb)',
    'public.claude_propose_ad_plan(text,text,text,numeric,numeric,date,date,text,text,text,uuid)',
    'public.staff_summary_save(uuid,date,text,text,text,text)',
    'public.staff_kpis_admin(timestamp with time zone,timestamp with time zone)',
    'public.staff_kpi_month_data(date)',
    'public.staff_summary_fallback(date)'] loop
    if to_regprocedure(f) is not null then execute format('grant execute on function %s to anon, authenticated', f); end if;
  end loop;
end $$;
