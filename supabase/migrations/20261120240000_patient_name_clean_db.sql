-- Live bug 2026-11-20 (main chat 4, owner «صلح الاخطاء اللي قولتها دي كلها»): a valid two/three-word Arabic name was refused
-- as «اسم المريض مطلوب من كلمتين على الأقل» because it carried invisible marks (RLM/LRM, ZWNJ/ZWJ, bidi embeds/isolates,
-- BOM, ALM), tatweel or harakat — psychcare.check_basics accepts only letters / spaces / «.» / «-».
-- #645 cleans the name in the archive form and patients-create. This cleans it in the database for EVERY path
-- (patients-create, reception employee booking, auto-book, journey, direct updates):
--   * psychcare.clean_name(text): removes those marks, tatweel and harakat, turns any whitespace run (incl. NBSP) into one space.
--   * psychcare.check_basics(n, p, a): validates the CLEANED name (in-place anchored patch, saved for rollback).
--   * trigger patient_basics_clean (BEFORE INSERT/UPDATE OF full_name on public.patients) stores the cleaned name; it fires
--     before patient_basics_guard (triggers fire in name order).
-- Rollback: supabase/rollbacks/20261120240000_patient_name_clean_db.rollback.sql
begin;

do $$ begin
  if to_regprocedure('psychcare.check_basics(text,text,integer)') is null then raise exception 'psychcare.check_basics غير موجودة'; end if;
  if to_regprocedure('psychcare.clean_name(text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function psychcare.clean_name(v text) returns text language sql immutable set search_path = pg_catalog as $$
  select btrim(regexp_replace(
           regexp_replace(coalesce(v, ''), '[​-‏‪-‮⁦-⁩﻿؜ـً-ٰٟ]', '', 'g'),
           '[[:space:] ]+', ' ', 'g'))
$$;

create table if not exists psychcare.name_clean_saved_defs(name text primary key, def text not null);
do $$
declare d text; a constant text := $s$if trim(coalesce(n,'')) !~$s$;
begin
  d := pg_get_functiondef('psychcare.check_basics(text,text,integer)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في check_basics مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  insert into psychcare.name_clean_saved_defs values ('check_basics', d) on conflict (name) do update set def = excluded.def;
  execute replace(d, a, $s$n := psychcare.clean_name(n); $s$ || a);
end $$;

create function psychcare.patient_name_clean() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.full_name is not null then new.full_name := psychcare.clean_name(new.full_name); end if;
  return new;
end $$;
drop trigger if exists patient_basics_clean on public.patients;
create trigger patient_basics_clean before insert or update of full_name on public.patients
  for each row execute function psychcare.patient_name_clean();

commit;
