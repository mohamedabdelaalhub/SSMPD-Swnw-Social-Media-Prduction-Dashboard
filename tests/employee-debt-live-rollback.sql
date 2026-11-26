-- Live rollback dry-run for 20261126210000_employee_debt.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Applies the migration inside the transaction, then as REAL people (never «Admin Test»): the receipt's own cashier (Mazen) asks to
-- convert visit 195's cash receipt (recorded by mistake) into a debt on the employee; reception «موافقة» is refused; A) once — the
-- financial manager approves → the open drawer's expected cash drops by the amount, reception journal 1142/1111 + finance mirror on
-- that shift, 1 installment; B) 3 installments from this month — the super admin approves → schedule, «مديونيات الموظفين» row and the
-- automatic payroll deduction (a payroll request for this month gets the installment added to «استرداد السلفة»); C) reject (FM, with
-- reason) + «الغي» (requester); D) the new collection method on a real unpaid employee invoice if one exists. Scenarios run in throwaway
-- sub-transactions. Notices print amounts / statuses only (no patient names); errors print the message and constraint only.
begin;
-- «على حساب الموظف — يتخصم من المرتب» (owner «طبّق شكل مديونية الموظف» 2026-11-26 ~22:50Z on the approved mockup
-- docs/ui-references/mockups/employee-account.html @d4edfb3d). Live workspaces only.
--   kind 'service'  — a new collection method in «تسجيل تحصيل»: an unpaid service invoice of the employee or a first-degree
--                     relative (same eligibility as «خصم العاملين بالمركز»: clinic_reception.staff_for_patient) becomes a debt on
--                     the EMPLOYEE. No cash enters the drawer. Until approval the invoice stays unpaid («مستنية اعتماد الخصم من
--                     المرتب»). On approval: allocation (source 'employee') for the full due + reception journal 'employee_debt'
--                     Dr 1142 سلف العاملين / Cr 1122 (dims patient_id, invoice_id, person_id) + its clinic_finance mirror.
--   kind 'convert'  — «تحويل التحصيل لمديونية على الموظف»: a cash receipt that was recorded by mistake (no money came in, e.g.
--                     visit 195 in Mazen's shift). On approval: reception journal 'employee_debt_convert' Dr 1142 / Cr 1111 on the
--                     payment's own shift (dims shift_id, register_id, payment_id, invoice_id, patient_id, person_id) + mirror on
--                     the finance shift: an OPEN shift's expected cash drops by the amount; an ended / closed shift gets the
--                     adjustment against its cash difference. The receipt itself is kept (nothing is deleted).
--   Approval: the financial manager or the super admin (owner), never the requester. Requester: reception with 'collect' access
--   in that workspace (or finance 'create' for 'convert'). One open / approved debt per invoice (service) or payment (convert).
--   Salary: once (one month) or 2–12 monthly installments from a chosen start month. On approval the debt is also recorded as an
--   approved clinic_finance.business_requests 'advance' (source 'employee_debt') of the employee's finance subject — the same way
--   «طلب صرف من الدرج» records an advance — so clinic_finance.employee_advance and the payroll recovery (Dr 2131 / Cr 1142) work as
--   before. AUTOMATIC deduction: public.clinic_finance_business_command is wrapped; a payroll request of a subject adds every due,
--   unclaimed installment (month ≤ payroll month) to 'recovery' (payload 'employee_debt' shows the part) and claims those
--   installments; a rejected payroll releases them.
-- Narrow cash-out exception (same shape as drawer_payout / cash_case_settlement): cash_line_guard and ended_shift_entry_guard skip
-- ONLY for source 'reception_employee_debt_convert' when clinic_finance.employee_debt_ok(): the entry's reception journal row is
-- the approved convert debt's own journal row, for exactly its amount, on the payment's own finance shift.
-- Rollback: supabase/rollbacks/20261126210000_employee_debt.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.staff_for_patient(uuid,date)') is null or to_regprocedure('clinic_reception.due(uuid)') is null
     or to_regprocedure('clinic_reception.access(uuid,text)') is null or to_regclass('clinic_finance.business_requests') is null
     or to_regprocedure('public.clinic_finance_business_command(text,jsonb,uuid)') is null
     or to_regprocedure('clinic_finance.cash_line_guard()') is null or to_regprocedure('clinic_finance.ended_shift_entry_guard()') is null then
    raise exception 'طبّق خصم العاملين والخزينة والمرتبات الأول'; end if;
  if to_regclass('clinic_finance.employee_debts') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

do $$
declare d text; a constant text := $a$and e.source<>'treasury_transfer_out'$a$;
  b constant text := $b$new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement')$b$;
begin
  d := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في cash_line_guard اتغيّرت (md5 %)', md5(d); end if;
  d := pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure);
  if (length(d) - length(replace(d, b, ''))) / length(b) <> 1 then raise exception 'نقطة الربط في ended_shift_entry_guard اتغيّرت (md5 %)', md5(d); end if;
  if not exists (select 1 from clinic_finance.accounts where code = '1142') or not exists (select 1 from clinic_finance.accounts where code = '1122') then
    raise exception 'الحسابات 1142 / 1122 مش موجودة'; end if;
end $$;

