-- «سجلات تجريبية — حذف آمن» (20261109130000) learns one more record type: 'advance' = a TEST booking advance «مقدم حجز» (owner request 2026-11-18).
-- Same flow and same guarantees as the other types: owner only (super_admin) -> FLAG (reason + «تجريبي») -> DELETE (reason + «حذف»), full rows archived first, one transaction, audited.
-- Key = clinic_finance.advances.id (same as the other uuid-keyed types). Found by reference / patient reference in the search box.
--
-- An advance is deletable ONLY when it is provably unused:
--   * no clinic_finance.advance_uses row of any kind/status (never applied to an invoice, no refund request — pending or not)
--   * not linked to a patient booking (booking_id is null)
--   * posted advances: CASH only, with exactly ONE receipt entry (source 'advance_receipt', source_id = advance id) made of the drawer cash debit + 2150 credit for the full amount.
--     A posted network / bank / wallet / legacy-opening advance is refused (it needs a bank or POS settlement decision, not this tool). An advance that never reached the books
--     (pending / rejected, no entry) has nothing to undo and is deletable.
--   * the receipt's shift is still open and never counted (not ended / closed), no other shift of the same drawer was opened / ended / closed after the receipt (their stored
--     opening balance or count would include the money), no pending or executed cash handover out of that shift, and the drawer still holds at least the amount (cash_limit).
--   * no closed financial period, no journal correction / reversal, no bank-statement match on the entries that would be removed.
--
-- THE TREASURY BINDING ENTRY. A receipt posted BEFORE its drawer was bound to its own cash account sits on the shared legacy account 1111. Binding the drawer later
-- (clinic_finance.initial_treasury_binding, 20261019001000) wrote ONE shift-less entry (source 'treasury_binding', source_id = register id) that moved the drawer's whole
-- pre-binding balance from 1111 to the drawer account. The operational figures (treasury_balance / cash_limit / shift_cash) read shift-linked lines only, so they never see
-- that entry; the general ledger does. Deleting only the receipt would therefore leave 1111 at -amount and the drawer account at +amount for money that never existed.
-- So: when the binding entry of that drawer moved EXACTLY this advance and nothing else (the receipt is the only shift-linked cash entry of the drawer before the binding,
-- and the binding entry is exactly drawer-account debit / 1111 credit for the advance amount) the plan removes the binding entry + its 2 lines together with the receipt,
-- which is exactly the ledger a binding with a zero balance produces (no entry at all). If the binding moved anything else too, the advance is REFUSED (binding_mixed):
-- this tool never edits an entry, an accountant settles it. A receipt posted after the binding is already on the drawer account and needs nothing extra.
-- The register's own audit row 'treasury_first_binding' is history and is left as it is (its entry id then points at the archived copy).
--
-- ADDITIVE and small: test_plan and clinic_finance_test_find are WRAPPED (the 20261109130000 bodies are kept untouched as *_base and still serve every other type),
-- and the record_type check of test_flags accepts 'advance'. Nothing is flagged or deleted by applying this file.
-- Rollback: supabase/rollbacks/20261118190000_test_tool_booking_advance.rollback.sql (refuses while a flag / deletion of type 'advance' exists).
begin;

