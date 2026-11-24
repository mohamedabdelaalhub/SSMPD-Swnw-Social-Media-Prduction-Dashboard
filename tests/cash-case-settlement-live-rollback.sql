-- Live rollback dry-run for 20261124190000_cash_case_settlement.sql («تسوية فروق الخزن»). ONE transaction ending with ROLLBACK:
-- the migration body (inlined), then on a REAL open cash case: the FM walks it to «القرار» if needed, the FM (maker, create) files the
-- settlement, the owner / GM (checker, review) approves, and the drawer book goes back to 0. Also: the maker cannot approve his own
-- request, and the ledger stays balanced. Nothing is kept. Run the whole file as one script.
begin;
-- ===== migration body (20261124190000) =====

do $$ begin
  if to_regprocedure('public.clinic_finance_case_settle(text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_finance.cash_cases') is null or to_regprocedure('clinic_finance.cash_line_guard()') is null
     or to_regprocedure('clinic_finance.ended_shift_entry_guard()') is null or to_regclass('clinic_finance.account_config') is null then
    raise exception 'مكونات الخزينة وفروقها غير موجودة'; end if;
  if exists (select 1 from clinic_finance.accounts where code = '4119' and name <> 'فروق زيادة الخزينة')
     or exists (select 1 from clinic_finance.accounts where code = '5227' and name <> 'عجز الخزينة') then raise exception 'الأكواد 4119 / 5227 مستخدمة لحسابات تانية'; end if;
end $$;

insert into clinic_finance.accounts(code, name, kind) values ('4119', 'فروق زيادة الخزينة', 'income'), ('5227', 'عجز الخزينة', 'expense') on conflict do nothing;
insert into clinic_finance.account_config(code, is_system) values ('4119', true), ('5227', true) on conflict do nothing;

alter table clinic_finance.cash_cases
  add column settle_status text check (settle_status in ('pending', 'approved', 'rejected')),
  add column settle_kind text check (settle_kind in ('surplus_income', 'shortage_expense', 'shortage_employee')),
  add column settle_note text,
  add column settle_by uuid references public.admins(id),
  add column settle_at timestamptz,
  add column settle_reviewed_by uuid references public.admins(id),
  add column settle_reviewed_at timestamptz,
  add column settle_review_note text,
  add column settle_entry_id uuid references clinic_finance.entries(id);

