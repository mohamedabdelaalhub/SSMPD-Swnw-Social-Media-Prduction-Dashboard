-- «سجلات تجريبية — حذف آمن» (20261109130000, + 'advance' 20261118190000, + 'register' 20261118210000) learns one more record type: 'patient_credit' = a TEST reception
-- payment that became «رصيد لصالح المريض» (owner request 2026-11-21: cancel the trial credit of 1000 on «خزينة دينا (تجريبية)», then delete that drawer).
-- Same flow and guarantees as the other types: owner only (super_admin) -> FLAG (reason + «تجريبي») -> DELETE (reason + «حذف»), full rows archived first (test_take),
-- one transaction, audited. Key = clinic_reception.journal.id of the 'patient_credit' event (= clinic_finance.entries.source_id of the 'reception_patient_credit' entry).
-- Found in the search box by patient name / file number, payment reference, receipt number or the entry number.
--
-- How such a credit is made (clinic_reception.payment_operation 'collect', 20261017041727 + bridge 20261017044739): a reception payment whose money is not applied to an
-- invoice / package posts ONE reception journal event (source 'patient_credit', source_id = clinic_reception.payments.id) of drawer cash debit / 2150 credit, mirrored to
-- ONE clinic_finance entry (source 'reception_patient_credit', source_id = the journal id, shift_id = the finance shift of the drawer) whose '1111' line is moved to the
-- drawer's own cash account by the treasury trigger (20261018205000). The payment keeps credit_amount = the leftover.
--
-- A credit is deletable ONLY when it is provably unused and still in its drawer:
--   * the WHOLE payment became credit (credit_amount = amount): no allocation of that payment to an invoice / package, no other reception event about the payment
--     (refund, package, credit note ...), no request (refund / credit note) about it, nothing else references the payment (foreign keys found in the catalog);
--   * the patient's reception credit balance (2150) still holds at least this amount (it was not applied to an invoice with «استخدام رصيد المريض» or refunded);
--   * CASH only, mirrored to exactly ONE finance entry of the expected shape (2 lines: a cash-account debit + 2150 credit for the amount) on a finance shift;
--   * that shift is not closed / reviewed (an ENDED, counted shift is accepted: the count is undone together with the drawer by type «خزينة» — but only if nothing left it):
--     no pending or executed handover out of it (a REJECTED one is fine), no peer handover, no other shift of the same drawer opened / ended / closed after the credit,
--     and the drawer still holds at least the amount (cash_limit);
--   * no closed financial period, no journal correction / manual batch, no bank-statement match on the finance entry.
-- What a delete removes (archived first, in this order): the finance lines + entry, the reception journal lines + event, the payment's proof rows, the reception payment.
-- The patient file, the drawer, its shift and every audit / command history are KEPT (the audit rows keep pointing at the archived ids).
--
-- After it, «خزينة» (register, 20261118210000) can delete the test drawer together with its open (even ended) shift and its rejected handover: that type never looked at
-- the shift status, only at what is on it — so the register rule needs NO change.
--
-- ADDITIVE and small: test_plan and public.clinic_finance_test_find are WRAPPED again (the current bodies — the 'register' wrappers — are kept untouched as
-- *_pre_patient_credit and still serve every other type), and the record_type check of test_flags accepts 'patient_credit'. Nothing is flagged or deleted by applying this file.
-- Rollback: supabase/rollbacks/20261121210000_test_tool_patient_credit.rollback.sql (refuses while a patient credit is flagged).
begin;

