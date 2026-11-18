-- Rollback of 20261118160000_peer_cash_handover.sql (refuses while a handover is pending; accepted entries stay in the ledger).
begin;
do $$ begin if exists (select 1 from clinic_finance.peer_handovers where status = 'pending') then raise exception 'فيه تسليمات معلّقة؛ اقفلها الأول'; end if; end $$;
do $$
declare def text;
begin
  def := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  def := regexp_replace(def, ' p_in as \(.*?where e.source=''treasury_peer_in''\),\n', '', 's');
  def := replace(def, ' union all select * from p_in)', ')');
  execute def;
end $$;
drop trigger if exists peer_pending_shift_guard on clinic_finance.shifts;
drop trigger if exists peer_pending_transfer_guard on clinic_finance.treasury_transfers;
drop function if exists public.clinic_finance_peer_handover(text, jsonb, uuid);
drop function if exists clinic_finance.peer_json(clinic_finance.peer_handovers);
drop function if exists clinic_finance.peer_pending_guard();
alter table clinic_finance.peer_handovers rename to peer_handovers_rolled_back;
commit;
