-- Live rollback dry-run for 20261126180000_platform_audit.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Applies the migration inside the transaction, then as REAL people — maker = an accountant if live has one, else the financial
-- manager; checker = a different person (FM / GM / super admin, never «Admin Test»): takes ONE real live visit whose booked service is a كشف / استشارة, moves it (triggers off for that update only)
-- to vezeeta → counts 25%; marks it «فيزيتا شامل» → counts 0; audits vezeeta with a deduction to income 4122 (accountant asks, FM
-- approves; accountant approve / overlap refused; accountant chart account refused on kafaret), clinidu with a deduction to payable 2111 (GM / SA approves),
-- كفارة وسلامتك by the FM to chart account 5233 (FM self-approval refused), then settles vezeeta's audited balance by bank
-- (over-balance refused) → Dr 2112 / Cr 1112. Notices / errors print amounts and constraint names only — never rows or patient data.
begin;
do $$ begin
  if to_regprocedure('public.clinic_finance_month_end(text,jsonb)') is null or to_regclass('clinic_finance.month_end_parties') is null
     or to_regprocedure('clinic_finance.month_end_lines(text,date,date)') is null then raise exception 'طبّق حسابات آخر الشهر (20261126110000) أولًا'; end if;
  if to_regprocedure('clinic_reception.consult_kind(text)') is null then raise exception 'دالة نوع الكشف (20261124210000) غير موجودة'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'discount_kind')
    then raise exception 'عمود نوع الخصم في الحجوزات غير موجود'; end if;
  if to_regclass('clinic_finance.platform_audits') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if exists (select 1 from clinic_finance.month_end_settlements where party in ('vezeeta', 'clinidu', 'akshef'))
    then raise exception 'فيه سداد قديم لمنصة — راجعه قبل التطبيق'; end if;
end $$;

insert into clinic_finance.accounts(code, name, kind) values
  ('2112', 'مستحقات منصات الحجز', 'liability'), ('4122', 'إيراد تسويات منصات الحجز', 'income') on conflict (code) do nothing;
insert into clinic_finance.account_config(code, is_system) values ('2112', true), ('4122', true) on conflict (code) do nothing;

-- كفارة وسلامتك joins the platforms; all four at 25%
alter table clinic_finance.month_end_parties drop constraint month_end_parties_key_check;
alter table clinic_finance.month_end_parties add constraint month_end_parties_key_check
  check (key in ('vezeeta', 'clinidu', 'akshef', 'kafaret', 'lab', 'dental_lab', 'tahera'));
update clinic_finance.month_end_parties set sort = sort + 1 where key in ('lab', 'dental_lab', 'tahera');
insert into clinic_finance.month_end_parties(key, name, direction, account, percent, sort) values ('kafaret', 'كفارة وسلامتك', 'payable', '5233', 25, 4);
update clinic_finance.month_end_parties set percent = 25, updated_at = now() where key in ('vezeeta', 'clinidu', 'akshef');

create table clinic_finance.platform_audit_saved_defs(name text primary key, def text not null);
alter table clinic_finance.platform_audit_saved_defs enable row level security;
revoke all on clinic_finance.platform_audit_saved_defs from public, anon, authenticated;
insert into clinic_finance.platform_audit_saved_defs values
  ('month_end_lines', pg_get_functiondef('clinic_finance.month_end_lines(text,date,date)'::regprocedure));

create or replace function clinic_finance.month_end_lines(p_party text, p_from date, p_to date) returns table(day date, ref text, description text, base numeric, amount numeric)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pct numeric;
begin
  select percent into pct from clinic_finance.month_end_parties where key = p_party;
  if p_party in ('vezeeta', 'clinidu', 'akshef', 'kafaret') then
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
        and coalesce(a.discount_kind, '') <> 'vezeeta'                       -- «فيزيتا شامل»: nothing owed
        and coalesce(clinic_reception.consult_kind(s.name), '') in ('K', 'S') -- الكشف / الاستشارة only (not متابعة)
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

