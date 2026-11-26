-- «حساب الشريك» (owner «كمل باقي المراحل كلها» 2026-11-26 — daily-movements map phase 4; mockup
-- docs/ui-references/mockups/daily-movements-map.html §5). A current account per partner (د. دينا حسني · م. محمد), MAIN TREASURY ONLY:
--   * deposit    (توريد من الشريك): Dr main cash (open main shift) / bank 1112 — Cr the partner's account (the center owes him).
--   * withdrawal (صرف للشريك):     Dr the partner's account — Cr main cash / bank.
-- It is never revenue or expense: rent and the like are still paid as expenses from the main treasury. Requested by the financial
-- manager or accountant, APPROVED BY ANOTHER PERSON (FM / GM / super admin); only then posted. Partners are added by the super admin
-- (each gets its own equity account 331x). Balance > 0 = the center owes the partner; < 0 = the partner owes the center.
-- Rollback: supabase/rollbacks/20261126120000_partner_accounts.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)') is null or to_regclass('clinic_finance.registers') is null then raise exception 'مكونات الخزينة غير موجودة'; end if;
  if to_regclass('clinic_finance.partners') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if exists (select 1 from clinic_finance.accounts where code in ('3311', '3312')) then raise exception 'الحسابات 3311 / 3312 مستخدمة'; end if;
end $$;

create table clinic_finance.partners (
  id uuid primary key default gen_random_uuid(), name text not null unique check (length(btrim(name)) between 2 and 80),
  account text not null unique, active boolean not null default true, created_by uuid references public.admins(id), created_at timestamptz not null default now());
insert into clinic_finance.accounts(code, name, kind) values ('3311', 'جاري الشريك — د. دينا حسني', 'equity'), ('3312', 'جاري الشريك — م. محمد', 'equity');
insert into clinic_finance.account_config(code, is_system) values ('3311', true), ('3312', true) on conflict (code) do nothing;
insert into clinic_finance.partners(name, account) values ('د. دينا حسني', '3311'), ('م. محمد', '3312');

create table clinic_finance.partner_moves (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references clinic_finance.partners(id),
  kind text not null check (kind in ('deposit', 'withdrawal')), amount numeric(14,2) not null check (amount > 0 and amount <= 10000000),
  method text not null check (method in ('cash', 'bank')), shift_id uuid references clinic_finance.shifts(id),
  reason text not null check (length(btrim(reason)) between 3 and 300), reference text,
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(), token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text, entry_id uuid,
  unique (created_by, token));
alter table clinic_finance.partners enable row level security;
alter table clinic_finance.partner_moves enable row level security;
revoke all on clinic_finance.partners, clinic_finance.partner_moves from public, anon, authenticated;

create function clinic_finance.partner_balance(p_account text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(l.credit - l.debit), 0) from clinic_finance.lines l where l.account = p_account
$$;
revoke all on function clinic_finance.partner_balance(text) from public, anon, authenticated;

create function public.clinic_finance_partner(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); see boolean; req boolean; mgr boolean; pr clinic_finance.partners%rowtype; mv clinic_finance.partner_moves%rowtype;
  amt numeric; tok uuid; sh uuid; e uuid; cashacct text; v_code text; ok boolean;
