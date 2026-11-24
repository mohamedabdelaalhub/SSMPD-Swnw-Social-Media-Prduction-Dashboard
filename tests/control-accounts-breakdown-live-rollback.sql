-- Live rollback dry-run for 20261125030000_control_accounts_breakdown.sql (rule 9). ONE transaction ending with ROLLBACK.
-- 1) migration body; 2) archived = exactly the empty leaves (expect 67) and the 4 loose system accounts got parents;
-- 3) as the FM: breakdown of 1115 / 2120 / 5111 — every one adds up to the account total; the old wallet receipt (RC-2026-000010)
--    is listed «لسه ما اتحددتش»; FM proposes a kind, the owner / GM confirms → it moves to that wallet; maker cannot confirm;
-- 4) as a reception cashier: 'set' on a non-matching receipt changes nothing; 5) movements rows carry 'wallet_kind'. Nothing kept.
begin;
-- ===== migration body (20261125030000) =====

do $$ begin
  if to_regprocedure('public.clinic_finance_account_breakdown(text,date,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.payments') is null or to_regclass('clinic_finance.account_config') is null
     or to_regprocedure('clinic_finance.doctor_balance(text)') is null or to_regprocedure('clinic_finance.account_in_use(text)') is null then
    raise exception 'مكونات الحسابات أو الاستقبال غير موجودة'; end if;
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null
     or position('''receipt_no''' in pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'طبّق رقم الإيصال في حركات الخزن (20261124220000) الأول'; end if;
end $$;

-- 1) wallet kind on reception payments
alter table clinic_reception.payments
  add column wallet_kind text check (wallet_kind in ('vodafone', 'valu', 'other')),
  add column wallet_kind_pending text check (wallet_kind_pending in ('vodafone', 'valu', 'other')),
  add column wallet_kind_by uuid references public.admins(id),
  add column wallet_kind_at timestamptz;

create function clinic_finance.wallet_kind_label(k text) returns text language sql immutable set search_path = pg_catalog as $$
  select case k when 'vodafone' then 'فودافون كاش' when 'valu' then 'فاليو' when 'other' then 'محفظة تانية' else 'لسه ما اتحددتش' end
$$;

-- 3) set / propose / review
create function public.clinic_finance_wallet_kind(p_action text, p_payload jsonb, p_token uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p clinic_reception.payments%rowtype; k text := nullif(p_payload->>'kind', ''); op clinic_finance.journal_operations%rowtype; res jsonb;
begin
  if p_token is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'طلب غير صالح'; end if;
  if p_action = 'set' then
    -- the collector, right after a wallet collection: matched by his own receipt (reference + amount), today, still empty
    me := public.my_admin_id();
    if me is null then raise exception 'سجّل الدخول الأول'; end if;
    if k is null or k not in ('vodafone', 'valu', 'other') then raise exception 'اختار أنهي محفظة'; end if;
    select * into p from clinic_reception.payments where created_by = me and method = 'wallet' and wallet_kind is null
      and reference = btrim(coalesce(p_payload->>'reference', '')) and amount = (p_payload->>'amount')::numeric
      and created_at > now() - interval '1 day' order by created_at desc limit 1 for update;
    if not found then return jsonb_build_object('updated', 0); end if;
    update clinic_reception.payments set wallet_kind = k, wallet_kind_by = me, wallet_kind_at = now() where id = p.id;
    return jsonb_build_object('updated', 1, 'id', p.id, 'wallet_kind', k);
  end if;
  me := clinic_finance.require_access(case when p_action = 'review' then 'review' else 'create' end);
  select * into op from clinic_finance.journal_operations where actor = me and token = p_token;
  if found then
    if op.action <> 'wallet_kind_' || p_action or op.payload <> p_payload then raise exception 'مفتاح مكرر لبيانات مختلفة'; end if;
    return op.result;
  end if;
  select * into p from clinic_reception.payments where id = nullif(p_payload->>'id', '')::uuid for update;
  if not found or p.method <> 'wallet' then raise exception 'الإيصال ده مش تحصيل بمحفظة'; end if;
  if p.wallet_kind is not null then raise exception 'نوع المحفظة متحدد بالفعل (%)', clinic_finance.wallet_kind_label(p.wallet_kind); end if;
  if p_action = 'propose' then
    if k is null or k not in ('vodafone', 'valu', 'other') then raise exception 'اختار أنهي محفظة'; end if;
    update clinic_reception.payments set wallet_kind_pending = k, wallet_kind_by = me, wallet_kind_at = now() where id = p.id;
  elsif p_action = 'review' then
    if p.wallet_kind_pending is null then raise exception 'مفيش نوع محفظة مستني تأكيد'; end if;
    if p.wallet_kind_by = me then raise exception 'التأكيد لازم من شخص غير اللي حدد المحفظة'; end if;
    if p_payload->>'approve' not in ('true', 'false') then raise exception 'حدد القرار'; end if;
    if (p_payload->>'approve')::boolean then
      update clinic_reception.payments set wallet_kind = wallet_kind_pending, wallet_kind_pending = null, wallet_kind_by = me, wallet_kind_at = now() where id = p.id;
    else
      update clinic_reception.payments set wallet_kind_pending = null, wallet_kind_by = null, wallet_kind_at = null where id = p.id;
    end if;
  else raise exception 'إجراء غير معروف';
  end if;
  select * into p from clinic_reception.payments where id = p.id;
  res := jsonb_build_object('id', p.id, 'wallet_kind', p.wallet_kind, 'pending', p.wallet_kind_pending);
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'wallet_kind_' || p_action, p.id, res);
  insert into clinic_finance.journal_operations(actor, token, action, payload, result, created_at) values (me, p_token, 'wallet_kind_' || p_action, p_payload, res, now());
  return res;
