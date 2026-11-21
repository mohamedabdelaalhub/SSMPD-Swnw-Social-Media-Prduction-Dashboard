-- v3 of item 1 (main chat 4 live facts 2026-11-21 19:19Z). Consult services are GENERIC grade services in «خدمات الكشف»
-- (0001371 كشف الأخصائي, 0001372 كشف الاستشاري, 0001393 الاستشارة) and the doctors' other work sits in «الاشعة» (سونار,
-- رسم قلب 0000032, إيكو 0000034, دوبلر 0000035/36). Nothing is moved or created in the service catalogue.
-- This file only:
--   (1) sets the booking department of the doctors so the modal finds them:
--         EMP-000020, EMP-000034, EMP-000038 → «الباطنة»; EMP-000043, EMP-000053, EMP-000056 → «القلب والأوعية الدموية»;
--         EMP-000037 (د. إلهام قدري) → «الأطفال» (0001400 «كشف أطفال — استشاري» is already in الأطفال);
--   (2) keeps EVERY service each of them can book today: every service code of his ACTIVE exact-code contracts that is
--       not in his new department is added to provider_service_scopes (scope + active contract = the existing booking gate);
--   (3) creates EMP-000010 (النفسية والتخاطب) and reactivates EMP-000049; EMP-000059 (test) skipped.
-- Nothing else changes (other doctors, «رسم قلب» stays in الاشعة for د. محمد رشاد).
-- Self-contained: the apply does not depend on the preview. Every change is logged in
-- clinic_reception.ops_doctor_dept_20261121 for the rollback.

-- ===================== 0. PREVIEW (read-only, plain selects) =====================
with m(hr, new_dep) as (values ('EMP-000020','الباطنة'), ('EMP-000034','الباطنة'), ('EMP-000038','الباطنة'),
        ('EMP-000043','القلب والأوعية الدموية'), ('EMP-000053','القلب والأوعية الدموية'), ('EMP-000056','القلب والأوعية الدموية'), ('EMP-000037','الأطفال')),