create table clinic_finance.employee_debt_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.employee_debt_saved_defs from public, anon, authenticated;
insert into clinic_finance.employee_debt_saved_defs values
  ('cash_line_guard', pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure)),
  ('ended_shift_entry_guard', pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure));

create table clinic_finance.employee_debts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service', 'convert')),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id),
  invoice_id uuid not null references clinic_reception.invoices(id),
  payment_id uuid references clinic_reception.payments(id),
  person_id uuid not null references clinic_people.people(id),
  person_name text not null,
  relation text not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000),
  months int not null check (months between 1 and 12),
  first_month date not null check (first_month = date_trunc('month', first_month)::date),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null references public.admins(id),
  requested_at timestamptz not null default now(),
  token uuid not null,
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text,
  journal_id uuid, entry_id uuid, advance_id uuid, shift_open boolean,
  unique (requested_by, token),
  check ((kind = 'convert') = (payment_id is not null))
);
create unique index employee_debts_invoice_once on clinic_finance.employee_debts(invoice_id) where kind = 'service' and status in ('pending', 'approved');
create unique index employee_debts_payment_once on clinic_finance.employee_debts(payment_id) where kind = 'convert' and status in ('pending', 'approved');
create index employee_debts_person on clinic_finance.employee_debts(person_id, status);
alter table clinic_finance.employee_debts enable row level security;
revoke all on clinic_finance.employee_debts from public, anon, authenticated;

create table clinic_finance.employee_debt_installments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references clinic_finance.employee_debts(id),
  month date not null check (month = date_trunc('month', month)::date),
  amount numeric(14,2) not null check (amount > 0),
  payroll_id uuid,
  unique (debt_id, month)
);
alter table clinic_finance.employee_debt_installments enable row level security;
revoke all on clinic_finance.employee_debt_installments from public, anon, authenticated;

alter table clinic_reception.allocations drop constraint allocations_source_check;
alter table clinic_reception.allocations add constraint allocations_source_check check (source in ('payment', 'package', 'credit', 'employee'));

-- the ONLY door through the two cash guards for this feature
create function clinic_finance.employee_debt_ok(p_journal uuid, p_shift uuid, p_amount numeric) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_finance.employee_debts x
                   join clinic_reception.payments p on p.id = x.payment_id
                   join clinic_reception.shifts rs on rs.id = p.shift_id
                  where x.kind = 'convert' and x.status = 'approved' and x.journal_id = p_journal and x.entry_id is null
                    and rs.finance_shift_id = p_shift and (p_amount is null or p_amount = x.amount))
$$;
revoke all on function clinic_finance.employee_debt_ok(uuid, uuid, numeric) from public, anon, authenticated;

do $$ begin
  execute replace(pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure),
    $a$and e.source<>'treasury_transfer_out'$a$,
    $b$and e.source<>'treasury_transfer_out' and not (e.source='reception_employee_debt_convert' and clinic_finance.employee_debt_ok(e.source_id,e.shift_id,new.credit))$b$);
  execute replace(pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure),
    $a$new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement')$a$,
    $b$new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement') and not (new.source='reception_employee_debt_convert' and clinic_finance.employee_debt_ok(new.source_id,new.shift_id,null))$b$);
end $$;

