-- «حذف سجل تجريبي» — OWNER-ONLY, safe removal of TEST records (owner request 2026-11-09, after the manual cleanup kept in schema test_cleanup_20261109).
-- Flow: (1) the owner FLAGS a record as «تجريبي» (reason + typed confirmation)  (2) later DELETES it (reason + typed confirmation).
--   * Only an active super_admin (the owner role) can call any of it. Financial manager / admins / accountants are refused (errcode 42501).
--   * Only records that carry an ACTIVE test flag can be deleted. Unflagged data is never deletable, whatever its content.
--   * Refused (clear Arabic reason, nothing touched) when the record is tied to real activity: payments, refunds/requests, insurance claims, entity claims, advances, doctor payouts
--     (doctor_payouts / doctor_payout_invoices), stock movements/lots/counts/transfers, closed financial periods, shift-linked entries, other un-flagged records. Unknown dependents are caught by the foreign keys: the whole statement rolls back.
--   * Every deletion first copies the FULL rows (to_jsonb) into the append-only archive (who / when / why / what), then deletes, inside ONE function call = ONE transaction. Any error rolls back archive + deletes together.
--   Supported: invoice (+journal entry/lines/audit/doctor accrual+allocation(+lines)/channel allocation), doctor_contract, doctor_key (whole test doctor: contracts + accruals + allocations(+lines)),
--              inventory_item (+reception item, alerts, price history, catalog price), pricing_supply.
-- ADDITIVE: 3 new tables (RLS closed, no direct grants), helper functions, 5 owner RPCs. No existing table/function is changed. Nothing is deleted by applying this file.
-- Rollback: supabase/rollbacks/20261109110000_test_record_delete.rollback.sql (refuses while the archive/flags hold rows).
begin;

do $$ begin
  if to_regclass('clinic_finance.invoices') is null or to_regclass('clinic_finance.doctor_contracts') is null then raise exception 'طبّق ملفات المحاسبة أولًا'; end if;
  if to_regclass('clinic_finance.doctor_payout_invoices') is null then raise exception 'طبّق ملف صرف الأتعاب بالفاتورة (20261109100000) أولًا'; end if;
  if to_regclass('clinic_finance.test_flags') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- ------------------------------------------------------------------ tables (closed: RLS on, no grants to app roles)
create table clinic_finance.test_flags (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply')),
  record_key text not null check (length(record_key) between 1 and 200),
  label text not null,
  reason text not null check (length(btrim(reason)) >= 5),
  flagged_by uuid not null,
  flagged_at timestamptz not null default now(),
  unflagged_by uuid, unflagged_at timestamptz, unflag_reason text,
  deleted_at timestamptz, deletion_id uuid
);
create unique index test_flags_one_active on clinic_finance.test_flags (record_type, record_key) where unflagged_at is null and deleted_at is null;

create table clinic_finance.test_deletions (
  id uuid primary key default gen_random_uuid(),
  record_type text not null, record_key text not null, label text not null,
  reason text not null, flag_reason text, flagged_by uuid, flagged_at timestamptz,
  deleted_by uuid not null, deleted_at timestamptz not null default now(),
  row_counts jsonb not null default '{}'::jsonb
);
create table clinic_finance.test_deletion_rows (
  id bigint generated always as identity primary key,
  deletion_id uuid not null references clinic_finance.test_deletions(id) deferrable initially deferred,   -- the header row is written after the rows are taken (it carries the counts)
  source_table text not null,
  row_data jsonb not null
);
create index test_deletion_rows_by_deletion on clinic_finance.test_deletion_rows (deletion_id, source_table);
alter table clinic_finance.test_flags enable row level security;
alter table clinic_finance.test_deletions enable row level security;
alter table clinic_finance.test_deletion_rows enable row level security;
revoke all on clinic_finance.test_flags, clinic_finance.test_deletions, clinic_finance.test_deletion_rows from public, anon, authenticated;

-- the archive is append-only
create function clinic_finance.test_archive_guard() returns trigger language plpgsql as $$
begin raise exception 'أرشيف الحذف التجريبي لا يُعدَّل ولا يُحذف'; end $$;
create trigger test_deletions_append_only before update or delete on clinic_finance.test_deletions for each row execute function clinic_finance.test_archive_guard();
create trigger test_deletion_rows_append_only before update or delete on clinic_finance.test_deletion_rows for each row execute function clinic_finance.test_archive_guard();

