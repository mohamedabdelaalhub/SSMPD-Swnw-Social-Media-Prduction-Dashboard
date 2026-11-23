-- «طريقة الدفع / نوع الكشف» on every booking (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/booking-payer-kind.*):
--   «عايز الكشف يتحدد كاش ولا تأمين، ولو تأمين يظهر خيارات شركات التأمين اللي عندنا في التعاقدات ومش الحضانات والنوادي».
--   * cash      — as before; the optional booking discount (فيزيتا شامل / كارت العيلة / خاص) stays.
--   * contract  — «تأمين / تعاقد»: ONLY entities (contracting_entities.category insurance / unions / clubs) whose contract is ACTIVE
--                 and has an ACTIVE price list (clinic_prices.lists) valid on the visit day. Price = the list price of the service
--                 (fixed price, or base minus the item / list discount; fallback 'block' = not covered). The receptionist types
--                 «نسبة تحمّل الجهة ٪» from the coverage approval + the patient's medical card, the coupon / card no, the approval no,
--                 and uploads the approval photo (mandatory). The patient is linked to the contract (contract_patient_links).
--                 At arrival the arrival order gets the contract quote (existing order_quotes → claim at execution) with that coverage.
--   * union     — «نقابات / نوادي»: cash with a flat 30% (existing booking discount kind 'syndicate'), any union / club
--                 (category unions / clubs, or another name) with card no + valid until + card photo.
-- Actions on public.clinic_reception_command: 'book' / 'walk_in' / 'reschedule' carrying payer_kind set it; new 'set_payer'
-- {id, payer_*, discount_*} on a booked appointment; new 'order_payer' {order_id, payer_*, discount_*} after arrival while the
-- service is still «ordered». New read-only public.clinic_reception_payer_options(ws, service, day) feeds the form.
-- Outer wrapper (previous body kept as clinic_reception.command_before_payer_kind).
-- Rollback: supabase/rollbacks/20261123070000_booking_payer_kind.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.order_discount(uuid,uuid,jsonb,uuid)') is null then
    raise exception 'طبّق خصومات الحجز (20261123060000) الأول'; end if;
  if to_regprocedure('clinic_reception.command_before_payer_kind(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.appointments
  add column payer_kind text check (payer_kind in ('cash', 'contract', 'union')),
  add column payer_contract_id uuid,
  add column payer_entity_name text,
  add column payer_coupon_no text,
  add column payer_auth_ref text,
  add column payer_coverage_percent numeric(5,2) check (payer_coverage_percent between 0 and 100),
  add column payer_proof_path text,
  add column payer_price numeric(14,2),
  add column payer_by uuid references public.admins(id),
  add column payer_at timestamptz;

-- list price of a reception service under a contract on a day: {price, blocked, list_id, list_name, valid_from, valid_to}
create function clinic_reception.payer_price(p_contract uuid, p_service uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare l record; it record; base numeric; psid uuid; price numeric;
begin
  select s.price, nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid into base, psid from clinic_reception.services s where s.id = p_service;
  if base is null then return null; end if;
  select * into l from clinic_prices.lists x
   where x.contract_id = p_contract and x.status = 'active' and p_day between x.valid_from and x.valid_to
   order by x.version desc limit 1;
  if not found then return null; end if;
  if psid is not null then select * into it from clinic_prices.items i where i.list_id = l.id and i.service_id = psid; end if;
  if it.id is not null then
    price := coalesce(it.fixed_price, base * (1 - coalesce(it.discount_percent, 0) / 100) - coalesce(it.discount_amount, 0));
  elsif l.fallback = 'base' then price := base;
  elsif l.fallback = 'discount' then price := base * (1 - coalesce(l.discount_percent, 0) / 100) - coalesce(l.discount_amount, 0);
  else price := null;
  end if;
  return jsonb_build_object('price', case when price is null then null else round(greatest(price, 0), 2) end, 'blocked', price is null,
    'list_id', l.id, 'list_name', l.name, 'valid_from', l.valid_from, 'valid_to', l.valid_to);
end $$;
revoke all on function clinic_reception.payer_price(uuid, uuid, date) from public, anon, authenticated;

-- the form: active contracts (with their price for the service) + unions / clubs
create function public.clinic_reception_payer_options(p_workspace uuid, p_service uuid default null, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date); contracts jsonb := '[]'::jsonb; unions jsonb := '[]'::jsonb;
begin
  perform clinic_reception.access(p_workspace, 'view');
  if to_regclass('public.contracting_entity_contracts') is not null and to_regclass('clinic_prices.lists') is not null then
    select coalesce(jsonb_agg(x order by x->>'entity_name'), '[]'::jsonb) into contracts from (
      select jsonb_build_object('contract_id', c.id, 'entity_name', e.name, 'category', e.category) ||
             coalesce(case when p_service is not null then clinic_reception.payer_price(c.id, p_service, d) end, '{}'::jsonb) x
        from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
       where c.status = 'active' and e.category in ('insurance', 'unions', 'clubs')
         and (c.start_date is null or c.start_date <= d) and (c.end_date is null or c.end_date >= d)
         and exists (select 1 from clinic_prices.lists l where l.contract_id = c.id and l.status = 'active' and d between l.valid_from and l.valid_to)) q;
  end if;
  if to_regclass('public.contracting_entities') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'category', e.category) order by e.name), '[]'::jsonb) into unions
      from public.contracting_entities e where e.category in ('unions', 'clubs');
  end if;
  return jsonb_build_object('day', d, 'contracts', contracts, 'unions', unions);
