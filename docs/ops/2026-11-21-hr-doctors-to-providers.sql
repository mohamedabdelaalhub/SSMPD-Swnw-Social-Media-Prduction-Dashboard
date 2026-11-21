-- HR doctors → reception booking providers (owner batch «صلح كل حاجة من فضلك», main chat 4, 2026-11-21, item 1).
-- Problem: the booking modal lists departments/doctors from clinic_reception.services ∪ providers. Only some doctors have a
-- provider row, so e.g. «الأطفال» shows no doctor although د. إلهام قدري (EMP-000037) is in HR with a contract.
-- Rule (one provider per HR doctor, same model as the nurses):
--   * who: clinic_people.people with doctor_key, status <> 'ended', kind doctor/both, and ≥1 ACTIVE clinic_finance contract today;
--   * doctor_key = people.doctor_key; name = 'د. ' + full_name (unless it already starts with د);
--   * department = the live SERVICE department his active contracts cover most (contract scope = service code, or 'قسم:X'),
--     so the booking gate (provider.department = service.department) passes; when his contracts give none, the HR department
--     is used only if it matches a live service department after normalising (ال / ة→ه / spaces); otherwise he is listed
--     as «needs department» and NOT created.
--   * existing provider with the same doctor_key: never duplicated; reactivated only if inactive; its department is NOT
--     changed (preview lists differences for the owner).
-- NOT done here: weekly schedules. A new provider has no availability until reception sets his days in «إعداد الأطباء»
-- (or a Masa link fills them) — the preview lists them.

-- ===================== 0. PREVIEW (read-only) =====================
with ws as (select id from clinic_reception.workspaces where mode = 'live'),
svc as (select s.code, s.department from clinic_reception.services s join ws on ws.id = s.workspace_id where s.active and coalesce(s.department, '') <> ''),
norm as (select department d, regexp_replace(replace(replace(regexp_replace(department, '^ال', ''), 'ة', 'ه'), 'أ', 'ا'), '\s+', '', 'g') k
           from (select distinct department from svc) x),
doc as (select p.code hr_code, p.doctor_key, p.full_name, p.department hr_department, p.job_title
          from clinic_people.people p
         where p.doctor_key is not null and p.status <> 'ended' and p.kind in ('doctor', 'both')
           and exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p.doctor_key and c.status = 'active'
                        and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to)),
cdep as (select c.doctor_key, coalesce(s.department, nullif(substring(c.service_scope from '^قسم:(.*)$'), '')) dep, count(*) n
           from clinic_finance.doctor_contracts c left join svc s on s.code = c.service_scope
          where c.status = 'active' and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to
          group by 1, 2),
best as (select distinct on (doctor_key) doctor_key, dep from cdep where dep is not null order by doctor_key, n desc, dep)
select d.hr_code, d.full_name, d.hr_department, d.job_title, b.dep contract_department,
       (select n.d from norm n where n.k = regexp_replace(replace(replace(regexp_replace(d.hr_department, '^ال', ''), 'ة', 'ه'), 'أ', 'ا'), '\s+', '', 'g')) hr_match,
       pr.name existing_provider, pr.department existing_department, pr.active existing_active,
       case when pr.id is not null and pr.active then 'exists'
            when pr.id is not null then 'reactivate'
            when coalesce(b.dep, (select n.d from norm n where n.k = regexp_replace(replace(replace(regexp_replace(d.hr_department, '^ال', ''), 'ة', 'ه'), 'أ', 'ا'), '\s+', '', 'g'))) is null then 'NEEDS DEPARTMENT'
            else 'create' end plan
  from doc d left join best b on b.doctor_key = d.doctor_key
  left join clinic_reception.providers pr on pr.doctor_key = d.doctor_key and pr.workspace_id in (select id from ws)
 order by plan, d.full_name;
select distinct department from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
 where s.active order by 1;                                                     -- live service departments (for the owner)

-- ===================== 1. APPLY =====================
begin;
create temp table _hr_providers on commit drop as
with ws as (select id, (select branch from clinic_reception.providers p where p.workspace_id = w.id and p.active limit 1) br
              from clinic_reception.workspaces w where w.mode = 'live'),
svc as (select s.code, s.department from clinic_reception.services s join ws on ws.id = s.workspace_id where s.active and coalesce(s.department, '') <> ''),
norm as (select department d, regexp_replace(replace(replace(regexp_replace(department, '^ال', ''), 'ة', 'ه'), 'أ', 'ا'), '\s+', '', 'g') k
           from (select distinct department from svc) x),
doc as (select p.doctor_key, p.full_name, p.department hr_department from clinic_people.people p
         where p.doctor_key is not null and p.status <> 'ended' and p.kind in ('doctor', 'both')
           and exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p.doctor_key and c.status = 'active'
                        and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to)),
cdep as (select c.doctor_key, coalesce(s.department, nullif(substring(c.service_scope from '^قسم:(.*)$'), '')) dep, count(*) n
           from clinic_finance.doctor_contracts c left join svc s on s.code = c.service_scope
          where c.status = 'active' and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to group by 1, 2),
best as (select distinct on (doctor_key) doctor_key, dep from cdep where dep is not null order by doctor_key, n desc, dep)
select ws.id workspace_id, coalesce(ws.br, 'حدائق الأهرام') branch, d.doctor_key,
       case when btrim(d.full_name) ~ '^د' then btrim(d.full_name) else 'د. ' || btrim(d.full_name) end pname,
       coalesce(b.dep, (select n.d from norm n where n.k = regexp_replace(replace(replace(regexp_replace(d.hr_department, '^ال', ''), 'ة', 'ه'), 'أ', 'ا'), '\s+', '', 'g'))) dep
  from doc d cross join ws left join best b on b.doctor_key = d.doctor_key;

-- reactivate an existing inactive provider of the same doctor
update clinic_reception.providers pr set active = true from _hr_providers h
 where pr.workspace_id = h.workspace_id and pr.doctor_key = h.doctor_key and not pr.active
   and not exists (select 1 from clinic_reception.providers x where x.workspace_id = h.workspace_id and x.doctor_key = h.doctor_key and x.active);
-- create the missing ones (skip doctors without a department, and name clashes with another provider)
insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active)
select h.workspace_id, h.pname, h.doctor_key, h.dep, h.branch, true from _hr_providers h
 where h.dep is not null
   and not exists (select 1 from clinic_reception.providers x where x.workspace_id = h.workspace_id and x.doctor_key = h.doctor_key)
   and not exists (select 1 from clinic_reception.providers x where x.workspace_id = h.workspace_id and x.name = h.pname);
-- result
select h.pname, h.dep, pr.id is not null has_provider, pr.department, pr.active,
       (select count(*) from clinic_reception.weekly_slots s where s.provider_id = pr.id) schedule_days
  from _hr_providers h left join clinic_reception.providers pr on pr.workspace_id = h.workspace_id and pr.doctor_key = h.doctor_key
 order by (pr.id is null), h.dep nulls first, h.pname;   -- has_provider = false → needs a department or a name clash
commit;

-- ===================== 2. ROLLBACK =====================
-- (providers created by this file have no appointments yet; never delete one that has)
-- begin;
-- save the doctor_keys of the rows the apply CREATED (result above, has_provider = true and plan was 'create' in the preview):
-- delete from clinic_reception.providers pr where pr.doctor_key in (<keys>) and not exists (select 1 from clinic_reception.appointments a where a.provider_id = pr.id);
-- commit;
