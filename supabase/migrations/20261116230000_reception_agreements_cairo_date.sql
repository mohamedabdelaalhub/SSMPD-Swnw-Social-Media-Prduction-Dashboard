-- Doctor-fee agreements were matched with current_date, i.e. the database server's date (UTC), not Cairo's.
-- Between 00:00 and 02:00 Cairo a contract starting "today" was not yet valid (service execution refused with
-- «يلزم عقد أتعاب معتمد للخدمة المنفذة ولو بنسبة صفر»), and one that ended "yesterday" still matched.
-- Patch every reception function that compares agreement validity with current_date to use clinic_reception.today().
-- Same definition as 20261017051044 (kept identical; created here only if an older chain lacks it).
create or replace function clinic_reception.today() returns date language sql stable set search_path=pg_catalog as $f$select (now() at time zone 'Africa/Cairo')::date$f$;
do $$declare f record;def text;patched text;n int:=0;
begin
 for f in select p.oid from pg_proc p join pg_namespace s on s.oid=p.pronamespace
          where s.nspname in ('clinic_reception','public') and p.prokind='f'
            and (p.prosrc like '%current_date between valid_from and valid_to%' or p.prosrc like '%current_date between a.valid_from and a.valid_to%') loop
  def:=pg_get_functiondef(f.oid);
  patched:=replace(replace(def,'current_date between valid_from and valid_to','clinic_reception.today() between valid_from and valid_to'),
                   'current_date between a.valid_from and a.valid_to','clinic_reception.today() between a.valid_from and a.valid_to');
  if patched<>def then execute patched;n:=n+1;end if;
 end loop;
 raise notice 'agreement date checks moved to Cairo date in % function(s)',n;
end $$;
