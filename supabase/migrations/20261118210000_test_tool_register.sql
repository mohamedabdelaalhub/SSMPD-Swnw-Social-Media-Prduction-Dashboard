-- «سجلات تجريبية — حذف آمن» (20261109130000, + 'advance' 20261118190000) learns one more record type: 'register' = a TEST cash register «خزينة» (owner request 2026-11-18:
-- remove the test registers «dina» and «mahmoud» entirely). Same flow and guarantees as the other types: owner only (super_admin) -> FLAG (reason + «تجريبي») -> DELETE (reason + «حذف»),
-- full rows archived first (test_take), one transaction, audited. Key = clinic_finance.registers.id. Found by register name in the search box.
--
-- A register is deletable ONLY when it never held real money:
--   * it is not the main treasury (treasury_kind 'main') and no other register has it as parent;
--   * none of its shifts has ANY row in a shift-linked table: payments, requests, cash vouchers, cash cases, advances, advance uses, doctor payouts, insurance claim receipts,
--     supplier actions, peer handovers (either side), reception payments of its reception shifts;
--   * no journal entry on its shifts and none whose source is the register / one of its shifts;
--   * no treasury transfer that was executed (approved) from / to it. PENDING or REJECTED transfers out of its own shifts carry no ledger entry and are removed with it;
--     a pending transfer coming from ANOTHER register's shift into it is refused (that is the other drawer's open business);
--   * its own cash account has NO ledger line at all (a test booking advance must be deleted FIRST with type «مقدم حجز» — that also removes the treasury binding entry),
--     no pending journal batch / draft uses it, nothing else points at it (bank statements, vouchers, opening details, contracting entities, child accounts, another register ...);
--   * none of its shifts falls inside a closed financial period.
-- What a delete removes (archived first, in this order): the clinic_reception.shifts and clinic_reception.registers rows bridged to it, the pending / rejected
-- clinic_finance.treasury_transfers of its shifts, its clinic_finance.shifts, the clinic_finance.registers row, then — when the account is not a system account — its
-- clinic_finance.cash_accounts row and its (empty) ledger account: clinic_finance.account_config + clinic_finance.accounts.
-- The clinic_finance.audit history of the register (created / updated / first binding / shifts) is KEPT on purpose: no audit row is taken for this type.
--
-- ADDITIVE and small: test_plan and public.clinic_finance_test_find are WRAPPED again (the current bodies — the 'advance' wrappers over the 20261109130000 bases — are kept
-- untouched as *_pre_register and still serve every other type), and the record_type check of test_flags accepts 'register'. Nothing is flagged or deleted by applying this file.
-- Rollback: supabase/rollbacks/20261118210000_test_tool_register.rollback.sql (refuses while a register is flagged).
begin;

