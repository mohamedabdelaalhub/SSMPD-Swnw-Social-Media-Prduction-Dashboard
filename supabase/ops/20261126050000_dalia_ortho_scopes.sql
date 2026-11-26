-- Ops (data only, run AFTER migration 20261126050000_restricted_doctor_scope.sql). Owner rule 2026-11-25:
-- Dr Dalia Saeed (doctor_key EMP-000036) «بتشتغل في الاسنان تقويم فقط وفي الجلدية ليزر فقط».
-- Run PART 1 alone first (read-only) and show the matched list to the owner. PART 2 writes; to dry-run it, run it with the
-- final COMMIT replaced by ROLLBACK (every check and the after-state still print).
--
-- ORTHO MATCHER (explicit, on clinic_reception.norm_ar(name): lower case, أ/إ/آ→ا, ة→ه, ى→ي, spaces squeezed), dental
-- department = norm_ar(department) = 'الاسنان' (live writes «الاسنان»; «الأسنان» normalises to the same):
--   STRONG (applied):  تقويم | ortho | براكت | براكيت | bracket | aligner | اليجنر | انفزلاين | invisalign | ريتينر | retainer
--   WEAK (NOT applied, printed for the owner to confirm): جهاز | مثبت | توسيع | سلك | wire — and never a prosthetic name
--     (طقم | تركيب(ه)? اسنان | كوبري | تاج | crown | bridge | زرع | implant). To add a confirmed weak / other code, put it in
--     extra_codes in PART 2 (the only edit allowed) — codes are never guessed here.
-- PART 2 also lists her two departments in clinic_reception.provider_restricted_departments_set (the EXPLICIT restriction list —
-- nothing is inferred from scope rows): her home dermatology department (she keeps exactly her existing laser scope rows) and
-- her dental department (ortho rows added here). Basic services (كشف / استشارة / متابعة) stay open to her in both.

-- ===================================================================== PART 1 — PREVIEW (read-only)
-- 1a) the doctor, her departments
select p.id, p.name, p.doctor_key, p.department home_department, p.active,
       (select string_agg(pd.department, '، ' order by pd.department) from clinic_reception.provider_departments pd where pd.provider_id = p.id) extra_departments,
       case when to_regprocedure('clinic_reception.provider_restricted_departments(uuid)') is null then 'migration 20261126050000 NOT applied'
            else 'migration applied' end migration
  from clinic_reception.providers p where p.doctor_key = 'EMP-000036';

-- 1b) dental services and what the matcher says (STRONG = will be applied, WEAK = needs the owner's yes, other = not ortho)
with dent as (
  select s.code, s.name, s.price, s.department, clinic_reception.norm_ar(s.name) n
    from clinic_reception.providers p
    join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and not coalesce(s.placeholder, false)
   where p.doctor_key = 'EMP-000036' and p.active and clinic_reception.norm_ar(s.department) = 'الاسنان')
select code, name, price, department, clinic_reception.is_basic_service(department, name) basic,
       case when n ~ '(تقويم|ortho|براكت|براكيت|bracket|aligner|اليجنر|انفزلاين|invisalign|ريتينر|retainer)' then 'STRONG'
            when n ~ '(جهاز|مثبت|توسيع|سلك|wire)' and n !~ '(طقم|تركيبه? اسنان|كوبري|تاج|crown|bridge|زرع|implant)' then 'WEAK — confirm'
            else '' end ortho_match,
       substring(n from '(تقويم|ortho|براكت|براكيت|bracket|aligner|اليجنر|انفزلاين|invisalign|ريتينر|retainer|جهاز|مثبت|توسيع|سلك|wire)') matched_word
  from dent order by ortho_match desc, name;

-- 1c) her current scope rows per department (auto = automatic contract copy)
select s.department, count(*) rows_, count(af.provider_id) auto_copies, string_agg(sc.service_code, ' ' order by sc.service_code) codes
  from clinic_reception.providers p
  join clinic_reception.provider_service_scopes sc on sc.provider_id = p.id
  left join lateral (select x.department from clinic_reception.services x where x.workspace_id = p.workspace_id and x.code = sc.service_code
                      order by x.active desc, x.version desc limit 1) s on true
  left join clinic_reception.provider_scope_autofill af on af.provider_id = sc.provider_id and af.service_code = sc.service_code
 where p.doctor_key = 'EMP-000036'
 group by s.department order by s.department;