-- reception journal row + its clinic_finance mirror (the approver is not on a reception shift, so not through event_post)
create function clinic_finance.employee_debt_post(p_workspace uuid, p_source text, p_id uuid, p_description text, p_debit text, p_credit text,
  p_amount numeric, p_dims jsonb, p_actor uuid, p_fin_shift uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid; e uuid;
begin
  insert into clinic_reception.journal(workspace_id, source, source_id, description, dimensions, actor_id)
    values (p_workspace, p_source, p_id, p_description, p_dims, p_actor) returning id into v;
  insert into clinic_reception.journal_lines values (v, p_debit, p_amount, 0), (v, p_credit, 0, p_amount);
  update clinic_finance.employee_debts set journal_id = v where id = p_id;
  insert into clinic_finance.entries(source, source_id, description, shift_id, created_by)
    values ('reception_' || p_source, v, p_description, p_fin_shift, p_actor) returning id into e;
  insert into clinic_finance.lines(entry_id, account, debit, credit)
    values (e, clinic_reception.account(p_debit), p_amount, 0), (e, clinic_reception.account(p_credit), 0, p_amount);
  update clinic_reception.journal set finance_entry_id = e where id = v;
  update clinic_finance.employee_debts set entry_id = e where id = p_id;
  return v;
end $$;
revoke all on function clinic_finance.employee_debt_post(uuid, text, uuid, text, text, text, numeric, jsonb, uuid, uuid) from public, anon, authenticated;

-- approved debts become an approved 'advance' of the employee's finance subject (once the employee has one)
create function clinic_finance.employee_debt_materialize(p_person uuid) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare sub text; x record; v uuid; n int := 0;
begin
  select finance_subject into sub from clinic_people.people where id = p_person;
  if sub is null then return 0; end if;
  for x in select * from clinic_finance.employee_debts where person_id = p_person and status = 'approved' and advance_id is null for update loop
    insert into clinic_finance.business_requests(kind, subject, reference, amount, payload, created_by, token, status, reviewed_by, review_note)
      values ('advance', sub, 'EMD-' || left(replace(x.id::text, '-', ''), 10), x.amount,
              jsonb_build_object('source', 'employee_debt', 'debt_id', x.id, 'kind', x.kind, 'invoice_id', x.invoice_id, 'payment_id', x.payment_id,
                                 'employee_name', x.person_name, 'months', x.months, 'first_month', x.first_month, 'note', x.reason),
              x.requested_by, gen_random_uuid(), 'approved', x.reviewed_by, 'على حساب الموظف — يتخصم من المرتب') returning id into v;
    update clinic_finance.employee_debts set advance_id = v where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function clinic_finance.employee_debt_materialize(uuid) from public, anon, authenticated;

create function clinic_finance.employee_debt_row(x clinic_finance.employee_debts) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', x.id, 'kind', x.kind, 'workspace_id', x.workspace_id, 'invoice_id', x.invoice_id, 'payment_id', x.payment_id,
    'invoice_no', (select invoice_no from clinic_reception.invoices where id = x.invoice_id),
    'visit_no', (select v.visit_no from clinic_reception.invoices i join clinic_reception.visits v on v.id = i.visit_id where i.id = x.invoice_id),
    'person_id', x.person_id, 'person_name', x.person_name, 'relation', x.relation, 'amount', x.amount, 'months', x.months,
    'first_month', x.first_month, 'installment', round(x.amount / x.months, 2), 'reason', x.reason, 'status', x.status,
    'at', x.requested_at, 'by', (select name from public.admins where id = x.requested_by), 'mine', x.requested_by = public.my_admin_id(),
    'reviewed_by', (select name from public.admins where id = x.reviewed_by), 'reviewed_at', x.reviewed_at, 'note', x.review_note,
    'shift_open', x.shift_open,
    'recovered', coalesce((select sum(i.amount) from clinic_finance.employee_debt_installments i join clinic_finance.business_requests b on b.id = i.payroll_id
                            where i.debt_id = x.id and b.status = 'approved'), 0),
    'last_month', (select max(month) from clinic_finance.employee_debt_installments where debt_id = x.id))
$$;
revoke all on function clinic_finance.employee_debt_row(clinic_finance.employee_debts) from public, anon, authenticated;