doc as (select m.hr, m.new_dep, pr.id provider_id, pr.workspace_id, pr.name, pr.department old_dep, pr.doctor_key
          from m join clinic_people.people p on p.code = m.hr join clinic_reception.providers pr on pr.doctor_key = p.doctor_key
          join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live'),
svc as (select s.workspace_id, s.code, s.department from clinic_reception.services s where s.active),
con as (select distinct c.doctor_key, c.service_scope code from clinic_finance.doctor_contracts c
         where c.status = 'active' and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to),
sc as (select provider_id, service_code code from clinic_reception.provider_service_scopes),
bk as (select d.hr, s.code,
         (s.department = d.old_dep or exists (select 1 from sc where sc.provider_id = d.provider_id and sc.code = s.code)) and exists (select 1 from con where con.doctor_key = d.doctor_key and con.code = s.code) before,
         (s.department = d.new_dep or exists (select 1 from sc where sc.provider_id = d.provider_id and sc.code = s.code)
            or exists (select 1 from con where con.doctor_key = d.doctor_key and con.code = s.code)) and exists (select 1 from con where con.doctor_key = d.doctor_key and con.code = s.code) after
         from doc d join svc s on s.workspace_id = d.workspace_id)
select d.hr, d.name, d.old_dep, d.new_dep,
       (select count(*) from bk where bk.hr = d.hr and bk.before) contracted_bookable_before,
       (select count(*) from bk where bk.hr = d.hr and bk.after) contracted_bookable_after,
       (select count(*) from bk where bk.hr = d.hr and bk.before and not bk.after) lost,
       (select string_agg(c.code, ', ') from con c where c.doctor_key = d.doctor_key and c.code like 'قسم:%') dept_contracts
  from doc d order by d.new_dep, d.name;                -- «lost» must be 0
select p.code, p.full_name, pr.id is not null has_provider, pr.active from clinic_people.people p
  left join clinic_reception.providers pr on pr.doctor_key = p.doctor_key where p.code in ('EMP-000010','EMP-000049','EMP-000059');

-- ===================== 1. APPLY =====================
begin;
create table if not exists clinic_reception.ops_doctor_dept_20261121(kind text, provider_id uuid, old_value text, new_value text);
create temp table _v3 on commit drop as
select m.new_dep, pr.id provider_id, pr.workspace_id, pr.department old_dep, pr.doctor_key
  from (values ('EMP-000020','الباطنة'), ('EMP-000034','الباطنة'), ('EMP-000038','الباطنة'),
        ('EMP-000043','القلب والأوعية الدموية'), ('EMP-000053','القلب والأوعية الدموية'), ('EMP-000056','القلب والأوعية الدموية'), ('EMP-000037','الأطفال')) m(hr, new_dep)
  join clinic_people.people p on p.code = m.hr join clinic_reception.providers pr on pr.doctor_key = p.doctor_key
  join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live';
-- (2) scopes for every contracted service outside the new department
with ins as (
  insert into clinic_reception.provider_service_scopes(provider_id, service_code)
  select distinct v.provider_id, s.code from _v3 v
    join clinic_reception.services s on s.workspace_id = v.workspace_id and s.active and s.department is distinct from v.new_dep
    join clinic_finance.doctor_contracts c on c.doctor_key = v.doctor_key and c.service_scope = s.code and c.status = 'active'
     and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to
  on conflict do nothing returning provider_id, service_code)
insert into clinic_reception.ops_doctor_dept_20261121 select 'scope', provider_id, null, service_code from ins;
-- (1) departments
insert into clinic_reception.ops_doctor_dept_20261121 select 'department', provider_id, old_dep, new_dep from _v3 where old_dep is distinct from new_dep;
update clinic_reception.providers pr set department = v.new_dep from _v3 v where pr.id = v.provider_id and pr.department is distinct from v.new_dep;
-- (3) 049 reactivate, 010 create
with up as (update clinic_reception.providers pr set active = true from clinic_people.people p
             where p.code = 'EMP-000049' and pr.doctor_key = p.doctor_key and not pr.active returning pr.id)
insert into clinic_reception.ops_doctor_dept_20261121 select 'reactivated', id, 'false', 'true' from up;
with cr as (
  insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active)
  select w.id, case when btrim(p.full_name) ~ '^(د|أ)[ /.]' then btrim(p.full_name) else 'أ. ' || btrim(p.full_name) end, p.doctor_key, 'النفسية والتخاطب',
         coalesce((select branch from clinic_reception.providers x where x.workspace_id = w.id and x.active limit 1), 'حدائق الأهرام'), true
    from clinic_people.people p cross join clinic_reception.workspaces w
   where w.mode = 'live' and p.code = 'EMP-000010' and p.doctor_key is not null
     and not exists (select 1 from clinic_reception.providers x where x.workspace_id = w.id and x.doctor_key = p.doctor_key)
  returning id)
insert into clinic_reception.ops_doctor_dept_20261121 select 'created', id, null, 'EMP-000010' from cr;
-- result: per moved doctor, contracted services bookable now (department OR scope, + active contract)
select pr.name, pr.department,
       (select count(*) from clinic_reception.services s where s.workspace_id = pr.workspace_id and s.active
          and (s.department = pr.department or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = pr.id and sc.service_code = s.code))
          and exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = pr.doctor_key and c.service_scope = s.code and c.status = 'active')) contracted_bookable
  from clinic_reception.providers pr where pr.id in (select provider_id from _v3) order by 2, 1;
select kind, count(*) from clinic_reception.ops_doctor_dept_20261121 group by 1 order by 1;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- update clinic_reception.providers p set department = o.old_value from clinic_reception.ops_doctor_dept_20261121 o where o.kind = 'department' and p.id = o.provider_id;
-- delete from clinic_reception.provider_service_scopes sc using clinic_reception.ops_doctor_dept_20261121 o where o.kind = 'scope' and sc.provider_id = o.provider_id and sc.service_code = o.new_value;
-- update clinic_reception.providers p set active = false from clinic_reception.ops_doctor_dept_20261121 o where o.kind = 'reactivated' and p.id = o.provider_id;
-- update clinic_reception.providers p set active = false from clinic_reception.ops_doctor_dept_20261121 o where o.kind = 'created' and p.id = o.provider_id
--   and not exists (select 1 from clinic_reception.appointments a where a.provider_id = p.id);
-- drop table clinic_reception.ops_doctor_dept_20261121;
-- commit;