-- ------------------------------------------------------------------ helpers
create function clinic_finance.test_owner() returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null or not public.has_role('super_admin') then raise exception 'هذه الأداة للمالك فقط (سوبر أدمن)' using errcode = '42501'; end if;
  return me;
end $$;

-- rows of p_table whose column p_col (as text) is in p_vals; 0 when the table does not exist
create function clinic_finance.test_n(p_table text, p_col text, p_vals text[]) returns integer language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  if to_regclass(p_table) is null or coalesce(array_length(p_vals, 1), 0) = 0 then return 0; end if;
  execute format('select count(*)::int from %s t where t.%I::text = any($1)', p_table::regclass, p_col) into n using p_vals;
  return n;
end $$;

-- archive (full rows as jsonb) then delete; returns the number of rows taken
create function clinic_finance.test_take(p_del uuid, p_table text, p_col text, p_vals text[]) returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer; k integer;
begin
  if to_regclass(p_table) is null or coalesce(array_length(p_vals, 1), 0) = 0 then return 0; end if;
  execute format('insert into clinic_finance.test_deletion_rows(deletion_id, source_table, row_data) select $1, $2, to_jsonb(t) from %s t where t.%I::text = any($3)', p_table::regclass, p_col) using p_del, p_table, p_vals;
  get diagnostics n = row_count;
  execute format('delete from %s t where t.%I::text = any($1)', p_table::regclass, p_col) using p_vals;
  get diagnostics k = row_count;
  if k <> n then raise exception 'عدد الصفوف المحذوفة لا يطابق المؤرشف في %', p_table; end if;
  return n;
end $$;

create function clinic_finance.test_is_flagged(p_type text, p_key text) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from clinic_finance.test_flags where record_type = p_type and record_key = p_key and unflagged_at is null and deleted_at is null)
$$;