create function public.clinic_finance_employee_debt(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); x clinic_finance.employee_debts%rowtype; inv clinic_reception.invoices%rowtype; pay clinic_reception.payments%rowtype;
  rs clinic_reception.shifts%rowtype; fs clinic_finance.shifts%rowtype; ws uuid; who record; k text; amt numeric; n int; m0 date; tok uuid; why text;
  cairo date := (now() at time zone 'Africa/Cairo')::date; reviewer boolean; ok boolean; i int; part numeric; dims jsonb; v uuid; fin boolean := false;
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  p := coalesce(p, '{}'::jsonb);
  reviewer := public.has_role('financial_manager') or public.has_role('super_admin');
  begin fin := clinic_finance.allowed('review'); exception when others then fin := false; end;

  if p_action = 'options' then
    -- what «تسجيل تحصيل» needs to offer «على حساب الموظف»: eligible employees + the invoice's open request, if any
    ws := (p->>'workspace_id')::uuid;
    perform clinic_reception.access(ws, 'collect');
    if not exists (select 1 from clinic_reception.workspaces where id = ws and mode = 'live') then return jsonb_build_object('live', false, 'staff', '[]'::jsonb); end if;
    select * into inv from clinic_reception.invoices where id = nullif(p->>'invoice_id', '')::uuid and workspace_id = ws;
    if not found then raise exception 'الفاتورة مش موجودة'; end if;
    return jsonb_build_object('live', true, 'due', clinic_reception.due(inv.id), 'package', inv.package_id is not null,
      'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.person_id, 'name', s.name, 'code', s.code, 'relation', s.relation))
                          from clinic_reception.staff_for_patient(inv.patient_id, cairo) s), '[]'::jsonb),
      'default_person', (select a.discount_staff_id from clinic_reception.visits vv join clinic_reception.appointments a on a.id = vv.appointment_id where vv.id = inv.visit_id),
      'next_month', (date_trunc('month', cairo) + interval '1 month')::date,
      'open', (select clinic_finance.employee_debt_row(d) from clinic_finance.employee_debts d where d.invoice_id = inv.id and d.status in ('pending', 'approved') limit 1));

  elsif p_action = 'convertible' then
    -- cash receipts of the requester's workspace (last 14 days) that can be turned into an employee debt
    ws := (p->>'workspace_id')::uuid;
    perform clinic_reception.access(ws, 'collect');
    return jsonb_build_object('next_month', (date_trunc('month', cairo) + interval '1 month')::date, 'items', coalesce((select jsonb_agg(z order by z->>'at' desc) from (
      select jsonb_build_object('payment_id', pm.id, 'amount', al.amount, 'at', pm.created_at, 'receipt_no', pm.receipt_no, 'invoice_id', al.invoice_id,
               'invoice_no', iv.invoice_no, 'visit_no', vs.visit_no, 'patient', pt.name, 'shift_open', sh.status = 'open',
               'cashier', (select name from public.admins where id = sh.cashier_id),
               'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.person_id, 'name', s.name, 'code', s.code, 'relation', s.relation))
                                   from clinic_reception.staff_for_patient(iv.patient_id, cairo) s), '[]'::jsonb),
               'open', (select clinic_finance.employee_debt_row(d) from clinic_finance.employee_debts d where d.payment_id = pm.id and d.status in ('pending', 'approved') limit 1)) z
        from clinic_reception.payments pm
        join clinic_reception.workspaces wk on wk.id = pm.workspace_id and wk.mode = 'live'
        join clinic_reception.shifts sh on sh.id = pm.shift_id
        join lateral (select a2.invoice_id, sum(a2.amount) amount, count(*) c from clinic_reception.allocations a2 where a2.payment_id = pm.id group by a2.invoice_id) al on true
        join clinic_reception.invoices iv on iv.id = al.invoice_id
        left join clinic_reception.visits vs on vs.id = iv.visit_id
        join clinic_reception.patients pt on pt.id = iv.patient_id
       where pm.workspace_id = ws and pm.method = 'cash' and pm.created_at >= now() - interval '14 days'
         and (select count(*) from clinic_reception.allocations a3 where a3.payment_id = pm.id) = 1
         and not exists (select 1 from clinic_reception.journal rj where rj.workspace_id = ws and rj.source = 'refund' and rj.dimensions->>'payment_id' = pm.id::text)
         and exists (select 1 from clinic_reception.staff_for_patient(iv.patient_id, cairo))
       limit 100) q), '[]'::jsonb));

  elsif p_action = 'request' then
    k := p->>'kind';
    if k not in ('service', 'convert') then raise exception 'نوع الطلب غير معروف'; end if;
    tok := nullif(p->>'token', '')::uuid;
    if tok is null then raise exception 'طلب غير صالح'; end if;
    select * into x from clinic_finance.employee_debts where requested_by = me and token = tok;
    if found then return clinic_finance.employee_debt_row(x); end if;
    n := coalesce(nullif(p->>'months', '')::int, 1);
    if n < 1 or n > 12 then raise exception 'عدد الشهور من 1 لـ 12'; end if;
    m0 := date_trunc('month', coalesce(nullif(p->>'first_month', '')::date, (date_trunc('month', cairo) + interval '1 month')::date))::date;
    if m0 < date_trunc('month', cairo)::date or m0 > (date_trunc('month', cairo) + interval '3 months')::date then
      raise exception 'أول خصم من مرتب الشهر ده أو الـ 3 شهور الجايين'; end if;
    why := btrim(coalesce(p->>'reason', ''));
    if length(why) < 3 then raise exception 'اكتب السبب'; end if;
    if k = 'service' then
      select * into inv from clinic_reception.invoices where id = nullif(p->>'invoice_id', '')::uuid for update;
      if not found then raise exception 'الفاتورة مش موجودة'; end if;
      perform clinic_reception.access(inv.workspace_id, 'collect');
      if inv.package_id is not null then raise exception 'فواتير الباكدج مش بتتحوّل على حساب الموظف'; end if;
      amt := clinic_reception.due(inv.id);
      if amt is null or amt <= 0 then raise exception 'الفاتورة مدفوعة بالفعل'; end if;
    else
      select * into pay from clinic_reception.payments where id = nullif(p->>'payment_id', '')::uuid for update;
      if not found then raise exception 'الإيصال مش موجود'; end if;
      begin perform clinic_reception.access(pay.workspace_id, 'collect');
      exception when others then perform clinic_finance.require_access('create'); end;
      if pay.method <> 'cash' then raise exception 'التحويل للإيصالات النقدية بس'; end if;
      if (select count(*) from clinic_reception.allocations where payment_id = pay.id) <> 1 then raise exception 'الإيصال ده موزع على أكتر من فاتورة — كلم الحسابات'; end if;
      if exists (select 1 from clinic_reception.journal rj where rj.workspace_id = pay.workspace_id and rj.source = 'refund' and rj.dimensions->>'payment_id' = pay.id::text) then
        raise exception 'الإيصال ده عليه استرداد'; end if;
      select al.amount into amt from clinic_reception.allocations al where al.payment_id = pay.id;
      select * into inv from clinic_reception.invoices where id = (select invoice_id from clinic_reception.allocations where payment_id = pay.id);
      select * into rs from clinic_reception.shifts where id = pay.shift_id;
      if rs.finance_shift_id is null then raise exception 'وردية الإيصال مش مربوطة بالخزينة'; end if;
    end if;
    if not exists (select 1 from clinic_reception.workspaces where id = inv.workspace_id and mode = 'live') then raise exception 'على حساب الموظف في المساحة الحقيقية بس'; end if;
    select * into who from clinic_reception.staff_for_patient(inv.patient_id, cairo) s where s.person_id = nullif(p->>'person_id', '')::uuid;
    if not found then
      raise exception 'على حساب الموظف للموظفين الشغالين وقرايبهم من الدرجة الأولى بس — المريض لازم يكون الموظف نفسه أو مربوط بيه في «أفراد العيلة»'; end if;
    if exists (select 1 from clinic_finance.employee_debts d where d.status in ('pending', 'approved')
                and ((k = 'service' and d.kind = 'service' and d.invoice_id = inv.id) or (k = 'convert' and d.kind = 'convert' and d.payment_id = pay.id))) then
      raise exception 'عليه طلب بالفعل'; end if;
    insert into clinic_finance.employee_debts(kind, workspace_id, patient_id, invoice_id, payment_id, person_id, person_name, relation, amount, months, first_month, reason, requested_by, token)
      values (k, inv.workspace_id, inv.patient_id, inv.id, case when k = 'convert' then pay.id end, who.person_id, who.name, who.relation, amt, n, m0, left(why, 300), me, tok)
      returning * into x;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_request', x.id, clinic_finance.employee_debt_row(x));
    return clinic_finance.employee_debt_row(x);

  elsif p_action = 'cancel' then
    select * into x from clinic_finance.employee_debts where id = (p->>'id')::uuid for update;
    if not found or x.requested_by <> me then raise exception 'الطلب مش موجود'; end if;
    if x.status <> 'pending' then raise exception 'الطلب مينفعش يتلغي'; end if;
    update clinic_finance.employee_debts set status = 'cancelled' where id = x.id returning * into x;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_cancel', x.id, '{}'::jsonb);
    return clinic_finance.employee_debt_row(x);

  elsif p_action = 'review' then
    if not reviewer then raise exception 'الموافقة للمدير المالي أو المالك بس' using errcode = '42501'; end if;
    perform clinic_finance.lock_day();
    select * into x from clinic_finance.employee_debts where id = (p->>'id')::uuid for update;
    if not found then raise exception 'الطلب مش موجود'; end if;
    if x.status <> 'pending' then return clinic_finance.employee_debt_row(x); end if;
    if x.requested_by = me then raise exception 'الموافقة لازم من شخص غير اللي طلب'; end if;
    if p->>'ok' not in ('true', 'false') then raise exception 'حدد القرار'; end if;
    ok := (p->>'ok')::boolean;
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.employee_debts set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = left(btrim(p->>'note'), 300) where id = x.id returning * into x;
      insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_reject', x.id, clinic_finance.employee_debt_row(x));
      return clinic_finance.employee_debt_row(x);
    end if;
    if not exists (select 1 from clinic_reception.staff_for_patient(x.patient_id, cairo) s where s.person_id = x.person_id) then
      raise exception 'الموظف مبقاش شغال أو القرابة اتشالت — ارفض الطلب'; end if;
    update clinic_finance.employee_debts set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(left(btrim(coalesce(p->>'note', '')), 300), '')
      where id = x.id returning * into x;
    dims := jsonb_build_object('patient_id', x.patient_id, 'invoice_id', x.invoice_id, 'person_id', x.person_id, 'employee_debt_id', x.id);
    if x.kind = 'service' then
      select * into inv from clinic_reception.invoices where id = x.invoice_id for update;
      if clinic_reception.due(inv.id) <> x.amount then raise exception 'المطلوب على الفاتورة اتغيّر من وقت الطلب — ارفضه واطلب تاني'; end if;
      insert into clinic_reception.allocations(workspace_id, invoice_id, payment_id, source, amount) values (x.workspace_id, x.invoice_id, null, 'employee', x.amount);
      perform clinic_finance.employee_debt_post(x.workspace_id, 'employee_debt', x.id, 'خدمة على حساب الموظف — ' || x.person_name || ' (يتخصم من المرتب)',
        '1142', '1122', x.amount, dims, me, null);
    else
      select * into pay from clinic_reception.payments where id = x.payment_id;
      select * into rs from clinic_reception.shifts where id = pay.shift_id;
      select * into fs from clinic_finance.shifts where id = rs.finance_shift_id;
      if exists (select 1 from clinic_reception.journal rj where rj.workspace_id = x.workspace_id and rj.source = 'refund' and rj.dimensions->>'payment_id' = pay.id::text) then
        raise exception 'الإيصال ده عليه استرداد — ارفض الطلب'; end if;
      update clinic_finance.employee_debts set shift_open = (fs.status = 'open' and fs.ended_at is null) where id = x.id returning * into x;
      perform clinic_finance.employee_debt_post(x.workspace_id, 'employee_debt_convert', x.id,
        'تحويل تحصيل نقدي لمديونية على الموظف — ' || x.person_name || ' (مادخلش كاش)', '1142', '1111', x.amount,
        dims || jsonb_build_object('payment_id', pay.id, 'shift_id', rs.id, 'register_id', rs.register_id), me, rs.finance_shift_id);
    end if;
    -- installments: once, or n months (the last one takes the rounding)
    for i in 1 .. x.months loop
      part := case when i < x.months then round(x.amount / x.months, 2) else x.amount - round(x.amount / x.months, 2) * (x.months - 1) end;
      insert into clinic_finance.employee_debt_installments(debt_id, month, amount) values (x.id, (x.first_month + make_interval(months => i - 1))::date, part);
    end loop;
    perform clinic_finance.employee_debt_materialize(x.person_id);
    select * into x from clinic_finance.employee_debts where id = x.id;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_approve', x.id, clinic_finance.employee_debt_row(x));
    return clinic_finance.employee_debt_row(x);

  elsif p_action = 'list' then
    return jsonb_build_object('can_review', reviewer,
      'inbox', case when reviewer then coalesce((select jsonb_agg(clinic_finance.employee_debt_row(d) order by d.requested_at)
                 from clinic_finance.employee_debts d where d.status = 'pending' and d.requested_by <> me), '[]'::jsonb) else '[]'::jsonb end,
      'items', coalesce((select jsonb_agg(clinic_finance.employee_debt_row(d) order by d.requested_at desc) from (
                 select * from clinic_finance.employee_debts d
                  where (reviewer or fin or d.requested_by = me)
                    and d.requested_at::date between coalesce(nullif(p->>'from', '')::date, cairo - 60) and coalesce(nullif(p->>'to', '')::date, cairo)
                  order by d.requested_at desc limit 300) d), '[]'::jsonb),
      'balances', case when reviewer or fin then coalesce((select jsonb_agg(z order by z->>'name') from (
                 select jsonb_build_object('person_id', d.person_id, 'name', min(d.person_name), 'total', sum(d.amount),
                   'recovered', coalesce(sum((select coalesce(sum(i.amount), 0) from clinic_finance.employee_debt_installments i join clinic_finance.business_requests b on b.id = i.payroll_id
                                              where i.debt_id = d.id and b.status = 'approved')), 0),
                   'this_month', (select coalesce(sum(i.amount), 0) from clinic_finance.employee_debt_installments i join clinic_finance.employee_debts d2 on d2.id = i.debt_id
                                   where d2.person_id = d.person_id and d2.status = 'approved' and i.payroll_id is null and i.month <= date_trunc('month', cairo)::date),
                   'last_month', (select max(i.month) from clinic_finance.employee_debt_installments i join clinic_finance.employee_debts d2 on d2.id = i.debt_id
                                   where d2.person_id = d.person_id and d2.status = 'approved')) z
                   from clinic_finance.employee_debts d where d.status = 'approved' group by d.person_id) q), '[]'::jsonb) else '[]'::jsonb end);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_employee_debt(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_employee_debt(text, jsonb) to authenticated;

-- automatic salary deduction: wrap the business command (payroll request / review)
alter function public.clinic_finance_business_command(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_business_command(text, jsonb, uuid) rename to business_command_before_employee_debt;
revoke all on function clinic_finance.business_command_before_employee_debt(text, jsonb, uuid) from public, anon, authenticated;
create function public.clinic_finance_business_command(p_action text, p_payload jsonb, p_token uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid; pid uuid; mon date; due numeric := 0; ids uuid[]; r clinic_finance.business_requests%rowtype;
begin
  if p_action = 'request' and p_payload->>'kind' = 'payroll'
     and not exists (select 1 from clinic_finance.business_requests where token = p_token and created_by = public.my_admin_id()) then
    select id into pid from clinic_people.people where finance_subject = p_payload->>'subject';
    mon := nullif(p_payload->>'month', '')::date;
    if pid is not null and mon is not null then
      perform clinic_finance.employee_debt_materialize(pid);
      select coalesce(sum(i.amount), 0), array_agg(i.id) into due, ids
        from clinic_finance.employee_debt_installments i join clinic_finance.employee_debts d on d.id = i.debt_id
       where d.person_id = pid and d.status = 'approved' and i.payroll_id is null and i.month <= mon;
      if due > 0 then
        p_payload := p_payload || jsonb_build_object('recovery', round(coalesce(nullif(p_payload->>'recovery', '')::numeric, 0) + due, 2), 'employee_debt', due);
      end if;
    end if;
  end if;
  if p_action = 'review' then select * into r from clinic_finance.business_requests where id = nullif(p_payload->>'id', '')::uuid; end if;
  v := clinic_finance.business_command_before_employee_debt(p_action, p_payload, p_token);
  if due > 0 then update clinic_finance.employee_debt_installments set payroll_id = v where id = any(ids) and payroll_id is null; end if;
  if p_action = 'review' and r.kind = 'payroll'
     and exists (select 1 from clinic_finance.business_requests where id = r.id and status = 'rejected') then
    update clinic_finance.employee_debt_installments set payroll_id = null where payroll_id = r.id;
  end if;
  return v;
end $$;
revoke all on function public.clinic_finance_business_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_business_command(text, jsonb, uuid) to authenticated;


-- ===================== dry-run scenarios (real people, live data, nothing kept) =====================
do $$
declare inv uuid; pay record; rec uuid; rec_admin uuid; fm uuid; fm_admin uuid; sa uuid; sa_admin uuid; rs record; cash0 numeric; cash1 numeric;
  r jsonb; o jsonb; did uuid; cn text; n int; ln text; nxt date; cur date := date_trunc('month', (now() at time zone 'Africa/Cairo'))::date;
  person uuid; subj text; contract uuid; pr uuid; prp jsonb; sinv uuid; spat uuid; sperson uuid;
begin
  -- visit 195 (live): its invoice and its CASH receipt
  select i.id into inv from clinic_reception.invoices i join clinic_reception.visits v on v.id = i.visit_id
    join clinic_reception.workspaces w on w.id = i.workspace_id and w.mode = 'live' where v.visit_no = 195 order by i.created_at limit 1;
  if inv is null then raise exception 'visit 195 invoice not found in the live workspace'; end if;
  select p.*, al.amount alloc into pay from clinic_reception.payments p join clinic_reception.allocations al on al.payment_id = p.id
   where al.invoice_id = inv and p.method = 'cash' order by p.created_at desc limit 1;
  if pay.id is null then raise exception 'visit 195 has no cash receipt'; end if;
  select * into rs from clinic_reception.shifts where id = pay.shift_id;
  -- requester = the receipt's own cashier (Mazen); approvers = a real financial manager and a real super admin, both ≠ requester
  select a.user_id, a.id into rec, rec_admin from public.admins a where a.id = rs.cashier_id and a.active and coalesce(a.name, '') <> 'Admin Test';
  if rec is null then raise exception 'the receipt cashier is not an active real login'; end if;
  select a.user_id, a.id into fm, fm_admin from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and a.id <> rec_admin and public.has_role_for(a.id, 'financial_manager') order by a.id limit 1;
  select a.user_id, a.id into sa, sa_admin from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and a.id <> rec_admin and a.role = 'super_admin' order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  if fm is null or sa is null then raise exception 'need a real financial manager and a real super admin (≠ the requester)'; end if;
  raise notice 'visit 195: cash receipt %, allocated %, reception shift status %, requester = the receipt cashier (%), FM and SA are other people',
    pay.amount, pay.alloc, rs.status, case when (select name from public.admins where id = rec_admin) like '%مازن%' then 'Mazen' else 'not Mazen' end;

  -- «تسجيل تحصيل» options for that invoice (reception)
  perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
  o := public.clinic_finance_employee_debt('options', jsonb_build_object('workspace_id', pay.workspace_id, 'invoice_id', inv));
  r := public.clinic_finance_employee_debt('convertible', jsonb_build_object('workspace_id', pay.workspace_id));
  execute 'reset role';
  raise notice 'options (reception): live %, due %, eligible employees %, default from staff discount: %', o->>'live', o->>'due', jsonb_array_length(o->'staff'), (o->>'default_person') is not null;
  if jsonb_array_length(o->'staff') = 0 then raise exception 'visit 195 patient is not an employee / first-degree relative in HR — fix the HR phone / family link first'; end if;
  person := coalesce((o->>'default_person')::uuid, (o->'staff'->0->>'id')::uuid);
  if not exists (select 1 from jsonb_array_elements(r->'items') x where x->>'payment_id' = pay.id::text) then raise exception 'visit 195 receipt not in «convertible»'; end if;
  nxt := (r->>'next_month')::date;
  select finance_subject into subj from clinic_people.people where id = person;
  raise notice 'convertible (reception): % receipt(s) listed incl. visit 195; employee has a finance subject: %', jsonb_array_length(r->'items'), subj is not null;
  select clinic_finance.shift_cash(rs.finance_shift_id) into cash0;

  -- A) ONCE, approved by the FINANCIAL MANAGER
  begin
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'convert', 'payment_id', pay.id, 'person_id', person, 'months', 1, 'first_month', nxt,
           'reason', 'اتسجل كاش بالغلط — هيتخصم من المرتب (dry-run)', 'token', gen_random_uuid()));
    did := (r->>'id')::uuid;
    begin perform public.clinic_finance_employee_debt('review', jsonb_build_object('id', did, 'ok', true)); raise exception 'reception approved!';
    exception when others then if sqlerrm = 'reception approved!' then raise; end if; raise notice 'reception «موافقة» refused: %', sqlerrm; end;
    perform set_config('request.jwt.claim.sub', fm::text, true);
    r := public.clinic_finance_employee_debt('review', jsonb_build_object('id', did, 'ok', true));
    execute 'reset role';
    select clinic_finance.shift_cash(rs.finance_shift_id) into cash1;
    select string_agg(l.account || ' ' || l.debit || '/' || l.credit, ', ' order by l.debit desc) into ln from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
     where j.source = 'employee_debt_convert' and j.source_id = did;
    raise notice 'A once (FM approved): status %, shift open %, drawer expected cash % → % (−%), reception journal [%]', r->>'status', r->>'shift_open', cash0, cash1, cash0 - cash1, ln;
    select string_agg(l.account || ' ' || l.debit || '/' || l.credit, ', ' order by l.debit desc), count(distinct e.id) into ln, n from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
     where e.source = 'reception_employee_debt_convert' and e.shift_id = rs.finance_shift_id and e.source_id = (select journal_id from clinic_finance.employee_debts where id = did);
    raise notice 'A finance mirror on the receipt''s own shift: % entry [%]', n, ln;
    select string_agg(to_char(month, 'YYYY-MM') || ' ' || amount, ', ' order by month) into ln from clinic_finance.employee_debt_installments where debt_id = did;
    raise notice 'A installments: [%]; advance recorded for payroll: %', ln, (select advance_id is not null from clinic_finance.employee_debts where id = did);
    if (r->>'shift_open')::boolean and cash0 - cash1 <> pay.alloc then raise exception 'open shift cash did not drop by the amount'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'A: % [%]', sqlerrm, cn; end if; end;

  -- B) 3 INSTALLMENTS from THIS month, approved by the SUPER ADMIN (owner) + the automatic payroll deduction
  begin
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'convert', 'payment_id', pay.id, 'person_id', person, 'months', 3, 'first_month', cur,
           'reason', 'اتسجل كاش بالغلط — أقساط (dry-run)', 'token', gen_random_uuid()));
    did := (r->>'id')::uuid;
    perform set_config('request.jwt.claim.sub', sa::text, true);
    r := public.clinic_finance_employee_debt('review', jsonb_build_object('id', did, 'ok', true));
    execute 'reset role';
    select string_agg(to_char(month, 'YYYY-MM') || ' ' || amount, ', ' order by month) into ln from clinic_finance.employee_debt_installments where debt_id = did;
    raise notice 'B installments (SA approved, status %): [%]', r->>'status', ln;
    perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt('list', '{}'::jsonb);
    execute 'reset role';
    select x into o from jsonb_array_elements(r->'balances') x where x->>'person_id' = person::text;
    raise notice 'B «مديونيات الموظفين» row: total %, recovered %, this month %, last %', o->>'total', o->>'recovered', o->>'this_month', o->>'last_month';
    if subj is null then raise notice 'B payroll: skipped — the employee has no finance subject yet (the advance is recorded once HR links one)';
    else
      select b.id into contract from clinic_finance.business_requests b where b.kind = 'employment' and b.status = 'approved' and b.subject = subj order by b.created_at desc limit 1;
      begin
        perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
        pr := public.clinic_finance_business_command('request', jsonb_build_object('kind', 'payroll', 'subject', subj, 'contract_id', contract, 'month', cur,
                'allowance', 0, 'salary_deduction', 0, 'tax', 0, 'insurance', 0, 'recovery', 0, 'reference', 'DRY-RUN-EMD', 'note', 'dry-run مديونية الموظف'), gen_random_uuid());
        execute 'reset role';
        select payload into prp from clinic_finance.business_requests where id = pr;
        raise notice 'B payroll request for this month: recovery % (employee debt part %), installments claimed %', prp->>'recovery', prp->>'employee_debt',
          (select count(*) from clinic_finance.employee_debt_installments where payroll_id = pr);
      exception when others then execute 'reset role'; get stacked diagnostics cn = constraint_name; raise notice 'B payroll request refused by the existing payroll rules: % [%]', sqlerrm, cn; end;
    end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'B: % [%]', sqlerrm, cn; end if; end;

  -- C) reject (FM, reason required) and «الغي» (requester)
  begin
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'convert', 'payment_id', pay.id, 'person_id', person, 'months', 1, 'reason', 'dry-run رفض', 'token', gen_random_uuid()));
    perform set_config('request.jwt.claim.sub', fm::text, true);
    r := public.clinic_finance_employee_debt('review', jsonb_build_object('id', r->>'id', 'ok', false, 'note', 'dry-run: يدفع كاش'));
    perform set_config('request.jwt.claim.sub', rec::text, true);
    o := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'convert', 'payment_id', pay.id, 'person_id', person, 'months', 1, 'reason', 'dry-run إلغاء', 'token', gen_random_uuid()));
    o := public.clinic_finance_employee_debt('cancel', jsonb_build_object('id', o->>'id'));
    execute 'reset role';
    raise notice 'C reject by FM: %; cancel by requester: %; drawer cash unchanged: %', r->>'status', o->>'status', clinic_finance.shift_cash(rs.finance_shift_id) = cash0;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'C: % [%]', sqlerrm, cn; end if; end;

  -- D) the new collection method on a REAL unpaid live service invoice of an employee / relative, if one exists (else skipped)
  select i.id, i.patient_id into sinv, spat from clinic_reception.invoices i join clinic_reception.workspaces w on w.id = i.workspace_id and w.mode = 'live'
   where i.package_id is null and clinic_reception.due(i.id) > 0 and exists (select 1 from clinic_reception.staff_for_patient(i.patient_id, (now() at time zone 'Africa/Cairo')::date))
   order by i.created_at desc limit 1;
  if sinv is null then raise notice 'D service method: skipped — no unpaid live service invoice of an employee / relative right now';
  else
    begin
      select s.person_id into sperson from clinic_reception.staff_for_patient(spat, (now() at time zone 'Africa/Cairo')::date) s limit 1;
      perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
      r := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'service', 'invoice_id', sinv, 'person_id', sperson, 'months', 2, 'first_month', nxt, 'reason', 'dry-run خدمة على حساب الموظف', 'token', gen_random_uuid()));
      perform set_config('request.jwt.claim.sub', fm::text, true);
      r := public.clinic_finance_employee_debt('review', jsonb_build_object('id', r->>'id', 'ok', true));
      execute 'reset role';
      select string_agg(l.account || ' ' || l.debit || '/' || l.credit, ', ' order by l.debit desc) into ln from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
       where j.source = 'employee_debt' and j.source_id = (r->>'id')::uuid;
      raise notice 'D service (FM approved): amount %, invoice due now %, journal [%]', r->>'amount', clinic_reception.due(sinv), ln;
      raise exception 'SCENARIO_DONE';
    exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'D: % [%]', sqlerrm, cn; end if; end;
  end if;
  raise notice 'employee debt dry-run OK — nothing kept (ROLLBACK)';
exception when others then
  get stacked diagnostics cn = constraint_name;
  raise exception '%', sqlerrm || coalesce(' [' || nullif(cn, '') || ']', '');
end $$;
rollback;
