-- Live rollback dry-run for 20261126100000_drawer_payout_requests.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Real people by role (reception cashier, general manager or super admin, financial manager, accountant) with their logins.
-- A THROWAWAY collection register (forced receive-only like the real ones) + shift with 1,000 cash seeded by a posted collection,
-- a throwaway approved employment contract, a throwaway supplier with a 150 invoice event and a throwaway invoice photo object.
-- Proves: advance request → GM/SA first → FM second → the cashier's «اتصرف» posts Dr 1142 / Cr drawer and counts in the employee
-- advance; supplier → accountant (refused while the balance doesn't cover it) → pay Dr 2111; FM cannot give the first approval;
-- the requester cannot approve; a direct 'drawer_payout' post without an approved request, on another shift, or for another
-- amount is refused; any other payout from the register is still refused.
begin;

do $$ declare d text;
  a constant text := $a$p_credit='1111' and p_source<>'deposit' and $a$;
  b constant text := $b$and e.source<>'treasury_transfer_out'$b$;
begin
  if to_regclass('clinic_finance.business_requests') is null or to_regclass('clinic_finance.supplier_actions') is null
     or to_regprocedure('clinic_finance.cash_limit(uuid)') is null or to_regprocedure('clinic_finance.cash_line_guard()') is null then
    raise exception 'مكونات الخزينة أو السلف أو الموردين غير موجودة'; end if;
  if to_regclass('clinic_finance.drawer_requests') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  d := pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'سطر اتجاه الخزينة في post اتغيّر (md5 %)', md5(d); end if;
  d := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if (length(d) - length(replace(d, b, ''))) / length(b) <> 1 then raise exception 'نقطة الربط في cash_line_guard اتغيّرت (md5 %)', md5(d); end if;
end $$;

insert into clinic_finance.accounts(code, name, kind) values ('5212', 'حوافز وعمولات الطاقم', 'expense') on conflict (code) do nothing;
insert into clinic_finance.account_config(code, is_system) values ('5212', true) on conflict (code) do nothing;

create table clinic_finance.drawer_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('advance', 'incentive', 'supplier')),
  subject text,                                   -- employee finance subject (advance / incentive)
  subject_name text,
  supplier_id uuid references public.inventory_suppliers(id),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  evidence text check (evidence is null or length(evidence) between 2 and 200),
  requested_by uuid not null references public.admins(id),
  requested_at timestamptz not null default now(),
  token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'first_ok', 'approved', 'paid', 'rejected', 'cancelled')),
  first_by uuid references public.admins(id), first_at timestamptz,
  approved_by uuid references public.admins(id), approved_at timestamptz,
  review_note text,
  paid_shift uuid references clinic_finance.shifts(id), paid_at timestamptz, entry_id uuid, linked_id uuid,
  unique (requested_by, token),
  check ((kind = 'supplier') = (supplier_id is not null)),
  check (kind = 'supplier' or subject is not null)
);
create index drawer_requests_status_idx on clinic_finance.drawer_requests(status, requested_at desc);
alter table clinic_finance.drawer_requests enable row level security;
revoke all on clinic_finance.drawer_requests from public, anon, authenticated;

create table clinic_finance.drawer_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.drawer_saved_defs from public, anon, authenticated;
insert into clinic_finance.drawer_saved_defs values
  ('post', pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure)),
  ('cash_line_guard', pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure));

-- the ONLY door through the two cash-out guards
create function clinic_finance.drawer_payout_ok(p_id uuid, p_shift uuid, p_amount numeric) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_finance.drawer_requests r join clinic_finance.shifts s on s.id = p_shift
                 where r.id = p_id and r.status = 'approved' and r.paid_at is null and r.amount = p_amount
                   and s.cashier_id = r.requested_by and s.status = 'open' and s.ended_at is null and not s.is_main)
$$;
revoke all on function clinic_finance.drawer_payout_ok(uuid, uuid, numeric) from public, anon, authenticated;

do $$ begin
  execute replace(pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure),
    $a$p_credit='1111' and p_source<>'deposit' and $a$,
    $b$p_credit='1111' and p_source<>'deposit' and not (p_source='drawer_payout' and clinic_finance.drawer_payout_ok(p_source_id,p_shift,p_amount)) and $b$);
  execute replace(pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure),
    $a$and e.source<>'treasury_transfer_out'$a$,
    $b$and e.source<>'treasury_transfer_out' and not (e.source='drawer_payout' and clinic_finance.drawer_payout_ok(e.source_id,e.shift_id,new.credit))$b$);
