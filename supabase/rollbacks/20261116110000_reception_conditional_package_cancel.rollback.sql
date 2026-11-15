drop trigger if exists trg_package_cancel_request_quote on clinic_reception.requests;
drop function if exists clinic_reception.package_cancel_request_quote();
drop function if exists clinic_reception.review_operation(uuid,jsonb,uuid);
alter function clinic_reception.review_operation_before_conditional(uuid,jsonb,uuid) rename to review_operation;
drop function if exists public.clinic_reception_package_cancel_quote(uuid,uuid);
drop function if exists clinic_reception.package_cancel_quote(uuid,uuid);
drop trigger if exists trg_entitlement_standalone_snapshot on clinic_reception.entitlements;
drop function if exists clinic_reception.entitlement_standalone_snapshot();
drop trigger if exists trg_package_conditional_snapshot on clinic_reception.packages;
drop function if exists clinic_reception.package_conditional_snapshot();
drop trigger if exists trg_pricing_package_conditional_sync on public.pricing_packages;
drop function if exists public.pricing_package_conditional_sync();
drop trigger if exists trg_package_template_conditional_flag on clinic_reception.package_templates;
drop function if exists clinic_reception.package_template_conditional_flag();
-- Columns are kept (data snapshots); drop manually only if no conditional package was ever sold:
-- alter table clinic_reception.entitlements drop column standalone_unit; alter table clinic_reception.packages drop column conditional_offer;
-- alter table clinic_reception.package_templates drop column conditional_offer; alter table public.pricing_packages drop column conditional_offer;
