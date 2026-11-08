-- Department-scope doctor contracts: ONE contract can cover every service of a department (specialty = department).
-- Scope format in clinic_finance.doctor_contracts.service_scope:  قسم:<department>   (e.g. قسم:الاسنان). Anything else is an exact service code/name, exactly as before.
-- Labs, radiology and emergency are ordinary departments here (no special guard): maker-checker approval is the control against an accidental contract.
-- ADDITIVE: 3 new functions, 1 wrapper (clinic_finance_doctor_command moved + wrapped), 2 re-created functions (sync_doctor_contract, pricing_doctor_contracts).
-- No table or column changes. doctor_sync / billing / channel logic are NOT touched (a bill copies the chosen contract's terms into doctor_allocations as before).
-- Rollback: supabase/rollbacks/20261108230000_department_contracts.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_doctor_command(text,jsonb,uuid)') is null
     or to_regprocedure('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)') is not null then
    raise exception 'clinic_finance_doctor_command غير موجودة أو تم تطبيق هذا الملف من قبل';
  end if;
  if to_regprocedure('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)') is null
     or position($m$service_scope=o.snapshot->>'code'$m$ in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) = 0
     or position('doctor_contract_for_service' in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'sync_doctor_contract غير مطابقة للمتوقع؛ راجع الفرق قبل التطبيق';
  end if;
  -- exact text audited against production (md5 of pg_get_functiondef); a drifted function is refused instead of silently overwritten
  if md5(pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) <> '9940a1df7a26af0005b3dd3b9ab96348'
     or to_regprocedure('public.pricing_doctor_contracts()') is null
     or md5(pg_get_functiondef('public.pricing_doctor_contracts()'::regprocedure)) <> '2d64788544ad0c556ed070853df21d09' then
    raise exception 'sync_doctor_contract أو pricing_doctor_contracts تغيّرت عن نسخة الإنتاج المدقَّقة؛ راجع الفرق قبل التطبيق';
  end if;
  if to_regclass('clinic_reception.services') is null or to_regclass('public.pricing_services') is null then
    raise exception 'جداول الخدمات (استقبال/تسعير) غير موجودة';
  end if;
end $$;

-- 'قسم:X' -> 'X' ; NULL for anything that is not a well-formed department scope.
create function clinic_finance.department_scope_name(p_scope text) returns text language sql immutable set search_path = pg_catalog, public as $$
  select case when p_scope like 'قسم:%' then nullif(btrim(substr(p_scope, 5)), '') end
$$;

-- Departments that exist today (reception services + price list categories).
create function clinic_finance.contract_departments() returns setof text language sql stable security definer set search_path = pg_catalog, public as $$
  select d from (
    select btrim(department) d from clinic_reception.services where active and btrim(department) <> ''
    union
    select btrim(category) from public.pricing_services where active and btrim(category) <> ''
  ) x order by 1
$$;

create function public.clinic_finance_contract_departments() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('view');
  return coalesce((select jsonb_agg(jsonb_build_object('name', d) order by d) from clinic_finance.contract_departments() d), '[]'::jsonb);
end $$;

-- Contract creation: validate department scopes, then delegate to the existing function unchanged (same payload, same idempotency, same maker-checker).
alter function public.clinic_finance_doctor_command(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_doctor_command(text, jsonb, uuid) rename to doctor_command_before_departments;
create function public.clinic_finance_doctor_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare sc text; dep text;
begin
  if p_action = 'contract' and coalesce(p_payload->>'scope', '') ~ '^\s*قسم\s*:' then
    perform clinic_finance.require_access('create');
    sc := btrim(p_payload->>'scope'); dep := clinic_finance.department_scope_name(sc);
    if dep is null or sc <> 'قسم:' || dep or dep ~ '\s{2,}' or length(sc) > 120 then
      raise exception 'صيغة نطاق القسم: قسم:اسم القسم، مثال قسم:الاسنان (بدون مسافات زائدة)';
    end if;
    if not exists (select 1 from clinic_finance.contract_departments() d where d = dep) then
      raise exception 'القسم «%» غير موجود في الخدمات المسجلة', dep;
    end if;
  end if;
  return clinic_finance.doctor_command_before_departments(p_action, p_payload, p_token);
end $$;

-- Which contract applies to a service: an EXACT service code/name contract wins; only when there is none, the department contract applies.
create function clinic_finance.doctor_contract_for_service(p_doctor text, p_code text, p_name text, p_department text, p_on date)
returns setof clinic_finance.doctor_contracts language sql stable security definer set search_path = pg_catalog, public as $$
  with live as (
    select * from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor and c.status = 'active' and p_on between c.valid_from and c.valid_to
  ), exact as (
    select * from live c where c.service_scope = p_code or (p_name is not null and c.service_scope = p_name)
  ), dept as (
    select * from live c where nullif(btrim(p_department), '') is not null and c.service_scope = 'قسم:' || btrim(p_department)
  )
  select * from exact union all select * from dept where not exists (select 1 from exact)
$$;

-- Reception execution: same function as before, but resolves the contract with the precedence above.
create or replace function clinic_reception.sync_doctor_contract(p_workspace uuid,p_order uuid,p_provider uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o clinic_reception.orders%rowtype;p clinic_reception.providers%rowtype;c clinic_finance.doctor_contracts%rowtype;n integer;dep text;begin
 select * into o from clinic_reception.orders where workspace_id=p_workspace and id=p_order;
 select * into p from clinic_reception.providers where workspace_id=p_workspace and id=coalesce(p_provider,o.provider_id);
 select s.department into dep from clinic_reception.services s where s.workspace_id=p_workspace and s.code=o.snapshot->>'code' limit 1;
 n:=(select count(*) from clinic_finance.doctor_contract_for_service(p.doctor_key,o.snapshot->>'code',null,dep,clinic_reception.today()));
 if n<>1 then raise exception 'حدد عقدًا واحدًا معتمدًا للطبيب والخدمة % داخل الحسابات',o.snapshot->>'code';end if;
 select * into c from clinic_finance.doctor_contract_for_service(p.doctor_key,o.snapshot->>'code',null,dep,clinic_reception.today()) limit 1;
 if c.basis<>'performed' or c.base_scope<>'service' or c.deduction not in ('none','cost') then raise exception 'عقد الخدمة بالحسابات يجب أن يستحق عند التنفيذ على الخدمة مع خصم تكلفة المشمول أو بدون خصم';end if;
 if exists(select 1 from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and finance_contract_id=c.id and status='active' and rate=c.rate and deduct_material_cost=(c.deduction='cost')) then return;end if;
 update clinic_reception.doctor_agreements set status='rejected' where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and status='active';
 insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,status,created_by,reviewed_by,finance_contract_id)
 values(p_workspace,p.id,o.snapshot->>'code',c.rate,c.deduction='cost',c.valid_from,c.valid_to,c.reference,'active',c.created_by,c.reviewed_by,c.id);
end $$;

-- The service editor / invoice pickers can tell department contracts apart.
create or replace function public.pricing_doctor_contracts()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'doctor_key', c.doctor_key, 'doctor_name', c.doctor_name,
      'service_scope', c.service_scope, 'scope_kind', case when clinic_finance.department_scope_name(c.service_scope) is null then 'service' else 'department' end,
      'department', clinic_finance.department_scope_name(c.service_scope), 'valid_from', c.valid_from,
      'valid_to', c.valid_to, 'rate', c.rate, 'basis', c.basis,
      'base_scope', c.base_scope, 'deduction', c.deduction,
      'reference', c.reference
    ) order by c.doctor_name, c.service_scope, c.valid_from, c.id)
    from clinic_finance.doctor_contracts c
    where c.status = 'active'
      and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to
  ), '[]'::jsonb);
end;
$$;

revoke all on function clinic_finance.department_scope_name(text), clinic_finance.contract_departments(), clinic_finance.doctor_contract_for_service(text, text, text, text, date), clinic_finance.doctor_command_before_departments(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.clinic_finance_contract_departments(), public.clinic_finance_doctor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_contract_departments(), public.clinic_finance_doctor_command(text, jsonb, uuid) to authenticated;
revoke all on function public.pricing_doctor_contracts() from public, anon;
grant execute on function public.pricing_doctor_contracts() to authenticated;

commit;