create table clinic_finance.case_settle_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.case_settle_saved_defs from public, anon, authenticated;
do $$
declare def text; a constant text := $s$and e.source<>'treasury_transfer_out'$s$; b constant text := $s$new.source not in('treasury_transfer_out','treasury_binding')$s$;
begin
  def := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if (length(def) - length(replace(def, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في cash_line_guard مش موجودة مرة واحدة (md5 %)', md5(def); end if;
  insert into clinic_finance.case_settle_saved_defs values ('cash_line_guard', def);
  execute replace(def, a, a || $s$ and e.source<>'cash_case_settlement'$s$);
  def := pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure);
  if (length(def) - length(replace(def, b, ''))) / length(b) <> 1 then raise exception 'نقطة الربط في ended_shift_entry_guard مش موجودة مرة واحدة (md5 %)', md5(def); end if;
  insert into clinic_finance.case_settle_saved_defs values ('ended_shift_entry_guard', def);
  execute replace(def, b, $s$new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement')$s$);
end $$;

create function public.clinic_finance_case_settle(p_action text, p_payload jsonb, p_token uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; c clinic_finance.cash_cases%rowtype; s clinic_finance.shifts%rowtype; r clinic_finance.registers%rowtype; op clinic_finance.journal_operations%rowtype;
  k text; note text := btrim(coalesce(p_payload->>'note', '')); amt numeric; e uuid; res jsonb; approve boolean; dr text; cr text; who text;
begin
  if p_action = 'list' then
    me := clinic_finance.require_access('view');
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'register_balance', clinic_finance.treasury_balance(sh.register_id),
        'kinds', case when x.difference > 0 then '["surplus_income"]'::jsonb
                      when x.responsibility = 'employee' and x.decision = 'refer_management' and x.responsible_id is not null then '["shortage_expense","shortage_employee"]'::jsonb
                      else '["shortage_expense"]'::jsonb end,
        'responsible_name', (select a.name from public.admins a where a.id = x.responsible_id),
        'settle_by_name', (select a.name from public.admins a where a.id = x.settle_by),
        'settle_reviewed_by_name', (select a.name from public.admins a where a.id = x.settle_reviewed_by)))
      from clinic_finance.cash_cases x join clinic_finance.shifts sh on sh.id = x.shift_id
      where clinic_finance.allowed('review') or sh.cashier_id = me), '[]'::jsonb);
  end if;
  if p_token is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'طلب غير صالح'; end if;
  me := clinic_finance.require_access(case when p_action = 'review' then 'review' else 'create' end);
  perform clinic_finance.lock_day();
  select * into op from clinic_finance.journal_operations where actor = me and token = p_token;
  if found then
    if op.action <> 'cash_case_settle_' || p_action or op.payload <> p_payload then raise exception 'مفتاح مكرر لبيانات مختلفة'; end if;
    return op.result;
  end if;
  select * into c from clinic_finance.cash_cases where id = nullif(p_payload->>'id', '')::uuid for update;
  if not found then raise exception 'ملف الفرق غير موجود'; end if;
  select * into s from clinic_finance.shifts where id = c.shift_id;
  select * into r from clinic_finance.registers where id = s.register_id;
  if s.cashier_id = me then raise exception 'لا يمكن تسوية فرق ورديتك بنفسك'; end if;
  if length(note) < 3 then raise exception 'اكتب السبب والمستند'; end if;
  if p_action = 'request' then
    if c.status <> 'decided' then raise exception 'التسوية بعد «القرار» بس — استكمل المسار الأول'; end if;
    if c.settle_status in ('pending', 'approved') then raise exception 'الفرق ده عليه تسوية بالفعل'; end if;
    k := p_payload->>'kind';
    if c.difference > 0 and k is distinct from 'surplus_income' then raise exception 'الزيادة تتسوّى «إيراد فروق زيادة الخزينة»'; end if;
    if c.difference < 0 and k not in ('shortage_expense', 'shortage_employee') then raise exception 'اختار طريقة تسوية العجز'; end if;
    if k = 'shortage_employee' and not (c.responsibility = 'employee' and c.decision = 'refer_management' and c.responsible_id is not null) then
      raise exception 'التحميل على الموظف بس لما المسؤولية «مسؤولية موظف» والقرار «إحالة للإدارة»'; end if;
    update clinic_finance.cash_cases set settle_status = 'pending', settle_kind = k, settle_note = left(note, 1000), settle_by = me, settle_at = now(),
      settle_reviewed_by = null, settle_reviewed_at = null, settle_review_note = null, updated_by = me, updated_at = now() where id = c.id;
  elsif p_action = 'review' then
    if c.settle_status is distinct from 'pending' then raise exception 'مفيش تسوية مستنية مراجعة على الفرق ده'; end if;
    if c.settle_by = me then raise exception 'المراجعة لازم من شخص غير اللي طلب التسوية'; end if;
    if p_payload->>'approve' not in ('true', 'false') then raise exception 'حدد القرار'; end if;
    approve := (p_payload->>'approve')::boolean;
    if approve then
      amt := abs(c.difference);
      if c.settle_kind = 'surplus_income' then dr := '1111'; cr := '4119';
      elsif c.settle_kind = 'shortage_expense' then dr := '5227'; cr := '1111';
      else dr := '1142'; cr := '1111'; end if;
      select a.name into who from public.admins a where a.id = c.responsible_id;
      insert into clinic_finance.entries(source, source_id, description, shift_id, created_by)
        values ('cash_case_settlement', c.id, 'تسوية فرق خزينة — ' || r.name || case when c.settle_kind = 'shortage_employee' then ' — على الموظف ' || coalesce(who, '') else '' end,
                c.shift_id, me) returning id into e;
      insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, dr, amt, 0), (e, cr, 0, amt);
      update clinic_finance.cash_cases set settle_status = 'approved', settle_entry_id = e, settle_reviewed_by = me, settle_reviewed_at = now(),
        settle_review_note = left(note, 1000), updated_by = me, updated_at = now() where id = c.id;
    else
      update clinic_finance.cash_cases set settle_status = 'rejected', settle_reviewed_by = me, settle_reviewed_at = now(),
        settle_review_note = left(note, 1000), updated_by = me, updated_at = now() where id = c.id;
    end if;
  else raise exception 'إجراء غير معروف';
  end if;
  select * into c from clinic_finance.cash_cases where id = c.id;
  res := jsonb_build_object('id', c.id, 'settle_status', c.settle_status, 'settle_kind', c.settle_kind, 'entry_id', c.settle_entry_id,
    'register_balance', clinic_finance.treasury_balance(s.register_id));
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'cash_case_settle_' || p_action, c.id, res || jsonb_build_object('note', note));
  insert into clinic_finance.journal_operations(actor, token, action, payload, result, created_at) values (me, p_token, 'cash_case_settle_' || p_action, p_payload, res, now());
  return res;
