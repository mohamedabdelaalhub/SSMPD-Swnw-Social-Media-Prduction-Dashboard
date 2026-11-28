-- Contract pricing by service group (owner 2026-11-28: «موافق على جدول قواعد التسعير والمصاريف الإدارية»; Mahmoud's model):
-- a contract prices each GROUP of services from a SOURCE (the Sono center price, or a reference list such as نقابة الأطباء
-- 2024) plus or minus a percent, with fixed-price exceptions on the contract's own list taking priority.
--
--  1. clinic_prices.service_groups — the 13 groups (outpatient: كشف، معمل، أشعة، عيادات، طوارئ، أسنان، علاج طبيعي؛ inpatient: إقامة،
--     رعاية مركزة، رعاية متوسطة، رعاية قلب، حضانات، عمليات). Inpatient groups exist but are not used yet (owner: later).
--  2. clinic_prices.service_group_categories (catalog category → group) and clinic_prices.service_group_services
--     (one service → group, wins over its category; e.g. the consultation services). clinic_prices.service_group(service).
--  3. clinic_prices.contract_price_rules — (contract, group) → source 'center' | 'list' (+ source_list_id), adjust_percent
--     (−100…+1000), rounding step. One rule per group per contract.
--  4. clinic_prices.resolve_contract_rules(service, base, date, contract): NULL when the contract has no rules (so every
--     existing contract prices exactly as before). Otherwise, in order:
--       a) a fixed item for the service in the contract's own linked active list (the exceptions: كشف 170 …);
--       b) the rule of the service's group: source price × (1 + adjust/100), rounded to the step;
--       c) else refuse «الخدمة مش في عقد الجهة — الاستقبال هيأكد» (never the cash price).
--     Excluded services, insurer coverage and authorization flags come from price_list_terms exactly like today.
--     clinic_prices.resolve() calls it first for a contract (anchored one-line patch), so reception, invoices, claims and
--     the WhatsApp feed all get the same price.
--  5. public.contracting_entity_contracts.admin_fee_percent (0…100) — the contract's administrative fee, and
--     clinic_reception.claim_admin_fee(claim) → {percent, amount} for the claim screen / statement. The fee is NOT posted
--     automatically: it is taken through the existing reviewed «تخفيض تعاقدي» request (four eyes), pre-filled from here.
--  6. public.contract_price_rules_command(action, payload) — the only write path: set_rule / delete_rule / set_admin_fee
--     (contract managers, general manager, super admin, financial manager), map_category / map_service (price managers).
--     Every change is written to clinic_prices.rule_audit.
-- Rollback: supabase/rollbacks/20261127330000_contract_price_rules.rollback.sql
begin;

alter table public.contracting_entity_contracts
  add column if not exists admin_fee_percent numeric(5,2) not null default 0 check (admin_fee_percent between 0 and 100);

create table if not exists clinic_prices.service_groups(
  code text primary key, name_ar text not null, scope text not null check (scope in ('outpatient','inpatient')), sort integer not null);
insert into clinic_prices.service_groups(code, name_ar, scope, sort) values
  ('consult','الكشف','outpatient',1), ('lab','المعمل','outpatient',2), ('radiology','الأشعة','outpatient',3),
  ('clinics','العيادات والإجراءات','outpatient',4), ('emergency','الطوارئ','outpatient',5), ('dental','الأسنان','outpatient',6),
  ('physio','العلاج الطبيعي','outpatient',7),
  ('ward','الإقامة الداخلية','inpatient',8), ('icu','الرعاية المركزة','inpatient',9), ('imc','الرعاية المتوسطة','inpatient',10),
  ('ccu','رعاية القلب','inpatient',11), ('nicu','الحضانات','inpatient',12), ('surgery','العمليات','inpatient',13)
on conflict (code) do nothing;

create table if not exists clinic_prices.service_group_categories(
  category text primary key, group_code text not null references clinic_prices.service_groups(code));
create table if not exists clinic_prices.service_group_services(
  service_id uuid primary key references public.pricing_services(id), group_code text not null references clinic_prices.service_groups(code));

