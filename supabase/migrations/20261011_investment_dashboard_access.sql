-- صلاحية ظهور زرار "لوحة مؤشرات الاستثمار" في القائمة اللي جنب الاسم (بتتفعّل من لوحة التحكم)
alter table public.admins add column if not exists has_investment_dashboard_access boolean not null default false;