end $$;

-- 2) breakdown
create function public.clinic_finance_account_breakdown(p_code text, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('view'); total numeric; rows jsonb; split numeric; unset jsonb;
  d0 date := coalesce(p_from, date_trunc('month', (now() at time zone 'Africa/Cairo'))::date); d1 date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
begin
  if p_code = '1115' then
    select coalesce(sum(l.debit - l.credit), 0) into total from clinic_finance.lines l where l.account = '1115';
    select coalesce(jsonb_agg(jsonb_build_object('key', x.k, 'label', clinic_finance.wallet_kind_label(x.k), 'amount', x.amt, 'count', x.n) order by x.ord), '[]'::jsonb),
           coalesce(sum(x.amt), 0) into rows, split
      from (select coalesce(p.wallet_kind, 'unset') k, sum(p.amount) amt, count(*) n,
                   case coalesce(p.wallet_kind, 'unset') when 'vodafone' then 1 when 'valu' then 2 when 'other' then 3 else 4 end ord
              from clinic_reception.payments p join clinic_reception.workspaces w on w.id = p.workspace_id
             where w.mode = 'live' and p.method = 'wallet' group by 1) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'reference', p.reference, 'amount', p.amount,
             'at', p.created_at, 'by', (select a.name from public.admins a where a.id = p.created_by), 'pending', p.wallet_kind_pending,
             'pending_by', (select a.name from public.admins a where a.id = p.wallet_kind_by), 'pending_mine', p.wallet_kind_by = me) order by p.created_at), '[]'::jsonb)
      into unset from clinic_reception.payments p join clinic_reception.workspaces w on w.id = p.workspace_id
     where w.mode = 'live' and p.method = 'wallet' and p.wallet_kind is null;
  elsif p_code = '2120' then
    select coalesce(sum(l.credit - l.debit), 0) into total from clinic_finance.lines l where l.account = '2120';
    select coalesce(jsonb_agg(jsonb_build_object('key', x.k, 'label', x.nm, 'amount', x.amt) order by x.amt desc, x.nm), '[]'::jsonb), coalesce(sum(x.amt), 0)
      into rows, split
      from (select k.k, coalesce((select max(c.doctor_name) from clinic_finance.doctor_contracts c where c.doctor_key = k.k),
                                 (select max(pr.name) from clinic_reception.providers pr where pr.doctor_key = k.k), k.k) nm,
                   clinic_finance.doctor_balance(k.k) amt
              from (select doctor_key k from clinic_finance.doctor_contracts union select doctor_key from clinic_reception.providers where doctor_key is not null) k) x
     where x.amt <> 0;
    unset := '[]'::jsonb;
  elsif p_code = '5111' then
    select coalesce(sum(l.debit - l.credit), 0) into total from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id
      where l.account = '5111' and e.business_date between d0 and d1;
    select coalesce(jsonb_agg(jsonb_build_object('key', x.k, 'label', x.nm, 'amount', x.amt) order by x.amt desc, x.nm), '[]'::jsonb), coalesce(sum(x.amt), 0)
      into rows, split
      from (select pr.doctor_key k, coalesce(max(pr.name), pr.doctor_key) nm, sum(l.debit - l.credit) amt
              from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
              join clinic_reception.workspaces w on w.id = j.workspace_id and w.mode = 'live'
              join clinic_reception.providers pr on pr.id = nullif(j.dimensions->>'provider_id', '')::uuid and pr.workspace_id = w.id
             where l.account = '5111' and (j.created_at at time zone 'Africa/Cairo')::date between d0 and d1 and pr.doctor_key is not null
             group by pr.doctor_key) x where x.amt <> 0;
    unset := '[]'::jsonb;
  else
    raise exception 'التفصيل متاح لحسابات المحافظ ومستحقات وأتعاب الأطباء بس';
  end if;
  return jsonb_build_object('code', p_code, 'from', case when p_code = '5111' then d0 end, 'to', case when p_code = '5111' then d1 end,
    'total', total, 'rows', rows, 'other', total - split, 'unset', unset,
    'can_propose', clinic_finance.allowed('create'), 'can_review', clinic_finance.allowed('review'));
