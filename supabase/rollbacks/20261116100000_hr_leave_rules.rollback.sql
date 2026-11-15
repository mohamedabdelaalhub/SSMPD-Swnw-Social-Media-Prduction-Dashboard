-- Rollback of 20261116100000_hr_leave_rules.sql: restores hr_workspace / hr_command (20261024162604) and
-- hr_attendance_from_punches (20261115130000), drops the leave-rule trigger, helpers and columns.
-- Refund adjustments already created stay (they are normal pay adjustments with their own review).
begin;
drop trigger if exists requests_leave_rules on clinic_people.requests;
create or replace function public.hr_workspace(p_month date default current_date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();dt date:=date_trunc('month',p_month)::date;begin
 if me is null then raise exception 'سجل الدخول';end if;
 return jsonb_build_object('can_manage',m,'month',dt,
 'people',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('leave_balance',coalesce((select sum(case when r.kind='leave_credit' then r.units when r.kind='leave' then -r.units else 0 end) from clinic_people.requests r where r.person_id=p.id and r.status='approved' and r.from_date>=date_trunc('year',p_month)::date and r.from_date<(date_trunc('year',p_month)+interval '1 year')::date),0)) order by p.full_name),'[]') from clinic_people.people p where m or p.admin_id=me),
 'documents',(select coalesce(jsonb_agg(d order by d.expires_on nulls last),'[]') from clinic_people.documents d where clinic_people.visible(d.person_id)),
 'requests',(select coalesce(jsonb_agg(r order by r.created_at desc),'[]') from clinic_people.requests r where clinic_people.visible(r.person_id) and (r.status='pending' or r.from_date between dt and (dt+interval '1 month' - interval '1 day')::date)),
 'attendance',(select coalesce(jsonb_agg(a order by a.day desc),'[]') from clinic_people.attendance a where clinic_people.visible(a.person_id) and a.day between dt and (dt+interval '1 month' - interval '1 day')::date),
 'accounts',case when m then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(name,''),email)) order by name),'[]') from public.admins) else '[]'::jsonb end,
 'doctor_keys',case when m then (select coalesce(jsonb_agg(x),'[]') from(select doctor_key,max(doctor_name) name from clinic_finance.doctor_contracts group by doctor_key)x) else '[]'::jsonb end,
 'employee_keys',case when m then(select coalesce(jsonb_agg(x),'[]') from(select distinct subject,payload->>'employee_name' name from clinic_finance.business_requests where kind='employment' and status='approved')x) else '[]'::jsonb end);
end $$;
create or replace function public.hr_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();pid uuid:=nullif(p_payload->>'person_id','')::uuid;v uuid;oldp clinic_people.people%rowtype;r clinic_people.requests%rowtype;a clinic_people.attendance%rowtype;prior jsonb;afterj jsonb;balance numeric;begin
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
  insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,created_by) values(pid,p_payload->>'kind',(p_payload->>'from_date')::date,(p_payload->>'to_date')::date,(p_payload->>'units')::numeric,p_payload->>'note',me) returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 elsif p_action='request_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into r from clinic_people.requests where id=(p_payload->>'id')::uuid for update;
  if not found or r.status<>'pending' or r.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الطلب يحتاج مراجعًا آخر وسبب القرار';end if;
  perform 1 from clinic_people.people where id=r.person_id for update;
  if p_payload->>'decision'='approved' and r.kind='leave' then
   select coalesce(sum(case when kind='leave_credit' then units when kind='leave' then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status='approved' and extract(year from from_date)=extract(year from r.from_date);
   if balance<r.units then raise exception 'رصيد الإجازات لا يكفي؛ راجع الرصيد المعتمد';end if;
   if exists(select 1 from clinic_people.requests where person_id=r.person_id and kind='leave' and status='approved' and daterange(from_date,to_date,'[]')&&daterange(r.from_date,r.to_date,'[]')) then raise exception 'توجد إجازة متداخلة';end if;
  end if;
  prior:=to_jsonb(r);update clinic_people.requests set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=r.id returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 elsif p_action='attendance' then
  if not m then raise exception 'تسجيل الحضور للموارد البشرية';end if;
  insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,created_by) values(pid,(p_payload->>'day')::date,(p_payload->>'scheduled_start')::timestamptz,(p_payload->>'scheduled_end')::timestamptz,nullif(p_payload->>'actual_start','')::timestamptz,nullif(p_payload->>'actual_end','')::timestamptz,coalesce(p_payload->>'note',''),me) returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
 elsif p_action='attendance_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into a from clinic_people.attendance where id=(p_payload->>'id')::uuid for update;
  if not found or a.status<>'pending' or a.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الحضور يحتاج مراجعًا آخر وسبب القرار';end if;
  prior:=to_jsonb(a);update clinic_people.attendance set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=a.id returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
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
      exists (select 1 from clinic_people.attendance a where a.person_id = ev.person_id and a.day = ev.day) as has_row
    from ev),
  todo as (
    select x.*,
      case when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start
    from x
    where not x.has_row and x.status in ('on_time', 'late', 'absent') and not (x.status = 'absent' and x.excused))
  select
    (select jsonb_agg(jsonb_build_object(
        'person_id', t.person_id, 'day', t.day, 'scheduled_start', t.exp_start, 'scheduled_end', t.exp_end,
        'actual_start', t.a_start,
        'actual_end', case when t.a_start is null then null
                           when t.last_out is not null and t.last_out > t.a_start then t.last_out
                           else greatest(t.exp_end, t.a_start + interval '1 minute') end,
        'note', 'بصمة' || case when t.status = 'absent' then ' — غياب بدون بصمة حضور'
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


drop function if exists clinic_people.leave_rules();
drop function if exists clinic_people.leave_refund(uuid, uuid);
drop function if exists clinic_people.casual_days(uuid, date, date);
drop function if exists clinic_people.leave_break_labels(text[]);
drop function if exists clinic_people.leave_notice_days(numeric);
drop function if exists clinic_people.is_owner_level();
alter table clinic_people.requests drop constraint if exists requests_leave_type_kind;
alter table clinic_people.requests drop column if exists refund_adjustment_id, drop column if exists exception_by,
  drop column if exists certificate_at, drop column if exists certificate_url, drop column if exists notice_reason,
  drop column if exists rule_breaks, drop column if exists leave_type;
commit;
