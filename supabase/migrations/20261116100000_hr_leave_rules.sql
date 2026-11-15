-- HR: leave rules (owner decisions 2026-11-15, checked against Labor Law 14/2025 articles 124–131; docs/LEGAL-LEAVE-REFERENCE.md).
--
-- clinic_people.requests (kind='leave') gets a leave_type:
--   annual   notice by length: 1 day → 2 days before; 2–3 → 3; 4–7 → 7; over 7 → 14 (internal rule).
--   casual   (عارضة) no notice: reported the same day. Hard legal caps: 2 days at a time, 7 a year (art. 128).
--            Pacing (owner): at most 2 days a calendar month and 3 a calendar quarter. Uses the annual balance (art. 128).
--   sick     reported before the shift or the same day; medical certificate within 48 h, else the day is an absence.
--            Does not use the annual balance.
--   birth    1 paid day when the employee's child is born, at most 3 times, not from the balance (art. 128).
--   excused  owner-only: a day already counted absent is excused afterwards (strong circumstance).
-- A request outside the internal rules is still accepted with a written exception reason, and marked (rule_breaks):
--   short_notice / retroactive / casual_pace → any other HR reviewer can approve it, the review note is the exception;
--   sick_retroactive / no_certificate / excused → only an owner-level reviewer (super admin or general manager).
-- Legal caps are never bypassed.
-- When an approved leave covers days whose salary was already sent to finance with an absence deduction, a pending
-- «رد خصم» bonus adjustment is created for the current month; a different HR reviewer approves it (four-eyes).
--
-- Redefines public.hr_command and public.hr_workspace (copied from 20261024162604, the only definition in the repo)
-- and public.hr_attendance_from_punches (from 20261115130000). Compare the live pg_get_functiondef of these three
-- with those files before applying; stop if they drifted.
begin;

do $$ begin
  if to_regprocedure('public.hr_attendance_from_punches(date)') is null then raise exception 'طبّق 20261115130000 أولًا'; end if;
  if to_regclass('clinic_people.requests') is null then raise exception 'طبّق human_resources_workspace أولًا'; end if;
end $$;

alter table clinic_people.requests
  add column if not exists leave_type text check (leave_type in ('annual','casual','sick','birth','excused')),
  add column if not exists rule_breaks text[] not null default '{}',
  add column if not exists notice_reason text check (notice_reason is null or length(notice_reason) <= 500),
  add column if not exists certificate_url text,
  add column if not exists certificate_at timestamptz,
  add column if not exists exception_by uuid references public.admins(id),
  add column if not exists refund_adjustment_id uuid references clinic_people.pay_adjustments(id);
update clinic_people.requests set leave_type = 'annual' where kind = 'leave' and leave_type is null;
alter table clinic_people.requests drop constraint if exists requests_leave_type_kind;
alter table clinic_people.requests add constraint requests_leave_type_kind check ((kind = 'leave') = (leave_type is not null));

create or replace function clinic_people.is_owner_level() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('general_manager'))
$$;

-- Days of notice an annual leave of p_units days needs (internal rule, owner decision 2026-11-15).
create or replace function clinic_people.leave_notice_days(p_units numeric) returns integer
language sql immutable as $$
  select case when p_units <= 1 then 2 when p_units <= 3 then 3 when p_units <= 7 then 7 else 14 end
$$;

create or replace function clinic_people.leave_break_labels(p text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(case u.b
      when 'short_notice' then 'إخطار أقل من المطلوب'
      when 'retroactive' then 'بأثر رجعي'
      when 'casual_pace' then 'تجاوز توزيع العارضة (يومين في الشهر و3 أيام في الربع)'
      when 'sick_retroactive' then 'مرضي اتبلّغ بعد يومه'
      when 'no_certificate' then 'مفيش شهادة طبية خلال 48 ساعة'
      when 'excused' then 'استثناء من غياب'
      else u.b end order by u.o), '{}')
  from unnest(coalesce(p, '{}')) with ordinality u(b, o)
$$;

