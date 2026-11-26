-- Rollback of 20261126140000: put back the original center-list lookup in clinic_prices.resolve_before_offer. Safe to run twice.
begin;
do $rb$
declare
 fn regprocedure:=to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)');
 src text;
 old_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and deleted_at is null and status=''active'' and p_date between valid_from and valid_to;';
 new_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and contract_id is null and deleted_at is null and status=''active'' and p_date between valid_from and valid_to order by valid_from desc,id limit 1;';
begin
 if fn is null then raise exception 'clinic_prices.resolve_before_offer is missing';end if;
 select prosrc into src from pg_proc where oid=fn;
 if position(new_line in src)=0 then raise notice 'not patched (md5 %), nothing to roll back',md5(src);return;end if;
 execute format('create or replace function clinic_prices.resolve_before_offer(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as %L',replace(src,new_line,old_line));
 raise notice 'rolled back: md5 now %',(select md5(prosrc) from pg_proc where oid=fn);
end $rb$;
revoke all on function clinic_prices.resolve_before_offer(uuid,numeric,date,uuid) from public,anon,authenticated;
commit;