do $$ begin
  if to_regprocedure('clinic_finance.test_plan_base(text,text)') is null or to_regprocedure('clinic_finance.test_find_base(text,text)') is null then raise exception 'طبّق ملف نوع مقدم الحجز (20261118190000) أولًا'; end if;
  if to_regclass('clinic_finance.treasury_transfers') is null or to_regclass('clinic_finance.cash_accounts') is null then raise exception 'طبّق ملفات الخزينة (20261018205000 و 20261019001000) أولًا'; end if;
  if to_regprocedure('clinic_finance.test_plan_pre_register(text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_finance.test_flags drop constraint test_flags_record_type_check;
alter table clinic_finance.test_flags add constraint test_flags_record_type_check check (record_type in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply', 'advance', 'register'));

-- ------------------------------------------------------------------ the plan
alter function clinic_finance.test_plan(text, text) rename to test_plan_pre_register;

-- VOLATILE like the 'advance' wrapper: takes the finance day lock first (pg_advisory_xact_lock(927311), the lock every cash command takes) and then reads fresh,
-- so a payment / transfer / shift opened a moment earlier is seen and nothing slips in between the plan and the delete.
create function clinic_finance.test_plan(p_type text, p_key text) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare r clinic_finance.registers%rowtype; k text[]; label text; blk jsonb;
  shs text[]; rregs text[] := array[]::text[]; rshs text[] := array[]::text[]; xfers text[]; srcs text[]; acct text[] := array[]::text[]; take_acct boolean := false;
  n_exec integer; n_in integer; n_ent integer; n_lines integer := 0; n_refs integer := 0; n_pending_journal integer := 0; n_rpay integer := 0; fk record;
begin
  if p_type is distinct from 'register' then return clinic_finance.test_plan_pre_register(p_type, p_key); end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'حدد السجل'; end if;
  if p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'معرّف السجل غير صالح'; end if;

  perform pg_advisory_xact_lock(927311);
  select * into r from clinic_finance.registers where id = p_key::uuid;
  if not found then return jsonb_build_object('type', p_type, 'key', p_key, 'exists', false, 'label', p_key, 'takes', '[]'::jsonb, 'blockers', '[]'::jsonb); end if;
  k := array[r.id::text];   -- canonical text of the id: the takes below match on id::text
  label := 'خزينة ' || r.name || ' — ' || case r.treasury_kind when 'main' then 'رئيسية' when 'collection' then 'تحصيل' else 'غير مربوطة' end || coalesce(' — حساب ' || r.account_code, '');

  shs := array(select s.id::text from clinic_finance.shifts s where s.register_id = r.id);
  if to_regclass('clinic_reception.registers') is not null then
    rregs := array(select x.id::text from clinic_reception.registers x where x.finance_register_id = r.id);
    rshs := array(select x.id::text from clinic_reception.shifts x where x.finance_shift_id::text = any(shs) or x.register_id::text = any(rregs));
    n_rpay := clinic_finance.test_n('clinic_reception.payments', 'shift_id', rshs);
  end if;
  xfers := array(select t.id::text from clinic_finance.treasury_transfers t where (t.from_shift::text = any(shs) or t.to_shift::text = any(shs) or t.to_register = r.id) and t.status in ('pending', 'rejected'));
  n_exec := (select count(*)::int from clinic_finance.treasury_transfers t where (t.from_shift::text = any(shs) or t.to_shift::text = any(shs) or t.to_register = r.id) and t.status not in ('pending', 'rejected'));
  n_in := (select count(*)::int from clinic_finance.treasury_transfers t where t.to_register = r.id and t.status = 'pending' and not (t.from_shift::text = any(shs)));
  srcs := k || shs || xfers;
  n_ent := (select count(*)::int from clinic_finance.entries e where e.shift_id::text = any(shs) or e.source_id::text = any(srcs));

  if r.account_code is not null then
    acct := array[r.account_code];
    n_lines := clinic_finance.test_n('clinic_finance.lines', 'account', acct);
    -- everything else that points at the account (foreign keys found in the catalog, so a table added later is covered too); the register itself, its cash flag and its own config row excluded
    for fk in select c.conrelid::regclass::text t, a.attname::text col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'clinic_finance.accounts'::regclass and array_length(c.conkey, 1) = 1 loop
      if (fk.t, fk.col) in (('clinic_finance.lines', 'account'), ('clinic_finance.cash_accounts', 'code'), ('clinic_finance.account_config', 'code'), ('clinic_finance.registers', 'account_code')) then continue; end if;
      n_refs := n_refs + clinic_finance.test_n(fk.t, fk.col, acct);
    end loop;
    n_refs := n_refs + (select count(*)::int from clinic_finance.registers x where x.account_code = r.account_code and x.id <> r.id);
    if n_lines = 0 and to_regprocedure('clinic_finance.account_in_use(text)') is not null and clinic_finance.account_in_use(r.account_code) then n_pending_journal := 1; end if;
    -- a system account is never removed by this tool (it stays, with its cash flag); a register's own added account goes with it
    take_acct := not coalesce((select c.is_system from clinic_finance.account_config c where c.code = r.account_code), false) and r.account_code <> '1111';
    if take_acct then label := label || ' (+ حساب الخزينة الفارغ ' || r.account_code || ')'; end if;
  end if;

  blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
    ('main', 'الخزينة الرئيسية لا تُحذف', case when r.treasury_kind = 'main' then 1 else 0 end),
    ('children', 'خزن أخرى تابعة لهذه الخزينة', clinic_finance.test_n('clinic_finance.registers', 'parent_register_id', k)),
    ('payments', 'دفعات تحصيل على ورديات الخزينة', clinic_finance.test_n('clinic_finance.payments', 'shift_id', shs)),
    ('requests', 'طلبات استرداد أو تسوية على ورديات الخزينة', clinic_finance.test_n('clinic_finance.requests', 'shift_id', shs)),
    ('vouchers', 'أذون صرف أو قبض نقدية على ورديات الخزينة', clinic_finance.test_n('clinic_finance.cash_vouchers', 'shift_id', shs)),
    ('cash_cases', 'حالات نقدية مسجلة على ورديات الخزينة', clinic_finance.test_n('clinic_finance.cash_cases', 'shift_id', shs)),
    ('advances', 'مقدمات حجز على ورديات الخزينة — احذف مقدم الحجز التجريبي أولًا من نوع «مقدم حجز»', clinic_finance.test_n('clinic_finance.advances', 'shift_id', shs)),
    ('advance_uses', 'استخدام أو استرداد مقدمات على ورديات الخزينة', clinic_finance.test_n('clinic_finance.advance_uses', 'shift_id', shs)),
    ('doctor_payouts', 'صرف أتعاب أطباء من ورديات الخزينة', clinic_finance.test_n('clinic_finance.doctor_payouts', 'shift_id', shs)),
    ('insurance_receipts', 'تحصيل مطالبات تأمين على ورديات الخزينة', clinic_finance.test_n('clinic_finance.insurance_claim_receipts', 'shift_id', shs)),
    ('supplier_actions', 'مدفوعات موردين من ورديات الخزينة', clinic_finance.test_n('clinic_finance.supplier_actions', 'shift_id', shs)),
    ('peer_handovers', 'تسليمات نقدية بين الزملاء على ورديات الخزينة', clinic_finance.test_n('clinic_finance.peer_handovers', 'from_shift', shs) + clinic_finance.test_n('clinic_finance.peer_handovers', 'to_shift', shs)),
    ('reception_payments', 'مدفوعات استقبال على ورديات الخزينة', n_rpay),
    ('entries', 'قيود يومية على ورديات الخزينة أو مرتبطة بها', n_ent),
    ('executed_transfers', 'تسليمات نقدية مُنفَّذة من الخزينة أو إليها', n_exec),
    ('incoming_transfers', 'تسليم نقدية معلّق من خزينة أخرى إلى هذه الخزينة', n_in),
    ('account_lines', 'على حساب الخزينة ' || coalesce(r.account_code, '') || ' سطور قيود في الدفاتر — احذف مقدم الحجز التجريبي أولًا من نوع «مقدم حجز»، وأي حركة أخرى حقيقية تمنع حذف الخزينة', n_lines),
    ('journal_corrections', 'طلب قيد أو مسودة قيد معلّقة تستخدم حساب الخزينة', n_pending_journal),
    ('account_refs', 'حساب الخزينة مستخدم في بيانات أخرى (كشف بنك، أذون، أرصدة افتتاحية، جهة تعاقد، حساب تابع، خزينة أخرى)', n_refs),
    ('closed_period', 'وردية للخزينة داخل فترة مالية مقفلة', (select count(*)::int from clinic_finance.shifts s where s.register_id = r.id
        and (s.opened_at at time zone 'Africa/Cairo')::date <= coalesce((select max(closed_through) from clinic_finance.periods), '0001-01-01'::date)))
  ) as t(c, l, x) where x > 0);

  return jsonb_build_object('type', p_type, 'key', p_key, 'exists', true, 'label', label, 'blockers', blk, 'takes', jsonb_build_array(
    jsonb_build_object('table', 'clinic_reception.shifts', 'col', 'id', 'vals', to_jsonb(rshs)),
    jsonb_build_object('table', 'clinic_reception.registers', 'col', 'id', 'vals', to_jsonb(rregs)),
    jsonb_build_object('table', 'clinic_finance.treasury_transfers', 'col', 'id', 'vals', to_jsonb(xfers)),
    jsonb_build_object('table', 'clinic_finance.shifts', 'col', 'id', 'vals', to_jsonb(shs)),
    jsonb_build_object('table', 'clinic_finance.registers', 'col', 'id', 'vals', to_jsonb(k)),
    jsonb_build_object('table', 'clinic_finance.cash_accounts', 'col', 'code', 'vals', to_jsonb(case when take_acct then acct else array[]::text[] end)),
    jsonb_build_object('table', 'clinic_finance.account_config', 'col', 'code', 'vals', to_jsonb(case when take_acct then acct else array[]::text[] end)),
    jsonb_build_object('table', 'clinic_finance.accounts', 'col', 'code', 'vals', to_jsonb(case when take_acct then acct else array[]::text[] end))));
