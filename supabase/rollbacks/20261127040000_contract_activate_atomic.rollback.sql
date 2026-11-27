-- Rollback of 20261127040000: the list-step failure is again returned as price_list 'error' (contract still activated). Safe to run twice.
begin;
do $rb$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text;
 old_frag constant text := $o$  exception when others then
   list_state:='error';list_message:=sqlerrm;$o$;
 new_frag constant text := $n$  exception when others then
   raise exception 'العقد ماتفعلش ولا اتغير فيه حاجة: قائمة الأسعار المرتبطة ماتعتمدتش — %', sqlerrm;$n$;
begin
 def := pg_get_functiondef(fn);
 if position(new_frag in def) = 0 then raise notice 'not patched, nothing to roll back'; return; end if;
 execute replace(def, new_frag, old_frag);
end $rb$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