create table clinic_finance.platform_audits (
  id uuid primary key default gen_random_uuid(),
  party text not null references clinic_finance.month_end_parties(key) check (party in ('vezeeta', 'clinidu', 'akshef', 'kafaret')),
  from_month date not null check (from_month = date_trunc('month', from_month)::date),
  to_month date not null check (to_month = date_trunc('month', to_month)::date and to_month >= from_month and to_month <= (from_month + interval '1 month')::date),
  ours numeric(14,2) not null check (ours >= 0), cases int not null default 0,
  theirs numeric(14,2) not null check (theirs >= 0 and theirs <= 10000000),
  theirs_ref text not null check (length(btrim(theirs_ref)) between 2 and 120),
  agreed_mode text not null check (agreed_mode in ('amount', 'percent')), agreed_value numeric(14,3) not null check (agreed_value >= 0),
  agreed numeric(14,2) not null check (agreed >= 0 and agreed <= 10000000),
  reason text not null check (length(btrim(reason)) between 3 and 400),
  dest_kind text check (dest_kind in ('income', 'payable', 'account')), dest_account text references clinic_finance.accounts(code),
  check ((agreed < ours) = (dest_kind is not null and dest_account is not null)),
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(), token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text, entry_ids uuid[] not null default '{}',
  unique (created_by, token));
create index platform_audits_party_idx on clinic_finance.platform_audits(party, from_month);
alter table clinic_finance.platform_audits enable row level security;
revoke all on clinic_finance.platform_audits from public, anon, authenticated;

-- may this account receive an audit deduction of the given kind?
create function clinic_finance.platform_dest_ok(p_kind text, p_account text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select case p_kind
    when 'income' then p_account = '4122'
    when 'payable' then exists (select 1 from clinic_finance.accounts a left join clinic_finance.account_config c on c.code = a.code
                                 where a.code = p_account and a.kind = 'liability' and a.code <> '2112' and coalesce(c.active, true) and not coalesce(c.archived, false))
    when 'account' then exists (select 1 from clinic_finance.accounts a left join clinic_finance.account_config c on c.code = a.code
                                 where a.code = p_account and a.kind in ('liability', 'equity', 'income', 'expense') and a.code <> '2112'
                                   and coalesce(c.active, true) and not coalesce(c.archived, false))
    else false end
$$;
revoke all on function clinic_finance.platform_dest_ok(text, text) from public, anon, authenticated;

-- per platform: what the approved audits put on 2112, the deductions, the settlements and the balance we still owe
create function clinic_finance.platform_balances() returns table(party text, name text, percent numeric, audited numeric, extra numeric, deducted numeric,
  settled numeric, pending numeric, balance numeric, last_audit date)
language sql stable security definer set search_path = pg_catalog, public as $$
  select q.key, q.name, q.percent,
         coalesce((select sum(ours) from clinic_finance.platform_audits a where a.party = q.key and a.status = 'approved'), 0),
         coalesce((select sum(greatest(agreed - ours, 0)) from clinic_finance.platform_audits a where a.party = q.key and a.status = 'approved'), 0),
         coalesce((select sum(greatest(ours - agreed, 0)) from clinic_finance.platform_audits a where a.party = q.key and a.status = 'approved'), 0),
         coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.status = 'approved'), 0),
         coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.status = 'pending'), 0),
         coalesce((select sum(agreed) from clinic_finance.platform_audits a where a.party = q.key and a.status = 'approved'), 0)
           - coalesce((select sum(amount) from clinic_finance.month_end_settlements z where z.party = q.key and z.status = 'approved'), 0),
         (select max(to_month) from clinic_finance.platform_audits a where a.party = q.key and a.status = 'approved')
  from clinic_finance.month_end_parties q where q.key in ('vezeeta', 'clinidu', 'akshef', 'kafaret')
$$;
revoke all on function clinic_finance.platform_balances() from public, anon, authenticated;

alter function public.clinic_finance_month_end(text, jsonb) rename to clinic_finance_month_end_before_audit;
alter function public.clinic_finance_month_end_before_audit(text, jsonb) set schema clinic_finance;
revoke all on function clinic_finance.clinic_finance_month_end_before_audit(text, jsonb) from public, anon, authenticated;

