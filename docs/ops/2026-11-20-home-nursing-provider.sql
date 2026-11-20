-- Owner 2026-11-20 (main chat 4): «مواعيد التمريض المنزلي نفس مواعيد المركز. ومواعيد أي خدمات منزلية مرتبطة بمواعيد المركز.»
-- Center hours live in public.clinic_hours (the «تحديث بيانات الشات بوت» tab, render-clinic-info.js: department, open_time,
-- close_time, days, sort). Reception booking slots come ONLY from clinic_reception.availability per provider (manual / weekly /
-- walk_in); there is no center-hours gate today. Home services (كشف / تحاليل / أشعة) are booked on the provider whose
-- service it is, so they are bounded by that provider's schedule, not by clinic_hours.
-- This file: a reception provider «التمريض المنزلي» whose weekly schedule = the center row of clinic_hours.
-- LIMIT (phase 2): booking and the nurse picker work; EXECUTING / billing a service on this provider needs a finance contract
-- for its doctor_key + service code (clinic_reception.sync_doctor_contract), and nursing contracts are 'collected' basis on the
-- finance-bill path. Until phase 2, a nurse-alone visit can be booked and arrived, not executed/billed on this provider.

-- ===================== 0. PREVIEW (read-only) =====================
select * from public.clinic_hours order by sort, department;
select s.department, count(*) n from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
  where s.active and s.name ~ 'تمريض' group by 1 order by 2 desc;                                   -- nursing services by department
select p.name, p.department, p.branch, p.doctor_key, p.active from clinic_reception.providers p
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.department ~ '(طوارئ|كيماوي|تمريض)' order by 2, 1;
select count(*) from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.name = 'التمريض المنزلي';

-- ===================== 1. APPLY =====================
-- :dept = the department that holds most nursing services (preview #2, e.g. 'الطوارئ'); :center = the clinic_hours row for
-- the whole center (preview #1, e.g. 'المركز'). days may be int[] (0=Sun … 6=Sat) or Arabic day names — both handled.
begin;
with w as (select id, (select branch from clinic_reception.providers p where p.workspace_id = ws.id and p.active limit 1) as branch
           from clinic_reception.workspaces ws where ws.mode = 'live')
insert into clinic_reception.providers(workspace_id, name, department, branch, active)
select w.id, 'التمريض المنزلي', 'الطوارئ' /* :dept */, coalesce(w.branch, 'حدائق الأهرام'), true from w
on conflict (workspace_id, name) do nothing;

with h as (select open_time::time o, close_time::time c, d::text d from public.clinic_hours, unnest(days::text[]) d
           where department = 'المركز' /* :center */),
     dw as (select o, c, case when d ~ '^[0-6]$' then d::int else
              case btrim(d) when 'الأحد' then 0 when 'الاحد' then 0 when 'الإثنين' then 1 when 'الاثنين' then 1 when 'الثلاثاء' then 2
                when 'الأربعاء' then 3 when 'الاربعاء' then 3 when 'الخميس' then 4 when 'الجمعة' then 5 when 'الجمعه' then 5 when 'السبت' then 6 end end dow from h)
insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends)
select p.workspace_id, p.id, dw.dow, dw.o, dw.c from dw
  join clinic_reception.providers p on p.name = 'التمريض المنزلي'
  join clinic_reception.workspaces ws on ws.id = p.workspace_id and ws.mode = 'live'
where dw.dow is not null and dw.o <> dw.c
on conflict (provider_id, dow, starts) do nothing;

select clinic_reception.weekly_generate(p.workspace_id, p.id, 28) from clinic_reception.providers p
  join clinic_reception.workspaces ws on ws.id = p.workspace_id and ws.mode = 'live' where p.name = 'التمريض المنزلي';
-- check
select ws2.dow, ws2.starts, ws2.ends from clinic_reception.weekly_slots ws2 join clinic_reception.providers p on p.id = ws2.provider_id
  where p.name = 'التمريض المنزلي' order by 1;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- delete from clinic_reception.availability a using clinic_reception.providers p where a.provider_id = p.id and p.name = 'التمريض المنزلي' and a.source = 'weekly'
--   and not exists (select 1 from clinic_reception.appointments x where x.provider_id = p.id);
-- delete from clinic_reception.weekly_slots s using clinic_reception.providers p where s.provider_id = p.id and p.name = 'التمريض المنزلي';
-- update clinic_reception.providers set active = false where name = 'التمريض المنزلي';
-- commit;
