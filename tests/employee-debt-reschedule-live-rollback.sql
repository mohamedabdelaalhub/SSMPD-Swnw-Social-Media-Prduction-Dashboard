-- Live rollback dry-run for 20261127090000_employee_debt_reschedule.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Applies the migration inside the transaction, then as REAL people (never «Admin Test»): maker = a plain accountant (else the FM),
-- checker = a different FM / super admin. Uses an approved live employee debt if one exists, else builds one from visit 195's cash
-- receipt (convert, approved by the checker — rolled back). A) postpone the first open installment after the last one: maker «موافقة»
-- refused, checker approves, total and books unchanged. B) resplit the rest into 4. C) reject with reason, «الغي», reception refused.
-- Notices print months / amounts / statuses only (no patient names); errors print the message and constraint only.
begin;
-- «تأجيل قسط / تغيير عدد الأقساط» for «على حساب الموظف» (owner «طبّق تأجيل الأقساط» 2026-11-27 on the mockup
-- docs/ui-references/mockups/employee-debt-reschedule.html @f25d5f9c, relayed by main chat 7). راجعت قرارات المالك.
-- After a debt is approved, finance (accountant / FM / owner) can ask to change its salary schedule:
--   postpone — move ONE unclaimed installment to a month after the debt's last installment (up to 6 months after it);
--   resplit  — spread ALL unclaimed installments again over 1–12 months from a chosen start month (this month … +3).
-- The financial manager or the owner approves, never the requester. The debt amount never changes and NO entry is posted:
-- only clinic_finance.employee_debt_installments rows that are not yet claimed by a payroll request (payroll_id is null) move.
-- Installments already in a payroll (pending or approved) are never touched, and a new month may not collide with one.
-- The request stores the schedule it saw («قبل») and the one it makes («بعد»); approval re-checks that the unclaimed part is
-- still exactly «قبل», else it refuses («الجدول اتغيّر — اطلب تاني»). One open request per debt. Audited.
-- Rollback: supabase/rollbacks/20261127090000_employee_debt_reschedule.rollback.sql
do $$ begin
  if to_regclass('clinic_finance.employee_debt_installments') is null or to_regprocedure('public.clinic_finance_employee_debt(text,jsonb)') is null then
    raise exception 'طبّق «على حساب الموظف» (20261126210000) الأول'; end if;
  if to_regclass('clinic_finance.employee_debt_changes') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.employee_debt_changes (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references clinic_finance.employee_debts(id),
  kind text not null check (kind in ('postpone', 'resplit')),
  before_schedule jsonb not null,
  after_schedule jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null references public.admins(id),
  requested_at timestamptz not null default now(),
  token uuid not null,
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text,
  unique (requested_by, token)
);
create unique index employee_debt_changes_one_open on clinic_finance.employee_debt_changes(debt_id) where status = 'pending';
alter table clinic_finance.employee_debt_changes enable row level security;
revoke all on clinic_finance.employee_debt_changes from public, anon, authenticated;

-- the unclaimed part of a debt's schedule, oldest first: [{"month":"YYYY-MM-DD","amount":n}, ...]
create function clinic_finance.employee_debt_open_schedule(p_debt uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('month', i.month, 'amount', i.amount) order by i.month), '[]'::jsonb)
    from clinic_finance.employee_debt_installments i where i.debt_id = p_debt and i.payroll_id is null
$$;
revoke all on function clinic_finance.employee_debt_open_schedule(uuid) from public, anon, authenticated;

-- the full schedule for the screens: claimed (in a payroll) and open installments
create function clinic_finance.employee_debt_schedule_json(p_debt uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('month', i.month, 'amount', i.amount, 'claimed', i.payroll_id is not null,
           'recovered', exists (select 1 from clinic_finance.business_requests b where b.id = i.payroll_id and b.status = 'approved')) order by i.month), '[]'::jsonb)
    from clinic_finance.employee_debt_installments i where i.debt_id = p_debt
$$;
revoke all on function clinic_finance.employee_debt_schedule_json(uuid) from public, anon, authenticated;