-- 1c2) the explicit restriction list (needs the migration; expect 0 rows before PART 2)
select p.name, r.department, r.note, r.set_at from clinic_reception.provider_restricted_departments_set r
  join clinic_reception.providers p on p.id = r.provider_id order by p.name, r.department;

-- 1d) her open bookings from today (a non-ortho dental / non-laser derm booking will be refused at arrival/execution after PART 2)
select a.starts_at at time zone 'Africa/Cairo' starts_cairo, s.code, s.name, s.department, a.status
  from clinic_reception.appointments a join clinic_reception.providers p on p.id = a.provider_id
  join clinic_reception.services s on s.id = a.service_id
 where p.doctor_key = 'EMP-000036' and a.status = 'booked' and a.starts_at >= date_trunc('day', now())
 order by a.starts_at;

-- ===================================================================== PART 2 — APPLY (writes; COMMIT → ROLLBACK for a dry-run)
begin;
create temp table dalia_ops_codes(code text primary key, name text, price numeric, why text) on commit drop;
do $$
declare extra_codes text[] := array[]::text[];   -- ← owner-confirmed extra dental codes (e.g. WEAK matches), else leave empty
  pid uuid; ws uuid; home text; dental text; n int; restr_added int; added int; derm_scoped int; bad text;
begin
  if to_regprocedure('clinic_reception.provider_serves_code(uuid,text,text,date)') is null then
    raise exception 'طبّق migration 20261126050000_restricted_doctor_scope.sql الأول'; end if;
  select count(*) into n from clinic_reception.providers where doctor_key = 'EMP-000036' and active;
  if n <> 1 then raise exception 'المتوقع دكتورة واحدة فعّالة بالكود EMP-000036 — لقيت %', n; end if;
  select id, workspace_id, department into pid, ws, home from clinic_reception.providers where doctor_key = 'EMP-000036' and active;
  select d into dental from (select home d union all select pd.department from clinic_reception.provider_departments pd where pd.provider_id = pid) x
   where clinic_reception.norm_ar(d) = 'الاسنان' limit 1;
  if dental is null then raise exception 'الدكتورة مش في قسم الاسنان (لا قسم أساسي ولا قسم إضافي)'; end if;
  if clinic_reception.norm_ar(home) = 'الاسنان' then raise exception 'قسمها الأساسي اسنان — راجع قبل التطبيق (المتوقع الجلدية)'; end if;

  insert into dalia_ops_codes
  select s.code, min(s.name), min(s.price), 'strong'
    from clinic_reception.services s
   where s.workspace_id = ws and s.active and not coalesce(s.placeholder, false) and s.department = dental
     and clinic_reception.norm_ar(s.name) ~ '(تقويم|ortho|براكت|براكيت|bracket|aligner|اليجنر|انفزلاين|invisalign|ريتينر|retainer)'
   group by s.code;
  select string_agg(c, ' ') into bad from unnest(extra_codes) c
   where not exists (select 1 from clinic_reception.services s where s.workspace_id = ws and s.active and s.code = c and s.department = dental);
  if bad is not null then raise exception 'extra_codes مش خدمات اسنان فعّالة: %', bad; end if;
  insert into dalia_ops_codes
  select s.code, min(s.name), min(s.price), 'extra' from clinic_reception.services s
   where s.workspace_id = ws and s.active and s.code = any(extra_codes) group by s.code
  on conflict (code) do nothing;
  select count(*) into n from dalia_ops_codes;
  if n = 0 then raise exception 'المطابقة مالقتش ولا خدمة تقويم في قسم % — مفيش حاجة اتكتبت', dental; end if;

  insert into clinic_reception.provider_service_scopes(provider_id, service_code) select pid, code from dalia_ops_codes on conflict do nothing;
  get diagnostics added = row_count;
  -- the explicit restriction: her home (dermatology) department and her dental department
  insert into clinic_reception.provider_restricted_departments_set(provider_id, department, note)
  values (pid, home, 'المالك 2026-11-25: تقويم فقط / ليزر فقط'), (pid, dental, 'المالك 2026-11-25: تقويم فقط / ليزر فقط')
  on conflict (provider_id, department) do nothing;
  get diagnostics restr_added = row_count;
  select count(*) into derm_scoped from clinic_reception.provider_service_scopes sc
    join clinic_reception.services s on s.workspace_id = ws and s.code = sc.service_code and s.active and s.department = home
   where sc.provider_id = pid and not clinic_reception.is_basic_service(s.department, s.name);
  if derm_scoped = 0 then raise exception 'مالهاش ولا خدمة محددة في % — التقييد كان هيقفل القسم كله عليها', home; end if;

  -- checks: both departments restricted; dental (non-basic) = exactly the ortho codes; derm (non-basic) = her derm scope codes
  if not (home = any(clinic_reception.provider_restricted_departments(pid)) and dental = any(clinic_reception.provider_restricted_departments(pid))) then
    raise exception 'بعد التطبيق القسمين لازم يبقوا مقيّدين — لقيت %', clinic_reception.provider_restricted_departments(pid); end if;
  select string_agg(s.code, ' ') into bad from clinic_reception.services s
   where s.workspace_id = ws and s.active and not coalesce(s.placeholder, false) and s.department = dental
     and not clinic_reception.is_basic_service(s.department, s.name)
     and clinic_reception.provider_serves_code(pid, s.department, s.code, null) <> exists (select 1 from dalia_ops_codes o where o.code = s.code);
  if bad is not null then raise exception 'خدمات الاسنان اللي بتعملها مش هي التقويم بالظبط: %', bad; end if;
  select count(distinct s.code) into derm_scoped from clinic_reception.provider_service_scopes sc
    join clinic_reception.services s on s.workspace_id = ws and s.code = sc.service_code and s.active and s.department = home
   where sc.provider_id = pid and not clinic_reception.is_basic_service(s.department, s.name);
  select count(distinct s.code) into n from clinic_reception.services s
   where s.workspace_id = ws and s.active and not coalesce(s.placeholder, false) and s.department = home
     and not clinic_reception.is_basic_service(s.department, s.name) and clinic_reception.provider_serves_code(pid, s.department, s.code, null);
  if n <> derm_scoped then raise exception 'الجلدية: بتعمل % خدمة والمحدد % — راجع', n, derm_scoped; end if;
  raise notice 'EMP-000036: ortho codes % (non-basic %, scope rows added %), restriction rows added %, % non-basic services she serves in %',
    (select count(*) from dalia_ops_codes), (select count(distinct o.code) from dalia_ops_codes o join clinic_reception.services s on s.workspace_id = ws and s.code = o.code and s.active
      where not clinic_reception.is_basic_service(s.department, s.name)), added, restr_added, n, home;
  if (select count(*) from clinic_reception.provider_restricted_departments_set) <> 2 then
    raise exception 'المتوقع إن داليا بس اللي مقيّدة (صفين) — لقيت % صف', (select count(*) from clinic_reception.provider_restricted_departments_set); end if;
end $$;

-- after-state: every dental service and whether she serves it now; her home-department count
select s.code, s.name, s.price, clinic_reception.is_basic_service(s.department, s.name) basic,
       clinic_reception.provider_serves_code(p.id, s.department, s.code, null) she_serves, o.why
  from clinic_reception.providers p
  join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and not coalesce(s.placeholder, false)
  left join dalia_ops_codes o on o.code = s.code
 where p.doctor_key = 'EMP-000036' and p.active and clinic_reception.norm_ar(s.department) = 'الاسنان'
 order by she_serves desc, s.name;
select s.department, count(*) filter (where clinic_reception.provider_serves_code(p.id, s.department, s.code, null)) she_serves, count(*) total
  from clinic_reception.providers p
  join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and not coalesce(s.placeholder, false)
 where p.doctor_key = 'EMP-000036' and p.active
   and (s.department = p.department or exists (select 1 from clinic_reception.provider_departments pd where pd.provider_id = p.id and pd.department = s.department))
 group by s.department order by s.department;
commit;
