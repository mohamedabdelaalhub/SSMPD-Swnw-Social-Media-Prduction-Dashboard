-- Live rollback check for 20261125020000_package_expiry_cairo_day.sql. ONE transaction ending in ROLLBACK, as postgres.
-- Applies the migration, then copies any existing live package (forced non-legacy) as a new row with expires_on = current_date + 120
-- and shows the stored expiry = Cairo date + 120. Nothing is kept.
begin;
-- >>> paste supabase/migrations/20261125020000_package_expiry_cairo_day.sql here WITHOUT its own begin / commit <<<
create temp table pe_live(n serial, step text, expected text, actual text, ok boolean);
do $$ declare src jsonb; nid uuid := gen_random_uuid(); got date; want date := (now() at time zone 'Africa/Cairo')::date + 120; begin
  select to_jsonb(k) into src from clinic_reception.packages k order by expires_on desc nulls last, id limit 1;
  if src is null then raise exception 'no package on live to copy — sell one in the test first'; end if;
  insert into pe_live(step, expected, actual, ok) values ('server date / Cairo date', 'may differ 22:00–24:00 UTC', current_date || ' / ' || (now() at time zone 'Africa/Cairo')::date, true);
  insert into clinic_reception.packages select * from jsonb_populate_record(null::clinic_reception.packages,
    src || jsonb_build_object('id', nid, 'expires_on', current_date + 120, 'legacy_paid_on', null));
  select expires_on into got from clinic_reception.packages where id = nid;
  insert into pe_live(step, expected, actual, ok) values ('new package expiry', want::text, got::text, got = want);
end $$;
select step, expected, actual, ok from pe_live order by n;
rollback;