create function public.clinic_finance_month_end(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); fin boolean; mgr boolean; reqr boolean; fm boolean; r jsonb; pt clinic_finance.month_end_parties%rowtype;
  au clinic_finance.platform_audits%rowtype; st clinic_finance.month_end_settlements%rowtype; f date; t date; t_end date; ours_ numeric; n int;
  amt numeric; val numeric; tok uuid; left_ numeric; e1 uuid; e2 uuid; cashacct text; sh uuid; ok boolean; dk text; da text; m date;
  plat constant text[] := array['vezeeta', 'clinidu', 'akshef', 'kafaret'];
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  fin := public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  mgr := public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  reqr := public.has_role('accountant') or public.has_role('financial_manager');
  fm := public.has_role('financial_manager') or public.has_role('super_admin');
  p := coalesce(p, '{}'::jsonb);

  -- every non-platform path is the previous function, unchanged
  if p_action = 'settle_review' then
    select * into st from clinic_finance.month_end_settlements where id = nullif(p->>'id', '')::uuid;
    if not found or not (st.party = any(plat)) then return clinic_finance.clinic_finance_month_end_before_audit(p_action, p); end if;
  elsif p_action = 'settle_request' then
    if not (coalesce(p->>'party', '') = any(plat)) then return clinic_finance.clinic_finance_month_end_before_audit(p_action, p); end if;
  elsif p_action = 'statement' then
    r := clinic_finance.clinic_finance_month_end_before_audit(p_action, p);
    return r || jsonb_build_object('parties', (select coalesce(jsonb_agg(case when x->>'key' = any(plat) then x || jsonb_build_object(
        'balance', b.balance, 'pending', b.pending, 'settled', b.settled, 'deducted', b.deducted, 'remaining', greatest(b.balance - b.pending, 0), 'audited_through', b.last_audit, 'platform', true)
        else x end order by (x->>'sort')::int), '[]'::jsonb)
      from jsonb_array_elements(r->'parties') x left join clinic_finance.platform_balances() b on b.party = x->>'key'),
      'can_audit', reqr, 'can_account_dest', fm);
  elsif p_action not in ('platforms', 'audits', 'audit_preview', 'audit_request', 'audit_review') then
    return clinic_finance.clinic_finance_month_end_before_audit(p_action, p);
  end if;

  if p_action = 'platforms' then
    if not fin then raise exception 'مستحقات المنصات للحسابات والإدارة' using errcode = '42501'; end if;
    return jsonb_build_object('can_audit', reqr, 'platforms', (select coalesce(jsonb_agg(to_jsonb(b) order by q.sort), '[]'::jsonb)
      from clinic_finance.platform_balances() b join clinic_finance.month_end_parties q on q.key = b.party));

  elsif p_action = 'audits' then
    if not fin then raise exception 'مراجعات المنصات للحسابات والإدارة' using errcode = '42501'; end if;
    return jsonb_build_object('can_audit', reqr, 'can_review', mgr, 'can_account_dest', fm,
      'income_account', jsonb_build_object('code', '4122', 'name', (select name from clinic_finance.accounts where code = '4122')),
      'payable_accounts', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) order by a.code), '[]'::jsonb)
         from clinic_finance.accounts a where clinic_finance.platform_dest_ok('payable', a.code)),
      'other_accounts', case when fm then (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind) order by a.code), '[]'::jsonb)
         from clinic_finance.accounts a where clinic_finance.platform_dest_ok('account', a.code)) else '[]'::jsonb end,
      'audits', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'party', a.party, 'party_name', q.name, 'from', a.from_month, 'to', a.to_month,
          'ours', a.ours, 'cases', a.cases, 'theirs', a.theirs, 'theirs_ref', a.theirs_ref, 'agreed_mode', a.agreed_mode, 'agreed_value', a.agreed_value,
          'agreed', a.agreed, 'deduction', greatest(a.ours - a.agreed, 0), 'extra', greatest(a.agreed - a.ours, 0), 'reason', a.reason,
          'dest_kind', a.dest_kind, 'dest_account', a.dest_account, 'dest_name', (select name from clinic_finance.accounts where code = a.dest_account),
          'status', a.status, 'by', (select name from public.admins where id = a.created_by), 'mine', a.created_by = me, 'at', a.created_at,
          'reviewed_by', (select name from public.admins where id = a.reviewed_by), 'review_note', a.review_note) order by a.created_at desc), '[]'::jsonb)
        from (select * from clinic_finance.platform_audits order by created_at desc limit 100) a join clinic_finance.month_end_parties q on q.key = a.party));
  end if;

  if p_action in ('audit_preview', 'audit_request') then
    if not (case when p_action = 'audit_preview' then fin else reqr end) then raise exception 'مراجعة الفترة للمحاسب أو المدير المالي' using errcode = '42501'; end if;
    select * into pt from clinic_finance.month_end_parties where key = p->>'party';
    if not found or not (pt.key = any(plat)) then raise exception 'اختار منصة الحجز'; end if;
    begin f := date_trunc('month', (p->>'from')::date)::date; t := date_trunc('month', coalesce((p->>'to')::date, (p->>'from')::date))::date;
    exception when others then raise exception 'الفترة غير صالحة'; end;
    if f is null or t is null or t < f or t > (f + interval '1 month')::date then raise exception 'الفترة شهر أو شهرين بس'; end if;
    if t > date_trunc('month', (now() at time zone 'Africa/Cairo'))::date then raise exception 'الفترة لسه مجتش'; end if;
    t_end := (t + interval '1 month' - interval '1 day')::date;
    select coalesce(sum(l.amount), 0), count(*) into ours_, n from clinic_finance.month_end_lines(pt.key, f, t_end) l;
    if p_action = 'audit_preview' then
      return jsonb_build_object('party', pt.key, 'name', pt.name, 'percent', pt.percent, 'from', f, 'to', t, 'ours', ours_, 'cases', n,
        'overlap', exists (select 1 from clinic_finance.platform_audits a where a.party = pt.key and a.status in ('pending', 'approved') and a.from_month <= t and a.to_month >= f));
    end if;
    perform clinic_finance.lock_day();
    begin tok := (p->>'token')::uuid; amt := nullif(p->>'theirs', '')::numeric; val := nullif(p->>'agreed_value', '')::numeric;
    exception when others then raise exception 'راجع الأرقام'; end;
    if tok is null then raise exception 'راجع الأرقام'; end if;
    select * into au from clinic_finance.platform_audits where created_by = me and token = tok;
    if found then return to_jsonb(au); end if;
    perform 1 from clinic_finance.month_end_parties where key = pt.key for update;
    if exists (select 1 from clinic_finance.platform_audits a where a.party = pt.key and a.status in ('pending', 'approved') and a.from_month <= t and a.to_month >= f)
      then raise exception 'الفترة دي (أو جزء منها) اتراجعت قبل كده لنفس المنصة'; end if;
    if amt is null or amt < 0 or amt <> round(amt, 2) then raise exception 'اكتب رقمهم (مطالبة المنصة)'; end if;
    if length(btrim(coalesce(p->>'theirs_ref', ''))) < 2 then raise exception 'اكتب رقم فاتورتهم أو مرجع المطالبة'; end if;
    if coalesce(p->>'agreed_mode', '') not in ('amount', 'percent') then raise exception 'اختار المتفق عليه: مبلغ أو نسبة'; end if;
    if val is null or val < 0 then raise exception 'اكتب المتفق عليه'; end if;
    if p->>'agreed_mode' = 'percent' then
      if val > 200 then raise exception 'النسبة من رقمنا كبيرة أوي'; end if;
      amt := round(ours_ * val / 100, 2);
    else
      if val <> round(val, 2) then raise exception 'المبلغ المتفق عليه غير صالح'; end if;
      amt := val;
    end if;
    if length(btrim(coalesce(p->>'reason', ''))) < 3 then raise exception 'اكتب سبب الاتفاق'; end if;
    dk := null; da := null;
    if amt < ours_ then
      dk := p->>'dest_kind'; da := case when dk = 'income' then '4122' else nullif(p->>'dest_account', '') end;
      if dk is null or dk not in ('income', 'payable', 'account') then raise exception 'اختار خصم المراجعة يروح فين'; end if;
      if dk = 'account' and not fm then raise exception 'اختيار حساب من الشجرة للمدير المالي بس' using errcode = '42501'; end if;
      if not clinic_finance.platform_dest_ok(dk, da) then raise exception 'الحساب ده مينفعش يستقبل خصم المراجعة'; end if;
    end if;
    insert into clinic_finance.platform_audits(party, from_month, to_month, ours, cases, theirs, theirs_ref, agreed_mode, agreed_value, agreed, reason,
      dest_kind, dest_account, created_by, token)
      values (pt.key, f, t, ours_, n, (p->>'theirs')::numeric, btrim(p->>'theirs_ref'), p->>'agreed_mode', val, amt, btrim(p->>'reason'), dk, da, me, tok)
      returning * into au;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'platform_audit_request', au.id,
      jsonb_build_object('party', au.party, 'from', au.from_month, 'to', au.to_month, 'ours', au.ours, 'theirs', au.theirs, 'agreed', au.agreed, 'dest', au.dest_account));
    return to_jsonb(au);

  elsif p_action = 'audit_review' then
    perform clinic_finance.lock_day();
    if not mgr then raise exception 'اعتماد المراجعة للمدير المالي أو المدير العام أو السوبر أدمن' using errcode = '42501'; end if;
    select * into au from clinic_finance.platform_audits where id = nullif(p->>'id', '')::uuid for update;
    if not found or au.status <> 'pending' then raise exception 'المراجعة اتراجعت قبل كده'; end if;
    if au.created_by = me then raise exception 'مينفعش تعتمد مراجعة انت عاملها' using errcode = '42501'; end if;
    ok := coalesce((p->>'ok')::boolean, false);
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.platform_audits set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = btrim(p->>'note') where id = au.id returning * into au;
    else
      select * into pt from clinic_finance.month_end_parties where key = au.party;
      select coalesce(sum(l.amount), 0) into ours_ from clinic_finance.month_end_lines(au.party, au.from_month, (au.to_month + interval '1 month' - interval '1 day')::date) l;
      if ours_ <> au.ours then raise exception 'رقمنا اتغيّر من وقت الطلب (% بدل %) — ارفض واعمل طلب جديد', ours_, au.ours; end if;
      if au.dest_account is not null and not clinic_finance.platform_dest_ok(au.dest_kind, au.dest_account) then raise exception 'حساب خصم المراجعة اتقفل — ارفض واعمل طلب جديد'; end if;
      e1 := null; e2 := null;
      if au.ours > 0 then
        e1 := clinic_finance.post('platform_audit', au.id, 'استحقاق ' || pt.name || ' — ' || to_char(au.from_month, 'YYYY-MM') ||
          case when au.to_month > au.from_month then ' / ' || to_char(au.to_month, 'YYYY-MM') else '' end, null, '5233', '2112', au.ours);
      end if;
      if au.agreed > au.ours then
        e2 := clinic_finance.post('platform_audit_extra', au.id, 'زيادة متفق عليها — ' || pt.name || ' — ' || au.theirs_ref, null, '5233', '2112', au.agreed - au.ours);
      elsif au.agreed < au.ours then
        e2 := clinic_finance.post('platform_audit_deduction', au.id, 'خصم مراجعة ' || pt.name || ' — ' || au.reason, null, '2112', au.dest_account, au.ours - au.agreed);
      end if;
      update clinic_finance.platform_audits set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(btrim(coalesce(p->>'note', '')), ''),
        entry_ids = array_remove(array[e1, e2], null) where id = au.id returning * into au;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'platform_audit_review', au.id, jsonb_build_object('ok', ok, 'entries', au.entry_ids));
    return to_jsonb(au);

  elsif p_action = 'settle_request' then
    perform clinic_finance.lock_day();
    if not reqr then raise exception 'طلب السداد للمحاسب أو المدير المالي' using errcode = '42501'; end if;
    select * into pt from clinic_finance.month_end_parties where key = p->>'party';
    begin amt := (p->>'amount')::numeric; tok := (p->>'token')::uuid;
      m := date_trunc('month', coalesce((p->>'month')::date, (now() at time zone 'Africa/Cairo')::date))::date;
    exception when others then raise exception 'راجع المبلغ'; end;
    if amt is null or amt <= 0 or amt <> round(amt, 2) then raise exception 'المبلغ غير صالح'; end if;
    if coalesce(p->>'method', '') not in ('cash', 'bank', 'wallet') then raise exception 'اختار طريقة السداد'; end if;
    select * into st from clinic_finance.month_end_settlements where created_by = me and token = tok;
    if found then return to_jsonb(st); end if;
    perform 1 from clinic_finance.month_end_parties where key = pt.key for update;
    select greatest(b.balance - b.pending, 0) into left_ from clinic_finance.platform_balances() b where b.party = pt.key;
    if amt > coalesce(left_, 0) then raise exception 'المبلغ أكبر من المستحق المعتمد للمنصة (%) — راجع الفترة الأول', coalesce(left_, 0); end if;
    sh := null;
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
    select * into st from clinic_finance.month_end_settlements where id = st.id for update;
    if st.status <> 'pending' then raise exception 'الطلب اتراجع قبل كده'; end if;
    if st.created_by = me then raise exception 'مينفعش تعتمد طلب انت عامله' using errcode = '42501'; end if;
    ok := coalesce((p->>'ok')::boolean, false);
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.month_end_settlements set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = btrim(p->>'note') where id = st.id returning * into st;
    else
      select * into pt from clinic_finance.month_end_parties where key = st.party;
      if st.amount > (select b.balance from clinic_finance.platform_balances() b where b.party = st.party) then raise exception 'المبلغ أكبر من المستحق المعتمد للمنصة'; end if;
      cashacct := case st.method when 'cash' then '1111' when 'bank' then '1112' else '1115' end;
      if st.method = 'cash' and not exists (select 1 from clinic_finance.shifts where id = st.shift_id and status = 'open' and ended_at is null) then raise exception 'وردية الخزينة الرئيسية اتقفلت — اعمل طلب جديد'; end if;
      e1 := clinic_finance.post('month_end_settlement', st.id, 'سداد ' || pt.name || ' — ' || st.reference, case when st.method = 'cash' then st.shift_id end, '2112', cashacct, st.amount);
      update clinic_finance.month_end_settlements set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(btrim(coalesce(p->>'note', '')), ''), entry_id = e1 where id = st.id returning * into st;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'month_end_settle_review', st.id, jsonb_build_object('ok', ok, 'entry', st.entry_id));
    return to_jsonb(st);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_month_end(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_month_end(text, jsonb) to authenticated;

-- ===================== checks as real people (everything below is rolled back) =====================
do $$
declare cn text; acc uuid; mk uuid; chk uuid; fmu uuid; apr uuid; ap uuid; ap_src text; ap_dk text; v_id uuid; ma date; mx date; net numeric; r jsonb; a jsonb; o1 numeric; o2 numeric; n int; bal numeric;
  ln text; want text;
begin
  -- real people, the way live is staffed (roles from admins.role OR admin_extra_roles via has_role_for; never «Admin Test»):
  --   maker = an accountant if live has one, else the financial manager; checker = another person (FM if the maker is the
  --   accountant, else GM, else a super admin — non-owner first); apr = a GM / super admin who is neither (for the FM-as-maker case)
  select a.user_id into acc from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'accountant')
     -- a plain accountant: not also FM / super admin (extra roles), or the FM-only checks would not apply to them
     and not public.has_role_for(a.id, 'financial_manager') and not public.has_role_for(a.id, 'super_admin') order by a.id limit 1;
  select a.user_id into fmu from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'financial_manager') and a.user_id is distinct from acc order by a.id limit 1;
  select a.user_id into apr from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and (public.has_role_for(a.id, 'general_manager') or public.has_role_for(a.id, 'super_admin')) and a.user_id is distinct from acc and a.user_id is distinct from fmu
   order by public.has_role_for(a.id, 'general_manager') desc, (a.role = 'super_admin') asc, a.id limit 1;
  if fmu is null or apr is null then raise exception 'need a real financial manager and a different GM / super admin with logins (got % / %)', fmu is not null, apr is not null; end if;
  mk := coalesce(acc, fmu); chk := case when acc is not null then fmu else apr end;
  raise notice 'people: maker = %, checker = %, third approver = % (accountant on live: %)', case when acc is null then 'financial manager' else 'accountant' end,
    case when acc is null then 'GM / super admin' else 'financial manager' end, 'GM / super admin', acc is not null;

  -- one REAL live visit whose booked service is a كشف / استشارة and was completed on that visit (any source), latest first
  select ap0.id, ap0.source, ap0.discount_kind, v.id, date_trunc('month', ap0.starts_at at time zone 'Africa/Cairo')::date,
         sum(coalesce(o.net_revenue, o.price * o.quantity * (1 - o.discount / 100)))
    into ap, ap_src, ap_dk, v_id, ma, net
    from clinic_reception.appointments ap0 join clinic_reception.workspaces w on w.id = ap0.workspace_id and w.mode = 'live'
    join clinic_reception.visits v on v.appointment_id = ap0.id
    join clinic_reception.orders o on o.visit_id = v.id and o.status = 'completed' and o.service_id = ap0.service_id
    join clinic_reception.services s on s.id = ap0.service_id
   where coalesce(clinic_reception.consult_kind(s.name), '') in ('K', 'S') and ap0.starts_at > now() - interval '120 days'
   group by ap0.id, ap0.source, ap0.discount_kind, v.id, ap0.starts_at having sum(coalesce(o.net_revenue, o.price * o.quantity * (1 - o.discount / 100))) >= 8
   order by ap0.starts_at desc limit 1;
  if ap is null then raise exception 'no real live كشف visit in the last 120 days to test with'; end if;
  mx := ma;

  -- 1) vezeeta 25% vs «فيزيتا شامل» 0 — the same real visit, moved between the two cases (triggers off only for these updates)
  set local session_replication_role = replica;
  begin update clinic_reception.appointments set source = 'vezeeta', discount_kind = null where id = ap; exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
  set local session_replication_role = origin;
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  o1 := (public.clinic_finance_month_end('audit_preview', jsonb_build_object('party', 'vezeeta', 'from', ma))->>'ours')::numeric;
  execute 'reset role';
  set local session_replication_role = replica;
  begin update clinic_reception.appointments set discount_kind = 'vezeeta', discount_percent = 40, discount_card_no = 'DRY-RUN', discount_card_expiry = current_date + 30, discount_card_path = 'dry-run/none' where id = ap; exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
  set local session_replication_role = origin;
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  o2 := (public.clinic_finance_month_end('audit_preview', jsonb_build_object('party', 'vezeeta', 'from', ma))->>'ours')::numeric;
  execute 'reset role';
  if o1 - o2 <> round(net * 25 / 100, 2) then raise exception 'vezeeta 25%% vs «فيزيتا شامل»: delta % ≠ 25%% of % ', o1 - o2, net; end if;
  raise notice 'OK 25%%: vezeeta visit counts % (25%% of %), «فيزيتا شامل» counts 0', o1 - o2, net;
  set local session_replication_role = replica;
  begin update clinic_reception.appointments set discount_kind = null where id = ap; exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
  set local session_replication_role = origin;

  -- 2) accountant: deduction → income 4122; accountant cannot approve, cannot pick a chart account; overlap refused; FM approves
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  a := public.clinic_finance_month_end('audit_request', jsonb_build_object('party', 'vezeeta', 'from', ma, 'to', ma, 'theirs', o1 + 50, 'theirs_ref', 'DRY-RUN',
        'agreed_mode', 'amount', 'agreed_value', o1 - 1, 'reason', 'dry-run income', 'dest_kind', 'income', 'token', gen_random_uuid()));
  begin perform public.clinic_finance_month_end('audit_review', jsonb_build_object('id', a->>'id', 'ok', true)); raise exception 'maker approved his own audit!';
  exception when others then if sqlerrm not like '%اعتماد المراجعة%' and sqlerrm not like '%انت عاملها%' then raise; end if; end;
  begin perform public.clinic_finance_month_end('audit_request', jsonb_build_object('party', 'vezeeta', 'from', ma, 'theirs', 1, 'theirs_ref', 'DRY-RUN', 'agreed_mode', 'amount',
          'agreed_value', 0, 'reason', 'dry-run', 'dest_kind', 'income', 'token', gen_random_uuid())); raise exception 'overlap accepted!';
  exception when others then if sqlerrm not like '%اتراجعت قبل كده%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', chk::text, true);
  r := public.clinic_finance_month_end('audit_review', jsonb_build_object('id', a->>'id', 'ok', true));
  execute 'reset role';
  select string_agg(l.account || ':' || l.debit::numeric(14,2) || '/' || l.credit::numeric(14,2), ' ' order by l.account, l.debit) into ln
    from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source like 'platform\_audit%' and e.source_id = (a->>'id')::uuid;
  want := '2112:0.00/' || o1::numeric(14,2) || ' 2112:1.00/0.00 4122:0.00/1.00 5233:' || o1::numeric(14,2) || '/0.00';
  if ln <> want then raise exception 'income entries: % (want %)', ln, want; end if;
  raise notice 'OK income: %', ln;

  -- 3) clinidu: deduction → payable 2111, accountant asks, GM / SA approves
  set local session_replication_role = replica; begin update clinic_reception.appointments set source = 'clinidu' where id = ap; exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end; set local session_replication_role = origin;
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  o2 := (public.clinic_finance_month_end('audit_preview', jsonb_build_object('party', 'clinidu', 'from', ma))->>'ours')::numeric;
  a := public.clinic_finance_month_end('audit_request', jsonb_build_object('party', 'clinidu', 'from', ma, 'theirs', o2, 'theirs_ref', 'DRY-RUN', 'agreed_mode', 'amount',
        'agreed_value', o2 - 2, 'reason', 'dry-run payable', 'dest_kind', 'payable', 'dest_account', '2111', 'token', gen_random_uuid()));
  perform set_config('request.jwt.claim.sub', apr::text, true);
  perform public.clinic_finance_month_end('audit_review', jsonb_build_object('id', a->>'id', 'ok', true));
  execute 'reset role';
  select string_agg(l.account || ':' || l.debit::numeric(14,2) || '/' || l.credit::numeric(14,2), ' ' order by l.account, l.debit) into ln
    from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source like 'platform\_audit%' and e.source_id = (a->>'id')::uuid;
  if ln not like '2111:0.00/2.00 %' then raise exception 'payable entries: %', ln; end if;
  raise notice 'OK payable: %', ln;

  -- 4) كفارة وسلامتك: FM picks a chart account (5233); FM cannot approve his own; GM / SA approves
  set local session_replication_role = replica; begin update clinic_reception.appointments set source = 'kafaret' where id = ap; exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end; set local session_replication_role = origin;
  if acc is not null then
  perform set_config('request.jwt.claim.sub', acc::text, true); execute 'set local role authenticated';
  begin perform public.clinic_finance_month_end('audit_request', jsonb_build_object('party', 'kafaret', 'from', ma, 'theirs', 1, 'theirs_ref', 'DRY-RUN', 'agreed_mode', 'amount',
          'agreed_value', 0, 'reason', 'dry-run', 'dest_kind', 'account', 'dest_account', '5233', 'token', gen_random_uuid())); raise exception 'accountant used a chart account!';
  exception when others then if sqlerrm not like '%للمدير المالي بس%' then raise; end if; end;
  execute 'reset role';
  else raise notice 'skipped: accountant-only refusal (chart account) — live has no plain accountant login (not also FM / super admin)'; end if;
  perform set_config('request.jwt.claim.sub', fmu::text, true); execute 'set local role authenticated';
  o2 := (public.clinic_finance_month_end('audit_preview', jsonb_build_object('party', 'kafaret', 'from', ma))->>'ours')::numeric;
  a := public.clinic_finance_month_end('audit_request', jsonb_build_object('party', 'kafaret', 'from', ma, 'theirs', o2, 'theirs_ref', 'DRY-RUN', 'agreed_mode', 'percent',
        'agreed_value', 50, 'reason', 'dry-run account', 'dest_kind', 'account', 'dest_account', '5233', 'token', gen_random_uuid()));
  begin perform public.clinic_finance_month_end('audit_review', jsonb_build_object('id', a->>'id', 'ok', true)); raise exception 'self-approval accepted!';
  exception when others then if sqlerrm not like '%انت عاملها%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', apr::text, true);
  perform public.clinic_finance_month_end('audit_review', jsonb_build_object('id', a->>'id', 'ok', true));
  execute 'reset role';
  select count(*) into n from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id
   where e.source like 'platform\_audit%' and e.source_id = (a->>'id')::uuid and l.account = '5233' and l.credit = o2 - round(o2 * 50 / 100, 2);
  if n <> 1 then raise exception 'chart-account deduction not posted to 5233'; end if;
  raise notice 'OK account: kafaret ours % agreed 50%% → Cr 5233 %', o2, o2 - round(o2 * 50 / 100, 2);

  -- 5) settle vezeeta's audited balance by bank: accountant asks (over the balance refused), FM approves → Dr 2112 / Cr 1112
  perform set_config('request.jwt.claim.sub', mk::text, true); execute 'set local role authenticated';
  select (x->>'balance')::numeric into bal from jsonb_array_elements(public.clinic_finance_month_end('platforms', '{}')->'platforms') x where x->>'party' = 'vezeeta';
  begin perform public.clinic_finance_month_end('settle_request', jsonb_build_object('party', 'vezeeta', 'amount', bal + 1, 'method', 'bank', 'reference', 'DRY-RUN', 'token', gen_random_uuid()));
    raise exception 'over-balance accepted!'; exception when others then if sqlerrm not like '%أكبر من المستحق المعتمد%' then raise; end if; end;
  a := public.clinic_finance_month_end('settle_request', jsonb_build_object('party', 'vezeeta', 'amount', bal, 'method', 'bank', 'reference', 'DRY-RUN', 'token', gen_random_uuid()));
  perform set_config('request.jwt.claim.sub', chk::text, true);
  perform public.clinic_finance_month_end('settle_review', jsonb_build_object('id', a->>'id', 'ok', true));
  r := public.clinic_finance_month_end('statement', jsonb_build_object('month', ma));
  execute 'reset role';
  select string_agg(l.account || ':' || l.debit::numeric(14,2) || '/' || l.credit::numeric(14,2), ' ' order by l.debit desc) into ln
    from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source_id = (a->>'id')::uuid;
  if ln <> '2112:' || bal::numeric(14,2) || '/0.00 1112:0.00/' || bal::numeric(14,2) then raise exception 'settlement entries: %', ln; end if;
  if (select count(*) from jsonb_array_elements(r->'parties') x where x->>'key' = 'kafaret') <> 1 then raise exception 'statement lost kafaret'; end if;
  raise notice 'platform audit dry-run OK: real visit month %, vezeeta 25%% = % / «شامل» 0, income / payable 2111 / FM account 5233 deductions posted, maker≠checker and overlap refused, settlement %; nothing kept', to_char(ma, 'YYYY-MM'), o1, ln;
exception when others then
  -- message only: never the DETAIL line (a failing row) or any patient data
  get stacked diagnostics cn = constraint_name;
  raise exception '%', sqlerrm || coalesce(' [' || nullif(cn, '') || ']', '');
end $$;
rollback;
