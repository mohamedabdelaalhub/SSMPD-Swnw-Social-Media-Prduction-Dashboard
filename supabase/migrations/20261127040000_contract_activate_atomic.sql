-- «تفعيل العقد» must be all-or-nothing when the contract has a linked price list (main chat 6, 2026-11-27).
-- Found in a rolled-back dry-run: contracting_contract_activate (20261123080000) activated the contract, then the list
-- step failed (clinic_prices.guard_mapping_price_approval: «اعتماد أسعار اللائحة يحتاج مراجعًا آخر غير من راجع ربط المصدر»)
-- and the error was only returned as price_list_message. The result was an ACTIVE contract with a draft list and a
-- pending link, which reception cannot price («لا توجد قائمة أسعار مرتبطة ومعتمدة لعقد الجهة…»).
-- Now a list-step failure raises: nothing changes, the contract stays in its previous status, and the screen shows
-- «تعذر تفعيل العقد: العقد ماتفعلش …» with the reason (its existing error toast).
-- Unchanged: contracts with no linked list activate as before; the success path and its response shape; who may
-- press it (super admin / financial manager); the source-review four-eyes trigger itself (not touched).
-- In-place anchored patch of the LIVE definition (md5 of prosrc expected 227de8678378073e16e46007dd3d5e65, the
-- 20261123080000 body). Refuses if the anchor is not found exactly once. Running it twice is safe.
-- Rollback: supabase/rollbacks/20261127040000_contract_activate_atomic.rollback.sql
begin;
do $mig$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text; n int;
 old_frag constant text := $o$  exception when others then
   list_state:='error';list_message:=sqlerrm;$o$;
 new_frag constant text := $n$  exception when others then
   raise exception 'العقد ماتفعلش ولا اتغير فيه حاجة: قائمة الأسعار المرتبطة ماتعتمدتش — %', sqlerrm;$n$;
begin
 if fn is null then raise exception 'contracting_contract_activate is missing; apply 20261123080000 first'; end if;
 def := pg_get_functiondef(fn);
 if position(new_frag in def) > 0 then raise notice 'already patched'; return; end if;
 n := (length(def) - length(replace(def, old_frag, ''))) / length(old_frag);
 if n <> 1 then raise exception 'anchor found % times (md5 %); refusing', n, (select md5(prosrc) from pg_proc where oid = fn); end if;
 if (select md5(prosrc) from pg_proc where oid = fn) <> '227de8678378073e16e46007dd3d5e65' then
   raise notice 'contracting_contract_activate md5 % differs from the repo body; anchor matched once, patching', (select md5(prosrc) from pg_proc where oid = fn); end if;
 execute replace(def, old_frag, new_frag);
end $mig$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