-- Casual-leave days of a person (pending or approved) that fall between two dates.
create or replace function clinic_people.casual_days(p_person uuid, p_from date, p_to date) returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*)::integer
  from clinic_people.requests r, generate_series(r.from_date, r.to_date, interval '1 day') g(d)
  where r.person_id = p_person and r.kind = 'leave' and r.leave_type = 'casual' and r.status in ('pending', 'approved')
    and g.d::date between p_from and p_to
$$;

create or replace function clinic_people.leave_rules() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  today date := (now() at time zone 'Africa/Cairo')::date;
  days integer := new.to_date - new.from_date + 1;
  brk text[] := '{}';
  d date;
begin
  if new.kind <> 'leave' then new.leave_type := null; return new; end if;
  new.leave_type := coalesce(new.leave_type, 'annual');
  if new.leave_type in ('casual', 'sick', 'birth', 'excused') and new.units <> days then
    raise exception 'عدد أيام الإجازة لازم يساوي أيام الفترة';
  end if;
  if new.leave_type = 'annual' then
    if new.from_date < today then brk := brk || 'retroactive'::text;
    elsif new.from_date - today < clinic_people.leave_notice_days(new.units) then brk := brk || 'short_notice'::text; end if;
  elsif new.leave_type = 'casual' then
    if days > 2 then raise exception 'الإجازة العارضة يومين بالكتير في المرة (قانون العمل م 128)'; end if;
    if clinic_people.casual_days(new.person_id, date_trunc('year', new.from_date)::date,
         (date_trunc('year', new.from_date) + interval '1 year' - interval '1 day')::date) + days > 7 then
      raise exception 'الإجازة العارضة 7 أيام في السنة بالكتير (قانون العمل م 128)';
    end if;
    if new.from_date < today then brk := brk || 'retroactive'::text; end if;
    foreach d in array array[new.from_date, new.to_date] loop
      if clinic_people.casual_days(new.person_id, date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month' - interval '1 day')::date)
           + (select count(*) from generate_series(new.from_date, new.to_date, interval '1 day') g(x) where date_trunc('month', g.x) = date_trunc('month', d)) > 2
         or clinic_people.casual_days(new.person_id, date_trunc('quarter', d)::date, (date_trunc('quarter', d) + interval '3 months' - interval '1 day')::date)
           + (select count(*) from generate_series(new.from_date, new.to_date, interval '1 day') g(x) where date_trunc('quarter', g.x) = date_trunc('quarter', d)) > 3 then
        if not brk @> array['casual_pace'] then brk := brk || 'casual_pace'::text; end if;
      end if;
    end loop;
  elsif new.leave_type = 'sick' then
    if new.from_date < today then brk := brk || 'sick_retroactive'::text; end if;
  elsif new.leave_type = 'birth' then
    if days <> 1 then raise exception 'إجازة ولادة الطفل يوم واحد'; end if;
    if (select count(*) from clinic_people.requests r where r.person_id = new.person_id and r.kind = 'leave' and r.leave_type = 'birth'
          and r.status in ('pending', 'approved')) >= 3 then
      raise exception 'إجازة ولادة الطفل 3 مرات بالكتير طول مدة الخدمة (قانون العمل م 128)';
    end if;
  elsif new.leave_type = 'excused' then
    if not clinic_people.manage() then raise exception 'الاستثناء من الغياب للإدارة'; end if;
    brk := brk || 'excused'::text;
  end if;
  if cardinality(brk) > 0 and length(trim(coalesce(new.notice_reason, ''))) < 3 then
    raise exception 'الطلب خارج القواعد (%). اكتب سبب الاستثناء علشان المراجع يقرر', array_to_string(clinic_people.leave_break_labels(brk), '، ');
  end if;
  new.rule_breaks := brk;
  return new;
end $$;

drop trigger if exists requests_leave_rules on clinic_people.requests;
create trigger requests_leave_rules before insert on clinic_people.requests for each row execute function clinic_people.leave_rules();

-- After a leave is approved: days inside it that were deducted as absences in a salary already sent to finance are
-- refunded through a PENDING bonus adjustment for the current month (another HR reviewer approves it).
create or replace function clinic_people.leave_refund(p_request uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r clinic_people.requests%rowtype; p clinic_people.people%rowtype; amt numeric; v uuid; n integer;
begin
  select * into r from clinic_people.requests where id = p_request;
  select * into p from clinic_people.people where id = r.person_id;
  if r.status <> 'approved' or r.kind <> 'leave' or p.finance_subject is null or r.refund_adjustment_id is not null then return null; end if;
  select coalesce(sum(pr.absence_day), 0), count(*) into amt, n
  from clinic_people.attendance a
  join lateral (select x.absence_day from clinic_people.pay_rules x
                 where x.person_id = a.person_id and x.status = 'approved' and a.day between x.valid_from and x.valid_to
                 order by x.valid_from desc limit 1) pr on true
  where a.person_id = r.person_id and a.status = 'approved' and a.actual_start is null and a.day between r.from_date and r.to_date
    and exists (select 1 from clinic_finance.business_requests b
                 where b.kind = 'payroll' and b.subject = p.finance_subject and b.status in ('pending', 'approved')
                   and (b.payload->>'month')::date = date_trunc('month', a.day)::date);
  if amt <= 0 then return null; end if;
  insert into clinic_people.pay_adjustments(person_id, month, kind, amount, reference, note, created_by)
  values (r.person_id, date_trunc('month', now() at time zone 'Africa/Cairo')::date, 'bonus', round(amt, 2),
          'LEAVE-REFUND-' || r.id,
          'رد خصم غياب ' || n || ' يوم (' || r.from_date || ' — ' || r.to_date || ') بعد اعتماد إجازة؛ مرتب الشهر كان اتبعت للحسابات',
          p_actor)
  returning id into v;
  update clinic_people.requests set refund_adjustment_id = v where id = r.id;
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
  values (p_actor, 'leave_refund', r.id, jsonb_build_object('adjustment_id', v, 'amount', round(amt, 2), 'days', n));
  return v;
end $$;

revoke all on function clinic_people.is_owner_level(), clinic_people.leave_notice_days(numeric), clinic_people.leave_break_labels(text[]),
  clinic_people.casual_days(uuid, date, date), clinic_people.leave_rules(), clinic_people.leave_refund(uuid, uuid) from public, anon, authenticated;

create or replace function public.hr_workspace(p_month date default current_date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();dt date:=date_trunc('month',p_month)::date;begin
 if me is null then raise exception 'سجل الدخول';end if;
 return jsonb_build_object('can_manage',m,'month',dt,'owner_level',clinic_people.is_owner_level(),
 'people',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('leave_balance',coalesce((select sum(case when r.kind='leave_credit' then r.units when r.kind='leave' and r.leave_type in ('annual','casual') then -r.units else 0 end) from clinic_people.requests r where r.person_id=p.id and r.status='approved' and r.from_date>=date_trunc('year',p_month)::date and r.from_date<(date_trunc('year',p_month)+interval '1 year')::date),0)) order by p.full_name),'[]') from clinic_people.people p where m or p.admin_id=me),
 'documents',(select coalesce(jsonb_agg(d order by d.expires_on nulls last),'[]') from clinic_people.documents d where clinic_people.visible(d.person_id)),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('rule_break_labels',clinic_people.leave_break_labels(r.rule_breaks),'certificate_due',case when r.leave_type='sick' then r.created_at+interval '48 hours' end) order by r.created_at desc),'[]') from clinic_people.requests r where clinic_people.visible(r.person_id) and (r.status='pending' or r.from_date between dt and (dt+interval '1 month' - interval '1 day')::date)),
 'attendance',(select coalesce(jsonb_agg(a order by a.day desc),'[]') from clinic_people.attendance a where clinic_people.visible(a.person_id) and a.day between dt and (dt+interval '1 month' - interval '1 day')::date),
 'accounts',case when m then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(name,''),email)) order by name),'[]') from public.admins) else '[]'::jsonb end,
 'doctor_keys',case when m then (select coalesce(jsonb_agg(x),'[]') from(select doctor_key,max(doctor_name) name from clinic_finance.doctor_contracts group by doctor_key)x) else '[]'::jsonb end,
 'employee_keys',case when m then(select coalesce(jsonb_agg(x),'[]') from(select distinct subject,payload->>'employee_name' name from clinic_finance.business_requests where kind='employment' and status='approved')x) else '[]'::jsonb end);
