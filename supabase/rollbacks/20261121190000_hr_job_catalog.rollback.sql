-- Rollback of 20261121190000_hr_job_catalog.sql. Drops the catalog RPCs, the people.job_id link and the jobs table.
-- DATA LOSS: job text, KPIs, salary bands and every employee↔job link. Export first if anything was edited live.
begin;
drop function if exists public.hr_jobs(), public.hr_job_save(jsonb), public.hr_job_assign(uuid, uuid), public.hr_job_band(uuid), public.hr_my_job(), public.hr_job_annex(uuid);
drop function if exists clinic_people.salary_visible();
drop index if exists clinic_people.people_job_idx;
alter table clinic_people.people drop column if exists job_id;
drop table if exists clinic_people.jobs;
commit;
