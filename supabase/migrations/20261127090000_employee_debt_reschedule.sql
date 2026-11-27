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
begin;

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

commit;
