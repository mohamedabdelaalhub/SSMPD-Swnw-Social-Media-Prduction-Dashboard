-- Live rollback dry-run for 20261126110000_month_end_accounts.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Real people by role (reception, accountant, financial manager, GM or super admin). Reads the REAL live statement for the current
-- month (counts only in the notice). Then, inside the transaction only: FM sets a throwaway vezeeta percent; reception records a
-- Tahera referral and a dental-lab case; accountant asks to settle the dental lab by bank and Tahera to the wallet; the accountant
-- cannot approve; GM/SA approves both → Dr 5235 / Cr 1112 and Dr 1115 / Cr 4121; a request above the remaining is refused.
begin;

do $$ begin
  if to_regclass('clinic_reception.orders') is null or to_regclass('clinic_reception.appointments') is null or to_regclass('clinic_labs.item_links') is null
     or to_regprocedure('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)') is null then raise exception 'مكونات الاستقبال أو المعمل أو الخزينة غير موجودة'; end if;
  if to_regclass('clinic_finance.month_end_parties') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

insert into clinic_finance.accounts(code, name, kind) values
  ('5233', 'عمولات منصات الحجز', 'expense'), ('5234', 'تكلفة المعمل الخارجي', 'expense'), ('5235', 'تكلفة معمل الأسنان', 'expense'),
  ('4121', 'إيراد نسبة تحويلات الأشعة', 'income') on conflict (code) do nothing;
insert into clinic_finance.account_config(code, is_system) values ('5233', true), ('5234', true), ('5235', true), ('4121', true) on conflict (code) do nothing;

create table clinic_finance.month_end_parties (
  key text primary key check (key in ('vezeeta', 'clinidu', 'akshef', 'lab', 'dental_lab', 'tahera')),
  name text not null, direction text not null check (direction in ('payable', 'receivable')), account text not null,
  percent numeric(6,3) check (percent is null or (percent >= 0 and percent <= 100)), sort int not null,
  updated_by uuid references public.admins(id), updated_at timestamptz);
insert into clinic_finance.month_end_parties(key, name, direction, account, percent, sort) values
  ('vezeeta', 'فيزيتا', 'payable', '5233', null, 1), ('clinidu', 'كلينيدو', 'payable', '5233', null, 2), ('akshef', 'اكشف', 'payable', '5233', null, 3),
  ('lab', 'المعمل', 'payable', '5234', null, 4), ('dental_lab', 'معمل الأسنان', 'payable', '5235', null, 5), ('tahera', 'مركز الطاهرة', 'receivable', '4121', 30, 6);

create table clinic_finance.month_end_items (
  id uuid primary key default gen_random_uuid(),
  party text not null references clinic_finance.month_end_parties(key) check (party in ('dental_lab', 'tahera')),
  day date not null, ref text not null check (length(btrim(ref)) between 1 and 60),
  description text not null check (length(btrim(description)) between 2 and 200),
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000),
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(), token uuid not null,
  voided_by uuid references public.admins(id), voided_at timestamptz, void_reason text,
  unique (created_by, token));

create table clinic_finance.month_end_settlements (
  id uuid primary key default gen_random_uuid(),
  party text not null references clinic_finance.month_end_parties(key), month date not null check (month = date_trunc('month', month)::date),
  amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  method text not null check (method in ('cash', 'bank', 'wallet')), shift_id uuid references clinic_finance.shifts(id),
  reference text not null check (length(btrim(reference)) between 2 and 120), note text,
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(), token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text, entry_id uuid,
  unique (created_by, token));
alter table clinic_finance.month_end_parties enable row level security;
alter table clinic_finance.month_end_items enable row level security;
alter table clinic_finance.month_end_settlements enable row level security;
revoke all on clinic_finance.month_end_parties, clinic_finance.month_end_items, clinic_finance.month_end_settlements from public, anon, authenticated;