end $$;

revoke all on function public.clinic_finance_wallet_kind(text, jsonb, uuid), public.clinic_finance_account_breakdown(text, date, date) from public, anon;
grant execute on function public.clinic_finance_wallet_kind(text, jsonb, uuid), public.clinic_finance_account_breakdown(text, date, date) to authenticated;
revoke all on function clinic_finance.wallet_kind_label(text) from public, anon, authenticated;

-- 4) movements: + wallet_kind
create table clinic_finance.breakdown_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.breakdown_saved_defs from public, anon, authenticated;
do $$ declare d text; a constant text := $a$'receipt_no',(select rp.receipt_no from clinic_reception.payments rp where rp.id = a.source_id))$a$; begin
  d := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط في حركات الخزن مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  insert into clinic_finance.breakdown_saved_defs values ('shift_movements', d);
  execute replace(d, a, $b$'receipt_no',(select rp.receipt_no from clinic_reception.payments rp where rp.id = a.source_id),'wallet_kind',(select rp.wallet_kind from clinic_reception.payments rp where rp.id = a.source_id))$b$);
end $$;

-- 5a) loose system accounts → their tree parents (metadata only)
insert into clinic_finance.account_config(code, is_system) select code, true from clinic_finance.accounts where code in ('3198', '4118') on conflict (code) do nothing;
update clinic_finance.account_config c set parent_code = x.p, revision = c.revision + 1
  from (values ('4119', '04'), ('4118', '04'), ('3198', '03'), ('5227', '0505')) x(code, p)
 where c.code = x.code and c.parent_code is null and exists (select 1 from clinic_finance.account_config pc where pc.code = x.p and not pc.is_postable and not pc.archived);

-- 5b) archive the 67 empty leaves (owner «أرشف الـ67»)
create table clinic_finance.breakdown_archived(code text primary key, name text, parent_code text, archived_at timestamptz not null default now());
revoke all on clinic_finance.breakdown_archived from public, anon, authenticated;
with want(code) as (
  select unnest(array['0102010301', '0102010302', '0102010303', '0102010304', '0201040201', '0201040202'])
  union all select '05041504' || lpad(n::text, 2, '0') from generate_series(1, 62) n
), done as (
  update clinic_finance.account_config c set archived = true, active = false, revision = c.revision + 1
    from want w where c.code = w.code and not c.is_system and not c.archived and c.is_postable and not clinic_finance.account_in_use(c.code)
  returning c.code, c.parent_code)
