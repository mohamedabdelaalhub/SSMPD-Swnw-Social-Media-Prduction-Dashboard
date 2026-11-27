-- «تفعيل العقد» auto-close (20261127050000, applied live 2026-11-27): never drop a row that was confirmed only inside the
-- import file. Rows confirmed in the batch window («تأكدت أن هذه هي الخدمة الصحيحة» + «احفظ وكمّل بعدين») live only in
-- the batch JSON; only rows linked through «مراجعة أسماء الجهات» (source_review) are list items. 050000 counted every
-- confirmed row as decided, so closing a file that also has «مش عندنا» rows could drop those confirmations.
-- Now a row is undecided when it is not deferred/proposed AND (not confirmed OR its service is not yet an item of the list):
-- «تفعيل العقد» refuses with «فاضل N سطر …» and nothing changes (20261127040000). The batch window's «خلّصت» (#916) writes
-- such rows to the list with source_review before closing the file.
-- Anchored in-place patch of the LIVE 050000 body (both fragments must match exactly once); running it twice is safe.
-- Rollback: supabase/rollbacks/20261127060000_contract_activate_auto_close_linked_only.rollback.sql
begin;
do $mig$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text; n1 int; n2 int;
 o1 constant text := $q1$              where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
                and coalesce(r2->>'review_status','') not in ('deferred','proposed')) then$q1$;
 o2 constant text := $q2$        where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
          and coalesce(r2->>'review_status','') not in ('deferred','proposed'));$q2$;
 r1 constant text := $q3$              where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
                and (not coalesce((r2->>'confirmed')::boolean,false)
                     or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id'))) then$q3$;
 r2 constant text := $q4$        where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
          and (not coalesce((r2->>'confirmed')::boolean,false)
               or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id')));$q4$;
begin
 if fn is null then raise exception 'contracting_contract_activate is missing'; end if;
 def := pg_get_functiondef(fn);
 if position(r1 in def) > 0 and position(r2 in def) > 0 then raise notice 'nothing to do (already in the wanted state)'; return; end if;
 n1 := (length(def) - length(replace(def, o1, ''))) / length(o1);
 n2 := (length(def) - length(replace(def, o2, ''))) / length(o2);
 if n1 <> 1 or n2 <> 1 then raise exception 'anchors found %/% times (md5 %); refusing', n1, n2, (select md5(prosrc) from pg_proc where oid = fn); end if;
 execute replace(replace(def, o1, r1), o2, r2);
end $mig$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
