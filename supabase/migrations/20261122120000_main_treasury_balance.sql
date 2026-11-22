-- «رصيد الخزينة الرئيسية الآن» (owner «طبق رصيد الخزينة الرئيسية», 2026-11-22; accountant: «مينفعش اكون مش عارف الرصيد»).
-- READ-ONLY. The MAIN treasury's live book balance for anyone with finance VIEW (accountant included), from posted lines only:
--   balance      = clinic_finance.treasury_balance(main)   (the same figure the cash limit and handovers use)
--   open shift   = its start, custodian, cash in / out posted on it, and the shift's opening = balance − in + out
--   last_move    = the latest posted cash movement of the main treasury
-- The blind count is NOT changed for collection drawers: clinic_finance_snapshot still hides 'expected' on open shifts
-- (docs/CLINIC-CASH-CONTROL.md rule 9). The owner accepted that the main custodian sees this book figure before his own count;
-- the main close is still reviewed by another person and any difference still becomes a cash case.
-- Rollback: supabase/rollbacks/20261122120000_main_treasury_balance.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.treasury_balance(uuid)') is null then raise exception 'طبّق ملفات الخزينة (20261019001000) أولًا'; end if;
  if to_regprocedure('public.clinic_finance_main_treasury_balance()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.clinic_finance_main_treasury_balance() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r clinic_finance.registers%rowtype; s clinic_finance.shifts%rowtype; bal numeric; v_in numeric := 0; v_out numeric := 0; lm jsonb;
begin
  perform clinic_finance.require_access('view');
  select * into r from clinic_finance.registers where treasury_kind = 'main' order by created_at limit 1;
  if not found then return jsonb_build_object('configured', false); end if;
  bal := clinic_finance.treasury_balance(r.id);
  select * into s from clinic_finance.shifts where register_id = r.id and status = 'open' order by opened_at desc limit 1;
  if s.id is not null then
    select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) into v_in, v_out
      from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
     where e.shift_id = s.id and clinic_finance.is_cash_account(l.account);
  end if;
  select jsonb_build_object('at', e.created_at, 'description', e.description, 'amount', l.debit - l.credit, 'event_no', e.event_no) into lm
    from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id join clinic_finance.shifts x on x.id = e.shift_id
   where x.register_id = r.id and clinic_finance.is_cash_account(l.account)
   order by e.event_no desc limit 1;
  return jsonb_build_object('configured', true, 'register_id', r.id, 'register', r.name, 'account_code', r.account_code,
    'balance', round(bal, 2), 'as_of', now(), 'last_move', lm,
    'shift', case when s.id is null then null else jsonb_build_object('id', s.id, 'opened_at', s.opened_at,
      'custodian', (select coalesce(nullif(trim(a.name), ''), 'المسؤول') from public.admins a where a.id = s.cashier_id),
      'cash_in', round(v_in, 2), 'cash_out', round(v_out, 2), 'opening', round(bal - v_in + v_out, 2)) end);
end $$;

revoke all on function public.clinic_finance_main_treasury_balance() from public, anon;
grant execute on function public.clinic_finance_main_treasury_balance() to authenticated;

commit;