create function clinic_finance.employee_debt_change_row(c clinic_finance.employee_debt_changes) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', c.id, 'debt_id', c.debt_id, 'kind', c.kind, 'before', c.before_schedule, 'after', c.after_schedule,
    'reason', c.reason, 'status', c.status, 'at', c.requested_at, 'by', (select name from public.admins where id = c.requested_by),
    'mine', c.requested_by = public.my_admin_id(), 'reviewed_by', (select name from public.admins where id = c.reviewed_by),
    'reviewed_at', c.reviewed_at, 'note', c.review_note,
    'person_name', d.person_name, 'amount', d.amount, 'visit_no', (select v.visit_no from clinic_reception.invoices i join clinic_reception.visits v on v.id = i.visit_id where i.id = d.invoice_id))
    from clinic_finance.employee_debts d where d.id = c.debt_id
$$;
revoke all on function clinic_finance.employee_debt_change_row(clinic_finance.employee_debt_changes) from public, anon, authenticated;

create function public.clinic_finance_employee_debt_change(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); x clinic_finance.employee_debts%rowtype; c clinic_finance.employee_debt_changes%rowtype;
  reviewer boolean; maker boolean := false; cur date := date_trunc('month', (now() at time zone 'Africa/Cairo'))::date;
  k text; tok uuid; why text; open_s jsonb; after_s jsonb; fm date; tm date; lastm date; n int; m0 date; total numeric; i int; part numeric; ok boolean; mon date;
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  p := coalesce(p, '{}'::jsonb);
  reviewer := public.has_role('financial_manager') or public.has_role('super_admin');
  begin maker := clinic_finance.allowed('create'); exception when others then maker := false; end;
  maker := maker or reviewer;

  if p_action = 'schedule' then
    -- a person's approved debts with their full schedule (for «تأجيل / تغيير الأقساط»)
    if not maker and not coalesce((select clinic_finance.allowed('review')), false) then raise exception 'مش مسموح' using errcode = '42501'; end if;
    return jsonb_build_object('can_request', maker, 'this_month', cur, 'debts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'amount', d.amount, 'person_name', d.person_name, 'months', d.months, 'first_month', d.first_month,
        'visit_no', (select v.visit_no from clinic_reception.invoices iv join clinic_reception.visits v on v.id = iv.visit_id where iv.id = d.invoice_id),
        'schedule', clinic_finance.employee_debt_schedule_json(d.id),
        'open_request', (select clinic_finance.employee_debt_change_row(z) from clinic_finance.employee_debt_changes z where z.debt_id = d.id and z.status = 'pending'))
        order by d.requested_at) from clinic_finance.employee_debts d where d.person_id = nullif(p->>'person_id', '')::uuid and d.status = 'approved'), '[]'::jsonb));

  elsif p_action = 'request' then
    if not maker then raise exception 'طلب تغيير الأقساط للحسابات بس' using errcode = '42501'; end if;
    tok := nullif(p->>'token', '')::uuid;
    if tok is null then raise exception 'طلب غير صالح'; end if;
    select * into c from clinic_finance.employee_debt_changes where requested_by = me and token = tok;
    if found then return clinic_finance.employee_debt_change_row(c); end if;
    select * into x from clinic_finance.employee_debts where id = nullif(p->>'debt_id', '')::uuid for update;
    if not found or x.status <> 'approved' then raise exception 'المديونية مش موجودة أو لسه ماتعتمدتش'; end if;
    if exists (select 1 from clinic_finance.employee_debt_changes where debt_id = x.id and status = 'pending') then
      raise exception 'على المديونية دي طلب تغيير مستني موافقة'; end if;
    why := btrim(coalesce(p->>'reason', ''));
    if length(why) < 3 then raise exception 'اكتب السبب'; end if;
    open_s := clinic_finance.employee_debt_open_schedule(x.id);
    if jsonb_array_length(open_s) = 0 then raise exception 'مفيش أقساط باقية تتغيّر — كلها اتخصمت أو في مرتب متجهز'; end if;
    select max(month) into lastm from clinic_finance.employee_debt_installments where debt_id = x.id;
    k := p->>'kind';
    if k = 'postpone' then
      fm := date_trunc('month', nullif(p->>'from_month', '')::date)::date;
      tm := date_trunc('month', nullif(p->>'to_month', '')::date)::date;
      if fm is null or not exists (select 1 from jsonb_array_elements(open_s) e where (e->>'month')::date = fm) then
        raise exception 'اختار قسط لسه ماتخصمش'; end if;
      if tm is null or tm <= lastm or tm > (lastm + interval '6 months')::date then
        raise exception 'التأجيل لشهر بعد آخر قسط (%) ولحد 6 شهور بعده', to_char(lastm, 'YYYY-MM'); end if;
      select coalesce(jsonb_agg(case when (e->>'month')::date = fm then jsonb_build_object('month', tm, 'amount', (e->>'amount')::numeric) else e end
               order by case when (e->>'month')::date = fm then tm else (e->>'month')::date end), '[]'::jsonb)
        into after_s from jsonb_array_elements(open_s) e;
    elsif k = 'resplit' then
      n := nullif(p->>'months', '')::int;
      if n is null or n < 1 or n > 12 then raise exception 'عدد الأقساط من 1 لـ 12'; end if;
      m0 := date_trunc('month', coalesce(nullif(p->>'first_month', '')::date, cur))::date;
      if m0 < cur or m0 > (cur + interval '3 months')::date then raise exception 'أول قسط من مرتب الشهر ده أو الـ 3 شهور الجايين'; end if;
      if exists (select 1 from clinic_finance.employee_debt_installments where debt_id = x.id and payroll_id is not null
                  and month between m0 and (m0 + make_interval(months => n - 1))::date) then
        raise exception 'فيه شهر في الجدول الجديد قسطه في مرتب متجهز بالفعل — ابدأ من شهر بعده'; end if;
      select coalesce(sum((e->>'amount')::numeric), 0) into total from jsonb_array_elements(open_s) e;
      after_s := '[]'::jsonb;
      for i in 1 .. n loop
        part := case when i < n then round(total / n, 2) else total - round(total / n, 2) * (n - 1) end;
        if part <= 0 then raise exception 'المبلغ الباقي صغير على عدد الأقساط ده'; end if;
        after_s := after_s || jsonb_build_array(jsonb_build_object('month', (m0 + make_interval(months => i - 1))::date, 'amount', part));
      end loop;
    else raise exception 'نوع الطلب غير معروف';
    end if;
    insert into clinic_finance.employee_debt_changes(debt_id, kind, before_schedule, after_schedule, reason, requested_by, token)
      values (x.id, k, open_s, after_s, left(why, 300), me, tok) returning * into c;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_change_request', c.id, clinic_finance.employee_debt_change_row(c));
    return clinic_finance.employee_debt_change_row(c);

  elsif p_action = 'cancel' then
    select * into c from clinic_finance.employee_debt_changes where id = (p->>'id')::uuid for update;
    if not found or c.requested_by <> me then raise exception 'الطلب مش موجود'; end if;
    if c.status <> 'pending' then raise exception 'الطلب مينفعش يتلغي'; end if;
    update clinic_finance.employee_debt_changes set status = 'cancelled' where id = c.id returning * into c;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_change_cancel', c.id, '{}'::jsonb);
    return clinic_finance.employee_debt_change_row(c);

  elsif p_action = 'review' then
    if not reviewer then raise exception 'الموافقة للمدير المالي أو المالك بس' using errcode = '42501'; end if;
    perform clinic_finance.lock_day();
    select * into c from clinic_finance.employee_debt_changes where id = (p->>'id')::uuid for update;
    if not found then raise exception 'الطلب مش موجود'; end if;
    if c.status <> 'pending' then return clinic_finance.employee_debt_change_row(c); end if;
    if c.requested_by = me then raise exception 'الموافقة لازم من شخص غير اللي طلب'; end if;
    if p->>'ok' not in ('true', 'false') then raise exception 'حدد القرار'; end if;
    ok := (p->>'ok')::boolean;
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.employee_debt_changes set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = left(btrim(p->>'note'), 300)
        where id = c.id returning * into c;
      insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_change_reject', c.id, clinic_finance.employee_debt_change_row(c));
      return clinic_finance.employee_debt_change_row(c);
    end if;
    perform 1 from clinic_finance.employee_debts where id = c.debt_id for update;
    if clinic_finance.employee_debt_open_schedule(c.debt_id) <> c.before_schedule then
      raise exception 'الجدول اتغيّر من وقت الطلب (قسط دخل مرتب) — ارفض واطلب تاني'; end if;
    for mon in select (e->>'month')::date from jsonb_array_elements(c.after_schedule) e loop
      if exists (select 1 from clinic_finance.employee_debt_installments where debt_id = c.debt_id and payroll_id is not null and month = mon) then
        raise exception 'شهر % قسطه في مرتب متجهز بالفعل — ارفض واطلب تاني', to_char(mon, 'YYYY-MM'); end if;
    end loop;
    delete from clinic_finance.employee_debt_installments where debt_id = c.debt_id and payroll_id is null;
    insert into clinic_finance.employee_debt_installments(debt_id, month, amount)
      select c.debt_id, (e->>'month')::date, (e->>'amount')::numeric from jsonb_array_elements(c.after_schedule) e;
    update clinic_finance.employee_debt_changes set status = 'approved', reviewed_by = me, reviewed_at = now(),
      review_note = nullif(left(btrim(coalesce(p->>'note', '')), 300), '') where id = c.id returning * into c;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'employee_debt_change_approve', c.id, clinic_finance.employee_debt_change_row(c));
    return clinic_finance.employee_debt_change_row(c);

  elsif p_action = 'list' then
    return jsonb_build_object('can_review', reviewer, 'can_request', maker,
      'inbox', case when reviewer then coalesce((select jsonb_agg(clinic_finance.employee_debt_change_row(z) order by z.requested_at)
                 from clinic_finance.employee_debt_changes z where z.status = 'pending' and z.requested_by <> me), '[]'::jsonb) else '[]'::jsonb end,
      'items', case when maker or reviewer then coalesce((select jsonb_agg(clinic_finance.employee_debt_change_row(z) order by z.requested_at desc) from (
                 select * from clinic_finance.employee_debt_changes order by requested_at desc limit 200) z), '[]'::jsonb) else '[]'::jsonb end);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_employee_debt_change(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_employee_debt_change(text, jsonb) to authenticated;


-- ===================== dry-run scenarios (real people, live data, nothing kept) =====================
do $$
declare dbt uuid; mk uuid; mk_admin uuid; ck uuid; ck_admin uuid; rec uuid; rec_admin uuid; pay record; inv uuid; person uuid; r jsonb; o jsonb;
  cn text; s0 text; s1 text; tot0 numeric; tot1 numeric; e0 int; e1 int; lastm date; firstopen date; cur date := date_trunc('month', (now() at time zone 'Africa/Cairo'))::date; m0 date;
begin
  -- maker: a plain accountant if live has one (else the FM); checker: a real FM / super admin ≠ maker; never «Admin Test»
  select a.user_id, a.id into mk, mk_admin from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'accountant') and not public.has_role_for(a.id, 'financial_manager') and a.role <> 'super_admin' order by a.id limit 1;
  if mk is null then select a.user_id, a.id into mk, mk_admin from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'financial_manager') order by a.id limit 1; end if;
  select a.user_id, a.id into ck, ck_admin from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test' and a.id <> mk_admin
     and (public.has_role_for(a.id, 'financial_manager') or a.role = 'super_admin') order by public.has_role_for(a.id, 'financial_manager') desc, a.id limit 1;
  if mk is null or ck is null then raise exception 'need a real accountant / FM (maker) and a different FM / super admin (checker)'; end if;
  raise notice 'maker: % ; checker: %', case when public.has_role_for(mk_admin, 'financial_manager') then 'financial manager' else 'plain accountant' end,
    case when public.has_role_for(ck_admin, 'financial_manager') then 'financial manager' else 'super admin' end;

  -- an approved employee debt: a live one if any, else visit 195's cash receipt converted (inside this rolled-back transaction)
  select id into dbt from clinic_finance.employee_debts where status = 'approved' and exists (select 1 from clinic_finance.employee_debt_installments i where i.debt_id = employee_debts.id and i.payroll_id is null)
   order by requested_at desc limit 1;
  if dbt is null then
    select i.id into inv from clinic_reception.invoices i join clinic_reception.visits v on v.id = i.visit_id join clinic_reception.workspaces w on w.id = i.workspace_id and w.mode = 'live'
     where v.visit_no = 195 order by i.created_at limit 1;
    select p.* into pay from clinic_reception.payments p join clinic_reception.allocations al on al.payment_id = p.id where al.invoice_id = inv and p.method = 'cash' order by p.created_at desc limit 1;
    if pay.id is null then raise exception 'no approved employee debt on live and visit 195 has no cash receipt to build one'; end if;
    select id into dbt from clinic_finance.employee_debts where payment_id = pay.id and status = 'pending';
    if dbt is null then
      select a.user_id, a.id into rec, rec_admin from public.admins a join clinic_reception.shifts s on s.cashier_id = a.id where s.id = pay.shift_id;
      select s.person_id into person from clinic_reception.staff_for_patient(pay.patient_id, (now() at time zone 'Africa/Cairo')::date) s limit 1;
      perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
      r := public.clinic_finance_employee_debt('request', jsonb_build_object('kind', 'convert', 'payment_id', pay.id, 'person_id', person, 'months', 3, 'first_month', cur,
             'reason', 'dry-run: مديونية للتجربة', 'token', gen_random_uuid()));
      execute 'reset role'; dbt := (r->>'id')::uuid;
    end if;
    perform set_config('request.jwt.claim.sub', ck::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt('review', jsonb_build_object('id', dbt, 'ok', true));
    execute 'reset role';
    raise notice 'built a debt for the test (visit 195 convert, approved by the checker, rolled back at the end): %', r->>'status';
  else raise notice 'using an existing approved live debt (its schedule is only changed inside this rolled-back transaction)';
  end if;
  select string_agg(to_char(month, 'YYYY-MM') || ' ' || amount || case when payroll_id is not null then ' (في مرتب)' else '' end, ', ' order by month), sum(amount), max(month)
    into s0, tot0, lastm from clinic_finance.employee_debt_installments where debt_id = dbt;
  select min(month) into firstopen from clinic_finance.employee_debt_installments where debt_id = dbt and payroll_id is null;
  select count(*) into e0 from clinic_finance.entries;
  raise notice 'schedule before: [%] total %', s0, tot0;

  -- «تأجيل / تغيير الأقساط» → schedule view (maker)
  select person_id into person from clinic_finance.employee_debts where id = dbt;
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  o := public.clinic_finance_employee_debt_change('schedule', jsonb_build_object('person_id', person));
  execute 'reset role';
  raise notice 'schedule view (maker): can_request %, % approved debt(s)', o->>'can_request', jsonb_array_length(o->'debts');

  -- A) postpone the first open installment to the month after the last one; the checker approves
  begin
    perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt_change('request', jsonb_build_object('debt_id', dbt, 'kind', 'postpone', 'from_month', firstopen,
           'to_month', (lastm + interval '1 month')::date, 'reason', 'dry-run: تأجيل قسط', 'token', gen_random_uuid()));
    begin perform public.clinic_finance_employee_debt_change('review', jsonb_build_object('id', r->>'id', 'ok', true)); raise exception 'maker approved!';
    exception when others then if sqlerrm = 'maker approved!' then raise; end if; raise notice 'A maker «موافقة» refused: %', sqlerrm; end;
    perform set_config('request.jwt.claim.sub', ck::text, true);
    r := public.clinic_finance_employee_debt_change('review', jsonb_build_object('id', r->>'id', 'ok', true));
    execute 'reset role';
    select string_agg(to_char(month, 'YYYY-MM') || ' ' || amount, ', ' order by month), sum(amount) into s1, tot1 from clinic_finance.employee_debt_installments where debt_id = dbt;
    select count(*) into e1 from clinic_finance.entries;
    raise notice 'A postpone % → %: status %, schedule after: [%], total % (was %), new entries %', to_char(firstopen, 'YYYY-MM'), to_char(lastm + interval '1 month', 'YYYY-MM'), r->>'status', s1, tot1, tot0, e1 - e0;
    if tot1 <> tot0 or e1 <> e0 then raise exception 'A: total or books changed'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'A: % [%]', sqlerrm, cn; end if; end;

  -- B) resplit the rest into 4 from the first allowed month; the checker approves
  begin
    select min(m) into m0 from generate_series(cur, (cur + interval '3 months')::date, interval '1 month') g(m)
     where not exists (select 1 from clinic_finance.employee_debt_installments i where i.debt_id = dbt and i.payroll_id is not null and i.month between g.m::date and (g.m + interval '3 months')::date);
    perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt_change('request', jsonb_build_object('debt_id', dbt, 'kind', 'resplit', 'months', 4, 'first_month', m0,
           'reason', 'dry-run: تغيير عدد الأقساط', 'token', gen_random_uuid()));
    perform set_config('request.jwt.claim.sub', ck::text, true);
    r := public.clinic_finance_employee_debt_change('review', jsonb_build_object('id', r->>'id', 'ok', true));
    execute 'reset role';
    select string_agg(to_char(month, 'YYYY-MM') || ' ' || amount, ', ' order by month), sum(amount) into s1, tot1 from clinic_finance.employee_debt_installments where debt_id = dbt;
    raise notice 'B resplit into 4 from %: status %, schedule after: [%], total % (was %)', to_char(m0, 'YYYY-MM'), r->>'status', s1, tot1, tot0;
    if tot1 <> tot0 then raise exception 'B: total changed'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'B: % [%]', sqlerrm, cn; end if; end;

  -- C) reject (checker, reason) and «الغي» (maker); reception refused
  begin
    perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_employee_debt_change('request', jsonb_build_object('debt_id', dbt, 'kind', 'resplit', 'months', 1, 'first_month', m0, 'reason', 'dry-run رفض', 'token', gen_random_uuid()));
    perform set_config('request.jwt.claim.sub', ck::text, true);
    r := public.clinic_finance_employee_debt_change('review', jsonb_build_object('id', r->>'id', 'ok', false, 'note', 'dry-run: مرفوض'));
    perform set_config('request.jwt.claim.sub', mk::text, true);
    o := public.clinic_finance_employee_debt_change('request', jsonb_build_object('debt_id', dbt, 'kind', 'resplit', 'months', 2, 'first_month', m0, 'reason', 'dry-run إلغاء', 'token', gen_random_uuid()));
    o := public.clinic_finance_employee_debt_change('cancel', jsonb_build_object('id', o->>'id'));
    execute 'reset role';
    raise notice 'C reject: %, cancel: %', r->>'status', o->>'status';
    select a.user_id into rec from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test' and a.role = 'reception' order by (a.name like '%مازن%') desc limit 1;
    if rec is not null then
      perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
      begin perform public.clinic_finance_employee_debt_change('request', jsonb_build_object('debt_id', dbt, 'kind', 'resplit', 'months', 2, 'reason', 'x x x', 'token', gen_random_uuid()));
        raise exception 'reception requested!';
      exception when others then if sqlerrm = 'reception requested!' then raise; end if; raise notice 'C reception request refused: %', sqlerrm; end;
      execute 'reset role';
    end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'C: % [%]', sqlerrm, cn; end if; end;
  raise notice 'employee debt reschedule dry-run OK — nothing kept (ROLLBACK)';
exception when others then
  get stacked diagnostics cn = constraint_name;
  raise exception '%', sqlerrm || coalesce(' [' || nullif(cn, '') || ']', '');
end $$;
rollback;