create table if not exists clinic_prices.contract_price_rules(
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracting_entity_contracts(id) on delete cascade,
  group_code text not null references clinic_prices.service_groups(code),
  source text not null check (source in ('center','list')),
  source_list_id uuid references clinic_prices.lists(id),
  adjust_percent numeric(7,3) not null default 0 check (adjust_percent between -100 and 1000),
  rounding numeric(8,2) not null default 0.01 check (rounding > 0),
  notes text not null default '',
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(),
  updated_by uuid references public.admins(id), updated_at timestamptz,
  unique (contract_id, group_code),
  check ((source = 'list') = (source_list_id is not null)));

create table if not exists clinic_prices.rule_audit(
  id bigint generated always as identity primary key, actor_id uuid not null references public.admins(id), action text not null,
  contract_id uuid, details jsonb not null, created_at timestamptz not null default now());

alter table clinic_prices.service_groups enable row level security;
alter table clinic_prices.service_group_categories enable row level security;
alter table clinic_prices.service_group_services enable row level security;
alter table clinic_prices.contract_price_rules enable row level security;
alter table clinic_prices.rule_audit enable row level security;
revoke all on clinic_prices.service_groups, clinic_prices.service_group_categories, clinic_prices.service_group_services,
  clinic_prices.contract_price_rules, clinic_prices.rule_audit from public, anon, authenticated;

create or replace function clinic_prices.service_group(p_service uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select group_code from clinic_prices.service_group_services where service_id = p_service),
                  (select g.group_code from public.pricing_services s join clinic_prices.service_group_categories g on g.category = s.category where s.id = p_service));
$$;

create or replace function clinic_prices.resolve_contract_rules(p_service uuid, p_base numeric, p_date date, p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c public.contracting_entity_contracts%rowtype; g text; r clinic_prices.contract_price_rules%rowtype; src numeric; val numeric;
        q jsonb; t jsonb; coverage numeric := 0; why text;
begin
  if p_contract is null or not exists (select 1 from clinic_prices.contract_price_rules where contract_id = p_contract) then return null; end if;
  select * into c from public.contracting_entity_contracts where id = p_contract and status = 'active' and p_date between start_date and coalesce(end_date, '9999-12-31');
  if not found then raise exception 'عقد الجهة غير ساري في تاريخ الخدمة'; end if;
  select x into t from jsonb_array_elements(c.price_list_terms) x where x->>'service_id' = p_service::text;
  if coalesce((t->>'excluded')::boolean, false) then raise exception 'الخدمة مستثناة من عقد الجهة'; end if;
  -- a) exception: fixed item on the contract's own linked list
  if c.price_list_id is not null and c.price_list_link_status = 'active'
     and exists (select 1 from clinic_prices.items i where i.list_id = c.price_list_id and i.service_id = p_service) then
    q := clinic_prices.resolve_explicit_list(p_service, p_base, p_date, c.price_list_id) || jsonb_build_object('rule', 'exception');
  else
    -- b) group rule
    g := clinic_prices.service_group(p_service);
    select * into r from clinic_prices.contract_price_rules where contract_id = p_contract and group_code = g;
    if r.id is null then raise exception 'الخدمة مش في عقد الجهة — الاستقبال هيأكد'; end if;
    if r.source = 'center' then
      src := (clinic_prices.resolve_before_offer(p_service, p_base, p_date, null)->>'price')::numeric;
      why := 'سعر سونو';
    else
      select i.fixed_price into src from clinic_prices.items i join clinic_prices.lists l on l.id = i.list_id
       where i.list_id = r.source_list_id and i.service_id = p_service and l.status = 'active' and l.deleted_at is null and i.fixed_price > 0;
      if src is null then raise exception 'الخدمة مالهاش سعر في لايحة المصدر لعقد الجهة — الاستقبال هيأكد'; end if;
      select name into why from clinic_prices.lists where id = r.source_list_id;
    end if;
    val := round(src * (1 + r.adjust_percent / 100) / r.rounding) * r.rounding;
    if val <= 0 then raise exception 'التسعير يجعل السعر صفرًا أو سالبًا'; end if;
    q := jsonb_build_object('price', round(val, 2), 'source', 'contract_rule', 'rule', r.group_code, 'source_price', src,
      'adjust_percent', r.adjust_percent, 'source_list_id', r.source_list_id,
      'reason', why || case when r.adjust_percent = 0 then '' when r.adjust_percent > 0 then ' + ' || trim(to_char(r.adjust_percent, 'FM990.###')) || '%' else ' − ' || trim(to_char(-r.adjust_percent, 'FM990.###')) || '%' end);
  end if;
  if c.booking_billing_kind = 'insurer' then coverage := coalesce((t->>'coverage_percent')::numeric, c.booking_coverage, 0); end if;
  return q || jsonb_build_object('contract_id', c.id, 'contract_terms', coalesce(t, '{}'), 'coverage', coverage,
    'requires_authorization', coalesce((t->>'requires_authorization')::boolean, false), 'admin_fee_percent', c.admin_fee_percent);
