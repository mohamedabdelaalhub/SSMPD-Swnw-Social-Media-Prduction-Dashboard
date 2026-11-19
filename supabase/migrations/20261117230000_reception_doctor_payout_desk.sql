-- Owner 2026-11-17: «صرف حساب الطبيب» from reception.
--   * When the doctor's day is done (UI: every case finished and paid) an orange «صرف الحساب» sits next to the doctor on the today board.
--   * Reception prepares the payout with the dashboard's own amount (never typed by reception): every fully-paid invoice of that doctor
--     that is not already in a pending/approved payout. No tax for now (owner): tax_pct = withholding_pct = 0.
--   * It stays «معلّق» (pending) until an approver acts. Approvers (owner): financial_manager, general_manager, super_admin, or any account
--     granted admins.can_approve_doctor_payouts from the admin panel. The requester can never approve their own request (maker-checker kept).
--     Only an approver may change the amount (with a reason, never above the payable amount) or reject it (frees the invoices).
--   * Approval posts exactly like the accounting payout review (2120 → 1111 from the requester's open cash shift, net = gross, tax 0) and is
--     refused if the shift is closed or its proven cash is less than the amount.
--   * After approval reception hands the cash and prints a «إيصال استلام نقدية» for the doctor's signature → «تم الصرف»; uploading the signed
--     receipt (private bucket doctor-payout-receipts) is optional and can be done later.
-- Additive: 1 column on admins (+ guard), 1 table, 1 bucket + policies, functions below. The accounting payout path (finance-doctors.js,
-- public.clinic_finance_doctor_command / _payout_invoices) is not changed. Rows created here are ordinary clinic_finance.doctor_payouts
-- (+ doctor_payout_invoices) so the accounting screens, statements and the payable-now gate see them.
-- Rollback: supabase/rollbacks/20261117230000_reception_doctor_payout_desk.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.doctor_payout_invoices') is null or to_regprocedure('clinic_finance.invoice_fully_paid(uuid)') is null
     or to_regprocedure('clinic_finance.doctor_payable_now(text)') is null or to_regprocedure('clinic_finance.shift_cash(uuid)') is null
     or to_regprocedure('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)') is null or to_regprocedure('clinic_reception.access(uuid,text)') is null then
    raise exception 'مكونات صرف الأطباء أو الاستقبال غير موجودة';
  end if;
  if to_regclass('clinic_finance.desk_payouts') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table public.admins add column if not exists can_approve_doctor_payouts boolean not null default false;
create or replace function public.guard_doctor_payout_grant() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_super() and ((tg_op = 'INSERT' and new.can_approve_doctor_payouts)
     or (tg_op = 'UPDATE' and new.can_approve_doctor_payouts is distinct from old.can_approve_doctor_payouts)) then
    raise exception 'الصلاحيات للسوبر أدمن';
  end if;
  return new;
end $$;
revoke all on function public.guard_doctor_payout_grant() from public, anon, authenticated;
drop trigger if exists guard_doctor_payout_grant on public.admins;
create trigger guard_doctor_payout_grant before insert or update on public.admins for each row execute function public.guard_doctor_payout_grant();

create table clinic_finance.desk_payouts (
  payout_id uuid primary key references clinic_finance.doctor_payouts(id),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  provider_id uuid not null references clinic_reception.providers(id),
  requested_by uuid not null references public.admins(id),
  computed_gross numeric(14,2) not null check (computed_gross > 0),
  adjusted_by uuid references public.admins(id),
  adjust_note text,
  handed_by uuid references public.admins(id),
  handed_at timestamptz,
  receipt_path text,
  receipt_by uuid references public.admins(id),
  receipt_at timestamptz,
  created_at timestamptz not null default now()
);
create index desk_payouts_provider on clinic_finance.desk_payouts(provider_id, created_at desc);
alter table clinic_finance.desk_payouts enable row level security;
revoke all on clinic_finance.desk_payouts from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doctor-payout-receipts', 'doctor-payout-receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create or replace function clinic_finance.desk_approver() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin')
    or coalesce((select a.can_approve_doctor_payouts from public.admins a where a.id = public.my_admin_id()), false))
$$;

