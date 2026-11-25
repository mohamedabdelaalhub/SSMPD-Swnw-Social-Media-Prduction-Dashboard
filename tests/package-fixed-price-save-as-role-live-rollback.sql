-- Rule 9 live check for the «حفظ» button of the package editor with a fixed price — run AFTER mig 20261125120000 is live.
-- Acts as a real accounting/super-admin user through RLS (policy "accounting update packages"), exactly what
-- SSMPDDb.savePricingPackage sends (PATCH pricing_packages … booking_fixed_price). One transaction, ends in ROLLBACK.
--   psql -v ON_ERROR_STOP=1 -v auth=<auth.users id of the user> -f tests/package-fixed-price-save-as-role-live-rollback.sql
begin;
select set_config('request.jwt.claims',json_build_object('sub',:'auth','role','authenticated')::text,true);
create temp table fx_pick on commit drop as
select p.id, p.name, p.booking_fixed_price old_fixed from public.pricing_packages p
where p.active and p.booking_enabled and p.booking_fixed_price is not null order by p.name limit 1;
grant select on fx_pick to authenticated;
select 'actor' part, json_build_object('admin',public.my_admin_id(),'role',public.my_role(),'can_manage',public.can_manage_all_content())::text;
set local role authenticated;
update public.pricing_packages p set booking_fixed_price = f.old_fixed + 1, updated_at = now() from fx_pick f where p.id = f.id;
select 'saved_rows' part, count(*)::text from public.pricing_packages p join fx_pick f on f.id=p.id where p.booking_fixed_price = f.old_fixed + 1;
update public.pricing_packages p set booking_fixed_price = null, updated_at = now() from fx_pick f where p.id = f.id;
select 'cleared_rows' part, count(*)::text from public.pricing_packages p join fx_pick f on f.id=p.id where p.booking_fixed_price is null;
reset role;
select 'picked_package' part, (select json_build_object('package',f.name,'old',f.old_fixed) from fx_pick f)::text;
rollback;
