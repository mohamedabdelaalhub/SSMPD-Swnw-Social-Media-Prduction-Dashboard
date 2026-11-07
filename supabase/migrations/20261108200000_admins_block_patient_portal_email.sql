-- منع إضافة موظف بإيميل عليه حساب في بوابة المرضى (المالك، 2026-11-08).
-- الداشبورد وبوابة المرضى بيستخدموا نفس نظام الدخول: الإيميل الواحد = حساب دخول واحد بباسورد واحد.
-- بوابة المرضى بترفض إيميلات الموظفين من قبل (STAFF_EMAIL_NOT_ALLOWED في patient-portal-self-service)،
-- والملف ده بيقفل الناحية التانية: إضافة موظف (أو تغيير إيميله) لإيميل مسجل كحساب مريض.
-- إضافي فقط: دالة + تريجر جداد. الصفوف الموجودة ما بتتغيرش. التراجع: supabase/rollbacks/20261108200000_admins_block_patient_portal_email.rollback.sql
create or replace function public.admins_block_patient_portal_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.email is null or to_regclass('public.patient_accounts') is null then return new; end if;
  if tg_op = 'UPDATE' and lower(new.email) = lower(coalesce(old.email, '')) then return new; end if;
  if exists (select 1 from public.patient_accounts p where lower(p.login_email) = lower(btrim(new.email))) then
    raise exception 'الإيميل ده عليه حساب في بوابة المرضى، فمينفعش يبقى حساب موظف. ضيف الموظف بإيميل تاني (زي إيميل الشغل)، وخلي الإيميل ده للمريض.'
      using errcode = 'P0001', hint = 'PATIENT_PORTAL_EMAIL';
  end if;
  return new;
end $$;

revoke all on function public.admins_block_patient_portal_email() from public;

drop trigger if exists admins_block_patient_portal_email on public.admins;
create trigger admins_block_patient_portal_email
  before insert or update of email on public.admins
  for each row execute function public.admins_block_patient_portal_email();
