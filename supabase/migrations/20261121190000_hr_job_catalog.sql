-- HR Job Catalog («دليل الوظائف») — owner approved the mockup 2026-11-21.
-- * clinic_people.jobs: one row per job (tasks, qualifications, KPIs tagged auto/manual, incentive text, salary band).
-- * clinic_people.people.job_id: each employee links to ONE job, separate from the dashboard role. Doctors are out of scope.
-- * Salary columns are readable ONLY through the RPCs below and only for super_admin / accountant / financial_manager.
-- * Salary-vs-band check is a WARNING only (never blocks saving a salary). Salary source = the approved employment contract
--   (clinic_finance.business_requests kind='employment', payload.base) valid today, found through people.finance_subject.
-- Idempotent; no destructive change to existing data.

create table if not exists clinic_people.jobs(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[a-z0-9_]{3,40}$'),
  title_ar text not null check(length(trim(title_ar)) >= 3),
  title_en text not null default '',
  department text not null default '',
  tasks jsonb not null default '[]' check(jsonb_typeof(tasks) = 'array'),
  qualifications jsonb not null default '[]' check(jsonb_typeof(qualifications) = 'array'),
  experience text not null default '',
  kpis jsonb not null default '[]' check(jsonb_typeof(kpis) = 'array'),   -- [{name, target, kind: 'auto'|'manual'}]
  incentive text not null default '',
  salary_min numeric(14,2) check(salary_min is null or salary_min >= 0),
  salary_max numeric(14,2) check(salary_max is null or salary_max >= 0),
  salary_approved numeric(14,2) check(salary_approved is null or salary_approved >= 0),
  salary_note text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(salary_min is null or salary_max is null or salary_max >= salary_min)
);
alter table clinic_people.jobs enable row level security;
revoke all on clinic_people.jobs from public, anon, authenticated;
alter table clinic_people.people add column if not exists job_id uuid references clinic_people.jobs(id);
create index if not exists people_job_idx on clinic_people.people(job_id) where job_id is not null;

create or replace function clinic_people.salary_visible() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('accountant') or public.has_role('financial_manager'))
$$;

-- Catalog for HR managers. Salary / incentive-pay columns only when salary_visible().
create or replace function public.hr_jobs() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare sv boolean := clinic_people.salary_visible(); begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'لا تملك إدارة الموارد البشرية'; end if;
  return jsonb_build_object(
    'can_edit', clinic_people.is_owner_level(), 'salary_visible', sv,
    'jobs', (select coalesce(jsonb_agg(
        (to_jsonb(j) - 'salary_min' - 'salary_max' - 'salary_approved' - 'salary_note')
        || case when sv then jsonb_build_object('salary_min', j.salary_min, 'salary_max', j.salary_max, 'salary_approved', j.salary_approved, 'salary_note', j.salary_note) else '{}'::jsonb end
        || jsonb_build_object('people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name, 'status', p.status) order by p.full_name), '[]')
                                            from clinic_people.people p where p.job_id = j.id and p.status <> 'ended'))
      order by j.sort_order, j.title_ar), '[]') from clinic_people.jobs j where j.active),
    'unclassified', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name, 'job_title', p.job_title) order by p.full_name), '[]')
                       from clinic_people.people p where p.job_id is null and p.kind = 'employee' and p.status <> 'ended'));
end $$;

