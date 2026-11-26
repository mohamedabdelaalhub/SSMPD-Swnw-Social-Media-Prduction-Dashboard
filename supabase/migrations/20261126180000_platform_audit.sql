-- Booking platforms: 25% of the كشف, period audit and audit deduction (owner 2026-11-26 «تمام طبقه» on mockup
-- docs/ui-references/mockups/platform-audit.html, head 89a31a29). Builds on «حسابات آخر الشهر» (20261126110000).
--   * Parties: فيزيتا / كلينيدو / اكشف + NEW كفارة وسلامتك (key 'kafaret'), all 25%.
--   * What counts (clinic_finance.month_end_lines, platform branch): a LIVE appointment whose source is the platform, its booked
--     service is a كشف or استشارة (clinic_reception.consult_kind K / S — متابعة is excluded) and was completed on that visit, net
--     after discount. An appointment with the «فيزيتا شامل» discount (discount_kind = 'vezeeta': the patient got 40% off) owes
--     NOTHING, whatever its source. كفارة وسلامتك patients pay the normal price; only the 25% goes to the platform.
--   * Period audit (1 or 2 calendar months) — accountant / FM asks: our number (computed from the records, frozen at request and
--     re-checked at approval), their claimed number + their invoice reference, the agreed figure (an amount OR a % of ours) and a
--     reason. A DIFFERENT person (FM / GM / super admin) approves; only then it posts:
--        accrual     Dr 5233 عمولات منصات الحجز / Cr 2112 مستحقات منصات الحجز   = ours
--        agreed > ours  Dr 5233 / Cr 2112                                     = agreed − ours
--        agreed < ours  Dr 2112 / Cr 4122 إيراد تسويات منصات الحجز            = ours − agreed  (the «خصم المراجعة»)
--     The deduction ALWAYS goes to the company (owner 2026-11-26: «خليه رصيد في حساب الشركة» — it can later fund invoices, dues,
--     debts or installments through the normal treasury / payment paths); any other destination is refused.
--     Entry sources (entries are unique per source + source_id): 'platform_audit' (accrual), 'platform_audit_extra',
--     'platform_audit_deduction' — all with the audit id.
--   * A platform's balance (shown in «مستحقات الموردين» and «حسابات آخر الشهر») = Σ approved agreed − Σ approved/pending settlements.
--     Platform settlement now pays the balance: Dr 2112 / Cr main cash / bank / wallet (other parties are unchanged).
-- The previous public function is kept (renamed, not granted) and still serves every other action; the previous month_end_lines
-- definition is saved for the rollback. Rollback: supabase/rollbacks/20261126180000_platform_audit.rollback.sql
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
  dest_kind text check (dest_kind = 'income'), dest_account text references clinic_finance.accounts(code) check (dest_account = '4122'),
  check ((agreed < ours) = (dest_kind is not null and dest_account is not null)),
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(), token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text, entry_ids uuid[] not null default '{}',
  unique (created_by, token));
create index platform_audits_party_idx on clinic_finance.platform_audits(party, from_month);
alter table clinic_finance.platform_audits enable row level security;
revoke all on clinic_finance.platform_audits from public, anon, authenticated;

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
declare me uuid := public.my_admin_id(); fin boolean; mgr boolean; reqr boolean; r jsonb; pt clinic_finance.month_end_parties%rowtype;
  au clinic_finance.platform_audits%rowtype; st clinic_finance.month_end_settlements%rowtype; f date; t date; t_end date; ours_ numeric; n int;
  amt numeric; val numeric; tok uuid; left_ numeric; e1 uuid; e2 uuid; cashacct text; sh uuid; ok boolean; dk text; da text; m date;
  plat constant text[] := array['vezeeta', 'clinidu', 'akshef', 'kafaret'];
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  fin := public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  mgr := public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  reqr := public.has_role('accountant') or public.has_role('financial_manager');
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
      'can_audit', reqr);
  elsif p_action not in ('platforms', 'audits', 'audit_preview', 'audit_request', 'audit_review') then
    return clinic_finance.clinic_finance_month_end_before_audit(p_action, p);
  end if;

  if p_action = 'platforms' then
    if not fin then raise exception 'مستحقات المنصات للحسابات والإدارة' using errcode = '42501'; end if;
    return jsonb_build_object('can_audit', reqr, 'platforms', (select coalesce(jsonb_agg(to_jsonb(b) order by q.sort), '[]'::jsonb)
      from clinic_finance.platform_balances() b join clinic_finance.month_end_parties q on q.key = b.party));

  elsif p_action = 'audits' then
    if not fin then raise exception 'مراجعات المنصات للحسابات والإدارة' using errcode = '42501'; end if;
    return jsonb_build_object('can_audit', reqr, 'can_review', mgr,
      'income_account', jsonb_build_object('code', '4122', 'name', (select name from clinic_finance.accounts where code = '4122')),
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
    if coalesce(p->>'dest_kind', 'income') <> 'income' or coalesce(nullif(p->>'dest_account', ''), '4122') <> '4122'
      then raise exception 'خصم المراجعة بيروح لحساب الشركة بس (4122)'; end if;
    dk := null; da := null;
    if amt < ours_ then dk := 'income'; da := '4122'; end if;
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

commit;
