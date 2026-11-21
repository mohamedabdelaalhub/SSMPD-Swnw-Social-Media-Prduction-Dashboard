-- Merge duplicate doctor file EMP-000065 into EMP-000019 (owner: «الاتنين واحد», main chat 4, 2026-11-21).
-- KEEP = EMP-000019 (has doctor_key, 7 contracts, provider reactivated). LOSER = EMP-000065.
-- Plan: every row that points at the loser via a FK to clinic_people.people(id) is re-pointed to KEEP (found dynamically from
-- pg_constraint, so nothing is missed), each moved row is logged in clinic_people.merge_backup_20261121 for an exact rollback,
-- rows that would break a unique rule (e.g. attendance unique(person_id, day)) are LEFT on the loser and reported,
-- audit history stays on the loser (never rewritten), then the loser file is ended with a note.
-- Tables without an `id` column (e.g. device_user_map) are only reported in the preview — handle by hand if any rows show up.
-- Nothing here touches doctor_key / admin_id / contracts / provider (text keys, not FKs) — the preview shows them to decide.

-- ===================== 0. PREVIEW (read-only) =====================
select code, status, kind, department, job_title, doctor_key, admin_id is not null has_account, start_date, end_date, revision
  from clinic_people.people where code in ('EMP-000019','EMP-000065') order by code;

-- rows pointing at each file, per referencing table/column (loser vs keep)
with refs as (
  select n.nspname sch, c.relname tbl, a.attname col,
         exists (select 1 from pg_attribute i where i.attrelid = c.oid and i.attname = 'id' and not i.attisdropped) has_id
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
   where k.contype = 'f' and k.confrelid = 'clinic_people.people'::regclass and array_length(k.conkey, 1) = 1
), p as (select code, id from clinic_people.people where code in ('EMP-000019','EMP-000065'))
select r.sch || '.' || r.tbl tbl, r.col, r.has_id,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I where %I = %L', r.sch, r.tbl, r.col, l.id), false, true, '')))[1]::text::int loser_rows,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I where %I = %L', r.sch, r.tbl, r.col, k.id), false, true, '')))[1]::text::int keep_rows
  from refs r join p l on l.code = 'EMP-000065' join p k on k.code = 'EMP-000019'
 order by 1, 2;   -- only rows with loser_rows > 0 matter

-- text-key links of the loser (provider / contracts) — owner decides if anything is needed there
select 'provider' what, pr.id::text ref, pr.name, pr.active::text from clinic_reception.providers pr
  join clinic_people.people p on p.doctor_key = pr.doctor_key where p.code = 'EMP-000065'
union all
select 'contract', c.id::text, c.service_scope, c.status from clinic_finance.doctor_contracts c
  join clinic_people.people p on p.doctor_key = c.doctor_key where p.code = 'EMP-000065';

-- ===================== 1. APPLY =====================
begin;
create table if not exists clinic_people.merge_backup_20261121 (
  sch text not null, tbl text not null, col text not null, row_id uuid not null, moved_at timestamptz not null default now(),
  primary key (sch, tbl, col, row_id));
revoke all on clinic_people.merge_backup_20261121 from public, anon, authenticated;

do $$
declare keep uuid; lose uuid; r record; rid uuid; moved int; skipped int; tot_m int := 0; tot_s int := 0;
begin
  select id into keep from clinic_people.people where code = 'EMP-000019';
  select id into lose from clinic_people.people where code = 'EMP-000065';
  if keep is null or lose is null or keep = lose then raise exception 'EMP-000019 / EMP-000065 not found'; end if;
  for r in
    select n.nspname sch, c.relname tbl, a.attname col
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'clinic_people.people'::regclass and array_length(k.conkey, 1) = 1
       and exists (select 1 from pg_attribute i where i.attrelid = c.oid and i.attname = 'id' and not i.attisdropped)
       and not (n.nspname = 'clinic_people' and c.relname in ('audit', 'merge_backup_20261121'))
     order by 1, 2, 3
  loop
    moved := 0; skipped := 0;
    for rid in execute format('select id from %I.%I where %I = %L', r.sch, r.tbl, r.col, lose) loop
      begin
        execute format('update %I.%I set %I = %L where id = %L', r.sch, r.tbl, r.col, keep, rid);
        insert into clinic_people.merge_backup_20261121(sch, tbl, col, row_id) values (r.sch, r.tbl, r.col, rid);
        moved := moved + 1;
      exception when unique_violation then
        skipped := skipped + 1;   -- left on the loser, reported below
      end;
    end loop;
    if moved + skipped > 0 then
      raise notice '%.%.%: moved %, left (conflict) %', r.sch, r.tbl, r.col, moved, skipped;
    end if;
    tot_m := tot_m + moved; tot_s := tot_s + skipped;
  end loop;
  raise notice 'TOTAL moved %, left on loser because of unique conflicts %', tot_m, tot_s;
  update clinic_people.people
     set status = 'ended', end_date = coalesce(end_date, (now() at time zone 'Africa/Cairo')::date),
         notes = trim(both ' ' from coalesce(notes, '') || ' | مكرر — اندمج في EMP-000019 بقرار المالك 2026-11-21'),
         revision = revision + 1, updated_at = now()
   where id = lose;
end $$;

-- result
select code, status, end_date, revision from clinic_people.people where code in ('EMP-000019','EMP-000065') order by code;
select tbl, col, count(*) moved from clinic_people.merge_backup_20261121 group by 1, 2 order by 1, 2;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- do $$ declare r record; lose uuid := (select id from clinic_people.people where code = 'EMP-000065'); begin
--   for r in select sch, tbl, col, array_agg(row_id) ids from clinic_people.merge_backup_20261121 group by 1, 2, 3 loop
--     execute format('update %I.%I set %I = %L where id = any(%L::uuid[])', r.sch, r.tbl, r.col, lose, r.ids);
--   end loop;
-- end $$;
-- update clinic_people.people set status = 'active', end_date = null, revision = revision + 1, updated_at = now()
--   where code = 'EMP-000065';   -- set status / end_date back to the values the preview showed if they were different
-- drop table clinic_people.merge_backup_20261121;
-- commit;