-- one row per accrual line of a party in [p_from, p_to] (Cairo days); amount is what the line adds to the party's balance
create function clinic_finance.month_end_lines(p_party text, p_from date, p_to date) returns table(day date, ref text, description text, base numeric, amount numeric)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pct numeric;
begin
  select percent into pct from clinic_finance.month_end_parties where key = p_party;
  if p_party in ('vezeeta', 'clinidu', 'akshef') then
    if pct is null then return; end if;
    return query
      select (a.starts_at at time zone 'Africa/Cairo')::date, 'زيارة ' || v.visit_no::text, s.name::text,
             round(sum(coalesce(o.net_revenue, o.price * o.quantity * (1 - o.discount / 100))), 2),
             round(sum(coalesce(o.net_revenue, o.price * o.quantity * (1 - o.discount / 100))) * pct / 100, 2)
      from clinic_reception.appointments a
      join clinic_reception.workspaces w on w.id = a.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.appointment_id = a.id
      join clinic_reception.orders o on o.visit_id = v.id and o.status = 'completed' and o.service_id = a.service_id
      join clinic_reception.services s on s.id = a.service_id
      where a.source = p_party and (a.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to
      group by a.id, a.starts_at, v.visit_no, s.name;
  elsif p_party = 'lab' then
    return query
      select (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date, 'زيارة ' || v.visit_no::text, (s.name || ' — ' || c.lab_name)::text,
             round(o.quantity, 3), round(c.cost * o.quantity, 2)
      from clinic_reception.orders o
      join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.id = o.visit_id
      join clinic_reception.services s on s.id = o.service_id
      join lateral (select pi.cost, pv.lab_name from clinic_labs.item_links l join clinic_labs.price_items pi on pi.id = l.item_id
                    join clinic_labs.price_versions pv on pv.id = pi.version_id
                    where l.service_id = s.pricing_service_id and l.status = 'confirmed' and pi.cost is not null
                    order by pv.imported_at desc, pv.version desc limit 1) c on true
      where o.status = 'completed' and s.pricing_service_id is not null
        and (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date between p_from and p_to;
  elsif p_party = 'dental_lab' then
    return query select i.day, i.ref, i.description, i.amount, i.amount from clinic_finance.month_end_items i
      where i.party = 'dental_lab' and i.voided_at is null and i.day between p_from and p_to;
  elsif p_party = 'tahera' then
    return query select i.day, i.ref, i.description, i.amount, round(i.amount * coalesce(pct, 0) / 100, 2) from clinic_finance.month_end_items i
      where i.party = 'tahera' and i.voided_at is null and i.day between p_from and p_to;
  end if;
end $$;
revoke all on function clinic_finance.month_end_lines(text, date, date) from public, anon, authenticated;

create function public.clinic_finance_month_end(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); fin boolean; mgr boolean; rec boolean; m date; m_end date; pt clinic_finance.month_end_parties%rowtype;
  st clinic_finance.month_end_settlements%rowtype; it clinic_finance.month_end_items%rowtype; amt numeric; tok uuid; left_ numeric; e uuid; cashacct text; sh uuid; ok boolean;
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  fin := public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  mgr := public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  rec := public.has_role('reception') or public.has_role('customer_service');
  p := coalesce(p, '{}'::jsonb);
  begin m := date_trunc('month', coalesce((p->>'month')::date, (now() at time zone 'Africa/Cairo')::date))::date; exception when others then raise exception 'الشهر غير صالح'; end;
  m_end := (m + interval '1 month' - interval '1 day')::date;

  if p_action = 'statement' then
    if not fin then raise exception 'حسابات آخر الشهر للحسابات والإدارة' using errcode = '42501'; end if;
    return jsonb_build_object('month', m, 'can_rate', public.has_role('financial_manager') or public.has_role('super_admin'),
      'can_request', public.has_role('accountant') or public.has_role('financial_manager'), 'can_review', mgr,
      'main_shift', (select s.id from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where r.treasury_kind = 'main' and s.status = 'open' and s.ended_at is null order by s.opened_at desc limit 1),
      'parties', (select coalesce(jsonb_agg(x order by x.sort), '[]'::jsonb) from (
        select q.key, q.name, q.direction, q.percent, q.sort, l.n count, l.total accrued,
               coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.month = m and z.status = 'approved'), 0) settled,
               coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.month = m and z.status = 'pending'), 0) pending,
               l.total - coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.month = m and z.status in ('approved', 'pending')), 0) remaining
        from clinic_finance.month_end_parties q
        cross join lateral (select count(*)::int n, coalesce(sum(amount), 0) total from clinic_finance.month_end_lines(q.key, m, m_end)) l) x),
      'settlements', (select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'party', z.party, 'amount', z.amount, 'method', z.method, 'reference', z.reference, 'note', z.note,
               'status', z.status, 'by', (select name from public.admins where id = z.created_by), 'mine', z.created_by = me, 'at', z.created_at,
               'reviewed_by', (select name from public.admins where id = z.reviewed_by), 'review_note', z.review_note) order by z.created_at desc), '[]'::jsonb)
        from clinic_finance.month_end_settlements z where z.month = m));

  elsif p_action = 'lines' then
    if not fin then raise exception 'حسابات آخر الشهر للحسابات والإدارة' using errcode = '42501'; end if;
    if not exists (select 1 from clinic_finance.month_end_parties where key = p->>'party') then raise exception 'الجهة غير موجودة'; end if;
    return jsonb_build_object('party', p->>'party', 'month', m, 'lines', (select coalesce(jsonb_agg(jsonb_build_object('day', l.day, 'ref', l.ref, 'description', l.description, 'base', l.base, 'amount', l.amount) order by l.day, l.ref), '[]'::jsonb)
        from (select * from clinic_finance.month_end_lines(p->>'party', m, m_end) limit 2000) l),
      'items', case when p->>'party' in ('dental_lab', 'tahera') then (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'day', i.day, 'ref', i.ref, 'description', i.description, 'amount', i.amount,
               'voided', i.voided_at is not null, 'void_reason', i.void_reason, 'by', (select name from public.admins where id = i.created_by)) order by i.day, i.created_at), '[]'::jsonb)
        from clinic_finance.month_end_items i where i.party = p->>'party' and i.day between m and m_end) end);

  elsif p_action = 'my_items' then
    if not (fin or rec) then raise exception 'مش متاح' using errcode = '42501'; end if;
    return jsonb_build_object('tahera_percent', (select percent from clinic_finance.month_end_parties where key = 'tahera'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'party', i.party, 'day', i.day, 'ref', i.ref, 'description', i.description, 'amount', i.amount,
         'voided', i.voided_at is not null) order by i.created_at desc), '[]'::jsonb)
       from (select * from clinic_finance.month_end_items where created_by = me and created_at > now() - interval '2 days' order by created_at desc limit 20) i));

  elsif p_action = 'set_rate' then
    if not (public.has_role('financial_manager') or public.has_role('super_admin')) then raise exception 'النسب يحددها المدير المالي أو السوبر أدمن' using errcode = '42501'; end if;
    select * into pt from clinic_finance.month_end_parties where key = p->>'party' for update;
    if not found or pt.key in ('lab', 'dental_lab') then raise exception 'الجهة دي مالهاش نسبة'; end if;
    begin amt := nullif(p->>'percent', '')::numeric; exception when others then raise exception 'النسبة غير صالحة'; end;
    if amt is not null and (amt < 0 or amt > 100) then raise exception 'النسبة من 0 لـ 100'; end if;
    update clinic_finance.month_end_parties set percent = amt, updated_by = me, updated_at = now() where key = pt.key;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_rate', null, jsonb_build_object('party', pt.key, 'from', pt.percent, 'to', amt));
    return jsonb_build_object('party', pt.key, 'percent', amt);

  elsif p_action = 'add_item' then
    perform clinic_finance.lock_day();
    if p->>'party' = 'tahera' and not (fin or rec) then raise exception 'تسجيل التحويلات للاستقبال أو الحسابات' using errcode = '42501'; end if;
    if p->>'party' = 'dental_lab' and not (fin or rec) then raise exception 'تسجيل فواتير معمل الأسنان للاستقبال أو الحسابات' using errcode = '42501'; end if;
    if coalesce(p->>'party', '') not in ('tahera', 'dental_lab') then raise exception 'الجهة غير صالحة'; end if;
    begin amt := (p->>'amount')::numeric; tok := (p->>'token')::uuid; exception when others then raise exception 'راجع المبلغ'; end;
    if amt is null or amt <= 0 or amt <> round(amt, 2) then raise exception 'المبلغ غير صالح'; end if;
    select * into it from clinic_finance.month_end_items where created_by = me and token = tok;
    if found then return to_jsonb(it); end if;
    insert into clinic_finance.month_end_items(party, day, ref, description, amount, created_by, token)
      values (p->>'party', coalesce((p->>'day')::date, (now() at time zone 'Africa/Cairo')::date), btrim(coalesce(p->>'ref', '')), btrim(coalesce(p->>'description', '')), amt, me, tok) returning * into it;
    if it.day > (now() at time zone 'Africa/Cairo')::date then raise exception 'التاريخ في المستقبل'; end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_item', it.id, jsonb_build_object('party', it.party, 'amount', it.amount));
    return to_jsonb(it);

  elsif p_action = 'void_item' then
    if not fin then raise exception 'الإلغاء للحسابات' using errcode = '42501'; end if;
    select * into it from clinic_finance.month_end_items where id = (p->>'id')::uuid for update;
    if not found or it.voided_at is not null then raise exception 'السطر مش موجود'; end if;
    if length(btrim(coalesce(p->>'reason', ''))) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
    update clinic_finance.month_end_items set voided_by = me, voided_at = now(), void_reason = btrim(p->>'reason') where id = it.id returning * into it;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_item_void', it.id, jsonb_build_object('reason', it.void_reason));
    return to_jsonb(it);

  elsif p_action = 'settle_request' then
    perform clinic_finance.lock_day();
    if not (public.has_role('accountant') or public.has_role('financial_manager')) then raise exception 'طلب السداد للمحاسب أو المدير المالي' using errcode = '42501'; end if;
    select * into pt from clinic_finance.month_end_parties where key = p->>'party';
    if not found then raise exception 'الجهة غير موجودة'; end if;
    begin amt := (p->>'amount')::numeric; tok := (p->>'token')::uuid; exception when others then raise exception 'راجع المبلغ'; end;
    if amt is null or amt <= 0 or amt <> round(amt, 2) then raise exception 'المبلغ غير صالح'; end if;
    if coalesce(p->>'method', '') not in ('cash', 'bank', 'wallet') then raise exception 'اختار طريقة السداد'; end if;
    select * into st from clinic_finance.month_end_settlements where created_by = me and token = tok;
    if found then return to_jsonb(st); end if;
    select coalesce(sum(amount), 0) into left_ from clinic_finance.month_end_lines(pt.key, m, m_end);
    left_ := left_ - coalesce((select sum(amount) from clinic_finance.month_end_settlements where party = pt.key and month = m and status in ('approved', 'pending')), 0);
    if amt > left_ then raise exception 'المبلغ أكبر من المتبقي للشهر ده (%)', greatest(left_, 0); end if;
    if p->>'method' = 'cash' then
      select s.id into sh from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where r.treasury_kind = 'main' and s.status = 'open' and s.ended_at is null order by s.opened_at desc limit 1;
      if sh is null then raise exception 'مفيش وردية مفتوحة للخزينة الرئيسية'; end if;
    end if;
    insert into clinic_finance.month_end_settlements(party, month, amount, method, shift_id, reference, note, created_by, token)
      values (pt.key, m, amt, p->>'method', sh, btrim(coalesce(p->>'reference', '')), nullif(btrim(coalesce(p->>'note', '')), ''), me, tok) returning * into st;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_settle_request', st.id, jsonb_build_object('party', st.party, 'amount', st.amount, 'month', m));
    return to_jsonb(st);

  elsif p_action = 'settle_review' then
    perform clinic_finance.lock_day();
    if not mgr then raise exception 'اعتماد السداد للمدير المالي أو المدير العام أو السوبر أدمن' using errcode = '42501'; end if;
    select * into st from clinic_finance.month_end_settlements where id = (p->>'id')::uuid for update;
    if not found or st.status <> 'pending' then raise exception 'الطلب اتراجع قبل كده'; end if;
    if st.created_by = me then raise exception 'مينفعش تعتمد طلب انت عامله' using errcode = '42501'; end if;
    ok := coalesce((p->>'ok')::boolean, false);
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.month_end_settlements set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = btrim(p->>'note') where id = st.id returning * into st;
    else
      select * into pt from clinic_finance.month_end_parties where key = st.party;
      cashacct := case st.method when 'cash' then '1111' when 'bank' then '1112' else '1115' end;
      if st.method = 'cash' and not exists (select 1 from clinic_finance.shifts where id = st.shift_id and status = 'open' and ended_at is null) then raise exception 'وردية الخزينة الرئيسية اتقفلت — اعمل طلب جديد'; end if;
      if pt.direction = 'payable' then
        e := clinic_finance.post('month_end_settlement', st.id, 'سداد ' || pt.name || ' — ' || to_char(st.month, 'YYYY-MM') || ' — ' || st.reference, case when st.method = 'cash' then st.shift_id end, pt.account, cashacct, st.amount);
      else
        e := clinic_finance.post('month_end_settlement', st.id, 'تحصيل نسبة ' || pt.name || ' — ' || to_char(st.month, 'YYYY-MM') || ' — ' || st.reference, case when st.method = 'cash' then st.shift_id end, cashacct, pt.account, st.amount);
      end if;
      update clinic_finance.month_end_settlements set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(btrim(coalesce(p->>'note', '')), ''), entry_id = e where id = st.id returning * into st;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_settle_review', st.id, jsonb_build_object('ok', ok, 'entry', st.entry_id));
    return to_jsonb(st);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_month_end(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_month_end(text, jsonb) to authenticated;


do $$
declare ru uuid; au uuid; fu uuid; gu uuid; st jsonb; s1 jsonb; s2 jsonb; ok boolean; n_lab int; n_vz int;
begin
  select a.user_id into ru from public.admins a where a.active and a.user_id is not null and a.role = 'reception' order by a.id limit 1;
  select a.user_id into au from public.admins a where a.active and a.user_id is not null and a.role = 'accountant' order by a.id limit 1;
  select a.user_id into fu from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id into gu from public.admins a where a.active and a.user_id is not null and a.role in ('general_manager', 'super_admin') order by a.role, a.id limit 1;
  if ru is null or fu is null or gu is null then raise exception 'missing a real reception / FM / GM-or-SA with a login'; end if;
  if au is null then au := fu; end if;
  perform set_config('request.jwt.claim.sub', fu::text, true); execute 'set local role authenticated';
  perform public.clinic_finance_month_end('set_rate', jsonb_build_object('party', 'vezeeta', 'percent', '20'));
  st := public.clinic_finance_month_end('statement', '{}');
  select (x->>'count')::int into n_vz from jsonb_array_elements(st->'parties') x where x->>'key' = 'vezeeta';
  select (x->>'count')::int into n_lab from jsonb_array_elements(st->'parties') x where x->>'key' = 'lab';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', ru::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.clinic_finance_month_end('statement', '{}'); exception when others then ok := sqlerrm like '%للحسابات والإدارة%'; end;
  if not ok then raise exception 'reception read the statement'; end if;
  perform public.clinic_finance_month_end('add_item', jsonb_build_object('party', 'tahera', 'ref', 'تجربة', 'description', 'تحويل تجربة — يتلغي', 'amount', '1000', 'token', gen_random_uuid()));
  perform public.clinic_finance_month_end('add_item', jsonb_build_object('party', 'dental_lab', 'ref', 'تجربة', 'description', 'حالة تجربة — تتلغي', 'amount', '500', 'token', gen_random_uuid()));
  if jsonb_array_length(public.clinic_finance_month_end('my_items', '{}')->'items') < 2 then raise exception 'my_items'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', au::text, true); execute 'set local role authenticated';
  st := public.clinic_finance_month_end('statement', '{}');
  if (select (x->>'accrued')::numeric from jsonb_array_elements(st->'parties') x where x->>'key' = 'tahera') < 300 then raise exception 'tahera 30%% missing'; end if;
  ok := false; begin perform public.clinic_finance_month_end('settle_request', jsonb_build_object('party', 'dental_lab', 'amount', '999999', 'method', 'bank', 'reference', 'تجربة', 'token', gen_random_uuid()));
  exception when others then ok := sqlerrm like '%المتبقي%'; end; if not ok then raise exception 'over-remaining accepted'; end if;
  s1 := public.clinic_finance_month_end('settle_request', jsonb_build_object('party', 'dental_lab', 'amount', '500', 'method', 'bank', 'reference', 'تحويل تجربة', 'token', gen_random_uuid()));
  s2 := public.clinic_finance_month_end('settle_request', jsonb_build_object('party', 'tahera', 'amount', '300', 'method', 'wallet', 'reference', 'فودافون كاش تجربة', 'token', gen_random_uuid()));
  ok := false; begin perform public.clinic_finance_month_end('settle_review', jsonb_build_object('id', s1->>'id', 'ok', true)); exception when others then ok := sqlerrm like '%اعتماد السداد%' or sqlerrm like '%انت عامله%'; end;
  if not ok then raise exception 'accountant approved'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', gu::text, true); execute 'set local role authenticated';
  s1 := public.clinic_finance_month_end('settle_review', jsonb_build_object('id', s1->>'id', 'ok', true));
  s2 := public.clinic_finance_month_end('settle_review', jsonb_build_object('id', s2->>'id', 'ok', true));
  execute 'reset role';
  if not exists (select 1 from clinic_finance.lines where entry_id = (s1->>'entry_id')::uuid and account = '5235' and debit = 500)
     or not exists (select 1 from clinic_finance.lines where entry_id = (s1->>'entry_id')::uuid and account = '1112' and credit = 500) then raise exception 'dental lines'; end if;
  if not exists (select 1 from clinic_finance.lines where entry_id = (s2->>'entry_id')::uuid and account = '1115' and debit = 300)
     or not exists (select 1 from clinic_finance.lines where entry_id = (s2->>'entry_id')::uuid and account = '4121' and credit = 300) then raise exception 'tahera lines'; end if;
  raise notice 'month-end dry-run OK: live this month — vezeeta visits at 20%%: %, lab tests with a confirmed link: %; reception entries, accountant requests, GM/SA approvals posted Dr 5235/Cr 1112 and Dr 1115/Cr 4121; reception statement + accountant approval + over-remaining refused', n_vz, n_lab;
end $$;
rollback;
