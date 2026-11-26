-- Rollback of 20261126210000_unit_agreement_cairo_date.sql: the 20261126160000 wrapper body again (agreements keep their earlier start).
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
              and a.service_code = v_code and a.status = 'active' and v_today between a.valid_from and a.valid_to) then
        insert into clinic_reception.doctor_agreements(workspace_id, provider_id, service_code, rate, deduct_material_cost, valid_from, valid_to,
            reference, status, created_by)
          values (p_workspace, p.id, v_code, 0, false, v_today, date '9999-12-31', 'وحدة بدون طبيب — بدون أتعاب (20261126160000)', 'active',
            coalesce(public.my_admin_id(), o.created_by));
      end if;
      return;
    end if;
  end if;
  perform clinic_reception.sync_doctor_contract_before_units(p_workspace, p_order, p_provider);
end $$;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;
commit;
