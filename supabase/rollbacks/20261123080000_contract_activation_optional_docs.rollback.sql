-- Rollback of 20261123080000_contract_activation_optional_docs.sql (in place, safe to run twice).
-- Contracts already activated and lists already approved stay as they are; only the new rules go.
-- Brings back: four-eyes review of price lists and links (another reviewer), any contract manager may set status active.
begin;
do $$begin
 if to_regprocedure('clinic_prices.price_lists_command_before_approver(text,jsonb)') is not null then
  if position('price_lists_command_before_approver' in pg_get_functiondef('public.price_lists_command(text,jsonb)'::regprocedure))=0 then
   raise exception 'فيه ملف أحدث لف دالة قوائم الأسعار — رجّعه الأول';end if;
  drop function public.price_lists_command(text,jsonb);
  alter function clinic_prices.price_lists_command_before_approver(text,jsonb) set schema public;
  alter function public.price_lists_command_before_approver(text,jsonb) rename to price_lists_command;
 end if;
 if to_regprocedure('clinic_prices.price_contract_list_command_before_approver(text,jsonb)') is not null then
  if position('price_contract_list_command_before_approver' in pg_get_functiondef('public.price_contract_list_command(text,jsonb)'::regprocedure))=0 then
   raise exception 'فيه ملف أحدث لف دالة ربط الأسعار — رجّعه الأول';end if;
  drop function public.price_contract_list_command(text,jsonb);
  alter function clinic_prices.price_contract_list_command_before_approver(text,jsonb) set schema public;
  alter function public.price_contract_list_command_before_approver(text,jsonb) rename to price_contract_list_command;
 end if;
end $$;
revoke all on function public.price_lists_command(text,jsonb),public.price_contract_list_command(text,jsonb) from public,anon;
grant execute on function public.price_lists_command(text,jsonb),public.price_contract_list_command(text,jsonb) to authenticated;
drop function if exists public.contracting_contract_activate(uuid);
drop function if exists clinic_prices.decide_list(uuid,text,text);
drop trigger if exists contract_activation_role_guard on public.contracting_entity_contracts;
drop function if exists public.guard_contract_activation_role();
drop function if exists public.can_approve_contracts();
notify pgrst,'reload schema';
commit;