begin
  if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
  mgr := public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin');
  req := public.has_role('financial_manager') or public.has_role('accountant');
  see := mgr or req;
  if not see then raise exception 'حساب الشريك للحسابات والإدارة' using errcode = '42501'; end if;
  p := coalesce(p, '{}'::jsonb);
  select s.id into sh from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
   where r.treasury_kind = 'main' and s.status = 'open' and s.ended_at is null order by s.opened_at desc limit 1;

  if p_action = 'status' then
    return jsonb_build_object('can_request', req, 'can_review', mgr, 'can_add', public.has_role('super_admin'), 'main_shift', sh,
      'main_cash', case when sh is not null then clinic_finance.cash_limit(sh) end,
      'partners', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'account', x.account, 'active', x.active,
          'balance', clinic_finance.partner_balance(x.account),
          'pending', (select count(*) from clinic_finance.partner_moves m where m.partner_id = x.id and m.status = 'pending')) order by x.created_at), '[]'::jsonb) from clinic_finance.partners x),
      'pending', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'partner', x.name, 'kind', m.kind, 'amount', m.amount, 'method', m.method, 'reason', m.reason, 'reference', m.reference,
          'at', m.created_at, 'by', (select name from public.admins where id = m.created_by), 'mine', m.created_by = me) order by m.created_at), '[]'::jsonb)
        from clinic_finance.partner_moves m join clinic_finance.partners x on x.id = m.partner_id where m.status = 'pending'));

  elsif p_action = 'statement' then
    select * into pr from clinic_finance.partners where id = (p->>'partner_id')::uuid;
    if not found then raise exception 'الشريك مش موجود'; end if;
    return jsonb_build_object('partner', pr.name, 'balance', clinic_finance.partner_balance(pr.account), 'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'at', z.at, 'description', z.description, 'in', z.cr, 'out', z.dr, 'balance', z.run) order by z.at, z.id), '[]'::jsonb) from (
      select e.created_at at, e.id, e.description, l.credit cr, l.debit dr, sum(l.credit - l.debit) over (order by e.created_at, e.id) run
      from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where l.account = pr.account) z),
      'moves', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'method', m.method, 'reason', m.reason, 'status', m.status,
          'at', m.created_at, 'by', (select name from public.admins where id = m.created_by), 'reviewed_by', (select name from public.admins where id = m.reviewed_by), 'review_note', m.review_note) order by m.created_at desc), '[]'::jsonb)
        from (select * from clinic_finance.partner_moves where partner_id = pr.id order by created_at desc limit 100) m));

  elsif p_action = 'request' then
    perform clinic_finance.lock_day();
    if not req then raise exception 'الطلب للمدير المالي أو المحاسب' using errcode = '42501'; end if;
    select * into pr from clinic_finance.partners where id = (p->>'partner_id')::uuid and active;
    if not found then raise exception 'اختار الشريك'; end if;
    begin amt := (p->>'amount')::numeric; tok := (p->>'token')::uuid; exception when others then raise exception 'راجع المبلغ'; end;
    if amt is null or amt <= 0 or amt <> round(amt, 2) then raise exception 'المبلغ غير صالح'; end if;
    if coalesce(p->>'kind', '') not in ('deposit', 'withdrawal') then raise exception 'اختار نوع الحركة'; end if;
    if coalesce(p->>'method', '') not in ('cash', 'bank') then raise exception 'اختار كاش أو بنك'; end if;
    if p->>'method' = 'cash' and sh is null then raise exception 'مفيش وردية مفتوحة للخزينة الرئيسية'; end if;
    select * into mv from clinic_finance.partner_moves where created_by = me and token = tok;
    if found then return to_jsonb(mv); end if;
    insert into clinic_finance.partner_moves(partner_id, kind, amount, method, shift_id, reason, reference, created_by, token)
      values (pr.id, p->>'kind', amt, p->>'method', case when p->>'method' = 'cash' then sh end, btrim(coalesce(p->>'reason', '')), nullif(btrim(coalesce(p->>'reference', '')), ''), me, tok) returning * into mv;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'partner_move_request', mv.id, jsonb_build_object('partner', pr.name, 'kind', mv.kind, 'amount', amt));
    return to_jsonb(mv);

  elsif p_action = 'review' then
    perform clinic_finance.lock_day();
    if not mgr then raise exception 'الاعتماد للمدير المالي أو المدير العام أو السوبر أدمن' using errcode = '42501'; end if;
    select * into mv from clinic_finance.partner_moves where id = (p->>'id')::uuid for update;
    if not found or mv.status <> 'pending' then raise exception 'الطلب اتراجع قبل كده'; end if;
    if mv.created_by = me then raise exception 'مينفعش تعتمد طلب انت عامله' using errcode = '42501'; end if;
    ok := coalesce((p->>'ok')::boolean, false);
    if not ok then
      if length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.partner_moves set status = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = btrim(p->>'note') where id = mv.id returning * into mv;
    else
      select * into pr from clinic_finance.partners where id = mv.partner_id;
      cashacct := case mv.method when 'cash' then '1111' else '1112' end;
      if mv.method = 'cash' and not exists (select 1 from clinic_finance.shifts where id = mv.shift_id and status = 'open' and ended_at is null) then raise exception 'وردية الخزينة الرئيسية اتقفلت — اعمل طلب جديد'; end if;
      if mv.kind = 'deposit' then
        e := clinic_finance.post('partner_move', mv.id, 'توريد من الشريك ' || pr.name || ' — ' || mv.reason, case when mv.method = 'cash' then mv.shift_id end, cashacct, pr.account, mv.amount);
      else
        e := clinic_finance.post('partner_move', mv.id, 'صرف للشريك ' || pr.name || ' — ' || mv.reason, case when mv.method = 'cash' then mv.shift_id end, pr.account, cashacct, mv.amount);
      end if;
      update clinic_finance.partner_moves set status = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(btrim(coalesce(p->>'note', '')), ''), entry_id = e where id = mv.id returning * into mv;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'partner_move_review', mv.id, jsonb_build_object('ok', ok, 'entry', mv.entry_id));
    return to_jsonb(mv);

  elsif p_action = 'add_partner' then
    if not public.has_role('super_admin') then raise exception 'إضافة شريك للسوبر أدمن' using errcode = '42501'; end if;
    if length(btrim(coalesce(p->>'name', ''))) < 2 then raise exception 'اكتب اسم الشريك'; end if;
    if exists (select 1 from clinic_finance.partners where name = btrim(p->>'name')) then raise exception 'الشريك ده موجود'; end if;
    select '33' || lpad((coalesce(max(substr(x.account, 3)::int), 10) + 1)::text, 2, '0') into v_code from clinic_finance.partners x where x.account ~ '^33[0-9]{2}$';
    if v_code is null or v_code > '3399' or exists (select 1 from clinic_finance.accounts a where a.code = v_code) then raise exception 'مفيش رقم حساب متاح'; end if;
    insert into clinic_finance.accounts(code, name, kind) values (v_code, 'جاري الشريك — ' || btrim(p->>'name'), 'equity');
    insert into clinic_finance.account_config(code, is_system) values (v_code, true) on conflict (code) do nothing;
    insert into clinic_finance.partners(name, account, created_by) values (btrim(p->>'name'), v_code, me) returning * into pr;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'partner_added', pr.id, jsonb_build_object('name', pr.name, 'account', v_code));
    return to_jsonb(pr);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_partner(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_partner(text, jsonb) to authenticated;

commit;