insert into clinic_finance.breakdown_archived(code, name, parent_code) select d.code, a.name, d.parent_code from done d join clinic_finance.accounts a on a.code = d.code;

-- ===== test =====
do $$
declare fm uuid; ck uuid; fmid uuid; rc uuid; b jsonb; code text; s numeric; n int; pid uuid; r jsonb; ok boolean; m jsonb; d0 date := (now() at time zone 'Africa/Cairo')::date;
begin
  select a.user_id, a.id into fm, fmid from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id into ck from public.admins a where a.active and a.user_id is not null and a.role in ('super_admin', 'general_manager') and a.id <> fmid order by a.role desc, a.id limit 1;
  select a.user_id into rc from public.admins a where a.active and a.user_id is not null and a.role = 'reception' order by a.id limit 1;
  if fm is null or ck is null then raise exception 'need FM + owner/GM with logins'; end if;
  select count(*) into n from clinic_finance.breakdown_archived;
  raise notice 'archived % empty leaf accounts (owner approved 67)', n;
  if n > 67 then raise exception 'archived more than the 67 approved: %', n; end if;
  if exists (select 1 from clinic_finance.breakdown_archived x where clinic_finance.account_in_use(x.code)) then raise exception 'archived a used account'; end if;
  if exists (select 1 from clinic_finance.account_config where code in ('4119', '5227') and parent_code is null) then raise exception 'loose system accounts still loose'; end if;
  select p.id into pid from clinic_reception.payments p where p.method = 'wallet' and p.wallet_kind is null order by p.created_at limit 1;
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  foreach code in array array['1115', '2120', '5111'] loop
    b := public.clinic_finance_account_breakdown(code, null, null);
    select coalesce(sum((v->>'amount')::numeric), 0) into s from jsonb_array_elements(b->'rows') v;
    if s + (b->>'other')::numeric <> (b->>'total')::numeric then raise exception '% does not add up: rows % + other % <> total %', code, s, b->>'other', b->>'total'; end if;
    raise notice '% total % — % rows, other %', code, b->>'total', jsonb_array_length(b->'rows'), b->>'other';
  end loop;
  if pid is not null then
    b := public.clinic_finance_account_breakdown('1115', null, null);
    if not exists (select 1 from jsonb_array_elements(b->'unset') v where v->>'id' = pid::text) then raise exception 'old wallet receipt not listed as unset'; end if;
    r := public.clinic_finance_wallet_kind('propose', jsonb_build_object('id', pid, 'kind', 'vodafone'), gen_random_uuid());
    ok := false; begin perform public.clinic_finance_wallet_kind('review', jsonb_build_object('id', pid, 'approve', true), gen_random_uuid());
      exception when others then ok := sqlerrm like '%شخص غير%'; end;
    if not ok then raise exception 'maker confirmed his own wallet kind'; end if;
    perform set_config('request.jwt.claim.sub', ck::text, true);
    r := public.clinic_finance_wallet_kind('review', jsonb_build_object('id', pid, 'approve', true), gen_random_uuid());
    if r->>'wallet_kind' <> 'vodafone' then raise exception 'review did not set the kind: %', r; end if;
    b := public.clinic_finance_account_breakdown('1115', null, null);
    if not exists (select 1 from jsonb_array_elements(b->'rows') v where v->>'key' = 'vodafone') then raise exception 'receipt did not move to vodafone'; end if;
  end if;
  m := public.clinic_finance_shift_movements(null, d0 - 6, d0);
  if exists (select 1 from jsonb_array_elements(coalesce(m->'movements', '[]')) v where not (v ? 'wallet_kind')) then raise exception 'movement row without wallet_kind'; end if;
  if rc is not null then
    perform set_config('request.jwt.claim.sub', rc::text, true);
    r := public.clinic_finance_wallet_kind('set', jsonb_build_object('reference', 'NO-SUCH-REF', 'amount', 1, 'kind', 'valu'), gen_random_uuid());
    if (r->>'updated')::int <> 0 then raise exception 'set changed a receipt it should not'; end if;
  end if;
  execute 'reset role';
  raise notice 'breakdown dry-run OK (FM / owner-GM / reception), old wallet receipt %', coalesce(pid::text, 'none');
end $$;
rollback;
