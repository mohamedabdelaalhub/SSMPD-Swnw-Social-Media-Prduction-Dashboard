-- «شاشة أرشيف ماسا» (owner 2026-11-21: «موافق على شاشة أرشيف ماسا»). Step 1 = backend read RPC only; the screen is designed first.
-- public.masa_archive_lookup(p jsonb): look a patient up in the copied Masa archive (clinic_reception.masa_patients, both databases) and open
-- the card with the patient's booking history (masa_archive_bookings) and invoices / receipts (clinic_finance.masa_*).
--   {action:'search', q:'name or phone', source?:'old'|'current'}  -> up to 30 patient cards
--   {action:'open', source:'old'|'current', masa_patient_id:'...'} -> card + bookings + invoices + receipts
-- Roles: reception, customer_service, general_manager, super_admin, and finance (clinic_finance.allowed('view')). Every call is logged in
-- clinic_reception.masa_archive_lookup_log (admin, action, source, patient id, result count, search length and kind; the searched text itself is
-- NOT stored). A user who runs more than 120 lookups in 10 minutes is refused (bulk-copy guard). Read only; nothing is changed.
-- Matching: the archive bookings carry only name + phone, so a patient's bookings are those with the same normalized phone AND the same normalized
-- name; bookings on the same phone with another name are only counted (same_phone_other_name) because 353 phones are shared by families.
-- Rollback: supabase/rollbacks/20261120350000_masa_archive_lookup.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.masa_patients') is null or to_regclass('clinic_reception.masa_archive_bookings') is null
     or to_regclass('clinic_finance.masa_invoices') is null or to_regprocedure('clinic_reception.masa_phone_norm(text)') is null
     or to_regprocedure('clinic_finance.allowed(text)') is null or to_regprocedure('public.my_role()') is null or to_regprocedure('public.is_super()') is null then
    raise exception 'مكونات أرشيف ماسا غير موجودة';
  end if;
  if to_regclass('clinic_reception.masa_archive_lookup_log') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.masa_archive_lookup_log(
  id uuid primary key default gen_random_uuid(), admin_id uuid references public.admins(id), action text not null check (action in ('search', 'open')),
  query_kind text check (query_kind in ('phone', 'name')), query_len int, source text, masa_patient_id text, results int,
  created_at timestamptz not null default now());
create index on clinic_reception.masa_archive_lookup_log(admin_id, created_at);
alter table clinic_reception.masa_archive_lookup_log enable row level security;
revoke all on clinic_reception.masa_archive_lookup_log from public, anon, authenticated;

create function clinic_reception.masa_name_norm(v text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(translate(trim(coalesce(v, '')), 'أإآىة', 'ااايه'), '\s+', ' ', 'g')), '')
$$;

create function clinic_reception.masa_booking_state_label(v int) returns text language sql immutable as $$
  select case v when 1 then 'حجز' when 2 then 'حضور' when 3 then 'تغيير ميعاد' when 4 then 'الغاء' when 5 then 'عدم حضور' when 6 then 'قائمة الانتظار'
    when 7 then 'عدم الرد' when 8 then 'متابعة' when 9 then 'تاكيد الحجز' when 10 then 'عند الطبيب' when 11 then 'انهى' else null end
$$;