end $$;
create or replace function public.hr_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();pid uuid:=nullif(p_payload->>'person_id','')::uuid;v uuid;oldp clinic_people.people%rowtype;r clinic_people.requests%rowtype;a clinic_people.attendance%rowtype;prior jsonb;afterj jsonb;balance numeric;brk text[];begin
 if me is null then raise exception 'سجل الدخول';end if;
 if p_action='person' then
  if not m then raise exception 'لا تملك إدارة الموارد البشرية';end if;
  v:=nullif(p_payload->>'id','')::uuid;
  if v is not null then select * into oldp from clinic_people.people where id=v for update;if not found or oldp.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'الملف تغير؛ أعد تحميله قبل الحفظ';end if;prior:=to_jsonb(oldp);end if;
  if length(trim(coalesce(p_payload->>'full_name','')))<3 or trim(p_payload->>'full_name') !~ '[[:space:]]' then raise exception 'اكتب الاسم الثنائي على الأقل';end if;
  if nullif(p_payload->>'doctor_key','') is not null and not exists(select 1 from clinic_finance.doctor_contracts where doctor_key=p_payload->>'doctor_key') then raise exception 'اختر كود الطبيب الموجود في الحسابات';end if;
  if nullif(p_payload->>'finance_subject','') is not null and not exists(select 1 from clinic_finance.business_requests where kind='employment' and status='approved' and subject=p_payload->>'finance_subject') then raise exception 'اختر معرف الموظف من عقد الحسابات المعتمد';end if;
  if nullif(p_payload->>'manager_id','') is not null then
   if exists(with recursive chain as(select id,manager_id from clinic_people.people where id=(p_payload->>'manager_id')::uuid union select p.id,p.manager_id from clinic_people.people p join chain c on p.id=c.manager_id) select 1 from chain where id=v) then raise exception 'التبعية الإدارية دائرية';end if;
  end if;
  if v is null then insert into clinic_people.people(full_name,created_by) values(trim(p_payload->>'full_name'),me) returning id into v;end if;
  update clinic_people.people set full_name=trim(p_payload->>'full_name'),admin_id=nullif(p_payload->>'admin_id','')::uuid,phone=coalesce(p_payload->>'phone',''),email=coalesce(p_payload->>'email',''),kind=coalesce(p_payload->>'kind','employee'),doctor_key=nullif(p_payload->>'doctor_key',''),finance_subject=nullif(p_payload->>'finance_subject',''),department=coalesce(p_payload->>'department',''),job_title=coalesce(p_payload->>'job_title',''),branch=coalesce(p_payload->>'branch',''),manager_id=nullif(p_payload->>'manager_id','')::uuid,start_date=nullif(p_payload->>'start_date','')::date,end_date=nullif(p_payload->>'end_date','')::date,birth_date=nullif(p_payload->>'birth_date','')::date,emergency_name=coalesce(p_payload->>'emergency_name',''),emergency_phone=coalesce(p_payload->>'emergency_phone',''),status=coalesce(p_payload->>'status','active'),notes=coalesce(p_payload->>'notes',''),revision=revision+1,updated_at=now() where id=v returning to_jsonb(clinic_people.people.*) into afterj;
 elsif p_action='document' then
  if not m then raise exception 'إضافة المستندات لإدارة الموارد البشرية';end if;
  insert into clinic_people.documents(person_id,title,document_url,expires_on,created_by) values(pid,p_payload->>'title',p_payload->>'document_url',nullif(p_payload->>'expires_on','')::date,me) returning id,to_jsonb(clinic_people.documents.*) into v,afterj;
 elsif p_action='request' then
  if not clinic_people.visible(pid) or not exists(select 1 from clinic_people.people where id=pid and status<>'ended') then raise exception 'ملف الموظف غير متاح';end if;
  if p_payload->>'kind'='leave_credit' and not m then raise exception 'إضافة رصيد الإجازات للموارد البشرية';end if;
  if p_payload->>'kind' in ('leave','leave_credit') and ((p_payload->>'units')::numeric>1+(p_payload->>'to_date')::date-(p_payload->>'from_date')::date or extract(year from (p_payload->>'from_date')::date)<>extract(year from (p_payload->>'to_date')::date)) then raise exception 'راجع عدد أيام الإجازة وسنة الرصيد';end if;
  insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,created_by,leave_type,notice_reason) values(pid,p_payload->>'kind',(p_payload->>'from_date')::date,(p_payload->>'to_date')::date,(p_payload->>'units')::numeric,p_payload->>'note',me,case when p_payload->>'kind'='leave' then coalesce(nullif(p_payload->>'leave_type',''),'annual') end,nullif(trim(coalesce(p_payload->>'notice_reason','')),'')) returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 elsif p_action='request_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into r from clinic_people.requests where id=(p_payload->>'id')::uuid for update;
  if not found or r.status<>'pending' or r.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الطلب يحتاج مراجعًا آخر وسبب القرار';end if;
  perform 1 from clinic_people.people where id=r.person_id for update;
  if p_payload->>'decision'='approved' and r.kind='leave' then
   -- Leave rules (20261116100000): only annual and casual leave use the annual balance (Labor Law 14/2025 art. 128).
   if r.leave_type in ('annual','casual') then
    select coalesce(sum(case when kind='leave_credit' then units when kind='leave' and leave_type in ('annual','casual') then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status='approved' and extract(year from from_date)=extract(year from r.from_date);
    if balance<r.units then raise exception 'رصيد الإجازات لا يكفي؛ راجع الرصيد المعتمد';end if;
   end if;
   -- Out-of-rule requests: the reviewer's reason is the written exception. Sick leave without a certificate within 48 h,
   -- late sick leave and excused absences need an owner-level reviewer (super admin or general manager).
   brk:=r.rule_breaks||case when r.leave_type='sick' and (r.certificate_url is null or r.certificate_at>r.created_at+interval '48 hours') then array['no_certificate'] else '{}'::text[] end;
   if brk&&array['sick_retroactive','no_certificate','excused'] and not clinic_people.is_owner_level() then raise exception 'الطلب ده محتاج اعتماد استثنائي من المدير العام أو السوبر أدمن (%)',array_to_string(clinic_people.leave_break_labels(brk),'، ');end if;
   if exists(select 1 from clinic_people.requests where person_id=r.person_id and kind='leave' and status='approved' and daterange(from_date,to_date,'[]')&&daterange(r.from_date,r.to_date,'[]')) then raise exception 'توجد إجازة متداخلة';end if;
  end if;
  prior:=to_jsonb(r);update clinic_people.requests set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note',exception_by=case when p_payload->>'decision'='approved' and cardinality(coalesce(brk,'{}'))>0 then me end where id=r.id returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
  if p_payload->>'decision'='approved' and r.kind='leave' then perform clinic_people.leave_refund(r.id,me);select to_jsonb(q) into afterj from clinic_people.requests q where q.id=r.id;end if;
 elsif p_action='attendance' then
  if not m then raise exception 'تسجيل الحضور للموارد البشرية';end if;
  insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,created_by) values(pid,(p_payload->>'day')::date,(p_payload->>'scheduled_start')::timestamptz,(p_payload->>'scheduled_end')::timestamptz,nullif(p_payload->>'actual_start','')::timestamptz,nullif(p_payload->>'actual_end','')::timestamptz,coalesce(p_payload->>'note',''),me) returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
 elsif p_action='attendance_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into a from clinic_people.attendance where id=(p_payload->>'id')::uuid for update;
  if not found or a.status<>'pending' or a.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الحضور يحتاج مراجعًا آخر وسبب القرار';end if;
  prior:=to_jsonb(a);update clinic_people.attendance set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=a.id returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
 elsif p_action='sick_certificate' then
  select * into r from clinic_people.requests where id=(p_payload->>'id')::uuid for update;
  if not found or r.kind<>'leave' or r.leave_type<>'sick' or r.status<>'pending' or not clinic_people.visible(r.person_id) then raise exception 'اختر إجازة مرضية قيد المراجعة';end if;
  if coalesce(p_payload->>'certificate_url','') !~ '^https://[^[:space:]]{8,}$' then raise exception 'الصق رابط الشهادة الطبية (يبدأ بـ https://)';end if;
  prior:=to_jsonb(r);update clinic_people.requests set certificate_url=p_payload->>'certificate_url',certificate_at=now() where id=r.id returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_people.audit(actor_id,action,record_id,before_data,after_data) values(me,p_action,v,prior,afterj);return v;
end $$;
create or replace function public.hr_attendance_from_punches(p_month date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  dt date := date_trunc('month', p_month)::date;
  upto date;
  v_rows jsonb; v_import uuid; v_existing integer; v_incomplete integer; v_unmapped jsonb; v_absent integer; v_late integer;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if p_month is null then raise exception 'اختر الشهر'; end if;
  upto := least((dt + interval '1 month' - interval '1 day')::date, today - 1);
  if upto < dt then raise exception 'لا توجد أيام مكتملة في هذا الشهر بعد'; end if;

  with ev as (
    select g.d::date as day, e.*
    from generate_series(dt, upto, interval '1 day') g(d), lateral clinic_people.attendance_eval(g.d::date, now()) e),
  x as (
    select ev.*,
      (select max(d.ts) from clinic_people.device_punches d
         join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
        where m.person_id = ev.person_id and d.punch in (1, 5) and ev.first_in is not null
          and d.ts > ev.first_in and d.ts <= ev.exp_end + interval '6 hours') as last_out,
      exists (select 1 from clinic_people.attendance a where a.person_id = ev.person_id and a.day = ev.day) as has_row,
      -- sick leave reported but not decided yet: wait while its certificate is still due (48 h), then it is an absence
      (select bool_or(q.created_at + interval '48 hours' > now()) from clinic_people.requests q
        where q.person_id = ev.person_id and q.kind = 'leave' and q.leave_type = 'sick' and q.status = 'pending'
          and ev.day between q.from_date and q.to_date) as sick_wait
    from ev),
  todo as (
    select x.*,
      case when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start
    from x
    where not x.has_row and x.status in ('on_time', 'late', 'absent') and not (x.status = 'absent' and x.excused)
      and not (x.status = 'absent' and x.sick_wait is true))
  select
    (select jsonb_agg(jsonb_build_object(
        'person_id', t.person_id, 'day', t.day, 'scheduled_start', t.exp_start, 'scheduled_end', t.exp_end,
        'actual_start', t.a_start,
        'actual_end', case when t.a_start is null then null
                           when t.last_out is not null and t.last_out > t.a_start then t.last_out
                           else greatest(t.exp_end, t.a_start + interval '1 minute') end,
        'note', 'بصمة' || case when t.status = 'absent' and t.sick_wait is false then ' — غياب: إجازة مرضية بدون شهادة طبية خلال 48 ساعة'
                               when t.status = 'absent' then ' — غياب بدون بصمة حضور'
                               when t.last_out is null or t.last_out <= t.a_start then ' — خروج غير مسجل: اعتُبر نهاية الوردية'
                               else '' end
                        || case when t.excused then ' — إذن معتمد' else '' end)
        order by t.day, t.person_id) from todo t),
    (select count(*) from x where x.has_row),
    (select count(*) from todo t where t.a_start is not null and (t.last_out is null or t.last_out <= t.a_start)),
    (select count(*) from todo t where t.status = 'absent'),
    (select count(*) from todo t where t.status = 'late' and not t.excused),
    (select coalesce(jsonb_agg(distinct p.full_name), '[]'::jsonb) from x join clinic_people.people p on p.id = x.person_id where x.status = 'unmapped')
  into v_rows, v_existing, v_incomplete, v_absent, v_late, v_unmapped;

  if v_rows is not null then
    v_import := public.hr_payroll_command('import_attendance', jsonb_build_object(
      'filename', 'بصمات ' || to_char(dt, 'YYYY-MM') || ' حتى ' || upto,
      'checksum', 'punches-' || md5(v_rows::text),
      'rows', v_rows));
  end if;

  return jsonb_build_object('month', dt, 'through', upto, 'import_id', v_import,
    'created', coalesce(jsonb_array_length(v_rows), 0), 'already_recorded', v_existing,
    'absent', v_absent, 'late', v_late, 'missing_exit', v_incomplete, 'unmapped', v_unmapped);
end $$;


commit;
