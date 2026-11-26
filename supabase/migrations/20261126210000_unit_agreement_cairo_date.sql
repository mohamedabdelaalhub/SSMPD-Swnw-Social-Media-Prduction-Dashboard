-- Fix for 20261126160000 (unit providers execute with no doctor fee), found by Finance 2 (2026-11-26 ~22:00Z): the wrapper ensured
-- the 0% agreement with valid_from = clinic_reception.today() (Cairo date), but the core execute matches agreements on the server's
-- date (current_date, UTC) — so between 00:00 and 02:00 Cairo the FIRST execution of a unit service for a new provider+service pair
-- was refused «يلزم عقد أتعاب معتمد للخدمة المنفذة ولو بنسبة صفر». Now the agreement starts at least(Cairo date, server date) and the
-- "already has one" check requires it to cover both dates. Unit agreements already created with a Cairo-tomorrow start are moved back.
-- Rollback: supabase/rollbacks/20261126210000_unit_agreement_cairo_date.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is null then raise exception 'طبّق 20261126160000 الأول'; end if;
  if position('least(v_today, current_date)' in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
begin;

create or replace function clinic_reception.sync_doctor_contract(p_workspace uuid, p_order uuid, p_provider uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; p clinic_reception.providers%rowtype; v_code text; v_today date := clinic_reception.today();
begin
  select * into o from clinic_reception.orders where workspace_id = p_workspace and id = p_order;
  if found then
    select * into p from clinic_reception.providers where workspace_id = p_workspace and id = coalesce(p_provider, o.provider_id);
    if found and nullif(btrim(coalesce(p.doctor_key, '')), '') is null then
      v_code := o.snapshot->>'code';
      if v_code is not null and not exists (
           select 1 from clinic_reception.doctor_agreements a where a.workspace_id = p_workspace and a.provider_id = p.id
              and a.service_code = v_code and a.status = 'active' and least(v_today, current_date) >= a.valid_from
              and greatest(v_today, current_date) <= a.valid_to) then
        insert into clinic_reception.doctor_agreements(workspace_id, provider_id, service_code, rate, deduct_material_cost, valid_from, valid_to,
            reference, status, created_by)
          values (p_workspace, p.id, v_code, 0, false, least(v_today, current_date), date '9999-12-31', 'وحدة بدون طبيب — بدون أتعاب (20261126160000)', 'active',
            coalesce(public.my_admin_id(), o.created_by));
      end if;
      return;
    end if;
  end if;
  perform clinic_reception.sync_doctor_contract_before_units(p_workspace, p_order, p_provider);
end $$;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;

update clinic_reception.doctor_agreements set valid_from = least(valid_from, current_date, clinic_reception.today())
 where reference = 'وحدة بدون طبيب — بدون أتعاب (20261126160000)' and status = 'active' and valid_from > least(current_date, clinic_reception.today());

commit;
