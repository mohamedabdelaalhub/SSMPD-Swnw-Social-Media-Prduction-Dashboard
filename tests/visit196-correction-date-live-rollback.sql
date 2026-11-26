-- DRY-RUN: ends in ROLLBACK, writes nothing.
begin;
-- Move the #901 correction of visit 196 (journal source doctor_fee_platform, event_no 445, 75) to business day 2026-11-26.
-- Owner order «خلّي التصحيح يوم ٢٦». Touches exactly one clinic_reception.journal row (created_at) and its clinic_finance.entries
-- mirror (business_date). Refuses if 2026-11-26 is inside a closed financial period, or if the row is not exactly what we expect.
do $$
declare j record; e record; amt numeric; vno bigint; closed date; new_at timestamptz; n int;
begin
  select * into j from clinic_reception.journal where event_no = 445 and source = 'doctor_fee_platform';
  if not found then raise exception 'قيد التصحيح 445 مش موجود'; end if;
  select v.visit_no into vno from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id where o.id = j.source_id;
  if vno is distinct from 196 then raise exception 'القيد 445 مش بتاع زيارة 196 (زيارة %)', vno; end if;
  select coalesce(sum(debit), 0) into amt from clinic_reception.journal_lines where entry_id = j.id and account = '2120';
  if amt <> 75 then raise exception 'مبلغ القيد 445 % مش 75', amt; end if;
  select * into e from clinic_finance.entries where id = j.finance_entry_id and source = 'reception_doctor_fee_platform';
  if not found then raise exception 'القيد المقابل في الحسابات مش موجود'; end if;
  select max(closed_through) into closed from clinic_finance.periods;
  raise notice 'day-closed check: last closed period through % — 2026-11-26 closed: %', coalesce(closed::text, 'none'), coalesce(closed >= date '2026-11-26', false);
  if closed >= date '2026-11-26' then raise exception 'يوم 26-11 داخل فترة مالية مقفلة — مش هنحرك التصحيح'; end if;
  -- the original doctor_fee posting of the same order, one second after it (keeps it on the 26th, right after the fee)
  select created_at + interval '1 second' into new_at from clinic_reception.journal
   where workspace_id = j.workspace_id and source = 'doctor_fee' and source_id = j.source_id;
  if new_at is null or (new_at at time zone 'Africa/Cairo')::date <> date '2026-11-26' then
    new_at := timestamptz '2026-11-26 23:59:00 Africa/Cairo';
  end if;
  raise notice 'BEFORE: journal 445 created_at % (Cairo day %), entries.business_date %', j.created_at, (j.created_at at time zone 'Africa/Cairo')::date, e.business_date;
  update clinic_reception.journal set created_at = new_at where id = j.id; get diagnostics n = row_count;
  if n <> 1 then raise exception 'journal rows updated: %', n; end if;
  update clinic_finance.entries set business_date = date '2026-11-26' where id = e.id; get diagnostics n = row_count;
  if n <> 1 then raise exception 'entries rows updated: %', n; end if;
  select * into j from clinic_reception.journal where id = j.id;
  select * into e from clinic_finance.entries where id = e.id;
  raise notice 'AFTER: journal 445 created_at % (Cairo day %), entries.business_date %', j.created_at, (j.created_at at time zone 'Africa/Cairo')::date, e.business_date;
end $$;
rollback;