-- Create / edit a job. Owner level only. Salary fields are written only by salary-visible roles (otherwise kept).
create or replace function public.hr_job_save(p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v uuid := nullif(p_payload->>'id', '')::uuid; old clinic_people.jobs%rowtype; sv boolean := clinic_people.salary_visible();
  k jsonb; kk jsonb; begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.is_owner_level() then raise exception 'تعديل دليل الوظائف للإدارة العليا فقط'; end if;
  if length(trim(coalesce(p_payload->>'title_ar', ''))) < 3 then raise exception 'اكتب اسم الوظيفة'; end if;
  k := coalesce(p_payload->'kpis', '[]');
  if jsonb_typeof(k) <> 'array' or jsonb_typeof(coalesce(p_payload->'tasks', '[]')) <> 'array' or jsonb_typeof(coalesce(p_payload->'qualifications', '[]')) <> 'array' then raise exception 'صيغة غير صحيحة'; end if;
  for kk in select * from jsonb_array_elements(k) loop
    if coalesce(kk->>'kind', '') not in ('auto', 'manual') or length(trim(coalesce(kk->>'name', ''))) < 2 then raise exception 'كل مؤشر له اسم ونوع تلقائي أو يدوي'; end if;
  end loop;
  if v is null then
    insert into clinic_people.jobs(code, title_ar, title_en, department, tasks, qualifications, experience, kpis, incentive,
        salary_min, salary_max, salary_approved, salary_note, sort_order)
    values(coalesce(nullif(p_payload->>'code', ''), 'job_' || substr(gen_random_uuid()::text, 1, 8)), trim(p_payload->>'title_ar'), coalesce(p_payload->>'title_en', ''), coalesce(p_payload->>'department', ''),
      coalesce(p_payload->'tasks', '[]'), coalesce(p_payload->'qualifications', '[]'), coalesce(p_payload->>'experience', ''), k, coalesce(p_payload->>'incentive', ''),
      case when sv then nullif(p_payload->>'salary_min', '')::numeric end, case when sv then nullif(p_payload->>'salary_max', '')::numeric end,
      case when sv then nullif(p_payload->>'salary_approved', '')::numeric end, case when sv then coalesce(p_payload->>'salary_note', '') else '' end,
      coalesce(nullif(p_payload->>'sort_order', '')::int, 999)) returning id into v;
    insert into clinic_people.audit(actor_id, action, record_id, after_data) values(me, 'job_save', v, jsonb_build_object('title_ar', p_payload->>'title_ar', 'new', true));
  else
    select * into old from clinic_people.jobs where id = v for update;
    if not found or old.revision <> coalesce((p_payload->>'revision')::int, 0) then raise exception 'الوظيفة اتغيّرت؛ أعد التحميل قبل الحفظ'; end if;
    update clinic_people.jobs set title_ar = trim(p_payload->>'title_ar'), title_en = coalesce(p_payload->>'title_en', title_en), department = coalesce(p_payload->>'department', department),
      tasks = coalesce(p_payload->'tasks', tasks), qualifications = coalesce(p_payload->'qualifications', qualifications), experience = coalesce(p_payload->>'experience', experience),
      kpis = k, incentive = coalesce(p_payload->>'incentive', incentive),
      salary_min = case when sv then nullif(p_payload->>'salary_min', '')::numeric else salary_min end,
      salary_max = case when sv then nullif(p_payload->>'salary_max', '')::numeric else salary_max end,
      salary_approved = case when sv then nullif(p_payload->>'salary_approved', '')::numeric else salary_approved end,
      salary_note = case when sv then coalesce(p_payload->>'salary_note', '') else salary_note end,
      revision = revision + 1, updated_at = now() where id = v;
    -- audit carries the job title only, never the salary figures
    insert into clinic_people.audit(actor_id, action, record_id, after_data) values(me, 'job_save', v, jsonb_build_object('title_ar', p_payload->>'title_ar', 'salary_changed', sv));
  end if;
  return v;
end $$;

-- Link an employee to a job (or clear it with null). Doctors are out of scope.
create or replace function public.hr_job_assign(p_person uuid, p_job uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); pp clinic_people.people%rowtype; begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'لا تملك إدارة الموارد البشرية'; end if;
  select * into pp from clinic_people.people where id = p_person for update;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if pp.kind = 'doctor' then raise exception 'الأطباء خارج دليل الوظائف'; end if;
  if p_job is not null and not exists(select 1 from clinic_people.jobs where id = p_job and active) then raise exception 'الوظيفة غير موجودة'; end if;
  update clinic_people.people set job_id = p_job, updated_at = now() where id = p_person;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data)
    values(me, 'job_assign', p_person, jsonb_build_object('job_id', pp.job_id), jsonb_build_object('job_id', p_job));