-- the doctor's payable invoices right now: fee > 0, not voided, fully paid, not in a pending/approved payout
create or replace function clinic_finance.desk_payable(p_doctor text) returns table(invoice_id uuid, reference text, description text, amount numeric, fee numeric, created_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select i.id, i.reference, i.description, i.amount, f.fee, i.created_at
  from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
  join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided
  where clinic_finance.invoice_fully_paid(i.id)
    and not exists (select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                    where k.doctor_key = p_doctor and k.invoice_id = i.id and q.status in ('pending','approved'))
$$;

-- invoices of the doctor still waiting for the patient / insurer (their fee is held)
create or replace function clinic_finance.desk_held(p_doctor text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(f.fee), 0) from (select a.invoice_id, sum(a.delta) fee from clinic_finance.doctor_accruals a where a.doctor_key = p_doctor group by a.invoice_id having sum(a.delta) > 0) f
  join clinic_finance.invoices i on i.id = f.invoice_id and not i.voided where not clinic_finance.invoice_fully_paid(i.id)
$$;

create or replace function clinic_finance.desk_row(p clinic_reception.providers, p_day date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare day0 timestamptz := p_day::timestamp at time zone 'Africa/Cairo'; payable numeric; held numeric; pend record; paid numeric; waiting_handover record;
begin
  if p.doctor_key is null then
    return jsonb_build_object('provider_id', p.id, 'name', p.name, 'linked', false, 'state', 'unlinked');
  end if;
  select coalesce(sum(x.fee), 0) into payable from clinic_finance.desk_payable(p.doctor_key) x;
  held := clinic_finance.desk_held(p.doctor_key);
  select q.id, q.gross, q.created_at into pend from clinic_finance.doctor_payouts q where q.doctor_key = p.doctor_key and q.status = 'pending' order by q.created_at desc limit 1;
  select q.id, q.gross, q.reviewed_at into waiting_handover from clinic_finance.doctor_payouts q join clinic_finance.desk_payouts dp on dp.payout_id = q.id
   where q.doctor_key = p.doctor_key and q.status = 'approved' and dp.handed_at is null order by q.reviewed_at desc limit 1;
  select coalesce(sum(q.gross), 0) into paid from clinic_finance.doctor_payouts q join clinic_finance.desk_payouts dp on dp.payout_id = q.id
   where q.doctor_key = p.doctor_key and q.status = 'approved' and dp.handed_at >= day0;
  return jsonb_build_object('provider_id', p.id, 'name', p.name, 'linked', true, 'doctor_key', p.doctor_key,
    'payable', payable, 'held', held, 'paid_today', paid,
    'pending', case when pend.id is null then null else jsonb_build_object('id', pend.id, 'gross', pend.gross, 'created_at', pend.created_at) end,
    'approved', case when waiting_handover.id is null then null else jsonb_build_object('id', waiting_handover.id, 'gross', waiting_handover.gross, 'approved_at', waiting_handover.reviewed_at) end,
    'state', case when pend.id is not null then 'pending'
                  when waiting_handover.id is not null then 'approved'
                  when paid > 0 and (payable > 0 or held > 0) then 'partial'
                  when paid > 0 then 'paid'
                  when payable > 0 then 'ready'
                  else 'nothing' end);
end $$;

create or replace function clinic_finance.desk_payout_json(q clinic_finance.doctor_payouts) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', q.id, 'status', q.status, 'gross', q.gross, 'net', q.gross - q.withheld, 'doctor_key', q.doctor_key, 'reference', q.reference,
    'created_at', q.created_at, 'reviewed_at', q.reviewed_at, 'review_note', q.review_note,
    'requested_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = q.created_by),
    'reviewed_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = q.reviewed_by),
    'doctor_name', (select p.name from clinic_reception.providers p where p.id = d.provider_id),
    'provider_id', d.provider_id, 'workspace_id', d.workspace_id, 'computed_gross', d.computed_gross, 'adjust_note', d.adjust_note,
    'handed_at', d.handed_at, 'handed_by', (select coalesce(nullif(a.name, ''), a.email) from public.admins a where a.id = d.handed_by),
    'receipt_path', d.receipt_path, 'receipt_at', d.receipt_at,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', k.invoice_id, 'reference', i.reference, 'description', i.description, 'amount', i.amount, 'fee', k.fee, 'created_at', i.created_at) order by i.created_at)
                 from clinic_finance.doctor_payout_invoices k join clinic_finance.invoices i on i.id = k.invoice_id where k.payout_id = q.id), '[]'::jsonb))
  from clinic_finance.desk_payouts d where d.payout_id = q.id