do $$ begin
  if to_regclass('clinic_finance.test_flags') is null or to_regprocedure('clinic_finance.test_plan(text,text)') is null then raise exception 'طبّق ملف حذف السجلات التجريبية (20261109130000) أولًا'; end if;
  if to_regclass('clinic_finance.advances') is null or to_regclass('clinic_finance.advance_uses') is null then raise exception 'طبّق ملف مقدمات الحجز (20261017013522) أولًا'; end if;
  if to_regprocedure('clinic_finance.is_cash_account(text)') is null or to_regclass('clinic_finance.treasury_transfers') is null then raise exception 'طبّق ملفات الخزينة (20261018205000 و 20261019001000) أولًا'; end if;
  if to_regprocedure('clinic_finance.test_plan_base(text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_finance.test_flags drop constraint test_flags_record_type_check;
alter table clinic_finance.test_flags add constraint test_flags_record_type_check check (record_type in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply', 'advance'));

-- ------------------------------------------------------------------ the plan
alter function clinic_finance.test_plan(text, text) rename to test_plan_base;

-- VOLATILE on purpose (the base stays STABLE): for an advance the plan first takes the finance day lock (the advisory lock every cash command takes in clinic_finance.lock_day)
-- and then reads with fresh snapshots, so a handover / shift end / refund committed a moment earlier is seen and nothing can slip in between the plan and the delete.
create function clinic_finance.test_plan(p_type text, p_key text) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.advances%rowtype; label text; blk jsonb; k text[] := array[p_key];
  ents text[]; binds text[] := array[]::text[]; allents text[]; lns text[];
  e clinic_finance.entries%rowtype; b clinic_finance.entries%rowtype; sh clinic_finance.shifts%rowtype; reg clinic_finance.registers%rowtype;
  cash_account text; posted integer; others integer;
  n_shape integer := 0; n_shift integer := 0; n_later integer := 0; n_xfer integer := 0; n_short integer := 0; n_bind integer := 0;
begin
  if p_type is distinct from 'advance' then return clinic_finance.test_plan_base(p_type, p_key); end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'حدد السجل'; end if;
  if p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'معرّف السجل غير صالح'; end if;

  perform pg_advisory_xact_lock(927311);
  select * into a from clinic_finance.advances where id = p_key::uuid;
  if not found then return jsonb_build_object('type', p_type, 'key', p_key, 'exists', false, 'label', p_key, 'takes', '[]'::jsonb, 'blockers', '[]'::jsonb); end if;
  k := array[a.id::text];   -- canonical text of the id: the takes below match on id::text
  label := 'مقدم حجز ' || a.reference || coalesce(' — ' || nullif(a.patient_ref, a.reference), '') || ' — ' || a.amount::text;

  ents := array(select x.id::text from clinic_finance.entries x where x.source = 'advance_receipt' and x.source_id = a.id);
  posted := (select count(*)::int from clinic_finance.entries x where x.source_id = a.id);
  others := posted - coalesce(array_length(ents, 1), 0);

  -- a posted CASH advance: the receipt must be exactly what this tool knows how to undo, and its money must still be (on paper) in the same open, uncounted drawer
  if a.method = 'cash' and posted > 0 and others = 0 then
    if array_length(ents, 1) = 1 then select * into e from clinic_finance.entries where id = ents[1]::uuid; end if;
    cash_account := (select min(l.account) from clinic_finance.lines l where l.entry_id = e.id and clinic_finance.is_cash_account(l.account) and l.debit = a.amount and l.credit = 0);
    if e.id is null or e.shift_id is null or cash_account is null
       or (select count(*) from clinic_finance.lines l where l.entry_id = e.id) <> 2
       or not exists(select 1 from clinic_finance.lines l where l.entry_id = e.id and l.account = '2150' and l.credit = a.amount and l.debit = 0) then
      n_shape := 1;
    else
      select * into sh from clinic_finance.shifts where id = e.shift_id;
      select * into reg from clinic_finance.registers where id = sh.register_id;
      if sh.status <> 'open' or sh.ended_at is not null or sh.closed_at is not null then n_shift := 1; end if;
      n_later := (select count(*)::int from clinic_finance.shifts s where s.register_id = sh.register_id and s.id <> sh.id
                   and (s.opened_at > e.created_at or s.ended_at > e.created_at or s.closed_at > e.created_at));
      n_xfer := (select count(*)::int from clinic_finance.treasury_transfers t where t.from_shift = sh.id and t.status <> 'rejected');
      if to_regclass('clinic_finance.peer_handovers') is not null then
        execute 'select $1 + count(*)::int from clinic_finance.peer_handovers h where h.from_shift = $2 and h.status in (''pending'', ''accepted'')' into n_xfer using n_xfer, sh.id;
      end if;
      if clinic_finance.cash_limit(sh.id) < a.amount then n_short := 1; end if;
      -- receipt still on the legacy account of a drawer that now has its own account => the binding entry carried it; take that entry only when it carried nothing else
      if cash_account = '1111' and reg.account_code is not null and reg.account_code <> '1111' then
        binds := array(select x.id::text from clinic_finance.entries x where x.source = 'treasury_binding' and x.source_id = reg.id);
        if array_length(binds, 1) = 1 then select * into b from clinic_finance.entries where id = binds[1]::uuid; end if;
        if b.id is null or b.shift_id is not null or b.event_no <= e.event_no
           or (select count(*) from clinic_finance.lines l where l.entry_id = b.id) <> 2
           or not exists(select 1 from clinic_finance.lines l where l.entry_id = b.id and l.account = reg.account_code and l.debit = a.amount and l.credit = 0)
           or not exists(select 1 from clinic_finance.lines l where l.entry_id = b.id and l.account = '1111' and l.credit = a.amount and l.debit = 0)
           or exists(select 1 from clinic_finance.lines l join clinic_finance.entries x on x.id = l.entry_id join clinic_finance.shifts s on s.id = x.shift_id
                      where s.register_id = reg.id and clinic_finance.is_cash_account(l.account) and x.event_no < b.event_no and x.id <> e.id) then
          n_bind := 1; binds := array[]::text[];
        else
          label := label || ' (+ قيد ربط عهدة الخزينة ' || a.amount::text || ')';
        end if;
      end if;
    end if;
  end if;

  allents := ents || binds;
  lns := array(select l.id::text from clinic_finance.lines l where l.entry_id::text = any(allents));
  blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
    ('uses', 'المقدم مستخدم على فاتورة أو عليه طلب استرداد', clinic_finance.test_n('clinic_finance.advance_uses', 'advance_id', k)),
    ('refund_pending', 'طلب استرداد للمقدم ما زال معلّقًا', (select count(*)::int from clinic_finance.advance_uses u where u.advance_id = a.id and u.kind = 'refund' and u.status = 'pending')),
    ('booking', 'المقدم مربوط بحجز مريض', case when a.booking_id is null then 0 else 1 end),
    ('non_cash_posted', 'مقدم شبكة أو تحويل أو محفظة مُرحَّل في الدفاتر (حذفه يحتاج تسوية بنك أو شبكة)', case when a.method <> 'cash' then posted else 0 end),
    ('other_entries', 'قيود أخرى مرتبطة بالمقدم غير قيد الاستلام', case when a.method = 'cash' then others else 0 end),
    ('receipt_shape', 'قيد استلام المقدم ليس بالشكل المتوقع (قيد واحد على وردية: نقدية الخزينة مدين / 2150 دائن بكامل المبلغ)', n_shape),
    ('shift_closed', 'وردية المقدم انتهت أو أُقفلت (النقدية دخلت في جرد أو تسليم)', n_shift),
    ('later_shifts', 'وردية أخرى على نفس الخزينة فُتحت أو انتهت بعد استلام المقدم (رصيدها يشمل المبلغ)', n_later),
    ('transfers', 'على وردية المقدم تسليم نقدية معلّق أو مُنفَّذ', n_xfer),
    ('cash_short', 'نقدية المقدم ليست كاملة في الخزينة (سُلِّمت أو صُرفت)', n_short),
    ('binding_mixed', 'قيد ربط عهدة الخزينة يشمل حركات نقدية أخرى مع المقدم (يحتاج تسوية محاسبية)', n_bind),
    ('journal_corrections', 'قيود تصحيح أو عكس على قيد المقدم', clinic_finance.test_n('clinic_finance.journal_corrections', 'entry_id', allents) + clinic_finance.test_n('clinic_finance.manual_batches', 'entry_id', allents)
        + (select count(*)::int from clinic_finance.manual_batches m where m.status <> 'rejected' and m.payload->>'entry_id' = any(allents))),
    ('bank_match', 'سطور قيد المقدم مطابَقة مع كشف بنك', clinic_finance.test_n('clinic_finance.bank_rows', 'line_id', lns) + clinic_finance.test_n('clinic_finance.bank_group_matches', 'line_id', lns)),
    ('closed_period', 'قيد المقدم داخل فترة مالية مقفلة', (select count(*)::int from clinic_finance.entries x where x.id::text = any(allents) and x.business_date <= coalesce((select max(closed_through) from clinic_finance.periods), '0001-01-01'::date)))
  ) as t(c, l, x) where x > 0);

  return jsonb_build_object('type', p_type, 'key', p_key, 'exists', true, 'label', label, 'blockers', blk, 'takes', jsonb_build_array(
    jsonb_build_object('table', 'clinic_finance.lines', 'col', 'entry_id', 'vals', to_jsonb(allents)),
    jsonb_build_object('table', 'clinic_finance.entries', 'col', 'id', 'vals', to_jsonb(allents)),
    jsonb_build_object('table', 'clinic_finance.advance_proofs', 'col', 'advance_id', 'vals', to_jsonb(k)),
    jsonb_build_object('table', 'clinic_finance.audit', 'col', 'entity_id', 'vals', to_jsonb(k)),
    jsonb_build_object('table', 'clinic_finance.advances', 'col', 'id', 'vals', to_jsonb(k))));