end $$;

-- ------------------------------------------------------------------ the search box
alter function public.clinic_finance_test_find(text, text) set schema clinic_finance;
alter function clinic_finance.clinic_finance_test_find(text, text) rename to test_find_pre_register;

create function public.clinic_finance_test_find(p_type text, p_q text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare q text := '%' || replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '') || '%'; r jsonb;
begin
  perform clinic_finance.test_owner();
  if p_type is distinct from 'register' then return clinic_finance.test_find_pre_register(p_type, p_q); end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', g.id, 'label', 'خزينة ' || g.name,
      'sub', case g.treasury_kind when 'main' then 'رئيسية' when 'collection' then 'تحصيل' else 'غير مربوطة' end || coalesce(' — حساب ' || g.account_code, '')
        || coalesce(' — ' || (select a.name from public.admins a where a.id = g.assigned_to), '')
        || ' — ' || (select count(*) from clinic_finance.shifts s where s.register_id = g.id)::text || ' وردية',
      'flagged', clinic_finance.test_is_flagged('register', g.id::text)) order by g.created_at desc), '[]'::jsonb) into r
  from (select * from clinic_finance.registers where name ilike q order by created_at desc limit 25) g;
  return r;
end $$;

-- privileges: exactly as before (public RPC = authenticated only, re-checks the owner role itself; helpers = nobody)
revoke all on function public.clinic_finance_test_find(text, text) from public, anon;
grant execute on function public.clinic_finance_test_find(text, text) to authenticated;
revoke all on function clinic_finance.test_plan(text, text), clinic_finance.test_plan_pre_register(text, text), clinic_finance.test_find_pre_register(text, text) from public, anon, authenticated;

commit;