end $$;
revoke all on function public.clinic_reception_payer_options(uuid, uuid, date) from public, anon;
grant execute on function public.clinic_reception_payer_options(uuid, uuid, date) to authenticated;

-- validate a contract choice for a service / day; returns the price row
create function clinic_reception.payer_contract_check(p jsonb, p_service uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare cid uuid; ok boolean; pr jsonb; cov numeric; path text; has_file boolean;
begin
  begin cid := nullif(p->>'payer_contract_id', '')::uuid; exception when others then cid := null; end;
  if cid is null then raise exception 'اختار الجهة (تأمين / تعاقد)'; end if;
  execute 'select exists (select 1 from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
             where c.id = $1 and c.status = ''active'' and e.category in (''insurance'', ''unions'', ''clubs'')
               and (c.start_date is null or c.start_date <= $2) and (c.end_date is null or c.end_date >= $2))' into ok using cid, p_day;
  if not coalesce(ok, false) then raise exception 'عقد الجهة مش متفعّل — الحسابات تفعّل العقد الأول'; end if;
  pr := clinic_reception.payer_price(cid, p_service, p_day);
  if pr is null then raise exception 'مفيش قايمة أسعار متفعّلة للجهة دي في اليوم ده'; end if;
  if (pr->>'blocked')::boolean then raise exception 'الخدمة دي مش في قايمة أسعار الجهة'; end if;
  if length(btrim(coalesce(p->>'payer_coupon_no', ''))) < 2 then raise exception 'اكتب رقم الكوبون / الكارنيه'; end if;
  if length(btrim(coalesce(p->>'payer_auth_ref', ''))) < 2 then raise exception 'اكتب رقم موافقة التغطية'; end if;
  begin cov := nullif(btrim(coalesce(p->>'payer_coverage_percent', '')), '')::numeric; exception when others then cov := null; end;
  if cov is null or cov < 0 or cov > 100 then raise exception 'اكتب نسبة تحمّل الجهة (من 0 لـ 100٪) من الموافقة والكارت الطبي'; end if;
  path := btrim(coalesce(p->>'payer_proof_path', ''));
  if length(path) < 4 then raise exception 'ارفع صورة الموافقة'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''booking-discount-cards'' and o.name = $1)' into has_file using path;
    if not has_file then raise exception 'ارفع صورة الموافقة'; end if;
  end if;
  return pr || jsonb_build_object('contract_id', cid, 'coverage', cov, 'proof', path);
end $$;
revoke all on function clinic_reception.payer_contract_check(jsonb, uuid, date) from public, anon, authenticated;

-- union path → the booking discount kind 'syndicate' at a flat 30%
create function clinic_reception.payer_union_discount(p jsonb) returns jsonb language plpgsql immutable as $$
declare nm text := btrim(coalesce(nullif(btrim(coalesce(p->>'payer_union', '')), ''), p->>'payer_union_other', ''));
begin
  if length(nm) < 2 then raise exception 'اختار النقابة / النادي أو اكتب اسمها'; end if;
  return jsonb_build_object('discount_kind', 'syndicate', 'discount_percent', '30',
    'discount_org_type', case when p->>'payer_union_type' = 'club' or nm like 'نادي%' then 'club' else 'syndicate' end,
    'discount_org_name', nm, 'discount_card_no', p->>'payer_card_no', 'discount_card_expiry', p->>'payer_card_expiry',
    'discount_card_path', p->>'payer_card_path');
