-- Rollback of 20261118030000_desk_payout_from_collection.sql: receive-only registers refuse desk doctor payouts again.
begin;
do $$
declare def text; patched text;
  new_line constant text := $s$if p_credit='1111' and p_source<>'deposit' and not (p_source='doctor_payment' and clinic_finance.desk_payout_from_collection(p_source_id,p_shift)) then perform clinic_finance.register_direction(p_shift,'pay');end if;$s$;
  old_line constant text := $s$if p_credit='1111' and p_source<>'deposit' then perform clinic_finance.register_direction(p_shift,'pay');end if;$s$;
begin
  def := pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure);
  if position(new_line in def) = 0 then raise exception 'clinic_finance.post is not patched (md5 %)', md5(def); end if;
  patched := replace(def, new_line, old_line); execute patched;
end $$;
drop function if exists clinic_finance.desk_payout_from_collection(uuid, uuid);
commit;