$$;

create or replace function public.clinic_reception_doctor_payout(p_action text, p_payload jsonb, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); ws uuid; day date; p clinic_reception.providers%rowtype; q clinic_finance.doctor_payouts%rowtype; d clinic_finance.desk_payouts%rowtype;
  fin_shift uuid; v uuid; gross numeric; inv record; note text; newg numeric; payable numeric; ids jsonb;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  ws := nullif(p_payload->>'workspace_id', '')::uuid;

  if p_action = 'board' then
    perform clinic_reception.access(ws, 'book');
    day := coalesce(nullif(p_payload->>'day', '')::date, (now() at time zone 'Africa/Cairo')::date);
    return jsonb_build_object('approver', clinic_finance.desk_approver(), 'day', day, 'doctors', coalesce((
      select jsonb_agg(clinic_finance.desk_row(pr, day) order by pr.name) from clinic_reception.providers pr
       where pr.workspace_id = ws and pr.active
         and exists (select 1 from clinic_reception.appointments a where a.provider_id = pr.id and a.status not in ('cancelled')
                     and (a.starts_at at time zone 'Africa/Cairo')::date = day)), '[]'::jsonb));

  elsif p_action = 'detail' then
    perform clinic_reception.access(ws, 'book');
    select * into p from clinic_reception.providers where id = (p_payload->>'provider_id')::uuid and workspace_id = ws;
    if not found then raise exception 'الطبيب غير موجود'; end if;
    return clinic_finance.desk_row(p, coalesce(nullif(p_payload->>'day', '')::date, (now() at time zone 'Africa/Cairo')::date)) || jsonb_build_object(
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', x.invoice_id, 'reference', x.reference, 'description', x.description, 'amount', x.amount, 'fee', x.fee, 'created_at', x.created_at) order by x.created_at)
                            from clinic_finance.desk_payable(p.doctor_key) x), '[]'::jsonb),
      'payouts', coalesce((select jsonb_agg(clinic_finance.desk_payout_json(q2) order by q2.created_at desc) from (
                            select q3.* from clinic_finance.doctor_payouts q3 join clinic_finance.desk_payouts d3 on d3.payout_id = q3.id
                             where d3.provider_id = p.id order by q3.created_at desc limit 10) q2), '[]'::jsonb));

  elsif p_action = 'request' then
    perform clinic_finance.lock_day();
    perform clinic_reception.access(ws, 'book');
    if p_token is null then raise exception 'مفتاح الطلب مطلوب'; end if;
    select * into q from clinic_finance.doctor_payouts where created_by = me and token = p_token;
    if found then return clinic_finance.desk_payout_json(q); end if;
    select * into p from clinic_reception.providers where id = (p_payload->>'provider_id')::uuid and workspace_id = ws and active;
    if not found or p.doctor_key is null then raise exception 'الطبيب مش مربوط بعقد أتعاب في الحسابات؛ كلّم المحاسب'; end if;
    perform pg_advisory_xact_lock(hashtext('doctor_payout_invoices'), hashtext(p.doctor_key));
    if exists (select 1 from clinic_finance.doctor_payouts where doctor_key = p.doctor_key and status = 'pending') then raise exception 'فيه طلب صرف معلّق للدكتور ده؛ مستني الاعتماد'; end if;
    select s.finance_shift_id into fin_shift from clinic_reception.shifts s join clinic_finance.shifts f on f.id = s.finance_shift_id and f.status = 'open'
     where s.workspace_id = ws and s.cashier_id = me and s.status = 'open' order by s.opened_at desc limit 1;
    if fin_shift is null then raise exception 'افتح وردية الخزينة الأول علشان تصرف من الكاش'; end if;
    select coalesce(sum(x.fee), 0), coalesce(jsonb_agg(x.invoice_id order by x.invoice_id), '[]'::jsonb) into gross, ids from clinic_finance.desk_payable(p.doctor_key) x;
    if gross <= 0 then raise exception 'مفيش مبلغ مستحق للصرف دلوقتي (الأتعاب بتتصرف بعد ما الفواتير تتدفع بالكامل)'; end if;
    if gross > clinic_finance.doctor_payable_now(p.doctor_key) then raise exception 'المبلغ أكبر من رصيد الطبيب المتاح؛ كلّم المحاسب'; end if;
    insert into clinic_finance.doctor_payouts(doctor_key, gross, withheld, method, shift_id, reference, period_from, period_to, payload, created_by, token)
    values (p.doctor_key, gross, 0, 'cash', fin_shift, 'صرف استقبال — ' || p.name || ' — ' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || ' — ' || right(p_token::text, 8),
            coalesce((select min(i.created_at at time zone 'Africa/Cairo')::date from clinic_finance.invoices i where i.id in (select (jsonb_array_elements_text(ids))::uuid)), current_date),
            (now() at time zone 'Africa/Cairo')::date,
            jsonb_build_object('doctor_key', p.doctor_key, 'gross', gross, 'tax_pct', 0, 'withholding_pct', 0, 'withheld', 0, 'net', gross, 'method', 'cash',
                               'shift_id', fin_shift, 'invoice_ids', ids, 'channel', 'reception_desk', 'provider_id', p.id), me, p_token)
    returning * into q;
    insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee)
      select q.id, x.invoice_id, p.doctor_key, x.fee from clinic_finance.desk_payable(p.doctor_key) x;
    insert into clinic_finance.desk_payouts(payout_id, workspace_id, provider_id, requested_by, computed_gross) values (q.id, ws, p.id, me, gross);
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_request', q.id,
      jsonb_build_object('doctor_key', p.doctor_key, 'provider_id', p.id, 'gross', gross, 'invoice_count', jsonb_array_length(ids), 'shift_id', fin_shift));
    return clinic_finance.desk_payout_json(q);

  elsif p_action in ('approve', 'reject') then
    perform clinic_finance.lock_day();
    if not clinic_finance.desk_approver() then raise exception 'اعتماد صرف حساب الطبيب للمدير المالي أو المدير العام أو السوبر أدمن أو صاحب الصلاحية' using errcode = '42501'; end if;
    select * into q from clinic_finance.doctor_payouts where id = (p_payload->>'id')::uuid for update;
    if not found or not exists (select 1 from clinic_finance.desk_payouts where payout_id = q.id) then raise exception 'الطلب غير موجود'; end if;
    if q.status <> 'pending' then return clinic_finance.desk_payout_json(q); end if;   -- already decided (idempotent replay)
    if q.created_by = me then raise exception 'مينفعش تعتمد طلب إنت اللي عامله؛ لازم حد تاني'; end if;
    note := trim(coalesce(p_payload->>'note', ''));
    if p_action = 'reject' then
      if length(note) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.doctor_payouts set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = note where id = q.id returning * into q;
      insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_reject', q.id, jsonb_build_object('note', note));
      return clinic_finance.desk_payout_json(q);
    end if;
    newg := nullif(p_payload->>'gross', '')::numeric;
    if newg is not null and newg <> q.gross then
      if length(note) < 3 then raise exception 'اكتب سبب تعديل المبلغ'; end if;
      if newg <= 0 or newg <> round(newg, 2) or newg::text in ('NaN','Infinity','-Infinity') then raise exception 'المبلغ غير صالح'; end if;
      select coalesce(sum(k.fee), 0) into payable from clinic_finance.doctor_payout_invoices k where k.payout_id = q.id;
      if newg > payable then raise exception 'المبلغ المعدّل أكبر من أتعاب الفواتير المشمولة (%)', payable; end if;
      update clinic_finance.desk_payouts set adjusted_by = me, adjust_note = note where payout_id = q.id;
      insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_adjust', q.id, jsonb_build_object('from', q.gross, 'to', newg, 'note', note));
      update clinic_finance.doctor_payouts set gross = newg, payload = payload || jsonb_build_object('gross', newg, 'net', newg, 'adjusted_from', q.gross) where id = q.id returning * into q;
    end if;
    if q.gross > clinic_finance.doctor_payable_now(q.doctor_key) then raise exception 'رصيد الطبيب المتاح أقل من المبلغ (المتاح %)؛ ارفض الطلب أو عدّل المبلغ', clinic_finance.doctor_payable_now(q.doctor_key); end if;
    if not exists (select 1 from clinic_finance.shifts where id = q.shift_id and status = 'open') then raise exception 'وردية الاستقبال اللي هيتصرف منها اتقفلت؛ ارفض الطلب وخلي الاستقبال يطلبه تاني من ورديته الجديدة'; end if;
    if clinic_finance.shift_cash(q.shift_id) < q.gross - q.withheld then raise exception 'الكاش اللي في وردية الاستقبال (%) أقل من مبلغ الصرف', clinic_finance.shift_cash(q.shift_id); end if;
    perform clinic_finance.post('doctor_payment', q.id, 'صرف مستحقات طبيب — ' || q.reference, q.shift_id, '2120', '1111', q.gross - q.withheld);
    update clinic_finance.doctor_payouts set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = coalesce(nullif(note, ''), 'اعتماد صرف من الاستقبال') where id = q.id returning * into q;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_approve', q.id, jsonb_build_object('gross', q.gross, 'shift_id', q.shift_id));
    return clinic_finance.desk_payout_json(q);

  elsif p_action = 'pending_list' then
    if not clinic_finance.desk_approver() then return jsonb_build_object('approver', false, 'items', '[]'::jsonb); end if;
    return jsonb_build_object('approver', true, 'me', me, 'items', coalesce((select jsonb_agg(clinic_finance.desk_payout_json(q2) order by q2.created_at)
      from clinic_finance.doctor_payouts q2 join clinic_finance.desk_payouts d2 on d2.payout_id = q2.id where q2.status = 'pending'), '[]'::jsonb));

  elsif p_action in ('handover', 'receipt') then
    select * into d from clinic_finance.desk_payouts where payout_id = (p_payload->>'id')::uuid for update;
    if not found then raise exception 'الطلب غير موجود'; end if;
    perform clinic_reception.access(d.workspace_id, 'book');
    select * into q from clinic_finance.doctor_payouts where id = d.payout_id;
    if q.status <> 'approved' then raise exception 'الصرف لسه ما اتعتمدش'; end if;
    if p_action = 'handover' then
      if d.handed_at is null then
        update clinic_finance.desk_payouts set handed_at = now(), handed_by = me where payout_id = d.payout_id;
        insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_handover', q.id, jsonb_build_object('gross', q.gross));
      end if;
    else
      if coalesce(p_payload->>'path', '') !~ ('^' || d.payout_id::text || '/[A-Za-z0-9._-]{1,120}$') then raise exception 'مسار الإيصال غير صالح'; end if;
      update clinic_finance.desk_payouts set receipt_path = p_payload->>'path', receipt_by = me, receipt_at = now() where payout_id = d.payout_id;
      insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_receipt', q.id, jsonb_build_object('path', p_payload->>'path'));
    end if;
    return clinic_finance.desk_payout_json(q);
  end if;
  raise exception 'إجراء غير معروف';