end $$;

create function clinic_finance.drawer_row(r clinic_finance.drawer_requests) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'subject', r.subject, 'subject_name', r.subject_name, 'supplier_id', r.supplier_id,
    'supplier', (select name from public.inventory_suppliers where id = r.supplier_id), 'amount', r.amount, 'reason', r.reason,
    'evidence', r.evidence, 'status', r.status, 'at', r.requested_at,
    'by', (select name from public.admins where id = r.requested_by), 'mine', r.requested_by = public.my_admin_id(),
    'first_by', (select name from public.admins where id = r.first_by), 'first_at', r.first_at,
    'approved_by', (select name from public.admins where id = r.approved_by), 'approved_at', r.approved_at,
    'note', r.review_note, 'paid_at', r.paid_at)
$$;
revoke all on function clinic_finance.drawer_row(clinic_finance.drawer_requests) from public, anon, authenticated;

create function public.clinic_finance_drawer_request(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); role text := public.my_role(); r clinic_finance.drawer_requests%rowtype; sh clinic_finance.shifts%rowtype;
  k text; amt numeric; tok uuid; sub text; sname text; sup uuid; ev text; why text; ok boolean; note text; v uuid; e uuid; lim numeric;
  step1 boolean; step2 boolean; supok boolean;
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  step1 := role in ('general_manager', 'super_admin');
  step2 := role = 'financial_manager';
  supok := role in ('accountant', 'financial_manager');
  p := coalesce(p, '{}'::jsonb);

  if p_action = 'status' then
    select * into sh from clinic_finance.shifts where cashier_id = me and status = 'open' and ended_at is null and not is_main order by opened_at desc limit 1;
    return jsonb_build_object(
      'shift_id', sh.id, 'cash', case when sh.id is not null then clinic_finance.cash_limit(sh.id) end,
      'can_request', sh.id is not null, 'can_first', step1, 'can_final', step2, 'can_supplier', supok,
      'employees', case when sh.id is not null then (select coalesce(jsonb_agg(jsonb_build_object('subject', x.subject, 'name', x.name) order by x.name), '[]'::jsonb)
         from (select distinct on (b.subject) b.subject, coalesce(b.payload->>'employee_name', b.subject) name from clinic_finance.business_requests b
               where b.kind = 'employment' and b.status = 'approved' and (b.payload->>'to')::date >= (now() at time zone 'Africa/Cairo')::date
               order by b.subject, b.created_at desc) x) else '[]'::jsonb end,
      'suppliers', case when sh.id is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb) from public.inventory_suppliers s where s.active) else '[]'::jsonb end,
      'mine', (select coalesce(jsonb_agg(clinic_finance.drawer_row(x) order by x.requested_at desc), '[]'::jsonb) from (select * from clinic_finance.drawer_requests
               where requested_by = me and (status in ('pending', 'first_ok', 'approved') or requested_at > now() - interval '3 days') order by requested_at desc limit 20) x),
      'inbox', (select coalesce(jsonb_agg(clinic_finance.drawer_row(x) || jsonb_build_object('step', case when x.kind = 'supplier' then 'supplier' when x.status = 'pending' then 'first' else 'final' end,
                 'supplier_balance', case when x.kind = 'supplier' then clinic_finance.supplier_balance(x.supplier_id) end,
                 'employee_advance', case when x.kind = 'advance' then clinic_finance.employee_advance(x.subject) end) order by x.requested_at), '[]'::jsonb)
               from clinic_finance.drawer_requests x where x.requested_by <> me and (
                 (x.kind <> 'supplier' and x.status = 'pending' and step1) or
                 (x.kind <> 'supplier' and x.status = 'first_ok' and step2 and x.first_by <> me) or
                 (x.kind = 'supplier' and x.status = 'pending' and supok))));

  elsif p_action = 'request' then
    perform clinic_finance.lock_day();
    k := p->>'kind'; why := btrim(coalesce(p->>'reason', '')); ev := nullif(btrim(coalesce(p->>'evidence', '')), '');
    begin amt := (p->>'amount')::numeric; tok := (p->>'token')::uuid; exception when others then raise exception 'راجع المبلغ'; end;
    if k is null or k not in ('advance', 'incentive', 'supplier') then raise exception 'اختار نوع الصرف'; end if;
    if amt is null or amt <= 0 or amt > 100000 or amt <> round(amt, 2) then raise exception 'المبلغ غير صالح'; end if;
    if tok is null then raise exception 'حاول تاني'; end if;
    if length(why) < 3 then raise exception 'اكتب السبب'; end if;
    if not exists (select 1 from clinic_finance.shifts where cashier_id = me and status = 'open' and ended_at is null and not is_main) then
      raise exception 'افتح ورديتك الأول — الطلب بيتصرف من درجك'; end if;
    select * into r from clinic_finance.drawer_requests where requested_by = me and token = tok;
    if found then return clinic_finance.drawer_row(r); end if;
    if k in ('advance', 'incentive') then
      sub := btrim(coalesce(p->>'subject', ''));
      select coalesce(b.payload->>'employee_name', b.subject) into sname from clinic_finance.business_requests b
       where b.kind = 'employment' and b.status = 'approved' and b.subject = sub order by b.created_at desc limit 1;
      if sname is null then raise exception 'اختار الموظف (لازم يكون ليه عقد معتمد)'; end if;
    else
      begin sup := (p->>'supplier_id')::uuid; exception when others then sup := null; end;
      if sup is null or not exists (select 1 from public.inventory_suppliers where id = sup and active) then raise exception 'اختار المورد'; end if;
      if ev is null or split_part(ev, '/', 1) <> auth.uid()::text
         or not exists (select 1 from storage.objects where bucket_id = 'shift-expense-receipts' and name = ev) then raise exception 'صوّر فاتورة المورد الأول'; end if;
    end if;
    insert into clinic_finance.drawer_requests(kind, subject, subject_name, supplier_id, amount, reason, evidence, requested_by, token)
      values (k, sub, sname, sup, amt, why, ev, me, tok) returning * into r;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'drawer_request', r.id, jsonb_build_object('kind', k, 'amount', amt));
    return clinic_finance.drawer_row(r);

  elsif p_action = 'review' then
    perform clinic_finance.lock_day();
    select * into r from clinic_finance.drawer_requests where id = (p->>'id')::uuid for update;
    if not found then raise exception 'الطلب مش موجود'; end if;
    if r.requested_by = me then raise exception 'مينفعش توافق على طلبك' using errcode = '42501'; end if;
    ok := coalesce((p->>'ok')::boolean, false); note := nullif(btrim(coalesce(p->>'note', '')), '');
    if r.kind = 'supplier' then
      if r.status <> 'pending' then raise exception 'الطلب اتراجع قبل كده'; end if;
      if not supok then raise exception 'موافقة فاتورة المورد للمحاسب أو المدير المالي' using errcode = '42501'; end if;
      if ok and clinic_finance.supplier_balance(r.supplier_id) < r.amount then
        raise exception 'رصيد المورد أقل من المبلغ — سجّل فاتورة المورد بأصنافها في المخزن الأول (المستحق %)', clinic_finance.supplier_balance(r.supplier_id); end if;
    elsif r.status = 'pending' then
      if not step1 then raise exception 'الموافقة الأولى للمدير العام أو السوبر أدمن' using errcode = '42501'; end if;
    elsif r.status = 'first_ok' then
      if not step2 then raise exception 'الموافقة التانية للمدير المالي' using errcode = '42501'; end if;
      if r.first_by = me then raise exception 'الموافقتين لازم من شخصين مختلفين' using errcode = '42501'; end if;
    else raise exception 'الطلب اتراجع قبل كده'; end if;
    if not ok then
      if note is null or length(note) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.drawer_requests set status = 'rejected', review_note = note,
        first_by = coalesce(first_by, case when status = 'pending' and kind <> 'supplier' then me end), first_at = coalesce(first_at, case when status = 'pending' and kind <> 'supplier' then now() end),
        approved_by = case when status = 'first_ok' or kind = 'supplier' then me end, approved_at = case when status = 'first_ok' or kind = 'supplier' then now() end
       where id = r.id returning * into r;
    elsif r.kind <> 'supplier' and r.status = 'pending' then
      update clinic_finance.drawer_requests set status = 'first_ok', first_by = me, first_at = now(), review_note = note where id = r.id returning * into r;
    else
      update clinic_finance.drawer_requests set status = 'approved', approved_by = me, approved_at = now(), review_note = coalesce(note, review_note) where id = r.id returning * into r;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'drawer_review', r.id, jsonb_build_object('ok', ok, 'status', r.status, 'note', note));
    return clinic_finance.drawer_row(r);

  elsif p_action = 'cancel' then
    select * into r from clinic_finance.drawer_requests where id = (p->>'id')::uuid for update;
    if not found or r.requested_by <> me then raise exception 'الطلب مش موجود'; end if;
    if r.status not in ('pending', 'first_ok', 'approved') then raise exception 'الطلب مينفعش يتلغي'; end if;
    update clinic_finance.drawer_requests set status = 'cancelled' where id = r.id returning * into r;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'drawer_cancel', r.id, '{}'::jsonb);
    return clinic_finance.drawer_row(r);

  elsif p_action = 'pay' then
    perform clinic_finance.lock_day();
    select * into r from clinic_finance.drawer_requests where id = (p->>'id')::uuid for update;
    if not found or r.requested_by <> me then raise exception 'الطلب مش موجود'; end if;
    if r.status = 'paid' then return clinic_finance.drawer_row(r); end if;
    if r.status <> 'approved' then raise exception 'الطلب لسه مستني الموافقة'; end if;
    select * into sh from clinic_finance.shifts where cashier_id = me and status = 'open' and ended_at is null and not is_main order by opened_at desc limit 1 for update;
    if not found then raise exception 'افتح ورديتك الأول'; end if;
    lim := clinic_finance.cash_limit(sh.id);
    if r.amount > lim then raise exception 'الكاش اللي في درجك (%) أقل من المبلغ — استنى تحصيل أو اطلب من الحسابات', lim; end if;
    if r.kind = 'advance' then
      insert into clinic_finance.business_requests(kind, subject, reference, amount, payload, created_by, token, status, reviewed_by, review_note)
        values ('advance', r.subject, 'DRW-' || left(replace(r.id::text, '-', ''), 10), r.amount,
                jsonb_build_object('source', 'drawer', 'drawer_id', r.id, 'method', 'cash', 'shift_id', sh.id, 'note', r.reason, 'employee_name', r.subject_name, 'first_by', r.first_by),
                r.requested_by, gen_random_uuid(), 'approved', r.approved_by, 'طلب صرف من الدرج') returning id into v;
      e := clinic_finance.post('drawer_payout', r.id, 'سلفة موظف من الدرج — ' || r.subject_name, sh.id, '1142', '1111', r.amount);
    elsif r.kind = 'incentive' then
      e := clinic_finance.post('drawer_payout', r.id, 'حافز / نسبة من الدرج — ' || r.subject_name, sh.id, '5212', '1111', r.amount);
    else
      if clinic_finance.supplier_balance(r.supplier_id) < r.amount then raise exception 'رصيد المورد بقى أقل من المبلغ — راجع الحسابات'; end if;
      insert into clinic_finance.supplier_actions(kind, supplier_id, amount, method, shift_id, reference, note, payload, created_by, token, status, reviewed_by, reviewed_at, review_note)
        values ('supplier_payment', r.supplier_id, r.amount, 'cash', sh.id, 'DRW-' || left(replace(r.id::text, '-', ''), 10), r.reason,
                jsonb_build_object('source', 'drawer', 'drawer_id', r.id, 'evidence', r.evidence), r.requested_by, gen_random_uuid(), 'approved', r.approved_by, now(), 'طلب صرف من الدرج')
        returning id into v;
      e := clinic_finance.post('drawer_payout', r.id, 'سداد مورد من الدرج — ' || (select name from public.inventory_suppliers where id = r.supplier_id), sh.id, '2111', '1111', r.amount);
    end if;
    update clinic_finance.drawer_requests set status = 'paid', paid_shift = sh.id, paid_at = now(), entry_id = e, linked_id = v where id = r.id returning * into r;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'drawer_paid', r.id, jsonb_build_object('amount', r.amount, 'shift', sh.id, 'entry', e));
    return clinic_finance.drawer_row(r);

  elsif p_action = 'list' then
    perform clinic_finance.require_access('review');
    return jsonb_build_object('items', (select coalesce(jsonb_agg(clinic_finance.drawer_row(x) order by x.requested_at desc), '[]'::jsonb)
      from (select * from clinic_finance.drawer_requests where requested_at::date between coalesce((p->>'from')::date, current_date - 30) and coalesce((p->>'to')::date, current_date)
            order by requested_at desc limit 500) x));
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_drawer_request(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_drawer_request(text, jsonb) to authenticated;


do $$
declare ca uuid; cu uuid; ga uuid; gu uuid; fa uuid; fu uuid; aa uuid; au uuid; acct text; inc text; rg uuid; sid uuid; sup uuid; ev text;
  r jsonb; s jsonb; ok boolean; sub text := 'DRW-TEST-' || left(gen_random_uuid()::text, 8);
begin
  select a.id, a.user_id into ca, cu from public.admins a where a.active and a.user_id is not null and a.role = 'reception'
     and not exists (select 1 from clinic_finance.shifts x where x.cashier_id = a.id and x.status = 'open' and x.ended_at is null and not x.is_main) order by a.id limit 1;
  select a.id, a.user_id into ga, gu from public.admins a where a.active and a.user_id is not null and a.role in ('general_manager', 'super_admin') order by a.role, a.id limit 1;
  select a.id, a.user_id into fa, fu from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.id, a.user_id into aa, au from public.admins a where a.active and a.user_id is not null and a.role = 'accountant' order by a.id limit 1;
  if ca is null or ga is null or fa is null then raise exception 'missing a real cashier (no open shift) / GM-or-SA / FM with a login'; end if;
  if aa is null then aa := fa; au := fu; end if;
  acct := '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0'); inc := '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  insert into clinic_finance.accounts(code, name, kind) values (acct, 'درج تجربة طلب الصرف — يتلغي', 'asset'), (inc, 'إيراد تجربة طلب الصرف — يتلغي', 'income');
  insert into clinic_finance.account_config(code, is_system, is_postable) values (acct, false, true), (inc, false, true);
  insert into clinic_finance.registers(name, petty_limit, created_by, treasury_kind, account_code, assigned_to, parent_register_id)
  values ('تجربة طلب صرف — تتلغي ' || left(gen_random_uuid()::text, 8), 0, fa, 'collection', acct, ca, (select id from clinic_finance.registers where treasury_kind = 'main' limit 1)) returning id into rg;
  if (select operation_mode from clinic_finance.registers where id = rg) <> 'receive' then raise exception 'fixture register is not receive-only'; end if;
  insert into clinic_finance.shifts(register_id, cashier_id, token, opening_book) values (rg, ca, gen_random_uuid(), 0) returning id into sid;
  insert into clinic_finance.business_requests(kind, subject, reference, amount, payload, created_by, token, status, reviewed_by)
  values ('employment', sub, sub || '-C', 5000, jsonb_build_object('employee_name', 'موظف تجربة — يتلغي', 'base', 5000, 'from', current_date - 1, 'to', current_date + 30), fa, gen_random_uuid(), 'approved', ga);
  insert into public.inventory_suppliers(name) values ('مورد تجربة طلب صرف — يتلغي ' || left(gen_random_uuid()::text, 8)) returning id into sup;
  ev := cu::text || '/drw-test-' || left(gen_random_uuid()::text, 8) || '.jpg';
  insert into storage.objects(bucket_id, name) values ('shift-expense-receipts', ev);

  perform set_config('request.jwt.claim.sub', cu::text, true);
  perform clinic_finance.post('collection', gen_random_uuid(), 'تجربة — تحصيل كاش يتلغي', sid, '1111', inc, 1000);
  if clinic_finance.cash_limit(sid) <> 1000 then raise exception 'seed cash %', clinic_finance.cash_limit(sid); end if;
  ok := false; begin perform clinic_finance.post('drawer_payout', gen_random_uuid(), 'x', sid, '1142', '1111', 10); exception when others then ok := sqlerrm like '%للاستلام فقط%'; end;
  if not ok then raise exception 'direct drawer_payout without a request was accepted'; end if;

  -- cashier asks (as authenticated)
  execute 'set local role authenticated';
  s := public.clinic_finance_drawer_request('status', '{}');
  if (s->>'shift_id')::uuid <> sid or not (s->'employees') @> jsonb_build_array(jsonb_build_object('subject', sub)) then raise exception 'status: %', s - 'suppliers'; end if;
  r := public.clinic_finance_drawer_request('request', jsonb_build_object('kind', 'advance', 'subject', sub, 'amount', '400', 'reason', 'تجربة سلفة', 'token', gen_random_uuid()));
  ok := false; begin perform public.clinic_finance_drawer_request('review', jsonb_build_object('id', r->>'id', 'ok', true)); exception when others then ok := sqlerrm like '%طلبك%'; end;
  if not ok then raise exception 'requester approved his own request'; end if;
  ok := false; begin perform public.clinic_finance_drawer_request('pay', jsonb_build_object('id', r->>'id')); exception when others then ok := sqlerrm like '%الموافقة%'; end;
  if not ok then raise exception 'paid before approval'; end if;
  execute 'reset role';
  -- FM cannot be first; GM/SA first; FM second
  perform set_config('request.jwt.claim.sub', fu::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.clinic_finance_drawer_request('review', jsonb_build_object('id', r->>'id', 'ok', true)); exception when others then ok := sqlerrm like '%الموافقة الأولى%'; end;
  if not ok then raise exception 'FM gave the first approval'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', gu::text, true); execute 'set local role authenticated';
  if not exists (select 1 from jsonb_array_elements(public.clinic_finance_drawer_request('status', '{}')->'inbox') x where x->>'id' = r->>'id') then raise exception 'GM inbox misses it'; end if;
  r := public.clinic_finance_drawer_request('review', jsonb_build_object('id', r->>'id', 'ok', true));
  if r->>'status' <> 'first_ok' then raise exception 'first approval: %', r->>'status'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', fu::text, true); execute 'set local role authenticated';
  r := public.clinic_finance_drawer_request('review', jsonb_build_object('id', r->>'id', 'ok', true));
  if r->>'status' <> 'approved' then raise exception 'second approval: %', r->>'status'; end if;
  execute 'reset role';
  -- narrow door: wrong amount refused even for the approved request
  perform set_config('request.jwt.claim.sub', cu::text, true);
  ok := false; begin perform clinic_finance.post('drawer_payout', (r->>'id')::uuid, 'x', sid, '1142', '1111', 399); exception when others then ok := sqlerrm like '%للاستلام فقط%'; end;
  if not ok then raise exception 'drawer_payout for another amount was accepted'; end if;
  execute 'set local role authenticated';
  r := public.clinic_finance_drawer_request('pay', jsonb_build_object('id', r->>'id'));
  if r->>'status' <> 'paid' then raise exception 'pay: %', r->>'status'; end if;
  -- supplier
  s := public.clinic_finance_drawer_request('request', jsonb_build_object('kind', 'supplier', 'supplier_id', sup, 'amount', '150', 'reason', 'تجربة فاتورة مورد', 'evidence', ev, 'token', gen_random_uuid()));
  execute 'reset role'; perform set_config('request.jwt.claim.sub', au::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.clinic_finance_drawer_request('review', jsonb_build_object('id', s->>'id', 'ok', true)); exception when others then ok := sqlerrm like '%فاتورة المورد%'; end;
  if not ok then raise exception 'supplier approved without a balance'; end if;
  execute 'reset role';
  insert into clinic_finance.supplier_events(supplier_id, amount, description) values (sup, 150, 'فاتورة تجربة — تتلغي');
  execute 'set local role authenticated';
  s := public.clinic_finance_drawer_request('review', jsonb_build_object('id', s->>'id', 'ok', true));
  execute 'reset role'; perform set_config('request.jwt.claim.sub', cu::text, true); execute 'set local role authenticated';
  s := public.clinic_finance_drawer_request('pay', jsonb_build_object('id', s->>'id'));
  if s->>'status' <> 'paid' then raise exception 'supplier pay: %', s->>'status'; end if;
  execute 'reset role';
  -- ledger checks
  if not exists (select 1 from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source = 'drawer_payout' and e.source_id = (r->>'id')::uuid and l.account = '1142' and l.debit = 400)
     or not exists (select 1 from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source = 'drawer_payout' and e.source_id = (r->>'id')::uuid and l.account = acct and l.credit = 400) then raise exception 'advance lines'; end if;
  if clinic_finance.employee_advance(sub) <> 400 then raise exception 'employee advance %', clinic_finance.employee_advance(sub); end if;
  if clinic_finance.supplier_balance(sup) <> 0 then raise exception 'supplier balance %', clinic_finance.supplier_balance(sup); end if;
  if clinic_finance.cash_limit(sid) <> 450 then raise exception 'drawer cash %', clinic_finance.cash_limit(sid); end if;
  ok := false; begin perform clinic_finance.post('expense', gen_random_uuid(), 'x', sid, '5216', '1111', 1); exception when others then ok := sqlerrm like '%للاستلام فقط%'; end;
  if not ok then raise exception 'a normal payout from the receive-only register was accepted'; end if;
  raise notice 'drawer payout dry-run OK: advance 400 (cashier → GM/SA → FM → «اتصرف», Dr 1142, employee advance 400), supplier 150 (refused without balance → accountant → pay Dr 2111, balance 0), drawer 1000 → 450; requester self-approval, FM-first, pay-before-approval, direct/other-amount posts and normal payouts refused';
end $$;
rollback;