do $$ begin
  if to_regprocedure('clinic_finance.test_plan_pre_register(text,text)') is null or to_regprocedure('clinic_finance.test_find_pre_register(text,text)') is null then raise exception 'طبّق ملف نوع الخزينة (20261118210000) أولًا'; end if;
  if to_regclass('clinic_reception.journal') is null or to_regclass('clinic_reception.journal_lines') is null or to_regclass('clinic_reception.payments') is null or to_regclass('clinic_reception.patients') is null then raise exception 'طبّق ملفات الاستقبال (20261017041727 و 20261017044739) أولًا'; end if;
  if to_regprocedure('clinic_finance.test_plan_pre_patient_credit(text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_finance.test_flags drop constraint test_flags_record_type_check;
alter table clinic_finance.test_flags add constraint test_flags_record_type_check check (record_type in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply', 'advance', 'register', 'patient_credit'));

-- ------------------------------------------------------------------ the plan
alter function clinic_finance.test_plan(text, text) rename to test_plan_pre_patient_credit;

-- VOLATILE like the 'advance' / 'register' wrappers: takes the finance day lock first (pg_advisory_xact_lock(927311)) and then reads fresh.
create function clinic_finance.test_plan(p_type text, p_key text) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare j clinic_reception.journal%rowtype; p clinic_reception.payments%rowtype; pt clinic_reception.patients%rowtype; e clinic_finance.entries%rowtype; sh clinic_finance.shifts%rowtype; reg clinic_finance.registers%rowtype;
  k text[]; pk text[] := array[]::text[]; ents text[] := array[]::text[]; lns text[]; label text; blk jsonb; fk record; cash_account text;
  amt numeric := 0; credit_left numeric := 0;
  n_kind integer := 0; n_partial integer := 0; n_alloc integer := 0; n_other integer := 0; n_req integer := 0; n_refs integer := 0; n_used integer := 0;
  n_method integer := 0; n_mirror integer := 0; n_shape integer := 0; n_shift integer := 0; n_later integer := 0; n_xfer integer := 0; n_short integer := 0;
begin
  if p_type is distinct from 'patient_credit' then return clinic_finance.test_plan_pre_patient_credit(p_type, p_key); end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'حدد السجل'; end if;
  if p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'معرّف السجل غير صالح'; end if;

  perform pg_advisory_xact_lock(927311);
  select * into j from clinic_reception.journal where id = p_key::uuid;
  if not found then return jsonb_build_object('type', p_type, 'key', p_key, 'exists', false, 'label', p_key, 'takes', '[]'::jsonb, 'blockers', '[]'::jsonb); end if;
  k := array[j.id::text];   -- canonical text of the id: the takes below match on id::text
  if j.source <> 'patient_credit' then n_kind := 1; end if;
  amt := coalesce((select sum(l.credit) from clinic_reception.journal_lines l where l.entry_id = j.id and l.account = '2150'), 0);

  select * into p from clinic_reception.payments where id = j.source_id;
  if found then
    pk := array[p.id::text];
    if p.method <> 'cash' then n_method := 1; end if;
    if p.credit_amount <> p.amount or amt <> p.amount then n_partial := 1; end if;
    n_alloc := clinic_finance.test_n('clinic_reception.allocations', 'payment_id', pk);
    n_other := (select count(*)::int from clinic_reception.journal x where x.id <> j.id and (x.source_id = p.id or x.dimensions->>'payment_id' = p.id::text));
    if to_regclass('clinic_reception.requests') is not null then n_req := clinic_finance.test_n('clinic_reception.requests', 'subject_id', pk); end if;
    -- anything else that points at the payment (foreign keys from the catalog, so a table added later is covered too); its proof rows go with it
    for fk in select c.conrelid::regclass::text t, a.attname::text col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'clinic_reception.payments'::regclass and array_length(c.conkey, 1) = 1 loop
      if (fk.t, fk.col) in (('clinic_reception.allocations', 'payment_id'), ('clinic_reception.payment_proofs', 'payment_id')) then continue; end if;
      n_refs := n_refs + clinic_finance.test_n(fk.t, fk.col, pk);
    end loop;
    -- the credit must still be there: the patient's reception 2150 balance (credit = negative balance) covers this amount
    credit_left := -coalesce((select sum(l.debit - l.credit) from clinic_reception.journal_lines l join clinic_reception.journal x on x.id = l.entry_id
                               where x.workspace_id = j.workspace_id and l.account = '2150' and x.dimensions->>'patient_id' = p.patient_id::text), 0);
    if credit_left < amt then n_used := 1; end if;
    select * into pt from clinic_reception.patients where id = p.patient_id;
  else
    n_partial := 1;
  end if;
  label := 'رصيد لصالح المريض ' || coalesce(pt.name, '') || coalesce(' — ملف ' || pt.file_no, '') || ' — ' || amt::text
        || coalesce(' — إيصال ' || nullif(to_jsonb(p)->>'receipt_no', ''), '');

  -- the finance mirror: exactly one 'reception_patient_credit' entry on a shift, drawer cash debit / 2150 credit
  ents := array(select x.id::text from clinic_finance.entries x where x.source_id = j.id);
  if array_length(ents, 1) is distinct from 1 then n_mirror := 1; ents := array[]::text[];
  else
    select * into e from clinic_finance.entries where id = ents[1]::uuid;
    cash_account := (select min(l.account) from clinic_finance.lines l where l.entry_id = e.id and clinic_finance.is_cash_account(l.account) and l.debit = amt and l.credit = 0);
    if e.source <> 'reception_patient_credit' or e.shift_id is null or cash_account is null
       or (select count(*) from clinic_finance.lines l where l.entry_id = e.id) <> 2
       or not exists(select 1 from clinic_finance.lines l where l.entry_id = e.id and l.account = '2150' and l.credit = amt and l.debit = 0) then
      n_shape := 1;
    else
      select * into sh from clinic_finance.shifts where id = e.shift_id;
      select * into reg from clinic_finance.registers where id = sh.register_id;
      label := label || ' — ' || 'خزينة ' || reg.name || ' — قيد رقم ' || e.event_no::text;
      if sh.status <> 'open' or sh.closed_at is not null then n_shift := 1; end if;
      n_later := (select count(*)::int from clinic_finance.shifts s where s.register_id = sh.register_id and s.id <> sh.id
                   and (s.opened_at > e.created_at or s.ended_at > e.created_at or s.closed_at > e.created_at));
      n_xfer := (select count(*)::int from clinic_finance.treasury_transfers t where t.from_shift = sh.id and t.status <> 'rejected');
      if to_regclass('clinic_finance.peer_handovers') is not null then
        execute 'select $1 + count(*)::int from clinic_finance.peer_handovers h where h.from_shift = $2 and h.status in (''pending'', ''accepted'')' into n_xfer using n_xfer, sh.id;
      end if;
      if clinic_finance.cash_limit(sh.id) < amt then n_short := 1; end if;
    end if;
  end if;

  lns := array(select l.id::text from clinic_finance.lines l where l.entry_id::text = any(ents));
  blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
    ('not_credit', 'السجل ليس «رصيد لصالح المريض» من تحصيل استقبال', n_kind),
    ('partial', 'الدفعة لم تتحول كلها لرصيد (جزء منها على فاتورة أو باكج)', n_partial),
    ('allocations', 'الدفعة موزعة على فاتورة أو باكج', n_alloc),
    ('other_events', 'حركات استقبال أخرى على نفس الدفعة (استرداد، باكج، إشعار دائن)', n_other),
    ('requests', 'طلب استرداد أو إشعار دائن على الدفعة', n_req),
    ('payment_refs', 'الدفعة مستخدمة في بيانات أخرى', n_refs),
    ('credit_used', 'رصيد المريض استُخدم على فاتورة أو استُرد (المتبقي أقل من المبلغ)', n_used),
    ('non_cash', 'الدفعة ليست نقدية (شبكة أو تحويل أو محفظة تحتاج تسوية بنك أو شبكة)', n_method),
    ('mirror', 'الرصيد ليس له قيد واحد في دفاتر الحسابات', n_mirror),
    ('entry_shape', 'قيد الرصيد ليس بالشكل المتوقع (قيد واحد على وردية: نقدية الخزينة مدين / 2150 دائن بكامل المبلغ)', n_shape),
    ('shift_closed', 'وردية الخزينة أُقفلت أو رُوجعت', n_shift),
    ('later_shifts', 'وردية أخرى على نفس الخزينة فُتحت أو انتهت بعد الرصيد (رصيدها يشمل المبلغ)', n_later),
    ('transfers', 'على وردية الرصيد تسليم نقدية معلّق أو مُنفَّذ', n_xfer),
    ('cash_short', 'نقدية الرصيد ليست كاملة في الخزينة (سُلِّمت أو صُرفت)', n_short),
    ('journal_corrections', 'قيود تصحيح أو عكس على قيد الرصيد', clinic_finance.test_n('clinic_finance.journal_corrections', 'entry_id', ents) + clinic_finance.test_n('clinic_finance.manual_batches', 'entry_id', ents)
        + case when to_regclass('clinic_finance.manual_batches') is null then 0 else (select count(*)::int from clinic_finance.manual_batches m where m.status <> 'rejected' and m.payload->>'entry_id' = any(ents)) end),
    ('bank_match', 'سطور قيد الرصيد مطابَقة مع كشف بنك', clinic_finance.test_n('clinic_finance.bank_rows', 'line_id', lns) + clinic_finance.test_n('clinic_finance.bank_group_matches', 'line_id', lns)),
    ('closed_period', 'قيد الرصيد داخل فترة مالية مقفلة', (select count(*)::int from clinic_finance.entries x where x.id::text = any(ents) and x.business_date <= coalesce((select max(closed_through) from clinic_finance.periods), '0001-01-01'::date))
        + case when (j.created_at at time zone 'Africa/Cairo')::date <= coalesce((select max(closed_through) from clinic_finance.periods), '0001-01-01'::date) then 1 else 0 end)
  ) as t(c, l, x) where x > 0);

  return jsonb_build_object('type', p_type, 'key', p_key, 'exists', true, 'label', label, 'blockers', blk, 'takes', jsonb_build_array(
    jsonb_build_object('table', 'clinic_finance.lines', 'col', 'entry_id', 'vals', to_jsonb(ents)),
    jsonb_build_object('table', 'clinic_finance.entries', 'col', 'id', 'vals', to_jsonb(ents)),
    jsonb_build_object('table', 'clinic_reception.journal_lines', 'col', 'entry_id', 'vals', to_jsonb(k)),
    jsonb_build_object('table', 'clinic_reception.journal', 'col', 'id', 'vals', to_jsonb(k)),
    jsonb_build_object('table', 'clinic_reception.payment_proofs', 'col', 'payment_id', 'vals', to_jsonb(pk)),
    jsonb_build_object('table', 'clinic_reception.payments', 'col', 'id', 'vals', to_jsonb(pk))));
