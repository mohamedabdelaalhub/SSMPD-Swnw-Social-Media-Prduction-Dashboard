-- Owner 2026-11-20 (Egyptian Arabic, this chat): dental, physio, laser and cosmetics stay 20 min; every other specialty 5 min;
-- gap stays 5 (workspace booking_gap_minutes unchanged). Home services: الكشف, التحاليل, الأشعة and the nursing services.
-- Minutes live in public.pricing_services.booking_minutes → clinic_reception.sync_catalog(live) makes new service versions.
-- is_home lives on clinic_reception.services (20261120020000), so it is set AFTER the sync, on the active rows.

-- ===================== 0. PREVIEW (read-only) =====================
with r as (
  select s.id, s.name, s.booking_department d, s.booking_minutes m,
    case
      when s.booking_department ~ '(اسنان|أسنان)' then 'dental'
      when s.booking_department ~ 'علاج طبيعي' then 'physio'
      when s.booking_department ~ 'جلد' and s.name ~* '(ليزر|laser|تجميل|فيلر|filler|بوتوكس|botox|بلازما|prp|ميزو|meso|هيدرا|hydra|تقشير|peel|كاربون|carbon|ديرما|derma ?pen|خيوط|نضارة|تنظيف بشرة|نحت|تفتيح|حقن)' then 'cosmetic'
      else 'other' end k
  from public.pricing_services s where s.active and s.booking_enabled)
select k, case when k = 'other' then 5 else 20 end as new_minutes, count(*) n, count(*) filter (where m <> case when k = 'other' then 5 else 20 end) changes
from r group by k order by k;
-- dermatology split, to check by eye (cosmetic → 20, plain → 5):
select case when s.name ~* '(ليزر|laser|تجميل|فيلر|filler|بوتوكس|botox|بلازما|prp|ميزو|meso|هيدرا|hydra|تقشير|peel|كاربون|carbon|ديرما|derma ?pen|خيوط|نضارة|تنظيف بشرة|نحت|تفتيح|حقن)' then 'cosmetic 20' else 'plain 5' end k, s.name, s.booking_minutes
from public.pricing_services s where s.active and s.booking_enabled and s.booking_department ~ 'جلد' order by 1, 2;
-- home services that would be switched on:
select rs.department, count(*) n from clinic_reception.services rs join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live'
where rs.active and (rs.department in ('خدمات الكشف', 'التحاليل', 'باقي التحاليل', 'الاشعة') or rs.name ~ 'تمريض') group by 1 order by 1;

-- ===================== 1. APPLY (after the owner's approval) =====================
begin;
create table if not exists public.ops_backup_20261120_minutes as
  select id, booking_minutes, now() as saved_at from public.pricing_services;
create table if not exists public.ops_backup_20261120_home as
  select rs.code, rs.is_home, now() as saved_at from clinic_reception.services rs
  join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live' where rs.active;
update public.pricing_services s set booking_minutes = case
    when s.booking_department ~ '(اسنان|أسنان)' or s.booking_department ~ 'علاج طبيعي'
      or (s.booking_department ~ 'جلد' and s.name ~* '(ليزر|laser|تجميل|فيلر|filler|بوتوكس|botox|بلازما|prp|ميزو|meso|هيدرا|hydra|تقشير|peel|كاربون|carbon|ديرما|derma ?pen|خيوط|نضارة|تنظيف بشرة|نحت|تفتيح|حقن)')
    then 20 else 5 end
  where s.active and s.booking_enabled
    and s.booking_minutes is distinct from case
    when s.booking_department ~ '(اسنان|أسنان)' or s.booking_department ~ 'علاج طبيعي'
      or (s.booking_department ~ 'جلد' and s.name ~* '(ليزر|laser|تجميل|فيلر|filler|بوتوكس|botox|بلازما|prp|ميزو|meso|هيدرا|hydra|تقشير|peel|كاربون|carbon|ديرما|derma ?pen|خيوط|نضارة|تنظيف بشرة|نحت|تفتيح|حقن)')
    then 20 else 5 end;
select clinic_reception.sync_catalog(id) from clinic_reception.workspaces where mode = 'live';
-- home flags on the (new) active versions; keep any that were already on
update clinic_reception.services rs set is_home = true
  from clinic_reception.workspaces w
  where w.id = rs.workspace_id and w.mode = 'live' and rs.active and not rs.is_home
    and (rs.department in ('خدمات الكشف', 'التحاليل', 'باقي التحاليل', 'الاشعة') or rs.name ~ 'تمريض'
         or rs.code in (select code from public.ops_backup_20261120_home where is_home));
-- check: minutes and home counts per department on the live catalog
select department, minutes, count(*) n, count(*) filter (where is_home) home from clinic_reception.services rs
  join clinic_reception.workspaces w on w.id = rs.workspace_id and w.mode = 'live' where rs.active group by 1, 2 order by 1, 2;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- update public.pricing_services s set booking_minutes = b.booking_minutes from public.ops_backup_20261120_minutes b where b.id = s.id and s.booking_minutes is distinct from b.booking_minutes;
-- select clinic_reception.sync_catalog(id) from clinic_reception.workspaces where mode = 'live';
-- update clinic_reception.services rs set is_home = coalesce(b.is_home, false) from clinic_reception.workspaces w, public.ops_backup_20261120_home b
--   where w.id = rs.workspace_id and w.mode = 'live' and rs.active and b.code = rs.code;
-- commit;