end $$;
revoke all on function clinic_prices.resolve_contract_rules(uuid, numeric, date, uuid) from public, anon, authenticated;
revoke all on function clinic_prices.service_group(uuid) from public, anon, authenticated;

-- resolve(): try the contract rules first (anchored, one line, idempotent)
do $mig$
declare fn regprocedure := to_regprocedure('clinic_prices.resolve(uuid,numeric,date,uuid)'); src text;
  old_line constant text := ' r:=clinic_prices.resolve_before_offer(p_service,base,p_date,p_contract);';
  new_line constant text := ' r:=coalesce(clinic_prices.resolve_contract_rules(p_service,base,p_date,p_contract),clinic_prices.resolve_before_offer(p_service,base,p_date,p_contract));';
  n int;
begin
  if fn is null then raise exception 'clinic_prices.resolve is missing'; end if;
  select prosrc into src from pg_proc where oid = fn;
  if position(new_line in src) > 0 then raise notice 'resolve already patched, nothing to do'; return; end if;
  n := (length(src) - length(replace(src, old_line, ''))) / length(old_line);
  if n <> 1 then raise exception 'anchor found % times in clinic_prices.resolve (md5 %); refusing to patch', n, md5(src); end if;
  execute format('create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as %L', replace(src, old_line, new_line));
  raise notice 'resolve patched: % -> %', md5(src), (select md5(prosrc) from pg_proc where oid = fn);
end $mig$;
revoke all on function clinic_prices.resolve(uuid, numeric, date, uuid) from public, anon, authenticated;

