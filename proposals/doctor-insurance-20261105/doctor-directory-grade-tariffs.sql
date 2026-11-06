-- Isolated candidate migration. DO NOT apply to production without validating
-- current clinic_reception authorization and all booking/invoicing RPC callers.
-- Based on verified clinic_reception.providers/services schema, 2026-11-06.
begin;

-- The canonical reception provider already carries exactly one department.
-- Add scientific grade in place rather than create a parallel doctor directory.
alter table clinic_reception.providers
  add column if not exists scientific_grade text;

-- Do not presume older provider records have a grade. Explicit configuration
-- is required before grade-specific quoting; no automatic price fallback.
create table if not exists clinic_reception.doctor_grade_tariffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  service_id uuid not null references clinic_reception.services(id),
  department text not null check (length(trim(department)) > 0),
  scientific_grade text not null check (length(trim(scientific_grade)) > 0),
  amount numeric(14,2) not null check (amount >= 0),
  effective_from date not null,
  effective_to date,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  constraint doctor_grade_tariffs_dates check (effective_to is null or effective_to >= effective_from),
  constraint doctor_grade_tariffs_approval check ((approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null))
);

create index if not exists doctor_grade_tariffs_lookup_idx
  on clinic_reception.doctor_grade_tariffs(workspace_id,service_id,department,scientific_grade,effective_from desc);

alter table clinic_reception.doctor_grade_tariffs enable row level security;
revoke all on clinic_reception.doctor_grade_tariffs from public,anon,authenticated;

-- Private schema/function. No execute grant to frontend: existing authorized
-- reception RPC must call after its own authorization checks.
create or replace function clinic_reception.doctor_grade_quote(
  p_workspace uuid, p_provider uuid, p_service uuid, p_on date
) returns numeric
language plpgsql stable security invoker
set search_path = pg_catalog, clinic_reception
as $$
declare v_provider clinic_reception.providers%rowtype;
        v_service clinic_reception.services%rowtype;
        v_count integer; v_amount numeric;
begin
  if p_workspace is null or p_provider is null or p_service is null or p_on is null then
    raise exception 'Missing quote context';
  end if;
  select * into v_provider from clinic_reception.providers
    where id=p_provider and workspace_id=p_workspace and active;
  if not found or nullif(trim(v_provider.department),'') is null
     or nullif(trim(v_provider.scientific_grade),'') is null then
    raise exception 'Doctor specialty or scientific grade is not configured';
  end if;
  select * into v_service from clinic_reception.services
    where id=p_service and workspace_id=p_workspace and active;
  if not found or nullif(trim(v_service.department),'') is null
    or v_service.department is distinct from v_provider.department then
    raise exception 'Service does not belong to doctor specialty';
  end if;
  select count(*),max(t.amount) into v_count,v_amount
    from clinic_reception.doctor_grade_tariffs t
    where t.workspace_id=p_workspace and t.service_id=p_service
      and t.department=v_provider.department
      and t.scientific_grade=v_provider.scientific_grade
      and t.approved_at is not null and t.effective_from<=p_on
      and (t.effective_to is null or t.effective_to>=p_on);
  if v_count<>1 then
    raise exception 'Exactly one approved grade tariff must apply';
  end if;
  return v_amount;
end;
$$;

revoke all on function clinic_reception.doctor_grade_quote(uuid,uuid,uuid,date)
  from public,anon,authenticated;
commit;