end $$;

-- receipts: upload by reception staff of that workspace for an approved desk payout; read by them and by approvers
create or replace function public.doctor_payout_receipt_allowed(p_name text, p_write boolean) returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pid uuid; d clinic_finance.desk_payouts%rowtype;
begin
  begin pid := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  select * into d from clinic_finance.desk_payouts where payout_id = pid;
  if not found then return false; end if;
  if not p_write and clinic_finance.desk_approver() then return true; end if;
  begin perform clinic_reception.access(d.workspace_id, 'book'); exception when others then return false; end;
  return not p_write or exists (select 1 from clinic_finance.doctor_payouts q where q.id = pid and q.status = 'approved');
end $$;
drop policy if exists doctor_payout_receipts_insert on storage.objects;
drop policy if exists doctor_payout_receipts_select on storage.objects;
create policy doctor_payout_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'doctor-payout-receipts' and public.doctor_payout_receipt_allowed(name, true));
create policy doctor_payout_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'doctor-payout-receipts' and public.doctor_payout_receipt_allowed(name, false));

revoke all on function clinic_finance.desk_approver(), clinic_finance.desk_payable(text), clinic_finance.desk_held(text),
  clinic_finance.desk_row(clinic_reception.providers, date), clinic_finance.desk_payout_json(clinic_finance.doctor_payouts) from public, anon, authenticated;
revoke all on function public.doctor_payout_receipt_allowed(text, boolean) from public, anon;
grant execute on function public.doctor_payout_receipt_allowed(text, boolean) to authenticated;
revoke all on function public.clinic_reception_doctor_payout(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_doctor_payout(text, jsonb, uuid) to authenticated;
commit;
