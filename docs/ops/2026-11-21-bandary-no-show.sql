-- Mark the mistaken visit of P-2026-001919 as «لم يحضر» — owner «اوكي» (main chat 4, 2026-11-21), AFTER the money was reversed with the existing
-- «إلغاء خدمة اتدخلت بالغلط» (service_void) request on invoice no 16 (81fe5cde…) and that request was APPROVED by a second reviewer.
-- What it changes (nothing else):
--   * clinic_reception.appointments 18f5ad93-3483-469e-8e18-93522180693c: status 'completed' -> 'no_show'
--   * its clinic_reception.visits row (e0f99c12…): close_note = Arabic reason + the approved service_void request id. Visit status stays 'completed'
--     (the table allows only open / completed), the archive visit RX-42 (public.patient_visits) is LEFT AS IS (owner decision).
--   * No ledger row, invoice, order or payment is touched here: the approved service_void already posted the counter-entries.
-- Both rows are copied first (full to_jsonb) into ops_backup.bandary_no_show_20261121. One transaction; any guard failure = nothing changes.

-- ===================== 0. PREVIEW (read-only) =====================
-- select a.id, a.status, v.id visit_id, v.status visit_status, v.close_note, i.id invoice_id, i.amount, o.status order_status,
--        (select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount)) from clinic_reception.requests r where r.kind = 'service_void' and r.subject_id = i.id) voids
--   from clinic_reception.appointments a join clinic_reception.visits v on v.appointment_id = a.id
--   join clinic_reception.orders o on o.visit_id = v.id join clinic_reception.invoices i on i.order_id = o.id
--  where a.id = '18f5ad93-3483-469e-8e18-93522180693c';

-- ===================== 1. APPLY =====================
begin;
create schema if not exists ops_backup;
revoke all on schema ops_backup from public, anon, authenticated;
create table if not exists ops_backup.bandary_no_show_20261121(id bigint generated always as identity primary key, source_table text not null, row_data jsonb not null, saved_at timestamptz not null default now());
revoke all on ops_backup.bandary_no_show_20261121 from public, anon, authenticated;

do $$
declare a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; inv uuid; req uuid; n integer;
begin
  select * into a from clinic_reception.appointments where id = '18f5ad93-3483-469e-8e18-93522180693c' for update;
  if not found then raise exception 'الموعد غير موجود'; end if;
  if a.status <> 'completed' then raise exception 'الموعد حالته % مش completed — اتعدل قبل كده؟ مفيش تغيير', a.status; end if;
  select * into v from clinic_reception.visits where appointment_id = a.id for update;
  if not found or v.id::text not like 'e0f99c12%' then raise exception 'الزيارة المربوطة بالموعد مش الزيارة المتوقعة (e0f99c12…)'; end if;

  -- the invoice of this visit must be 81fe5cde… and it must carry an APPROVED service_void
  select count(*)::int, min(i.id::text)::uuid into n, inv from clinic_reception.invoices i join clinic_reception.orders o on o.id = i.order_id where o.visit_id = v.id and i.kind = 'service';
  if n <> 1 or inv::text not like '81fe5cde%' then raise exception 'فاتورة الزيارة مش الفاتورة المتوقعة (81fe5cde…)'; end if;
  select r.id into req from clinic_reception.requests r where r.kind = 'service_void' and r.subject_id = inv and r.status = 'approved' order by r.created_at desc limit 1;
  if req is null then raise exception 'طلب «إلغاء خدمة اتدخلت بالغلط» على الفاتورة لسه مااتعتمدش — اعتمده الأول ثم شغّل الملف'; end if;
  if exists(select 1 from clinic_reception.orders o where o.visit_id = v.id and o.status <> 'cancelled') then raise exception 'فيه خدمة في الزيارة لسه مش ملغاة'; end if;

  insert into ops_backup.bandary_no_show_20261121(source_table, row_data) values ('clinic_reception.appointments', to_jsonb(a)), ('clinic_reception.visits', to_jsonb(v));

  update clinic_reception.appointments set status = 'no_show' where id = a.id and status = 'completed';
  get diagnostics n = row_count; if n <> 1 then raise exception 'تحديث الموعد فشل'; end if;
  update clinic_reception.visits set close_note = 'زيارة مسجلة بالخطأ — المريض لم يحضر (قرار المالك 2026-11-21) — طلب إلغاء الخدمة ' || req::text
         || coalesce(' — ملاحظة سابقة: ' || nullif(v.close_note, ''), '') where id = v.id;
  get diagnostics n = row_count; if n <> 1 then raise exception 'تحديث الزيارة فشل'; end if;
  raise notice 'OK: appointment % -> no_show, visit % noted with request %', a.id, v.id, req;
end $$;
commit;

-- ===================== 2. VERIFY =====================
-- select a.status, v.status, v.close_note from clinic_reception.appointments a join clinic_reception.visits v on v.appointment_id = a.id where a.id = '18f5ad93-3483-469e-8e18-93522180693c';
-- select source_table, row_data->>'status' from ops_backup.bandary_no_show_20261121;
-- ===================== UNDO (only if needed) =====================
-- update clinic_reception.appointments a set status = b.row_data->>'status' from ops_backup.bandary_no_show_20261121 b where b.source_table = 'clinic_reception.appointments' and a.id = (b.row_data->>'id')::uuid;
-- update clinic_reception.visits v set close_note = b.row_data->>'close_note' from ops_backup.bandary_no_show_20261121 b where b.source_table = 'clinic_reception.visits' and v.id = (b.row_data->>'id')::uuid;