end $$;

-- Salary vs band — warning only. status: no_job | no_band | no_salary | below | within | above.
create or replace function public.hr_job_band(p_person uuid) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pp clinic_people.people%rowtype; j clinic_people.jobs%rowtype; sal numeric; st text; today date := (now() at time zone 'Africa/Cairo')::date; begin
  if not clinic_people.salary_visible() then return jsonb_build_object('visible', false); end if;
  select * into pp from clinic_people.people where id = p_person;
  if not found then return jsonb_build_object('visible', true, 'status', 'no_job'); end if;
  select * into j from clinic_people.jobs where id = pp.job_id;
  if not found then return jsonb_build_object('visible', true, 'status', 'no_job'); end if;
  select (b.payload->>'base')::numeric into sal from clinic_finance.business_requests b
   where b.kind = 'employment' and b.status = 'approved' and b.subject = pp.finance_subject and pp.finance_subject is not null
     and (b.payload->>'from')::date <= today and (b.payload->>'to')::date >= today order by (b.payload->>'from')::date desc limit 1;
  st := case when j.salary_min is null or j.salary_max is null then 'no_band' when sal is null then 'no_salary'
             when sal < j.salary_min then 'below' when sal > j.salary_max then 'above' else 'within' end;
  return jsonb_build_object('visible', true, 'status', st, 'job_id', j.id, 'title_ar', j.title_ar, 'salary_min', j.salary_min, 'salary_max', j.salary_max,
    'salary_approved', j.salary_approved, 'salary', sal,
    'diff', case when st = 'below' then j.salary_min - sal when st = 'above' then sal - j.salary_max end);
end $$;

-- «وظيفتي»: the caller's own job, never any salary / incentive.
create or replace function public.hr_my_job() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); j clinic_people.jobs%rowtype; begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select j2.* into j from clinic_people.jobs j2 join clinic_people.people p on p.job_id = j2.id where p.admin_id = me and p.status <> 'ended' limit 1;
  if not found then return jsonb_build_object('job', null); end if;
  return jsonb_build_object('job', jsonb_build_object('title_ar', j.title_ar, 'title_en', j.title_en, 'department', j.department, 'tasks', j.tasks,
    'qualifications', j.qualifications, 'experience', j.experience,
    'kpis', (select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'kind', x->>'kind')), '[]') from jsonb_array_elements(j.kpis) x)));
end $$;

-- Annex payload for one employee (HR managers): job text only, no pay.
create or replace function public.hr_job_annex(p_person uuid) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j clinic_people.jobs%rowtype; nm text; begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'لا تملك إدارة الموارد البشرية'; end if;
  select j2.* into j from clinic_people.jobs j2 join clinic_people.people p on p.job_id = j2.id where p.id = p_person;
  if not found then raise exception 'اربط الموظف بوظيفة أولًا'; end if;
  select full_name into nm from clinic_people.people where id = p_person;
  return jsonb_build_object('full_name', nm, 'title_ar', j.title_ar, 'department', j.department, 'tasks', j.tasks, 'qualifications', j.qualifications, 'experience', j.experience);
end $$;

revoke all on function clinic_people.salary_visible() from public, anon, authenticated;
revoke all on function public.hr_jobs(), public.hr_job_save(jsonb), public.hr_job_assign(uuid, uuid), public.hr_job_band(uuid), public.hr_my_job(), public.hr_job_annex(uuid) from public, anon;
grant execute on function public.hr_jobs(), public.hr_job_save(jsonb), public.hr_job_assign(uuid, uuid), public.hr_job_band(uuid), public.hr_my_job(), public.hr_job_annex(uuid) to authenticated;