end $$;
revoke all on function public.clinic_finance_case_settle(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_case_settle(text, jsonb, uuid) to authenticated;

-- ===== test =====
do $$
declare maker uuid; checker uuid; c clinic_finance.cash_cases%rowtype; reg uuid; b0 numeric; b1 numeric; r jsonb; ok boolean; mk uuid; ck uuid;
begin
  select a.user_id, a.id into maker, mk from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id, a.id into checker, ck from public.admins a where a.active and a.user_id is not null and a.role in ('super_admin', 'general_manager') and a.id <> mk order by a.role desc, a.id limit 1;
  if maker is null or checker is null then raise exception 'Need an FM (maker) and an owner / GM (checker) with logins'; end if;
  select x.* into c from clinic_finance.cash_cases x join clinic_finance.shifts s on s.id = x.shift_id
   where x.settle_status is null and s.cashier_id not in (mk, ck) order by abs(x.difference), x.id limit 1;
  if c.id is null then raise exception 'No open cash case to test on'; end if;
  select s.register_id into reg from clinic_finance.shifts s where s.id = c.shift_id;
  b0 := clinic_finance.treasury_balance(reg);
  perform set_config('request.jwt.claim.sub', maker::text, true); execute 'set local role authenticated';
  if c.status = 'recorded' then perform public.clinic_finance_case_step(c.id, 'review', 'اختبار تراجع — مراجعة'); c.status := 'reviewed'; end if;
  if c.status = 'reviewed' then perform public.clinic_finance_case_step(c.id, 'responsibility', 'اختبار تراجع — مسؤولية', 'process_error', null, null); c.status := 'responsibility'; end if;
  if c.status = 'responsibility' then perform public.clinic_finance_case_step(c.id, 'decision', 'اختبار تراجع — قرار', null, null, 'correct_records'); end if;
  r := public.clinic_finance_case_settle('request', jsonb_build_object('id', c.id, 'kind', case when c.difference > 0 then 'surplus_income' else 'shortage_expense' end, 'note', 'اختبار تراجع — تسوية'), gen_random_uuid());
  if r->>'settle_status' <> 'pending' then raise exception 'Request failed: %', r; end if;
  ok := false; begin perform public.clinic_finance_case_settle('review', jsonb_build_object('id', c.id, 'approve', true, 'note', 'اعتماد ذاتي'), gen_random_uuid());
    exception when others then ok := sqlerrm like '%غير اللي طلب%'; end;
  if not ok then raise exception 'Maker approved his own settlement'; end if;
  perform set_config('request.jwt.claim.sub', checker::text, true);
  r := public.clinic_finance_case_settle('review', jsonb_build_object('id', c.id, 'approve', true, 'note', 'اختبار تراجع — اعتماد'), gen_random_uuid());
  execute 'reset role';
  b1 := clinic_finance.treasury_balance(reg);
  if r->>'settle_status' <> 'approved' or b1 <> b0 - c.difference then raise exception 'Settlement wrong: % (balance % → %, difference %)', r, b0, b1, c.difference; end if;
  if exists (select 1 from clinic_finance.lines group by entry_id having sum(debit - credit) <> 0) then raise exception 'Unbalanced ledger'; end if;
  raise notice 'cash case settlement live rollback OK: case % difference %, drawer % → %', c.id, c.difference, b0, b1;
end $$;
rollback;
select jsonb_build_object('test', 'cash case settlement live rollback passed',
  'migration_left_applied', to_regprocedure('public.clinic_finance_case_settle(text,jsonb,uuid)') is not null);