end $$;

-- ------------------------------------------------------------------ the search box
alter function public.clinic_finance_test_find(text, text) set schema clinic_finance;
alter function clinic_finance.clinic_finance_test_find(text, text) rename to test_find_base;

create function public.clinic_finance_test_find(p_type text, p_q text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare q text := '%' || replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '') || '%'; r jsonb;
begin
  perform clinic_finance.test_owner();
  if p_type is distinct from 'advance' then return clinic_finance.test_find_base(p_type, p_q); end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', a.id, 'label', 'مقدم حجز ' || a.reference || coalesce(' — ' || nullif(a.patient_ref, a.reference), ''),
      'sub', a.amount::text || ' ج — ' || case a.method when 'cash' then 'نقدي' when 'pos' then 'شبكة' when 'bank' then 'تحويل بنكي' else 'محفظة' end || ' — ' || to_char(a.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')
        || case a.status when 'pending' then ' — في انتظار التحقق' when 'rejected' then ' — مرفوض' else '' end,
      'flagged', clinic_finance.test_is_flagged('advance', a.id::text)) order by a.created_at desc), '[]'::jsonb) into r
  from (select * from clinic_finance.advances where reference ilike q or patient_ref ilike q order by created_at desc limit 25) a;
  return r;
end $$;

-- privileges: exactly as 20261109130000 (public RPC = authenticated only, re-checks the owner role itself; helpers = nobody)
revoke all on function public.clinic_finance_test_find(text, text) from public, anon;
grant execute on function public.clinic_finance_test_find(text, text) to authenticated;
revoke all on function clinic_finance.test_plan(text, text), clinic_finance.test_plan_base(text, text), clinic_finance.test_find_base(text, text) from public, anon, authenticated;

commit;