-- Seed: the 14 approved jobs. Salary bands are deliberately NOT in git (owner rule): they are entered live from the catalog screen by super_admin / finance.
insert into clinic_people.jobs(code, title_ar, title_en, department, tasks, qualifications, experience, kpis, incentive, salary_min, salary_max, salary_approved, salary_note, sort_order) values
('medical_director',$j$المدير الطبي$j$,$j$Medical Director$j$,$j$الإدارة العليا$j$,$j$["الإشراف على جودة الخدمة الطبية والبروتوكولات العلاجية في كل التخصصات.", "متابعة مكافحة العدوى وسلامة المرضى واعتماد أي تغيير في الإجراءات الطبية.", "التنسيق مع الإدارة الإدارية والمالية على تشغيل الأقسام والفروع."]$j$::jsonb,$j$["طبيب بشري بخبرة إكلينيكية لا تقل عن 5 سنوات + سنتين في الإدارة الطبية."]$j$::jsonb,$j$5 سنوات إكلينيكية + سنتين إدارة طبية$j$,$j$[{"name": "الالتزام بمكافحة العدوى", "target": "100%", "kind": "auto"}, {"name": "رضا المرضى", "target": "أكثر من 90%", "kind": "manual"}]$j$::jsonb,$j$مكافأة جودة طبية وتشغيل فروع$j$,null,null,null,$j$$j$,1),
('admin_manager',$j$المدير الإداري (التشغيل)$j$,$j$Operations Manager$j$,$j$الإدارة العليا$j$,$j$["إدارة التشغيل اليومي للفرع ومتابعة انتظام الحضور والورديات.", "متابعة شكاوى المرضى وإغلاقها وتقليل زمن الانتظار.", "متابعة تارجت إيرادات الفرع مع الإدارة المالية."]$j$::jsonb,$j$["مؤهل عالٍ في الإدارة أو ما يعادله وخبرة في إدارة المنشآت الطبية."]$j$::jsonb,$j$3–5 سنوات$j$,$j$[{"name": "زمن انتظار المريض", "target": "أقل من 20 دقيقة", "kind": "auto"}, {"name": "انضباط الحضور", "target": "أكثر من 95%", "kind": "auto"}, {"name": "إغلاق الشكاوى", "target": "خلال 24 ساعة", "kind": "manual"}]$j$::jsonb,$j$حافز تحقيق تارجت إيرادات الفرع$j$,null,null,null,$j$$j$,2),
('finance_manager',$j$المدير المالي$j$,$j$Financial Manager$j$,$j$الإدارة المالية$j$,$j$["إعداد التقارير المالية الشهرية ومراجعة الإقفال والمطابقات.", "الإشراف على الخزينة والنسب والتعاقدات ومتابعة تحصيل شركات التأمين.", "متابعة فروق المخزون والجرد."]$j$::jsonb,$j$["بكالوريوس تجارة محاسبة وخبرة مالية، منها سنتان في القطاع الطبي."]$j$::jsonb,$j$5–7 سنوات (سنتان منها في القطاع الطبي)$j$,$j$[{"name": "تسليم التقارير الشهرية", "target": "قبل يوم 5 من الشهر", "kind": "manual"}, {"name": "فروق المخزون", "target": "أقل من 1%", "kind": "auto"}]$j$::jsonb,$j$مكافأة دقة الإقفال وتحصيل التعاقدات$j$,null,null,null,$j$$j$,3),
('branch_accountant',$j$محاسب فرع / حسابات عامة$j$,$j$Branch Accountant$j$,$j$الإدارة المالية$j$,$j$["مطابقة الخزينة اليومية وقيد الإيرادات والمصروفات.", "احتساب نسب الأطباء وتسليمها في موعدها.", "تجهيز مطالبات التأمين ومتابعتها."]$j$::jsonb,$j$["بكالوريوس تجارة محاسبة وإجادة برامج الحسابات."]$j$::jsonb,$j$2–4 سنوات$j$,$j$[{"name": "مطابقة الخزينة", "target": "100%", "kind": "auto"}, {"name": "نسب الأطباء", "target": "قبل يوم 3", "kind": "manual"}, {"name": "مطالبات التأمين", "target": "أول 5 أيام عمل", "kind": "manual"}]$j$::jsonb,$j$حافز انضباط الدورات المستندية والجرد$j$,null,null,null,$j$$j$,4),
('contracts_officer',$j$موظف تعاقدات وتأمين طبي$j$,$j$Contracts & Insurance Officer$j$,$j$التعاقدات والمبيعات$j$,$j$["جلب وتجديد تعاقدات الشركات وشركات التأمين.", "تفعيل موافقات التأمين ومتابعة المرفوضات.", "التنسيق مع الاستقبال والحسابات في المطالبات."]$j$::jsonb,$j$["مؤهل عالٍ ومهارات تفاوض ومعرفة بالتأمين الطبي."]$j$::jsonb,$j$1–3 سنوات$j$,$j$[{"name": "نسبة الرفض", "target": "أقل من 3%", "kind": "auto"}]$j$::jsonb,$j$عمولة جلب تعاقدات جديدة + تفعيل موافقات$j$,null,null,null,$j$$j$,5),
('receptionist',$j$موظف استقبال$j$,$j$Receptionist$j$,$j$التشغيل وخدمة العملاء$j$,$j$["استقبال المرضى وتسجيل بياناتهم على النظام، وتأكيد الحجوزات الهاتفية وحجوزات الواتساب.", "تحصيل رسوم الكشوفات والجلسات (كاش / فيزا) وإصدار الإيصالات، وتفعيل موافقات التأمين والنقابات.", "توجيه المرضى للعيادات وتنظيم دور الدخول بالتنسيق مع التمريض، وإغلاق العهدة اليومية."]$j$::jsonb,$j$["مؤهل عالٍ، مظهر لائق، لباقة عالية ومهارات تواصل وحل مشكلات.", "إجادة الكمبيوتر وبرامج الأوفيس والأنظمة الطبية، وخبرة سنة في خدمة العملاء أو العيادات."]$j$::jsonb,$j$سنة$j$,$j$[{"name": "نسبة تحويل الاستفسارات (هاتف وواتساب) إلى حجوزات فعلية", "target": "", "kind": "auto"}, {"name": "دقة إدخال البيانات ومطابقة الخزينة اليومية (عجز صفر)", "target": "صفر", "kind": "auto"}, {"name": "تقييم المرضى لتجربة الاستقبال وسرعة إنهاء الإجراءات", "target": "", "kind": "manual"}]$j$::jsonb,$j$بونص شهري على تحقيق تارجت الحجوزات$j$,null,null,null,$j$$j$,6),
('cleaner',$j$عامل / عاملة نظافة$j$,$j$Cleaner$j$,$j$الخدمات المعاونة$j$,$j$["نظافة العيادات والممرات ودورات المياه حسب جدول يومي.", "تجهيز الغرف بين المرضى والتخلص الآمن من المخلفات."]$j$::jsonb,$j$["القدرة على العمل بالورديات والالتزام بتعليمات مكافحة العدوى."]$j$::jsonb,$j$لا تشترط$j$,$j$[{"name": "قائمة النظافة اليومية", "target": "95% فأكثر", "kind": "manual"}]$j$::jsonb,$j$حافز انتظام ونظافة يومية$j$,null,null,null,$j$$j$,7),
('senior_nurse',$j$سنيور تمريض (مشرف)$j$,$j$Senior Nurse (Supervisor)$j$,$j$الطاقم التمريضي$j$,$j$["الإشراف على فريق التمريض وتوزيع الغرف والورديات.", "ضبط المخزون الطبي ومتابعة مكافحة العدوى.", "التنسيق مع الأطباء والمدير الطبي."]$j$::jsonb,$j$["بكالوريوس تمريض أو معهد فني مع ترخيص مزاولة المهنة."]$j$::jsonb,$j$3–4 سنوات$j$,$j$[{"name": "التزام بروتوكولات مكافحة العدوى", "target": "", "kind": "manual"}]$j$::jsonb,$j$حافز ضبط المخزون ومكافحة العدوى$j$,null,null,null,$j$$j$,8),
('nurse',$j$ممرض / ممرضة$j$,$j$Nurse$j$,$j$الطاقم التمريضي$j$,$j$["تجهيز غرف الكشف قبل حضور الطبيب، وقياس العلامات الحيوية للمرضى ومساعدة الطبيب أثناء الكشف والإجراءات.", "تعقيم الآلات الطبية وتنظيف الأسطح بين كل مريض وآخر، وتسجيل استهلاك المستلزمات لكل حالة."]$j$::jsonb,$j$["دبلوم تمريض أو معهد فني تمريض + ترخيص مزاولة المهنة، وخبرة سنة على الأقل."]$j$::jsonb,$j$سنة$j$,$j$[{"name": "سرعة تجهيز الغرفة بين المرضى", "target": "أقل من 5 دقايق", "kind": "manual"}, {"name": "دقة تسجيل المستلزمات المستهلكة لكل مريض", "target": "", "kind": "auto"}, {"name": "الالتزام بالواقيات الشخصية ومعايير التعقيم", "target": "", "kind": "manual"}]$j$::jsonb,$j$حافز التزام وانضباط$j$,null,null,null,$j$$j$,9),
('dental_nurse',$j$تمريض أسنان$j$,$j$Dental Nurse$j$,$j$الطاقم التمريضي$j$,$j$["مساعدة طبيب الأسنان في الإجراءات وتجهيز الأدوات.", "تعقيم الأدوات ومتابعة دورات التعقيم."]$j$::jsonb,$j$["دبلوم تمريض مع خبرة في مساعدة طبيب الأسنان."]$j$::jsonb,$j$1–2 سنة$j$,$j$[{"name": "دورات التعقيم", "target": "100%", "kind": "auto"}]$j$::jsonb,$j$حافز إنتاجية عيادة الأسنان$j$,null,null,null,$j$$j$,10),
('aesthetics_specialist',$j$أخصائي تجميل وليزر$j$,$j$Aesthetics & Laser Specialist$j$,$j$الأقسام التخصصية$j$,$j$["تنفيذ جلسات التجميل والليزر بنفسه على الحالات.", "متابعة عداد النبضات وسلامة المريض أثناء الجلسة."]$j$::jsonb,$j$["مؤهل مناسب ودورات معتمدة في التجميل والليزر."]$j$::jsonb,$j$1–3 سنوات$j$,$j$[{"name": "عداد النبضات", "target": "100%", "kind": "auto"}, {"name": "حالات الحروق", "target": "صفر", "kind": "manual"}]$j$::jsonb,$j$عمولة على الباقات والبيع الإضافي$j$,null,null,null,$j$$j$,11),
('aesthetics_officer',$j$مسئول تجميل وليزر$j$,$j$Aesthetics & Laser Coordinator$j$,$j$الأقسام التخصصية$j$,$j$["التنسيق وتنظيم والتواصل بخصوص حالات القسم."]$j$::jsonb,$j$["مؤهل مناسب ومهارات تنسيق وتواصل."]$j$::jsonb,$j$$j$,$j$[]$j$::jsonb,$j$$j$,null,null,null,$j$$j$,12),
('physio_specialist',$j$أخصائي علاج طبيعي$j$,$j$Physiotherapy Specialist$j$,$j$الأقسام التخصصية$j$,$j$["تنفيذ جلسات العلاج الطبيعي بنفسه حسب خطة الطبيب.", "توثيق الجلسات ومتابعة تقدم الحالة."]$j$::jsonb,$j$["بكالوريوس علاج طبيعي مع ترخيص."]$j$::jsonb,$j$$j$,$j$[{"name": "إتمام الكورس العلاجي", "target": "أكثر من 80%", "kind": "auto"}]$j$::jsonb,$j$نسبة أو عمولة على الجلسات المنفذة$j$,null,null,null,$j$$j$,13),
('physio_officer',$j$مسئول علاج طبيعي$j$,$j$Physiotherapy Coordinator$j$,$j$الأقسام التخصصية$j$,$j$["التنسيق وتنظيم والتواصل بخصوص حالات القسم."]$j$::jsonb,$j$["مؤهل مناسب ومهارات تنسيق وتواصل."]$j$::jsonb,$j$$j$,$j$[]$j$::jsonb,$j$$j$,null,null,null,$j$$j$,14)
on conflict (code) do nothing;
