-- Rollback for 20261118200000_reception_fallback_last_slot.sql: the reverse text patch.
begin;
do $$
declare src text; b1 text := 'while t + visit <= dend and cnt < 300 loop';
  a1 text := 'while t + make_interval(mins => row_.interval_min) <= dend and cnt < 300 loop';
  b2 text := 'if (extract(epoch from t - (row_.day + row_.starts) at time zone ''Africa/Cairo'')::bigint / 60) % row_.interval_min <> 0 then';
  a2 text := 'if t + make_interval(mins => row_.interval_min) > (row_.day + case when row_.ends = time ''00:00'' then interval ''24 hours'' else row_.ends - time ''00:00'' end) at time zone ''Africa/Cairo'' or (extract(epoch from t - (row_.day + row_.starts) at time zone ''Africa/Cairo'')::bigint / 60) % row_.interval_min <> 0 then';
begin
  src := pg_get_functiondef('clinic_reception.fallback_api(text,jsonb)'::regprocedure);
  if position(a1 in src) = 0 or position(a2 in src) = 0 then raise exception 'patched text not found'; end if;
  execute replace(replace(src, a1, b1), a2, b2);
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;
commit;
