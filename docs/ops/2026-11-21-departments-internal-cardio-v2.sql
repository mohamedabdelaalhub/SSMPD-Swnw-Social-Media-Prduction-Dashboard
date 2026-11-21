-- v2 of item 1 (main chat 4 live preview 2026-11-21 19:01Z): almost every HR doctor already HAS a provider; the real
-- problem is wrong / missing booking DEPARTMENTS (no «الباطنة», no «القلب»; internists + cardiologists sit under «الاشعة»,
-- pediatrics under «خدمات الكشف»), so the booking modal finds no «باطن» department and «الأطفال» shows no doctor.
-- This file (live workspace only):
--   (a) owner 21/11: «يتسجل في الاتنين الكشف والاستشارة والمتابعة وخدمات القسم نفسه» — each new department gets its consult,
--       consultation, follow-up AND its own department services, moved from «الاشعة» / «خدمات الكشف» only:
--         «الباطنة»                  : name ~ 'باطن'
--         «القلب والأوعية الدموية»   : name ~ 'قلب|ايكو|إيكو|هولتر|مجهود'   (consults + ECG / echo / holter / stress test)
--         «الأطفال»                  : name ~ 'اطفال|أطفال'
--       general imaging / lab stays where it is: names with سونار / أشعة / اشعة / مقطعي / رنين / تحليل never move.
--   (b) moves providers: EMP-000020, EMP-000034, EMP-000038 → «الباطنة»; EMP-000043, EMP-000056, EMP-000053 → «القلب
--       والأوعية الدموية»; EMP-000037 → «الأطفال».
--   (c) creates EMP-000010 (department «النفسية والتخاطب») and reactivates EMP-000049; EMP-000059 (test doctor) skipped.
-- Safety: a moved doctor keeps every service he could book before — his services that stay in «الاشعة» (echo/ECG…) are
-- added to his provider_service_scopes (scope + his existing ACTIVE contract = bookable, the existing gate). Preview shows
-- per doctor: services bookable before / after, and moved services whose ONLY contract is a department contract
-- ('قسم:الاشعة'…) — those need a new 'قسم:<new>' contract (listed, not created).
-- Doctor keys come from clinic_people.people.code (HR code) → people.doctor_key → providers.doctor_key.

-- ===================== 0. PREVIEW (read-only) =====================
create temp view _mv_svc as
select s.id, s.workspace_id, s.code, s.name, s.department old_dep,
       case when s.name ~ 'باطن' then 'الباطنة' when s.name ~ '(قلب|ايكو|إيكو|هولتر|مجهود)' then 'القلب والأوعية الدموية' else 'الأطفال' end new_dep
  from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
 where s.active and s.department in ('الاشعة', 'خدمات الكشف')
   and s.name ~ '(باطن|قلب|ايكو|إيكو|هولتر|مجهود|اطفال|أطفال)'
   and s.name !~ '(سونار|أشعة|اشعة|مقطعي|رنين|تحليل)';
create temp view _mv_doc as
select pr.id provider_id, pr.workspace_id, pr.name, pr.department old_dep, pr.doctor_key, m.new_dep, m.hr
  from (values ('EMP-000020','الباطنة'), ('EMP-000034','الباطنة'), ('EMP-000038','الباطنة'),
               ('EMP-000043','القلب والأوعية الدموية'), ('EMP-000056','القلب والأوعية الدموية'), ('EMP-000053','القلب والأوعية الدموية'),
               ('EMP-000037','الأطفال')) m(hr, new_dep)
  join clinic_people.people p on p.code = m.hr
  join clinic_reception.providers pr on pr.doctor_key = p.doctor_key
  join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live';
select code, name, old_dep, new_dep from _mv_svc order by new_dep, name;                 -- (a) services to move — CHECK THE LIST
select hr, name, old_dep, new_dep from _mv_doc order by new_dep, name;                    -- (b) providers to move
-- bookable services per moved doctor: before vs after (department match OR scope+active contract)
with today as (select (now() at time zone 'Africa/Cairo')::date d),
svc_after as (select s.id, s.workspace_id, s.code, coalesce(m.new_dep, s.department) dep, s.department dep_before
                from clinic_reception.services s left join _mv_svc m on m.id = s.id where s.active),
contracted as (select d.provider_id, s.code from _mv_doc d join svc_after s on s.workspace_id = d.workspace_id, today
                where exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = d.doctor_key and c.status = 'active'
                               and today.d between c.valid_from and c.valid_to and c.service_scope = s.code))
