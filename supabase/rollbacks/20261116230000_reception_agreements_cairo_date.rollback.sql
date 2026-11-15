-- Reverts to the server date (not recommended): same loop in reverse.
do $$declare f record;def text;begin
 for f in select p.oid from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('clinic_reception','public') and p.prokind='f' and p.prosrc like '%clinic_reception.today() between%valid_from and%valid_to%' loop
  def:=pg_get_functiondef(f.oid);
  execute replace(replace(def,'clinic_reception.today() between valid_from and valid_to','current_date between valid_from and valid_to'),'clinic_reception.today() between a.valid_from and a.valid_to','current_date between a.valid_from and a.valid_to');
 end loop;end $$;