end $$;
revoke all on function clinic_reception.payer_union_discount(jsonb) from public, anon, authenticated;

-- link the patient to the contract (owner: «أيوه، يتربط لوحده») — archive patient only
create function clinic_reception.payer_link_patient(p_patient uuid, p_contract uuid, p_member text, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare arch uuid;
begin
  if to_regclass('public.contract_patient_links') is null then return; end if;
  select patient_id into arch from clinic_reception.patients where id = p_patient;
  if arch is null then return; end if;
  execute 'insert into public.contract_patient_links(contract_id, patient_id, member_reference, linked_from, linked_by)
           select $1, $2, nullif(btrim($3), ''''), (now() at time zone ''Africa/Cairo'')::date, $4
            where not exists (select 1 from public.contract_patient_links l where l.contract_id = $1 and l.patient_id = $2
                                and l.linked_from <= (now() at time zone ''Africa/Cairo'')::date
                                and (l.linked_until is null or l.linked_until >= (now() at time zone ''Africa/Cairo'')::date))'
    using p_contract, arch, p_member, p_me;
end $$;
revoke all on function clinic_reception.payer_link_patient(uuid, uuid, text, uuid) from public, anon, authenticated;

-- set the payment type on a booked appointment
create function clinic_reception.set_payer(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; kind text := nullif(btrim(coalesce(p->>'payer_kind', '')), ''); d date; pr jsonb; nm text;
begin
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status <> 'booked' then raise exception 'طريقة الدفع بتتعدّل قبل وصول المريض — بعد الوصول من «⋯» في كارت الزيارة'; end if;
  if kind is null or kind not in ('cash', 'contract', 'union') then raise exception 'اختار طريقة الدفع: كاش أو تأمين / تعاقد أو نقابات / نوادي'; end if;
  if ap.package_id is not null and kind <> 'cash' then raise exception 'حجز الباكج بسعره المتعاقد عليه — طريقة الدفع كاش'; end if;
  d := (ap.starts_at at time zone 'Africa/Cairo')::date;
  if kind = 'contract' then
    pr := clinic_reception.payer_contract_check(p, ap.service_id, d);
    if ap.discount_kind is not null then perform clinic_reception.set_booking_discount(p_workspace, ap.id, jsonb_build_object('discount_kind', ''), p_me); end if;
    execute 'select e.name from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id where c.id = $1'
      into nm using (pr->>'contract_id')::uuid;
    update clinic_reception.appointments set payer_kind = 'contract', payer_contract_id = (pr->>'contract_id')::uuid, payer_entity_name = nm,
        payer_coupon_no = left(btrim(p->>'payer_coupon_no'), 60), payer_auth_ref = left(btrim(p->>'payer_auth_ref'), 80),
        payer_coverage_percent = (pr->>'coverage')::numeric, payer_proof_path = pr->>'proof', payer_price = (pr->>'price')::numeric,
        payer_by = p_me, payer_at = now()
     where id = ap.id;
    perform clinic_reception.payer_link_patient(ap.patient_id, (pr->>'contract_id')::uuid, p->>'payer_coupon_no', p_me);
  elsif kind = 'union' then
    pr := clinic_reception.payer_union_discount(p);
    perform clinic_reception.set_booking_discount(p_workspace, ap.id, pr, p_me);
    update clinic_reception.appointments set payer_kind = 'union', payer_contract_id = null, payer_entity_name = pr->>'discount_org_name',
        payer_coupon_no = null, payer_auth_ref = null, payer_coverage_percent = null, payer_proof_path = null, payer_price = null,
        payer_by = p_me, payer_at = now()
     where id = ap.id;
  else
    -- via book / walk_in / reschedule the inner wrappers already applied the payload's discount (_via)
    if not coalesce((p->>'_via')::boolean, false) then
      if ap.payer_kind = 'union' and not (p ? 'discount_kind') then
        perform clinic_reception.set_booking_discount(p_workspace, ap.id, jsonb_build_object('discount_kind', ''), p_me); end if;
      if p ? 'discount_kind' then perform clinic_reception.set_booking_discount(p_workspace, ap.id, p, p_me); end if;
    elsif ap.payer_kind = 'union' and ap.discount_kind = 'syndicate' and not (p ? 'discount_kind') then
      perform clinic_reception.set_booking_discount(p_workspace, ap.id, jsonb_build_object('discount_kind', ''), p_me);
    end if;
    update clinic_reception.appointments set payer_kind = 'cash', payer_contract_id = null, payer_entity_name = null, payer_coupon_no = null,
        payer_auth_ref = null, payer_coverage_percent = null, payer_proof_path = null, payer_price = null, payer_by = p_me, payer_at = now()
     where id = ap.id;
  end if;
  return jsonb_build_object('id', ap.id, 'payer_kind', kind, 'price', pr->'price');
end $$;
revoke all on function clinic_reception.set_payer(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- the contract quote on an «ordered» service: reception mirror entity / contract on demand, then order_quotes (claim at execution)
create function clinic_reception.payer_quote(p_order uuid, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o record; ap record; pr jsonb; eid uuid; ent record; ec clinic_reception.entity_contracts%rowtype; code text; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select ord.*, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id where ord.id = p_order;
  select * into ap from clinic_reception.appointments where id = o.appointment_id;
  if ap.payer_kind is distinct from 'contract' then return null; end if;
  pr := clinic_reception.payer_price(ap.payer_contract_id, o.service_id, d);
  if pr is null or (pr->>'blocked')::boolean then raise exception 'قايمة أسعار الجهة مش سارية النهارده للخدمة دي — راجع الحسابات'; end if;
  execute 'select e.id, e.name from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id where c.id = $1'
    into ent using ap.payer_contract_id;
  select id into eid from clinic_reception.entities where workspace_id = o.workspace_id and contracting_entity_id = ent.id order by id limit 1;
  if eid is null then
    insert into clinic_reception.entities(workspace_id, name, kind, contracting_entity_id) values (o.workspace_id, ent.name, 'insurer', ent.id) returning id into eid;
  end if;
  code := o.snapshot->>'code';
  if code is null then select s.code into code from clinic_reception.services s where s.id = o.service_id; end if;
  select * into ec from clinic_reception.entity_contracts c
   where c.workspace_id = o.workspace_id and c.entity_id = eid and c.service_code = code and c.external_contract_id = ap.payer_contract_id
     and c.status = 'active' and d between c.valid_from and c.valid_to and c.price = (pr->>'price')::numeric
   order by c.valid_from desc limit 1;
  if not found then
    insert into clinic_reception.entity_contracts(workspace_id, entity_id, service_code, price, coverage, valid_from, valid_to, reference, terms,
        status, created_by, reviewed_by, external_contract_id)
      values (o.workspace_id, eid, code, (pr->>'price')::numeric, 0, (pr->>'valid_from')::date, (pr->>'valid_to')::date,
        coalesce(pr->>'list_name', 'قايمة أسعار'), 'لائحة ' || ent.name || ' — من «طريقة الدفع» في الحجز', 'active', p_me, p_me, ap.payer_contract_id)
      returning * into ec;
  end if;
  insert into clinic_reception.order_quotes(order_id, workspace_id, contract_id, snapshot, authorization_ref, quoted_by, quoted_at)
    values (o.id, o.workspace_id, ec.id, to_jsonb(ec) || jsonb_build_object('coverage', ap.payer_coverage_percent, 'entity_id', eid,
              'entity_name', ent.name, 'entity_kind', 'insurer', 'coupon', ap.payer_coupon_no, 'proof_path', ap.payer_proof_path),
            ap.payer_auth_ref, p_me, now())
    on conflict (order_id) do update set contract_id = excluded.contract_id, snapshot = excluded.snapshot,
      authorization_ref = excluded.authorization_ref, quoted_by = excluded.quoted_by, quoted_at = now();
  if o.entitlement_id is null then update clinic_reception.orders set price = ec.price, discount = 0 where id = o.id; end if;
  return jsonb_build_object('order_id', o.id, 'price', ec.price, 'coverage', ap.payer_coverage_percent,
    'patient_share', round(ec.price * o.quantity * (100 - ap.payer_coverage_percent) / 100, 2));
end $$;
revoke all on function clinic_reception.payer_quote(uuid, uuid) from public, anon, authenticated;

-- arrival: the arrival order of a contract booking gets its quote
create function clinic_reception.payer_arrival() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record;
begin
  if new.entitlement_id is not null then return new; end if;
  select a.* into ap from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = new.visit_id;
  if not found or ap.payer_kind is distinct from 'contract' or ap.service_id is distinct from new.service_id then return new; end if;
  if (select count(*) from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id) > 1 then return new; end if;
  perform clinic_reception.payer_quote(new.id, coalesce(ap.payer_by, ap.created_by));
  return new;
end $$;
revoke all on function clinic_reception.payer_arrival() from public, anon, authenticated;
create trigger payer_arrival after insert on clinic_reception.orders for each row execute function clinic_reception.payer_arrival();

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_payer_kind;
  alter function public.command_before_payer_kind(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_payer_kind(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb; aid uuid; kind text := nullif(btrim(coalesce(p_payload->>'payer_kind', '')), ''); o record; ap record;
begin
  if p_action in ('set_payer', 'order_payer') then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    if p_action = 'set_payer' then
      out := clinic_reception.set_payer(p_workspace, nullif(p_payload->>'id', '')::uuid, p_payload - '_via', me);
    else
      select ord.*, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
       where ord.id = nullif(p_payload->>'order_id', '')::uuid and ord.workspace_id = p_workspace for update of ord;
      if not found then raise exception 'الخدمة مش موجودة'; end if;
      if o.status <> 'ordered' then raise exception 'طريقة الدفع بتتعدّل قبل تنفيذ الخدمة وتحصيلها بس'; end if;
      if kind = 'contract' then
        if exists (select 1 from clinic_reception.discount_requests dr join clinic_reception.orders o2 on o2.id = dr.order_id
                    where o2.visit_id = o.visit_id and dr.status in ('pending', 'approved')) then
          raise exception 'الزيارة دي عليها خصم — مينفعش معاه تأمين / تعاقد'; end if;
        perform clinic_reception.payer_contract_check(p_payload, o.service_id, (now() at time zone 'Africa/Cairo')::date);
        select * into ap from clinic_reception.appointments where id = o.appointment_id for update;
        update clinic_reception.appointments set payer_kind = 'contract', payer_contract_id = (p_payload->>'payer_contract_id')::uuid,
            payer_coupon_no = left(btrim(p_payload->>'payer_coupon_no'), 60), payer_auth_ref = left(btrim(p_payload->>'payer_auth_ref'), 80),
            payer_coverage_percent = (p_payload->>'payer_coverage_percent')::numeric, payer_proof_path = btrim(p_payload->>'payer_proof_path'),
            payer_by = me, payer_at = now()
         where id = o.appointment_id;
        perform clinic_reception.payer_link_patient(ap.patient_id, (p_payload->>'payer_contract_id')::uuid, p_payload->>'payer_coupon_no', me);
        out := clinic_reception.payer_quote(o.id, me);
      elsif kind = 'union' then
        out := clinic_reception.order_discount(p_workspace, o.id, clinic_reception.payer_union_discount(p_payload), me);
        update clinic_reception.appointments set payer_kind = 'union', payer_entity_name = p_payload->>'payer_union', payer_by = me, payer_at = now()
         where id = o.appointment_id;
      elsif kind = 'cash' and nullif(btrim(coalesce(p_payload->>'discount_kind', '')), '') is not null then
        out := clinic_reception.order_discount(p_workspace, o.id, p_payload, me);
      else raise exception 'اختار طريقة الدفع (ولو كاش اختار الخصم)';
      end if;
    end if;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, p_action, coalesce(nullif(p_payload->>'id', ''), nullif(p_payload->>'order_id', ''))::uuid,
              (p_payload - 'payer_proof_path' - 'payer_card_path' - 'discount_card_path') || coalesce(out, '{}'::jsonb));
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  out := clinic_reception.command_before_payer_kind(p_workspace, p_action, p_payload, p_token);
  if p_action in ('book', 'walk_in', 'reschedule') and kind is not null then
    begin aid := coalesce(nullif(out->>'id', ''), nullif(p_payload->>'id', ''))::uuid; exception when others then aid := null; end;
    if aid is not null then
      me := clinic_reception.access(p_workspace, 'book');
      perform clinic_reception.set_payer(p_workspace, aid, (p_payload - '_via') || jsonb_build_object('_via', true), me);
      insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
        values (p_workspace, me, 'set_payer', aid, (p_payload - 'payer_proof_path' - 'payer_card_path' - 'discount_card_path') || jsonb_build_object('via', p_action));
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