end $$;

-- ------------------------------------------------------------------ the search box
alter function public.clinic_finance_test_find(text, text) set schema clinic_finance;
alter function clinic_finance.clinic_finance_test_find(text, text) rename to test_find_pre_patient_credit;

create function public.clinic_finance_test_find(p_type text, p_q text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare raw text := replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', ''); q text; r jsonb;
begin
  perform clinic_finance.test_owner();
  if p_type is distinct from 'patient_credit' then return clinic_finance.test_find_pre_patient_credit(p_type, p_q); end if;
  q := '%' || raw || '%';
  select coalesce(jsonb_agg(jsonb_build_object('key', g.id, 'label', 'رصيد لصالح المريض ' || coalesce(g.pname, '') || ' — ' || g.amount::text || ' ج',
      'sub', to_char(g.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') || coalesce(' — ملف ' || g.file_no, '') || coalesce(' — إيصال ' || g.receipt_no, '')
        || coalesce(' — خزينة ' || g.rname, '') || coalesce(' — قيد رقم ' || g.event_no::text, ''),
      'flagged', clinic_finance.test_is_flagged('patient_credit', g.id::text)) order by g.created_at desc), '[]'::jsonb) into r
  from (select j.id, j.created_at, pt.name pname, pt.file_no, nullif(to_jsonb(p)->>'receipt_no', '') receipt_no, p.amount, e.event_no, rg.name rname
        from clinic_reception.journal j
        left join clinic_reception.payments p on p.id = j.source_id
        left join clinic_reception.patients pt on pt.id = p.patient_id
        left join clinic_finance.entries e on e.source_id = j.id and e.source = 'reception_patient_credit'
        left join clinic_finance.shifts s on s.id = e.shift_id
        left join clinic_finance.registers rg on rg.id = s.register_id
        where j.source = 'patient_credit'
          and (pt.name ilike q or pt.file_no ilike q or p.reference ilike q or coalesce(to_jsonb(p)->>'receipt_no', '') ilike q or rg.name ilike q
               or e.event_no::text = raw or j.id::text = lower(raw))
        order by j.created_at desc limit 25) g;
  return r;
end $$;

-- privileges: exactly as before (public RPC = authenticated only, re-checks the owner role itself; helpers = nobody)
revoke all on function public.clinic_finance_test_find(text, text) from public, anon;
grant execute on function public.clinic_finance_test_find(text, text) to authenticated;
revoke all on function clinic_finance.test_plan(text, text), clinic_finance.test_plan_pre_patient_credit(text, text), clinic_finance.test_find_pre_patient_credit(text, text) from public, anon, authenticated;

commit;
