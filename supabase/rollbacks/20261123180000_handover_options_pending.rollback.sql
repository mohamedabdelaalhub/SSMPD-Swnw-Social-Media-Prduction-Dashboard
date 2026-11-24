-- Rollback of 20261123180000_handover_options_pending.sql: restores the 20261122010000 wrapper as public.clinic_finance_peer_handover.
begin;
do $$ begin
  if to_regprocedure('clinic_finance.peer_handover_pre_pending(text,jsonb,uuid)') is null then raise exception 'الملف مش متطبق'; end if;
end $$;
drop function public.clinic_finance_peer_handover(text, jsonb, uuid);
alter function clinic_finance.peer_handover_pre_pending(text, jsonb, uuid) rename to clinic_finance_peer_handover;
alter function clinic_finance.clinic_finance_peer_handover(text, jsonb, uuid) set schema public;
revoke all on function public.clinic_finance_peer_handover(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_peer_handover(text, jsonb, uuid) to authenticated;
commit;
