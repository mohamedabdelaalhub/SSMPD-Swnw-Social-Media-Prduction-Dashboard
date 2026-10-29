-- أي بوست يفضل "بيتنشر" أكتر من 10 دقايق (الوظيفة اتقطعت) يرجع للطابور مرة،
-- ولو علق تاني يتحول failed برسالة واضحة (بيظهر في التنبيهات).
create or replace function public.reap_stuck_meta_publish_jobs()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r integer;
begin
  update public.meta_publish_jobs
     set status = 'failed', error_code = 'STUCK_TIMEOUT',
         error_message = 'النشر وقف في النص مرتين (انقطاع قبل ما يخلص). راجع الصفحة وتأكد مفيش نسخة اتنشرت قبل ما تعيد الجدولة.'
   where status = 'processing'
     and last_attempt_at < now() - interval '10 minutes'
     and coalesce(attempt_count, 0) >= 2;
  get diagnostics r = row_count; n := n + r;
  update public.meta_publish_jobs
     set status = 'pending', scheduled_at = now(),
         error_code = null, error_message = null
   where status = 'processing'
     and last_attempt_at < now() - interval '10 minutes'
     and coalesce(attempt_count, 0) < 2;
  get diagnostics r = row_count; n := n + r;
  return n;
end $$;
revoke all on function public.reap_stuck_meta_publish_jobs() from public, anon, authenticated;
grant execute on function public.reap_stuck_meta_publish_jobs() to service_role;
select cron.schedule('meta-publish-reaper', '*/5 * * * *', $c$select public.reap_stuck_meta_publish_jobs();$c$);
