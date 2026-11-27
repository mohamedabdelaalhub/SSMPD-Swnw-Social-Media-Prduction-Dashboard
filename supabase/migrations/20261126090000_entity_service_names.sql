-- «اسم سونو واسم الجهة» in the reception service search — PART A, reception side (owner 2026-11-26 «طبقه»,
-- mockup docs/ui-references/mockups/entity-service-names.html on claude/entity-names-mockup).
--   * تأمين / تعاقد: the receptionist picks the ENTITY (contract) first, then searches services of THAT entity's price list by the
--     Sono name, the Sono code (clinic_reception.services.code = pricing_services.booking_code), or the entity's own name / code
--     (clinic_prices.items.external_name / external_code of the contract's active list + clinic_prices.aliases scope 'list:<list_id>').
--   * New read-only public.clinic_reception_entity_services(ws, contract, day) → jsonb array, one row per active reception service:
--     {service_id, code, name, department, entity_name, entity_code, aliases:[{name, code}], price, blocked}
--     price / blocked = clinic_reception.payer_price (the same price the booking is saved with; a service without a pricing mapping
--     is blocked — payer_price cannot price it, so the save refuses it too); entity_name / code = null when the entity has no own
--     name for it (UI: «نفس اسم سونو»).
--   * order_quotes.snapshot of a contract quote (clinic_reception.payer_quote: at arrival, or ⋯ «طريقة الدفع» after arrival) now
--     always carries the keys entity_service_name / entity_service_code (JSON null = the entity uses the Sono name). PART B (claims
--     printing) reads them; quotes made before this file do not have the keys at all («اسم الجهة مش متسجل»).
-- Wrapper by rename: the previous body is kept as clinic_reception.payer_quote_before_entity_names; callers (trigger payer_arrival,
-- clinic_reception_command 'order_payer') call clinic_reception.payer_quote by name, so they get the wrapper.
-- Rollback: supabase/rollbacks/20261126090000_entity_service_names.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.payer_price(uuid,uuid,date)') is null or to_regprocedure('clinic_reception.payer_quote(uuid,uuid)') is null then
    raise exception 'طبّق طريقة الدفع (20261123070000) الأول'; end if;
  if to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

begin;

-- the entity's own name / code for a reception service under the contract's list that payer_price uses on that day
create function clinic_reception.entity_service_name(p_contract uuid, p_service uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pr jsonb; psid uuid; it jsonb;
begin
  pr := clinic_reception.payer_price(p_contract, p_service, p_day);
  if pr is null or pr->>'list_id' is null then return null; end if;
  select nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid into psid from clinic_reception.services s where s.id = p_service;
  if psid is null then return jsonb_build_object('name', null, 'code', null, 'list_id', pr->>'list_id'); end if;
  select to_jsonb(i) into it from clinic_prices.items i where i.list_id = (pr->>'list_id')::uuid and i.service_id = psid;
  return jsonb_build_object('name', nullif(btrim(coalesce(it->>'external_name', '')), ''), 'code', nullif(btrim(coalesce(it->>'external_code', '')), ''),
    'list_id', pr->>'list_id');
end $$;
revoke all on function clinic_reception.entity_service_name(uuid, uuid, date) from public, anon, authenticated;

-- the booking form: every active service of the workspace under ONE contract (entity price list), with the entity's names / codes
create function public.clinic_reception_entity_services(p_workspace uuid, p_contract uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date); ok boolean; lid uuid; al jsonb := '{}'::jsonb; out jsonb;
begin
  perform clinic_reception.access(p_workspace, 'view');
  if p_contract is null then raise exception 'اختار الجهة الأول'; end if;
  if to_regclass('public.contracting_entity_contracts') is null or to_regclass('clinic_prices.lists') is null then return '[]'::jsonb; end if;
  execute 'select exists (select 1 from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
             where c.id = $1 and c.status = ''active'' and e.category in (''insurance'', ''unions'', ''clubs'')
               and (c.start_date is null or c.start_date <= $2) and (c.end_date is null or c.end_date >= $2))' into ok using p_contract, d;
  if not coalesce(ok, false) then raise exception 'عقد الجهة مش متفعّل — الحسابات تفعّل العقد الأول'; end if;
  -- the same list payer_price picks
  select x.id into lid from clinic_prices.lists x
   where x.contract_id = p_contract and x.status = 'active' and d between x.valid_from and x.valid_to and to_jsonb(x)->>'deleted_at' is null
   order by x.version desc limit 1;
  if lid is null then raise exception 'مفيش قايمة أسعار متفعّلة للجهة دي في اليوم ده'; end if;
  if to_regclass('clinic_prices.aliases') is not null then
    execute 'select coalesce(jsonb_object_agg(service_id::text, a), ''{}''::jsonb) from (
               select a.service_id, jsonb_agg(distinct jsonb_build_object(''name'', nullif(btrim(coalesce(a.external_name, '''')), ''''),
                                                                  ''code'', nullif(btrim(coalesce(a.external_code, '''')), ''''))) a
                 from clinic_prices.aliases a where a.scope_key = $1 group by a.service_id) q' into al using 'list:' || lid::text;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('service_id', q.id, 'code', q.code, 'name', q.name, 'department', q.department,
           'entity_name', nullif(btrim(coalesce(q.it->>'external_name', '')), ''), 'entity_code', nullif(btrim(coalesce(q.it->>'external_code', '')), ''),
           'aliases', coalesce(al->(q.psid::text), '[]'::jsonb),
           'price', case when coalesce((q.pr->>'blocked')::boolean, true) then null else (q.pr->>'price')::numeric end,
           'blocked', coalesce((q.pr->>'blocked')::boolean, true)) order by q.name, q.code), '[]'::jsonb) into out
    from (-- payer_price needs a pricing mapping (unmapped services cannot be saved under a contract either) → blocked
          select s.id, s.code, s.name, s.department, ps.psid, case when ps.psid is not null then clinic_reception.payer_price(p_contract, s.id, d) end pr,
                 (select to_jsonb(i) from clinic_prices.items i where i.list_id = lid and i.service_id = ps.psid) it
            from clinic_reception.services s
           cross join lateral (select nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid psid) ps
           where s.workspace_id = p_workspace and s.active) q;
  return out;
end $$;
revoke all on function public.clinic_reception_entity_services(uuid, uuid, date) from public, anon;
grant execute on function public.clinic_reception_entity_services(uuid, uuid, date) to authenticated;

-- the contract quote keeps the entity's name / code of the service (PART B prints them)
alter function clinic_reception.payer_quote(uuid, uuid) rename to payer_quote_before_entity_names;
revoke all on function clinic_reception.payer_quote_before_entity_names(uuid, uuid) from public, anon, authenticated;

create function clinic_reception.payer_quote(p_order uuid, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare out jsonb; o record; ctr uuid; nm jsonb;
begin
  out := clinic_reception.payer_quote_before_entity_names(p_order, p_me);
  if out is null then return null; end if;
  select ord.service_id, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id where ord.id = p_order;
  select a.payer_contract_id into ctr from clinic_reception.appointments a where a.id = o.appointment_id;
  nm := clinic_reception.entity_service_name(ctr, o.service_id, (now() at time zone 'Africa/Cairo')::date);
  update clinic_reception.order_quotes
     set snapshot = snapshot || jsonb_build_object('entity_service_name', nm->'name', 'entity_service_code', nm->'code')
   where order_id = p_order;
  return out;
end $$;
revoke all on function clinic_reception.payer_quote(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