-- admin fee for a claim (shown on the claim; posted only through the reviewed contractual-reduction request)
create or replace function clinic_reception.claim_admin_fee(p_claim uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare cl record; pct numeric;
begin
  select c.id, c.amount, i.created_at, e.contracting_entity_id into cl from clinic_reception.claims c join clinic_reception.entities e on e.id = c.entity_id
    join clinic_reception.invoices i on i.id = c.invoice_id where c.id = p_claim;
  if not found then return null; end if;
  select k.admin_fee_percent into pct from public.contracting_entity_contracts k
   where k.entity_id = cl.contracting_entity_id and k.status in ('active','expired')
     and (cl.created_at at time zone 'Africa/Cairo')::date between k.start_date and coalesce(k.end_date, '9999-12-31')
   order by k.start_date desc limit 1;
  return jsonb_build_object('percent', coalesce(pct, 0), 'amount', round(cl.amount * coalesce(pct, 0) / 100, 2));
end $$;
revoke all on function clinic_reception.claim_admin_fee(uuid) from public, anon;
grant execute on function clinic_reception.claim_admin_fee(uuid) to authenticated;

create or replace function public.contract_price_rules_command(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); k uuid := nullif(p_payload->>'contract_id', '')::uuid; r clinic_prices.contract_price_rules%rowtype;
        old jsonb; src text; lid uuid;
begin
  if me is null then raise exception 'سجّل الدخول الأول'; end if;
  if p_action in ('set_rule', 'delete_rule', 'set_admin_fee') then
    if not (public.can_manage_contracting_entities() or public.can_approve_contracts()) then raise exception 'تعديل قواعد تسعير العقود لمدير التعاقدات أو المدير المالي أو السوبر أدمن'; end if;
    if not exists (select 1 from public.contracting_entity_contracts where id = k) then raise exception 'العقد مش موجود'; end if;
  elsif p_action in ('map_category', 'map_service') then
    if not clinic_prices.manage() then raise exception 'ربط الأقسام بالمجموعات لمدير لوائح الأسعار'; end if;
  else raise exception 'إجراء غير معروف'; end if;

  if p_action = 'set_rule' then
    src := p_payload->>'source'; lid := nullif(p_payload->>'source_list_id', '')::uuid;
    if src = 'list' and not exists (select 1 from clinic_prices.lists where id = lid and deleted_at is null and status in ('active', 'draft')) then raise exception 'اختار لايحة مصدر موجودة'; end if;
    select * into r from clinic_prices.contract_price_rules where contract_id = k and group_code = p_payload->>'group_code';
    old := to_jsonb(r);
    insert into clinic_prices.contract_price_rules(contract_id, group_code, source, source_list_id, adjust_percent, rounding, notes, created_by)
    values (k, p_payload->>'group_code', src, case when src = 'list' then lid end, coalesce((p_payload->>'adjust_percent')::numeric, 0),
            coalesce(nullif(p_payload->>'rounding', '')::numeric, 0.01), coalesce(p_payload->>'notes', ''), me)
    on conflict (contract_id, group_code) do update set source = excluded.source, source_list_id = excluded.source_list_id,
      adjust_percent = excluded.adjust_percent, rounding = excluded.rounding, notes = excluded.notes, updated_by = me, updated_at = now()
    returning * into r;
    insert into clinic_prices.rule_audit(actor_id, action, contract_id, details) values (me, 'set_rule', k, jsonb_build_object('old', old, 'new', to_jsonb(r)));
    return to_jsonb(r);
  elsif p_action = 'delete_rule' then
    delete from clinic_prices.contract_price_rules where contract_id = k and group_code = p_payload->>'group_code' returning * into r;
    if r.id is null then raise exception 'مفيش قاعدة للمجموعة دي'; end if;
    insert into clinic_prices.rule_audit(actor_id, action, contract_id, details) values (me, 'delete_rule', k, jsonb_build_object('old', to_jsonb(r)));
    return jsonb_build_object('deleted', r.id);
  elsif p_action = 'set_admin_fee' then
    select jsonb_build_object('admin_fee_percent', admin_fee_percent) into old from public.contracting_entity_contracts where id = k;
    update public.contracting_entity_contracts set admin_fee_percent = (p_payload->>'admin_fee_percent')::numeric, updated_at = now() where id = k;
    insert into clinic_prices.rule_audit(actor_id, action, contract_id, details) values (me, 'set_admin_fee', k, jsonb_build_object('old', old, 'new', p_payload->'admin_fee_percent'));
    return jsonb_build_object('admin_fee_percent', (p_payload->>'admin_fee_percent')::numeric);
  elsif p_action = 'map_category' then
    insert into clinic_prices.service_group_categories(category, group_code) values (p_payload->>'category', p_payload->>'group_code')
    on conflict (category) do update set group_code = excluded.group_code;
    insert into clinic_prices.rule_audit(actor_id, action, contract_id, details) values (me, 'map_category', null, p_payload);
    return p_payload;
  else
    insert into clinic_prices.service_group_services(service_id, group_code) values ((p_payload->>'service_id')::uuid, p_payload->>'group_code')
    on conflict (service_id) do update set group_code = excluded.group_code;
    insert into clinic_prices.rule_audit(actor_id, action, contract_id, details) values (me, 'map_service', null, p_payload);
    return p_payload;
  end if;
end $$;
revoke all on function public.contract_price_rules_command(text, jsonb) from public, anon;
grant execute on function public.contract_price_rules_command(text, jsonb) to authenticated;

create or replace function public.contract_price_rules_workspace() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not (public.can_manage_contracting_entities() or public.can_approve_contracts() or clinic_prices.manage()) then raise exception 'غير مسموح'; end if;
  return jsonb_build_object(
    'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.sort), '[]') from clinic_prices.service_groups g),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'group_code', m.group_code, 'services', c.n) order by c.category), '[]')
                   from (select category, count(*) n from public.pricing_services where active group by category) c left join clinic_prices.service_group_categories m on m.category = c.category),
    'rules', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from clinic_prices.contract_price_rules r),
    'admin_fees', (select coalesce(jsonb_object_agg(id, admin_fee_percent), '{}') from public.contracting_entity_contracts where admin_fee_percent > 0));
end $$;
revoke all on function public.contract_price_rules_workspace() from public, anon;
grant execute on function public.contract_price_rules_workspace() to authenticated;

commit;
