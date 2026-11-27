-- Rollback of 20261127060000: back to the applied 20261127050000 rule (confirmed rows count as decided). Safe to run twice.
begin;
do $rb$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text; n1 int; n2 int;
 o1 constant text := $q1$              where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
                and (not coalesce((r2->>'confirmed')::boolean,false)
                     or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id'))) then$q1$;
 o2 constant text := $q2$        where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
          and (not coalesce((r2->>'confirmed')::boolean,false)
               or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id')));$q2$;
 r1 constant text := $q3$              where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
                and coalesce(r2->>'review_status','') not in ('deferred','proposed')) then$q3$;
 r2 constant text := $q4$        where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
          and coalesce(r2->>'review_status','') not in ('deferred','proposed'));$q4$;
begin
 if fn is null then raise exception 'contracting_contract_activate is missing'; end if;
 def := pg_get_functiondef(fn);
 if position(r1 in def) > 0 and position(r2 in def) > 0 then raise notice 'nothing to do (already in the wanted state)'; return; end if;
 n1 := (length(def) - length(replace(def, o1, ''))) / length(o1);
 n2 := (length(def) - length(replace(def, o2, ''))) / length(o2);
 if n1 <> 1 or n2 <> 1 then raise exception 'anchors found %/% times (md5 %); refusing', n1, n2, (select md5(prosrc) from pg_proc where oid = fn); end if;
 execute replace(replace(def, o1, r1), o2, r2);
end $rb$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
