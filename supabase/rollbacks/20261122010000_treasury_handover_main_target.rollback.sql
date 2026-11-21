-- Rollback of 20261122010000_treasury_handover_main_target.sql: the peer-handover function of 20261118160000 comes back untouched, the open-drawers list goes.
-- Nothing to clean: the migration wrote no data (handovers made through it are ordinary treasury transfers and stay).
begin;
do $$ begin
  if to_regprocedure('clinic_finance.peer_handover_pre_main(text,jsonb,uuid)') is null then raise exception 'الملف 20261122010000 غير مطبَّق'; end if;
end $$;
drop function public.clinic_finance_open_drawers();
drop function public.clinic_finance_peer_handover(text, jsonb, uuid);
alter function clinic_finance.peer_handover_pre_main(text, jsonb, uuid) rename to clinic_finance_peer_handover;
alter function clinic_finance.clinic_finance_peer_handover(text, jsonb, uuid) set schema public;
revoke all on function public.clinic_finance_peer_handover(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_peer_handover(text, jsonb, uuid) to authenticated;
commit;
