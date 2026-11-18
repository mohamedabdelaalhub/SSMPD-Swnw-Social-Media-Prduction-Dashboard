-- Fallback last slot of a Masa day (WhatsApp-agent chat's 7-day re-run, 2026-11-18): Masa counts slots as
-- floor((end − start) / interval), so the FULL interval must fit before the day end. The fallback only needed
-- interval − gap, so it offered one extra slot (1131, 35-min step: 22:30 when Masa's last is 21:55).
-- In-place patch of clinic_reception.fallback_api (the 20261118190000 wrapper): two exact anchors, each must occur once.
begin;
do $$
declare src text; a1 text := 'while t + visit <= dend and cnt < 300 loop';
  b1 text := 'while t + make_interval(mins => row_.interval_min) <= dend and cnt < 300 loop';
  a2 text := 'if (extract(epoch from t - (row_.day + row_.starts) at time zone ''Africa/Cairo'')::bigint / 60) % row_.interval_min <> 0 then';
  b2 text := 'if t + make_interval(mins => row_.interval_min) > (row_.day + case when row_.ends = time ''00:00'' then interval ''24 hours'' else row_.ends - time ''00:00'' end) at time zone ''Africa/Cairo'' or (extract(epoch from t - (row_.day + row_.starts) at time zone ''Africa/Cairo'')::bigint / 60) % row_.interval_min <> 0 then';
begin
  src := pg_get_functiondef('clinic_reception.fallback_api(text,jsonb)'::regprocedure);
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 then raise exception 'anchor 1 not found exactly once'; end if;
  if (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1 then raise exception 'anchor 2 not found exactly once'; end if;
  execute replace(replace(src, a1, b1), a2, b2);
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;
commit;
