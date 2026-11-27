-- URGENT live fix (owner screenshots 2026-11-26 17:05Z): «تنفيذ حقنة عضل (شاملة المستلزمات)» 0000172 by «التمريض» and «إنهاء الزيارة»
-- were refused «حدد عقدًا واحدًا معتمدًا للطبيب والخدمة 0000172 داخل الحسابات».
-- Root cause (since 20261017130324 / 20261108230000, not #875/#877): on a live workspace every 'execute' first runs
-- clinic_reception.sync_doctor_contract, which needs exactly ONE active finance doctor contract for the provider's doctor_key, and
-- the core execute then needs an active reception doctor_agreement «ولو بنسبة صفر». A UNIT provider (doctor_key NULL: «التمريض»,
-- «المعمل», «التمريض المنزلي») can never have a finance contract (contracts are per doctor_key), so its services could not be
-- executed at all. 20261121170000 already lets units book / order their scoped services «no doctor_key, so no contract».
-- Fix: clinic_reception.sync_doctor_contract is wrapped (previous kept as clinic_reception.sync_doctor_contract_before_units).
--   * provider with doctor_key NULL / blank → no doctor fee: an active 0% reception agreement (provider, service code) is ensured
--     (reference «وحدة بدون طبيب — بدون أتعاب»), so the core execute posts no doctor fee (fee 0 → no 5111 entry) and completes.
--   * a provider WITH a doctor_key → unchanged (exactly one contract; home-consult exact-contract guard etc. untouched).
-- Rollback: supabase/rollbacks/20261126160000_unit_provider_no_doctor_fee.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)') is null then raise exception 'sync_doctor_contract missing'; end if;
  if to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
begin;

alter function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) rename to sync_doctor_contract_before_units;
revoke all on function clinic_reception.sync_doctor_contract_before_units(uuid, uuid, uuid) from public, anon, authenticated;

create function clinic_reception.sync_doctor_contract(p_workspace uuid, p_order uuid, p_provider uuid) returns void
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