select d.hr, d.name,
       (select count(*) from svc_after s where s.workspace_id = d.workspace_id and s.dep_before = d.old_dep) bookable_before_by_dept,
       (select count(*) from svc_after s where s.workspace_id = d.workspace_id and s.dep = d.new_dep) bookable_after_by_dept,
       (select count(*) from svc_after s join contracted c on c.provider_id = d.provider_id and c.code = s.code
         where s.dep_before = d.old_dep and s.dep <> d.new_dep) kept_by_new_scopes,
       (select string_agg(distinct c.service_scope, ', ') from clinic_finance.doctor_contracts c where c.doctor_key = d.doctor_key and c.status = 'active'
         and c.service_scope like 'قسم:%') dept_contracts_need_review
  from _mv_doc d order by d.new_dep, d.name;
-- other providers that book a service being moved: kept=true when they hold an exact contract (scope added), else they lose it
select pr.name, pr.department, m.name service, m.new_dep,
       exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = pr.doctor_key and c.status = 'active' and c.service_scope = m.code) kept
  from clinic_reception.providers pr join _mv_svc m on m.workspace_id = pr.workspace_id and m.old_dep = pr.department
 where pr.active and pr.id not in (select provider_id from _mv_doc) order by 1, 3;
select p.code, p.full_name, pr.id is not null has_provider, pr.active from clinic_people.people p
  left join clinic_reception.providers pr on pr.doctor_key = p.doctor_key where p.code in ('EMP-000010','EMP-000049','EMP-000059');

-- ===================== 1. APPLY =====================
begin;
create table if not exists clinic_reception.ops_dept_move_20261121(kind text, id uuid, old_dep text, new_dep text, primary key (kind, id));
-- doctors' current services that will NOT move with them → keep via scopes
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select d.provider_id, s.code from _mv_doc d
  join clinic_reception.services s on s.workspace_id = d.workspace_id and s.active and s.department = d.old_dep
 where not exists (select 1 from _mv_svc m where m.id = s.id and m.new_dep = d.new_dep)
   and exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = d.doctor_key and c.status = 'active' and c.service_scope = s.code)
on conflict do nothing;
-- other providers (e.g. a radiologist doing echo) keep a moved service they hold an exact ACTIVE contract for
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select pr.id, m.code from clinic_reception.providers pr join _mv_svc m on m.workspace_id = pr.workspace_id and m.old_dep = pr.department
 where pr.active and pr.id not in (select provider_id from _mv_doc)
   and exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = pr.doctor_key and c.status = 'active' and c.service_scope = m.code)
on conflict do nothing;
insert into clinic_reception.ops_dept_move_20261121 select 'service', id, old_dep, new_dep from _mv_svc on conflict do nothing;
insert into clinic_reception.ops_dept_move_20261121 select 'provider', provider_id, old_dep, new_dep from _mv_doc on conflict do nothing;
update clinic_reception.services s set department = m.new_dep from _mv_svc m where s.id = m.id;
update clinic_reception.providers pr set department = d.new_dep from _mv_doc d where pr.id = d.provider_id;
-- (c) EMP-000049 reactivate, EMP-000010 create
update clinic_reception.providers pr set active = true from clinic_people.people p
 where p.code = 'EMP-000049' and pr.doctor_key = p.doctor_key and not pr.active;
insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active)
select w.id, case when btrim(p.full_name) ~ '^(د|أ)[ /.]' then btrim(p.full_name) else 'أ. ' || btrim(p.full_name) end, p.doctor_key, 'النفسية والتخاطب',
       coalesce((select branch from clinic_reception.providers x where x.workspace_id = w.id and x.active limit 1), 'حدائق الأهرام'), true
  from clinic_people.people p cross join clinic_reception.workspaces w
 where w.mode = 'live' and p.code = 'EMP-000010' and p.doctor_key is not null
   and not exists (select 1 from clinic_reception.providers x where x.workspace_id = w.id and x.doctor_key = p.doctor_key);
select kind, old_dep, new_dep, count(*) from clinic_reception.ops_dept_move_20261121 group by 1, 2, 3 order by 1, 2, 3;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- update clinic_reception.services s set department = o.old_dep from clinic_reception.ops_dept_move_20261121 o where o.kind = 'service' and s.id = o.id;
-- update clinic_reception.providers p set department = o.old_dep from clinic_reception.ops_dept_move_20261121 o where o.kind = 'provider' and p.id = o.id;
-- (scopes added for kept services are harmless; EMP-000010 / 049: deactivate by doctor_key if needed)
-- drop table clinic_reception.ops_dept_move_20261121;
-- commit;