-- THE PLAN: what the record is, what would be removed (in delete order) and what blocks it. Used by scan, flag and delete so they can never disagree.
-- {exists, label, takes:[{table,col,vals}], blockers:[{code,label,count}]}
create function clinic_finance.test_plan(p_type text, p_key text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare label text; takes jsonb := '[]'::jsonb; blk jsonb := '[]'::jsonb; ex boolean := false;
  k text[] := array[p_key]; ents text[]; invs text[]; items text[];
begin
  if p_type not in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply') then raise exception 'نوع سجل غير مدعوم'; end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'حدد السجل'; end if;
  if p_type <> 'doctor_key' and p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'معرّف السجل غير صالح'; end if;

  if p_type = 'invoice' then
    select 'فاتورة ' || i.reference || coalesce(' — ' || nullif(i.patient_ref, ''), '') || ' — ' || i.amount::text into label from clinic_finance.invoices i where i.id = p_key::uuid;
    ex := found;
    if ex then
      ents := array(select e.id::text from clinic_finance.entries e where e.source = 'invoice' and e.source_id = p_key::uuid);
      blk := blk || (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
          ('payments', 'دفعات مسجلة على الفاتورة', clinic_finance.test_n('clinic_finance.payments', 'invoice_id', k)),
          ('requests', 'طلبات استرداد أو تسوية على الفاتورة', clinic_finance.test_n('clinic_finance.requests', 'invoice_id', k)),
          ('insurance_claims', 'مطالبات تأمين على الفاتورة', clinic_finance.test_n('clinic_finance.insurance_claims', 'invoice_id', k)),
          ('entity_claims', 'مطالبات جهات متعاقدة على الفاتورة', clinic_finance.test_n('clinic_finance.entity_claim_batch_lines', 'invoice_id', k) + clinic_finance.test_n('clinic_finance.entity_service_invoices', 'invoice_id', k)),
          ('advances', 'استخدام سلفة أو عربون على الفاتورة', clinic_finance.test_n('clinic_finance.advance_uses', 'invoice_id', k)),
          ('payout_invoices', 'الفاتورة داخلة في صرف أتعاب دكتور', clinic_finance.test_n('clinic_finance.doctor_payout_invoices', 'invoice_id', k)),
          ('stock', 'الفاتورة صرفت أصنافًا من المخزون', clinic_finance.test_n('clinic_finance.bill_items', 'invoice_id', k)),
          ('journal_corrections', 'قيود تصحيح على قيد الفاتورة', clinic_finance.test_n('clinic_finance.journal_corrections', 'entry_id', ents) + clinic_finance.test_n('clinic_finance.manual_batches', 'entry_id', ents)),
          ('other_entries', 'قيود أخرى مرتبطة بالفاتورة غير قيد الإثبات', (select count(*)::int from clinic_finance.entries e where e.source_id = p_key::uuid and e.source <> 'invoice')),
          ('shift_entries', 'قيد الفاتورة مرتبط بوردية', (select count(*)::int from clinic_finance.entries e where e.source = 'invoice' and e.source_id = p_key::uuid and e.shift_id is not null)),
          ('closed_period', 'قيد الفاتورة داخل فترة مالية مقفلة', (select count(*)::int from clinic_finance.entries e where e.source = 'invoice' and e.source_id = p_key::uuid and e.business_date <= coalesce((select max(closed_through) from clinic_finance.periods), '0001-01-01'::date))),
          ('doctor_payouts', 'الطبيب المنسوب إليه الفاتورة له عمليات صرف', (select count(*)::int from clinic_finance.doctor_payouts q where q.status <> 'rejected' and q.doctor_key in (select a.doctor_key from clinic_finance.doctor_allocations a where a.invoice_id = p_key::uuid union select c.doctor_key from clinic_finance.doctor_accruals c where c.invoice_id = p_key::uuid)))
        ) as t(c, l, x) where x > 0);
      takes := jsonb_build_array(
        jsonb_build_object('table', 'clinic_finance.lines', 'col', 'entry_id', 'vals', to_jsonb(ents)),
        jsonb_build_object('table', 'clinic_finance.entries', 'col', 'id', 'vals', to_jsonb(ents)),
        jsonb_build_object('table', 'clinic_finance.doctor_accruals', 'col', 'invoice_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.doctor_allocation_lines', 'col', 'invoice_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.doctor_extra_allocations', 'col', 'invoice_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.doctor_allocations', 'col', 'invoice_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.channel_allocations', 'col', 'invoice_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.audit', 'col', 'entity_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.invoices', 'col', 'id', 'vals', to_jsonb(k)));
    end if;

  elsif p_type = 'doctor_contract' then
    select 'عقد ' || coalesce(c.doctor_name, c.doctor_key) || ' — ' || c.service_scope || coalesce(' — ' || nullif(c.reference, ''), '') into label from clinic_finance.doctor_contracts c where c.id = p_key::uuid;
    ex := found;
    if ex then
      blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
        ('allocations', 'العقد استُخدم في حساب فواتير', clinic_finance.test_n('clinic_finance.doctor_allocations', 'contract_id', k) + clinic_finance.test_n('clinic_finance.doctor_allocation_lines', 'contract_id', k)),
        ('extra_lines', 'العقد مستخدم في مؤدٍّ إضافي على فاتورة', clinic_finance.test_n('clinic_finance.doctor_extra_lines', 'contract_id', k)),
        ('revisions', 'عقد آخر معدَّل عن هذا العقد', clinic_finance.test_n('clinic_finance.doctor_contracts', 'supersedes', k)),
        ('is_revision', 'العقد تعديل لعقد سابق (حذفه يترك العقد السابق مقصورًا)', (select count(*)::int from clinic_finance.doctor_contracts c where c.id = p_key::uuid and c.supersedes is not null))
      ) as t(c, l, x) where x > 0);
      takes := jsonb_build_array(jsonb_build_object('table', 'clinic_finance.doctor_contracts', 'col', 'id', 'vals', to_jsonb(k)));
    end if;

  elsif p_type = 'doctor_key' then
    select 'الدكتور ' || coalesce((select max(c.doctor_name) from clinic_finance.doctor_contracts c where c.doctor_key = p_key), p_key) || ' (' || p_key || ')' into label;
    ex := exists(select 1 from clinic_finance.doctor_contracts where doctor_key = p_key) or exists(select 1 from clinic_finance.doctor_accruals where doctor_key = p_key) or exists(select 1 from clinic_finance.doctor_allocations where doctor_key = p_key);
    if ex then
      invs := array(select x.i::text from (select a.invoice_id i from clinic_finance.doctor_allocations a where a.doctor_key = p_key union select c.invoice_id from clinic_finance.doctor_accruals c where c.doctor_key = p_key) x);
      blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
        ('payouts', 'للدكتور عمليات صرف أتعاب (doctor_payouts)', clinic_finance.test_n('clinic_finance.doctor_payouts', 'doctor_key', k)),
        ('payout_invoices', 'للدكتور فواتير داخلة في صرف أتعاب', clinic_finance.test_n('clinic_finance.doctor_payout_invoices', 'doctor_key', k)),
        ('real_invoices', 'للدكتور فواتير ليست مُعلَّمة «تجريبي» أو مرتبطة بنشاط حقيقي', (select count(*)::int from unnest(invs) i where not clinic_finance.test_is_flagged('invoice', i) or jsonb_array_length(clinic_finance.test_plan('invoice', i)->'blockers') > 0)),
        ('other_doctors_use', 'عقود الدكتور مستخدمة في فواتير دكتور آخر', (select count(*)::int from clinic_finance.doctor_allocation_lines l join clinic_finance.doctor_contracts c on c.id = l.contract_id where c.doctor_key = p_key and l.invoice_id::text <> all(invs)))
      ) as t(c, l, x) where x > 0);
      takes := jsonb_build_array(
        jsonb_build_object('table', 'clinic_finance.doctor_accruals', 'col', 'doctor_key', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.doctor_allocation_lines', 'col', 'invoice_id', 'vals', to_jsonb(invs)),
        jsonb_build_object('table', 'clinic_finance.doctor_allocations', 'col', 'doctor_key', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.doctor_contracts', 'col', 'doctor_key', 'vals', to_jsonb(k)));
    end if;

  elsif p_type = 'inventory_item' then
    select 'صنف ' || i.name || ' (' || i.sku || ')' into label from public.inventory_items i where i.id = p_key::uuid;
    ex := found;
    if ex then
      items := case when to_regclass('clinic_reception.items') is null then array[]::text[]
                    else array(select r.id::text from clinic_reception.items r where r.inventory_item_id = p_key::uuid or r.code = 'INV-' || p_key) end;
      blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
        ('movements', 'للصنف حركات مخزون', clinic_finance.test_n('public.inventory_movements', 'item_id', k)),
        ('lots', 'للصنف دفعات/أرصدة مخزون', clinic_finance.test_n('public.inventory_lots', 'item_id', k)),
        ('counts', 'الصنف داخل جرد', clinic_finance.test_n('public.inventory_count_lines', 'item_id', k)),
        ('opening', 'للصنف رصيد افتتاحي', clinic_finance.test_n('public.inventory_opening_markers', 'item_id', k)),
        ('requests', 'الصنف داخل طلبات صرف', clinic_finance.test_n('public.inventory_request_lines', 'item_id', k)),
        ('transfers', 'الصنف داخل تحويلات', clinic_finance.test_n('public.inventory_transfer_lines', 'item_id', k)),
        ('bill_items', 'الصنف مصروف على فواتير', clinic_finance.test_n('clinic_finance.bill_items', 'item_id', k)),
        ('patient_supplies', 'الصنف مصروف لمريض', clinic_finance.test_n('clinic_reception.patient_supplies', 'item_id', k)),
        ('reception_stock', 'للصنف حركات أو دفعات أو مشتريات في استقبال العيادة', clinic_finance.test_n('clinic_reception.lots', 'item_id', items) + clinic_finance.test_n('clinic_reception.movements', 'item_id', items) + clinic_finance.test_n('clinic_reception.purchase_lines', 'item_id', items) + clinic_finance.test_n('clinic_reception.transfers', 'item_id', items)),
        ('pricing_supplies', 'مستلزم تسعير مربوط بالصنف (احذف المستلزم التجريبي أولًا)', clinic_finance.test_n('public.pricing_supplies', 'inventory_item_id', k))
      ) as t(c, l, x) where x > 0);
      takes := jsonb_build_array(
        jsonb_build_object('table', 'public.inventory_alerts', 'col', 'item_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'public.inventory_price_history', 'col', 'item_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_finance.inventory_catalog_prices', 'col', 'item_id', 'vals', to_jsonb(k)),
        jsonb_build_object('table', 'clinic_reception.items', 'col', 'id', 'vals', to_jsonb(items)),
        jsonb_build_object('table', 'public.inventory_items', 'col', 'id', 'vals', to_jsonb(k)));
    end if;

  else -- pricing_supply
    select 'مستلزم تسعير ' || s.name into label from public.pricing_supplies s where s.id = p_key::uuid;
    ex := found;
    if ex then
      blk := (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', l, 'count', x)), '[]'::jsonb) from (values
        ('services', 'المستلزم داخل تسعير خدمة (supplies_used)', case when to_regclass('public.pricing_services') is null then 0 else (select count(*)::int from public.pricing_services s where s.supplies_used::text like '%' || p_key || '%') end)
      ) as t(c, l, x) where x > 0);
      takes := jsonb_build_array(jsonb_build_object('table', 'public.pricing_supplies', 'col', 'id', 'vals', to_jsonb(k)));
    end if;
  end if;

  return jsonb_build_object('type', p_type, 'key', p_key, 'exists', ex, 'label', coalesce(label, p_key), 'takes', case when ex then takes else '[]'::jsonb end, 'blockers', blk);
end $$;

create function clinic_finance.test_block_text(p_plan jsonb) returns text language sql immutable set search_path = pg_catalog as $$
  select string_agg(b->>'label' || ' (' || (b->>'count') || ')', '، ') from jsonb_array_elements(p_plan->'blockers') b
$$;

-- what the plan would remove, per table
create function clinic_finance.test_counts(p_plan jsonb) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (
    select x->>'table' t, sum(clinic_finance.test_n(x->>'table', x->>'col', array(select jsonb_array_elements_text(x->'vals'))))::int n
    from jsonb_array_elements(p_plan->'takes') x group by 1) s where n > 0
$$;

-- ------------------------------------------------------------------ owner RPCs
-- look up a record to flag (names, not ids)
create function public.clinic_finance_test_find(p_type text, p_q text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare q text := '%' || replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '') || '%'; r jsonb;
begin
  perform clinic_finance.test_owner();
  if p_type = 'invoice' then
    select coalesce(jsonb_agg(jsonb_build_object('key', i.id, 'label', i.reference || coalesce(' — ' || nullif(i.patient_ref, ''), ''), 'sub', i.amount::text || ' ج — ' || to_char(i.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') || case when i.voided then ' — ملغاة' else '' end,
      'flagged', clinic_finance.test_is_flagged('invoice', i.id::text)) order by i.created_at desc), '[]'::jsonb) into r
    from (select * from clinic_finance.invoices where reference ilike q or patient_ref ilike q or description ilike q order by created_at desc limit 25) i;
  elsif p_type = 'doctor_key' then
    select coalesce(jsonb_agg(jsonb_build_object('key', d.k, 'label', coalesce(d.n, d.k), 'sub', d.k || ' — ' || d.c::text || ' عقد', 'flagged', clinic_finance.test_is_flagged('doctor_key', d.k)) order by d.n), '[]'::jsonb) into r
    from (select doctor_key k, max(doctor_name) n, count(*) c from clinic_finance.doctor_contracts group by doctor_key having doctor_key ilike q or max(doctor_name) ilike q order by max(doctor_name) limit 25) d;
  elsif p_type = 'doctor_contract' then
    select coalesce(jsonb_agg(jsonb_build_object('key', c.id, 'label', coalesce(c.doctor_name, c.doctor_key) || ' — ' || c.service_scope, 'sub', c.rate::text || '% — ' || c.status || coalesce(' — ' || nullif(c.reference, ''), ''), 'flagged', clinic_finance.test_is_flagged('doctor_contract', c.id::text)) order by c.created_at desc), '[]'::jsonb) into r
    from (select * from clinic_finance.doctor_contracts where doctor_key ilike q or doctor_name ilike q or reference ilike q or service_scope ilike q order by created_at desc limit 25) c;
  elsif p_type = 'inventory_item' then
    select coalesce(jsonb_agg(jsonb_build_object('key', i.id, 'label', i.name, 'sub', i.sku || ' — ' || coalesce(i.category, ''), 'flagged', clinic_finance.test_is_flagged('inventory_item', i.id::text)) order by i.name), '[]'::jsonb) into r
    from (select * from public.inventory_items where name ilike q or sku ilike q order by name limit 25) i;
  elsif p_type = 'pricing_supply' then
    select coalesce(jsonb_agg(jsonb_build_object('key', s.id, 'label', s.name, 'sub', coalesce(s.category, ''), 'flagged', clinic_finance.test_is_flagged('pricing_supply', s.id::text)) order by s.name), '[]'::jsonb) into r
    from (select * from public.pricing_supplies where name ilike q order by name limit 25) s;
  else raise exception 'نوع سجل غير مدعوم';
  end if;
  return r;
end $$;

-- read-only check: what is it, is it flagged, what would be removed, what blocks it
create function public.clinic_finance_test_scan(p_type text, p_key text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pl jsonb;
begin
  perform clinic_finance.test_owner();
  pl := clinic_finance.test_plan(p_type, p_key);
  return jsonb_build_object('type', p_type, 'key', p_key, 'exists', pl->'exists', 'label', pl->'label', 'flagged', clinic_finance.test_is_flagged(p_type, p_key),
    'blockers', pl->'blockers', 'counts', case when (pl->>'exists')::boolean then clinic_finance.test_counts(pl) else '{}'::jsonb end,
    'deletable', (pl->>'exists')::boolean and jsonb_array_length(pl->'blockers') = 0);
end $$;

create function public.clinic_finance_test_flag(p_type text, p_key text, p_reason text, p_confirm text) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; pl jsonb; v uuid;
begin
  me := clinic_finance.test_owner();
  if btrim(coalesce(p_reason, '')) = '' or length(btrim(p_reason)) < 5 then raise exception 'اكتب سبب اعتبار السجل تجريبيًا (٥ حروف على الأقل)'; end if;
  if btrim(coalesce(p_confirm, '')) <> 'تجريبي' then raise exception 'اكتب كلمة «تجريبي» للتأكيد'; end if;
  perform pg_advisory_xact_lock(hashtext('test_record_delete'));
  pl := clinic_finance.test_plan(p_type, p_key);
  if not (pl->>'exists')::boolean then raise exception 'السجل غير موجود'; end if;
  if clinic_finance.test_is_flagged(p_type, p_key) then raise exception 'السجل مُعلَّم تجريبي بالفعل'; end if;
  if jsonb_array_length(pl->'blockers') > 0 then raise exception 'لا يمكن اعتباره تجريبيًا — مرتبط بنشاط حقيقي: %', clinic_finance.test_block_text(pl); end if;
  insert into clinic_finance.test_flags(record_type, record_key, label, reason, flagged_by) values (p_type, p_key, pl->>'label', btrim(p_reason), me) returning id into v;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'test_record_flagged', v, jsonb_build_object('type', p_type, 'key', p_key, 'label', pl->>'label', 'reason', btrim(p_reason)));
  return v;
end $$;

create function public.clinic_finance_test_unflag(p_type text, p_key text, p_reason text) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v uuid;
begin
  me := clinic_finance.test_owner();
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'اكتب سبب إلغاء علامة «تجريبي»'; end if;
  perform pg_advisory_xact_lock(hashtext('test_record_delete'));
  update clinic_finance.test_flags set unflagged_by = me, unflagged_at = now(), unflag_reason = btrim(p_reason)
   where record_type = p_type and record_key = p_key and unflagged_at is null and deleted_at is null returning id into v;
  if v is null then raise exception 'السجل غير مُعلَّم تجريبي'; end if;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'test_record_unflagged', v, jsonb_build_object('type', p_type, 'key', p_key, 'reason', btrim(p_reason)));
end $$;

-- ONE function call = ONE transaction: archive the full rows, then delete; any error rolls back both.
create function public.clinic_finance_test_delete(p_type text, p_key text, p_reason text, p_confirm text) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; pl jsonb; fl clinic_finance.test_flags%rowtype; del uuid := gen_random_uuid(); x jsonb; n integer; counts jsonb := '{}'::jsonb; cn text; tn text;
begin
  me := clinic_finance.test_owner();
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'اكتب سبب الحذف (٥ حروف على الأقل)'; end if;
  if btrim(coalesce(p_confirm, '')) <> 'حذف' then raise exception 'اكتب كلمة «حذف» للتأكيد'; end if;
  perform pg_advisory_xact_lock(hashtext('test_record_delete'));
  select * into fl from clinic_finance.test_flags where record_type = p_type and record_key = p_key and unflagged_at is null and deleted_at is null for update;
  if not found then raise exception 'السجل غير مُعلَّم «تجريبي»؛ لا يُحذف أي سجل غير معلَّم'; end if;
  pl := clinic_finance.test_plan(p_type, p_key);
  if not (pl->>'exists')::boolean then raise exception 'السجل غير موجود'; end if;
  if jsonb_array_length(pl->'blockers') > 0 then raise exception 'مرفوض — السجل مرتبط بنشاط حقيقي: %', clinic_finance.test_block_text(pl); end if;

  begin
    for x in select * from jsonb_array_elements(pl->'takes') loop
      n := clinic_finance.test_take(del, x->>'table', x->>'col', array(select jsonb_array_elements_text(x->'vals')));
      if n > 0 then counts := counts || jsonb_build_object(x->>'table', coalesce((counts->>(x->>'table'))::int, 0) + n); end if;
    end loop;
  exception when foreign_key_violation then
    get stacked diagnostics cn = constraint_name, tn = table_name;
    raise exception 'مرفوض — السجل مرتبط ببيانات أخرى لا يجوز حذفها (%.%)', tn, cn;
  end;
  insert into clinic_finance.test_deletions(id, record_type, record_key, label, reason, flag_reason, flagged_by, flagged_at, deleted_by, row_counts)
    values (del, p_type, p_key, pl->>'label', btrim(p_reason), fl.reason, fl.flagged_by, fl.flagged_at, me, counts);
  update clinic_finance.test_flags set deleted_at = now(), deletion_id = del where id = fl.id;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'test_record_deleted', del, jsonb_build_object('type', p_type, 'key', p_key, 'label', pl->>'label', 'reason', btrim(p_reason), 'counts', counts));
  return del;