create function public.masa_archive_lookup(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; act text; q text; src text; pid text; nq text; digits text; kind text; res jsonb; pt clinic_reception.masa_patients; pn text; recent int;
begin
  if not (public.is_super() or public.my_role() in ('reception', 'customer_service', 'general_manager') or clinic_finance.allowed('view')) then
    raise exception 'أرشيف ماسا لموظفي الاستقبال وخدمة العملاء والمالية والإدارة بس' using errcode = '42501';
  end if;
  me := public.my_admin_id();
  p := coalesce(p, '{}');
  act := p->>'action';
  src := nullif(p->>'source', '');
  if src is not null and src not in ('old', 'current') then raise exception 'المصدر old أو current'; end if;
  select count(*) into recent from clinic_reception.masa_archive_lookup_log where admin_id = me and created_at > now() - interval '10 minutes';
  if recent >= 120 then raise exception 'عدد كبير من الاستعلامات، استنى شوية' using errcode = '54000'; end if;

  if act = 'search' then
    q := trim(coalesce(p->>'q', ''));
    digits := regexp_replace(q, '[^0-9]', '', 'g');
    if length(digits) >= 6 and digits = regexp_replace(q, '[ +\-()]', '', 'g') then
      kind := 'phone'; nq := clinic_reception.masa_phone_norm(q);
    else
      kind := 'name'; nq := clinic_reception.masa_name_norm(q);
      if nq is null or length(nq) < 3 then raise exception 'اكتب 3 حروف على الأقل من الاسم أو رقم تليفون'; end if;
    end if;
    select coalesce(jsonb_agg(row_to_json(z)::jsonb), '[]') into res from (
      select m.source, m.masa_patient_id, m.name, m.phone, m.birth_date,
        case when m.birth_date is not null then extract(year from age(current_date, m.birth_date))::int end as age,
        m.insurance_name, m.is_blocked, m.is_deleted, m.masa_created_at,
        (select jsonb_build_object('id', dp.id, 'patient_code', dp.patient_code) from public.patients dp
          where m.phone_normalized is not null and dp.phone_normalized = m.phone_normalized
            and clinic_reception.masa_name_norm(dp.full_name) = clinic_reception.masa_name_norm(m.name) limit 1) as dashboard_patient
      from clinic_reception.masa_patients m
      where (src is null or m.source = src)
        and ((kind = 'phone' and (m.phone_normalized = nq or clinic_reception.masa_phone_norm(m.phone2) = nq or clinic_reception.masa_phone_norm(m.phone3) = nq))
          or (kind = 'name' and not exists (select 1 from unnest(string_to_array(nq, ' ')) t where clinic_reception.masa_name_norm(m.name) not like '%' || t || '%')))
      order by (clinic_reception.masa_name_norm(m.name) = nq) desc, m.masa_created_at desc nulls last limit 30) z;
    insert into clinic_reception.masa_archive_lookup_log(admin_id, action, query_kind, query_len, source, results) values (me, 'search', kind, length(q), src, jsonb_array_length(res));
    return jsonb_build_object('ok', true, 'results', res);

  elsif act = 'open' then
    pid := nullif(trim(p->>'masa_patient_id'), '');
    if pid is null or src is null then raise exception 'المصدر ورقم المريض مطلوبين'; end if;
    select * into pt from clinic_reception.masa_patients where source = src and masa_patient_id = pid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    pn := clinic_reception.masa_name_norm(pt.name);
    select jsonb_build_object('ok', true,
      'patient', jsonb_build_object('source', pt.source, 'masa_patient_id', pt.masa_patient_id, 'name', pt.name, 'phone', pt.phone, 'phone2', pt.phone2, 'phone3', pt.phone3,
        'birth_date', pt.birth_date, 'birth_date_flag', pt.birth_date_flag, 'age', case when pt.birth_date is not null then extract(year from age(current_date, pt.birth_date))::int end,
        'address', pt.address, 'job', pt.job, 'insurance_name', pt.insurance_name, 'insurance_no', pt.insurance_no, 'relative_name', pt.relative_name, 'relative_phone', pt.relative_phone,
        'membership_no', pt.membership_no, 'is_blocked', pt.is_blocked, 'is_deleted', pt.is_deleted, 'masa_created_at', pt.masa_created_at,
        'dashboard_patient', (select jsonb_build_object('id', dp.id, 'patient_code', dp.patient_code) from public.patients dp
           where dp.id = pt.patient_id or (pt.phone_normalized is not null and dp.phone_normalized = pt.phone_normalized and clinic_reception.masa_name_norm(dp.full_name) = pn) limit 1)),
      'bookings', coalesce((select jsonb_agg(jsonb_build_object('official_booking_id', b.official_booking_id, 'date', b.appointment_date, 'time', nullif(b.appointment_time, '00:00'),
          'doctor_id', b.masa_doctor_id, 'service', b.needed_service, 'status', b.status, 'state_id', b.booking_state_id,
          'state', clinic_reception.masa_booking_state_label(b.booking_state_id)) order by b.appointment_date desc, b.official_booking_id)
        from (select * from clinic_reception.masa_archive_bookings b0 where b0.source = pt.source and clinic_reception.masa_name_norm(b0.patient_name) = pn
            and b0.phone_normalized is not null and b0.phone_normalized in (clinic_reception.masa_phone_norm(pt.phone), clinic_reception.masa_phone_norm(pt.phone2), clinic_reception.masa_phone_norm(pt.phone3))
          order by b0.appointment_date desc limit 500) b), '[]'),
      'same_phone_other_name', (select count(*) from clinic_reception.masa_archive_bookings b0 where b0.source = pt.source and b0.phone_normalized is not null
          and b0.phone_normalized in (clinic_reception.masa_phone_norm(pt.phone), clinic_reception.masa_phone_norm(pt.phone2), clinic_reception.masa_phone_norm(pt.phone3))
          and clinic_reception.masa_name_norm(b0.patient_name) is distinct from pn),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.masa_invoice_id, 'invoice_no', i.invoice_no, 'date', i.day, 'doctor_id', i.masa_doctor_id, 'net', i.net_amount,
          'discount', i.discount, 'paid', i.paid_amount, 'remaining', i.remaining_amount, 'is_paid', i.is_paid, 'deleted', i.is_deleted, 'insurance', i.insurance_name) order by i.day desc)
        from (select * from clinic_finance.masa_invoices i0 where i0.masa_patient_id = pt.masa_patient_id and (pt.source = 'old') = (i0.masa_invoice_id like 'old:%')
          order by i0.day desc limit 200) i), '[]'),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.masa_receipt_id, 'receipt_no', r.receipt_no, 'date', r.day, 'amount', r.amt, 'deleted', r.is_deleted,
          'methods', r.methods) order by r.day desc)
        from (select r0.*, coalesce((select sum(l.amount) from clinic_finance.masa_receipt_lines l where l.masa_receipt_id = r0.masa_receipt_id), r0.total_paid) as amt,
            (select string_agg(distinct coalesce(t.name, 'طريقة #' || l.payment_type_id), ' + ') from clinic_finance.masa_receipt_lines l
              left join clinic_finance.masa_payment_types t on t.id = l.payment_type_id where l.masa_receipt_id = r0.masa_receipt_id) as methods
          from clinic_finance.masa_receipts r0 where r0.masa_patient_id = pt.masa_patient_id and (pt.source = 'old') = (r0.masa_receipt_id like 'old:%')
          order by r0.day desc limit 200) r), '[]')) into res;
    res := res || jsonb_build_object('booking_states', coalesce((select jsonb_object_agg(coalesce(s, 'غير معروف'), n) from (
        select clinic_reception.masa_booking_state_label(b0.booking_state_id) s, count(*) n from clinic_reception.masa_archive_bookings b0
        where b0.source = pt.source and clinic_reception.masa_name_norm(b0.patient_name) = pn and b0.phone_normalized is not null
          and b0.phone_normalized in (clinic_reception.masa_phone_norm(pt.phone), clinic_reception.masa_phone_norm(pt.phone2), clinic_reception.masa_phone_norm(pt.phone3))
        group by 1) q), '{}'));
    insert into clinic_reception.masa_archive_lookup_log(admin_id, action, source, masa_patient_id, results)
      values (me, 'open', pt.source, pt.masa_patient_id, jsonb_array_length(res->'bookings') + jsonb_array_length(res->'invoices') + jsonb_array_length(res->'receipts'));
    return res;
  end if;
  raise exception 'الإجراء search أو open';
end $$;
revoke all on function public.masa_archive_lookup(jsonb) from public, anon;
grant execute on function public.masa_archive_lookup(jsonb) to authenticated;

commit;
