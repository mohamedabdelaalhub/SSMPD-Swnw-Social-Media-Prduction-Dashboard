-- v2 (main chat preview 13:07Z: physio regex missed «العلاج الطبيعي»; «other → 5» hit chemo/therapy/surgery/labs; derm procedures).
-- Owner 2026-11-20: CONSULTATION length is 5 min, except dental, physio, laser and cosmetics, which are 20. Gap stays 5.
-- Rule (only active + booking_enabled pricing_services; everything not matched keeps its current minutes):
--   R20  department ~ 'سنان' (dental) or ~ 'طبيعي' (physio)                          → 20
--   R20  department ~ 'جلد|تجميل|ليزر' and NOT a consult (all derm procedures/laser)   → 20
--   R5   consult = department 'خدمات الكشف' or name ~ 'كشف|استشار|متابعة', outside the R20 departments → 5
--        (derm consults are R5 too: «مش كل الجلدية»)
-- Home: is_home on active live rows of خدمات الكشف / التحاليل / باقي التحاليل / الاشعة + name ~ 'تمريض' (after the sync).

-- ===================== 0. PREVIEW (read-only) =====================
create temp view _plan as
select s.id, s.name, s.booking_department d, s.booking_minutes old,
  case
    when s.booking_department ~ '(سنان|طبيعي)' then 20
    when s.booking_department ~ '(جلد|تجميل|ليزر)' and not s.name ~ '(كشف|استشار|متابعة)' then 20
    when s.booking_department = 'خدمات الكشف' or s.name ~ '(كشف|استشار|متابعة)' then 5
    else s.booking_minutes end as new
from public.pricing_services s where s.active and s.booking_enabled;
select d, old, new, count(*) n from _plan where new is distinct from old group by 1,2,3 order by 1,2,3;   -- what changes
select d, count(*) total, count(*) filter (where new is distinct from old) changing from _plan group by 1 order by 1;
select d, name, old, new from _plan where new = 5 and old is distinct from 5 order by 1,2;               -- every service going to 5, by eye
select d, name, old, new from _plan where d ~ '(جلد|تجميل|ليزر)' order by new, name;                     -- derm split, by eye
select rs.department, count(*) n from clinic_reception.services rs join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live'
where rs.active and (rs.department in ('خدمات الكشف', 'التحاليل', 'باقي التحاليل', 'الاشعة') or rs.name ~ 'تمريض') group by 1 order by 1;

-- ===================== 1. APPLY (after the owner's approval) =====================
begin;
create table if not exists public.ops_backup_20261120_minutes as
  select id, booking_minutes, now() as saved_at from public.pricing_services;
create table if not exists public.ops_backup_20261120_home as
  select rs.code, rs.is_home, now() as saved_at from clinic_reception.services rs
  join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live' where rs.active;
update public.pricing_services s set booking_minutes = p.new from _plan p where p.id = s.id and p.new is distinct from p.old;
select clinic_reception.sync_catalog(id) from clinic_reception.workspaces where mode = 'live';
update clinic_reception.services rs set is_home = true
  from clinic_reception.workspaces w
  where w.id = rs.workspace_id and w.mode = 'live' and rs.active and not rs.is_home
    and (rs.department in ('خدمات الكشف', 'التحاليل', 'باقي التحاليل', 'الاشعة') or rs.name ~ 'تمريض'
         or rs.code in (select code from public.ops_backup_20261120_home where is_home));
select department, minutes, count(*) n, count(*) filter (where is_home) home from clinic_reception.services rs
  join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live' where rs.active group by 1, 2 order by 1, 2;
commit;
-- (_plan is a temp view: run PREVIEW's create temp view in the same session before APPLY.)

-- ===================== 2. ROLLBACK =====================
-- begin;
-- update public.pricing_services s set booking_minutes = b.booking_minutes from public.ops_backup_20261120_minutes b where b.id = s.id and s.booking_minutes is distinct from b.booking_minutes;
-- select clinic_reception.sync_catalog(id) from clinic_reception.workspaces where mode = 'live';
-- update clinic_reception.services rs set is_home = coalesce(b.is_home, false) from clinic_reception.workspaces w, public.ops_backup_20261120_home b
--   where w.id = rs.workspace_id and w.mode = 'live' and rs.active and b.code = rs.code;
-- commit;