end $$;

create function public.clinic_finance_test_overview() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  perform clinic_finance.test_owner();
  select jsonb_build_object(
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('type', f.record_type, 'key', f.record_key, 'label', f.label, 'reason', f.reason, 'flagged_at', f.flagged_at,
        'flagged_by', (select a.name from public.admins a where a.id = f.flagged_by), 'scan', public.clinic_finance_test_scan(f.record_type, f.record_key)) order by f.flagged_at desc), '[]'::jsonb)
      from clinic_finance.test_flags f where f.unflagged_at is null and f.deleted_at is null),
    'deletions', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'type', d.record_type, 'label', d.label, 'reason', d.reason, 'deleted_at', d.deleted_at, 'counts', d.row_counts,
        'deleted_by', (select a.name from public.admins a where a.id = d.deleted_by)) order by d.deleted_at desc), '[]'::jsonb)
      from (select * from clinic_finance.test_deletions order by deleted_at desc limit 30) d)) into r;
  return r;
end $$;

-- privileges: authenticated only (the functions re-check the owner role themselves); never anon/public
revoke all on function public.clinic_finance_test_find(text, text), public.clinic_finance_test_scan(text, text), public.clinic_finance_test_flag(text, text, text, text),
  public.clinic_finance_test_unflag(text, text, text), public.clinic_finance_test_delete(text, text, text, text), public.clinic_finance_test_overview() from public, anon;
grant execute on function public.clinic_finance_test_find(text, text), public.clinic_finance_test_scan(text, text), public.clinic_finance_test_flag(text, text, text, text),
  public.clinic_finance_test_unflag(text, text, text), public.clinic_finance_test_delete(text, text, text, text), public.clinic_finance_test_overview() to authenticated;
revoke all on function clinic_finance.test_owner(), clinic_finance.test_n(text, text, text[]), clinic_finance.test_take(uuid, text, text, text[]), clinic_finance.test_is_flagged(text, text),
  clinic_finance.test_plan(text, text), clinic_finance.test_block_text(jsonb), clinic_finance.test_counts(jsonb) from public, anon, authenticated;

commit;
