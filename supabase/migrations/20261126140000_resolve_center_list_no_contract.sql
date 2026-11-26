-- Cash (no-contract) pricing must read ONLY the center's own list. Found by reception 2 in the #880 dry-run (2026-11-26).
-- clinic_prices.resolve_before_offer (the pre-offer body of resolve(), from 20261028215551, renamed by 20261123160000) picks
-- «the center list» with
--   select id into lid from clinic_prices.lists where list_kind='center' and deleted_at is null and status='active' and p_date between valid_from and valid_to;
-- with no `contract_id is null` and no order. A contract-linked center-kind list that is active on that date can then silently
-- become the cash price, and the chosen list can flip between calls, which re-versions services on every sync_catalog.
-- The offer wrapper (20261123190000) already filters contract_id is null. Live on 2026-11-26 13:43Z: 1 active center list with
-- no contract, 0 contract-linked center lists, so nothing is exposed today. This is a defensive fix before contracts go live.
--
-- In-place patch: the live function body is read from pg_proc and only the anchor line is replaced. The patch refuses to
-- run unless the anchor appears exactly once. It can run twice safely (if the new line is already present, nothing happens).
-- Expected md5(prosrc) before: 08d04b4206e8f0018941edd70859b0a5 (the 20261028215551 body). A different md5 is reported
-- in a NOTICE, but is not fatal while the anchor matches exactly once.
-- Rollback: supabase/rollbacks/20261126140000_resolve_center_list_no_contract.rollback.sql
begin;
do $mig$
declare
 fn regprocedure:=to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)');
 src text;
 old_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and deleted_at is null and status=''active'' and p_date between valid_from and valid_to;';
 new_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and contract_id is null and deleted_at is null and status=''active'' and p_date between valid_from and valid_to order by valid_from desc,id limit 1;';
 n integer;
begin
 if fn is null then raise exception 'clinic_prices.resolve_before_offer is missing; apply 20261123160000 first';end if;
 select prosrc into src from pg_proc where oid=fn;
 if position(new_line in src)>0 then raise notice 'resolve_before_offer already patched (md5 %), nothing to do',md5(src);return;end if;
 n:=(length(src)-length(replace(src,old_line,'')))/length(old_line);
 if n<>1 then raise exception 'anchor found % times in resolve_before_offer (md5 %); refusing to patch',n,md5(src);end if;
 if md5(src)<>'08d04b4206e8f0018941edd70859b0a5' then raise notice 'resolve_before_offer md5 % differs from the repo body; anchor matched once, patching',md5(src);end if;
 execute format('create or replace function clinic_prices.resolve_before_offer(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as %L',replace(src,old_line,new_line));
 raise notice 'resolve_before_offer patched: % -> %',md5(src),(select md5(prosrc) from pg_proc where oid=fn);
end $mig$;
revoke all on function clinic_prices.resolve_before_offer(uuid,numeric,date,uuid) from public,anon,authenticated;
commit;
