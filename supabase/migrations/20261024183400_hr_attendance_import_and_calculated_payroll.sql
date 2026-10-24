begin;
create table clinic_people.imports(id uuid primary key default gen_random_uuid(),checksum text not null unique,filename text not null,rows_count integer not null,created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
alter table clinic_people.attendance add column source_import_id uuid references clinic_people.imports(id);
create table clinic_people.pay_rules(id uuid primary key default gen_random_uuid(),person_id uuid not null references clinic_people.people(id),valid_from date not null,valid_to date not null,late_grace integer not null default 0 check(late_grace between 0 and 180),late_minute numeric(10,4) not null default 0 check(late_minute>=0 and late_minute::text not in ('NaN','Infinity')),absence_day numeric(14,2) not null default 0 check(absence_day>=0 and absence_day::text not in ('NaN','Infinity')),overtime_hour numeric(14,2) not null default 0 check(overtime_hour>=0 and overtime_hour::text not in ('NaN','Infinity')),note text not null check(length(trim(note))>=3),status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,check(valid_to>=valid_from));
create table clinic_people.pay_adjustments(id uuid primary key default gen_random_uuid(),person_id uuid not null references clinic_people.people(id),month date not null check(month=date_trunc('month',month)::date),kind text not null check(kind in ('bonus','deduction','commission')),amount numeric(14,2) not null check(amount>0 and amount::text not in ('NaN','Infinity')),service_id uuid references public.pricing_services(id),basis_amount numeric(14,2),percent numeric(7,4),reference text not null unique,note text not null check(length(trim(note))>=3),status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text);
create index hr_adjustment_month on clinic_people.pay_adjustments(person_id,month,status);
create index hr_rules_person on clinic_people.pay_rules(person_id,status,valid_from,valid_to);
create table clinic_people.device_settings(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('attendance','pos')),name text not null,model text not null,branch text not null default '',note text not null default '',status text not null default 'awaiting_provider' check(status='awaiting_provider'),created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
alter table clinic_people.imports enable row level security;
alter table clinic_people.pay_rules enable row level security;
alter table clinic_people.pay_adjustments enable row level security;
alter table clinic_people.device_settings enable row level security;
create function public.hr_payroll_workspace(p_month date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare dt date:=date_trunc('month',p_month)::date;begin
 if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 return jsonb_build_object('rules',(select coalesce(jsonb_agg(r),'[]') from clinic_people.pay_rules r),'adjustments',(select coalesce(jsonb_agg(a),'[]') from clinic_people.pay_adjustments a where month=dt),'devices',(select coalesce(jsonb_agg(d),'[]') from clinic_people.device_settings d),'imports',(select coalesce(jsonb_agg(x),'[]') from(select * from clinic_people.imports order by created_at desc limit 30)x),'services',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',canonical_code)),'[]') from public.pricing_services where active));end $$;
create function public.hr_payroll_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();v uuid:=nullif(p_payload->>'id','')::uuid;r clinic_people.pay_rules%rowtype;a clinic_people.pay_adjustments%rowtype;rowj jsonb;person clinic_people.people%rowtype;am numeric;import_row clinic_people.imports%rowtype;att clinic_people.attendance%rowtype;temp uuid;begin
 if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 perform pg_advisory_xact_lock(712241025);
 if p_action='rule' then
  insert into clinic_people.pay_rules(person_id,valid_from,valid_to,late_grace,late_minute,absence_day,overtime_hour,note,created_by) values((p_payload->>'person_id')::uuid,(p_payload->>'valid_from')::date,(p_payload->>'valid_to')::date,coalesce((p_payload->>'late_grace')::int,0),coalesce((p_payload->>'late_minute')::numeric,0),coalesce((p_payload->>'absence_day')::numeric,0),coalesce((p_payload->>'overtime_hour')::numeric,0),p_payload->>'note',me) returning id into v;
 elsif p_action='rule_review' then
  select * into r from clinic_people.pay_rules where id=v for update;
  if not found or r.status<>'pending' or r.created_by=me then raise exception 'تحتاج قاعدة معلقة ومراجعًا آخر';end if;
  if p_payload->>'decision'='approved' and exists(select 1 from clinic_people.pay_rules where person_id=r.person_id and status='approved' and daterange(valid_from,valid_to,'[]')&&daterange(r.valid_from,r.valid_to,'[]')) then raise exception 'توجد قواعد أجر متداخلة؛ راجع فترات السريان';end if;
  if coalesce(p_payload->>'decision','') not in ('approved','rejected') or length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'اكتب القرار وسببه';end if;
  update clinic_people.pay_rules set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=v;
 elsif p_action='adjustment' then
  select * into person from clinic_people.people where id=(p_payload->>'person_id')::uuid and status<>'ended';if not found then raise exception 'اختر موظفًا مستمرًا';end if;
  am:=(p_payload->>'amount')::numeric;
  if p_payload->>'kind'='commission' then
   if person.doctor_key is not null then raise exception 'نسب الطبيب تصرف من مستحقات الأطباء لمنع ازدواجها بالمرتب';end if;
   if not exists(select 1 from public.pricing_services where id=(p_payload->>'service_id')::uuid and active) or (p_payload->>'percent')::numeric not between 0.0001 and 100 or (p_payload->>'basis_amount')::numeric<=0 then raise exception 'أكمل الخدمة وقيمة الأساس والنسبة';end if;
   am:=round((p_payload->>'basis_amount')::numeric*(p_payload->>'percent')::numeric/100,2);
  end if;
  insert into clinic_people.pay_adjustments(person_id,month,kind,amount,service_id,basis_amount,percent,reference,note,created_by) values(person.id,(p_payload->>'month')::date,p_payload->>'kind',am,nullif(p_payload->>'service_id','')::uuid,nullif(p_payload->>'basis_amount','')::numeric,nullif(p_payload->>'percent','')::numeric,trim(p_payload->>'reference'),p_payload->>'note',me) returning id into v;
 elsif p_action='adjustment_review' then
  select * into a from clinic_people.pay_adjustments where id=v for update;
  if not found or a.status<>'pending' or a.created_by=me or coalesce(p_payload->>'decision','') not in ('approved','rejected') or length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'تحتاج بندًا معلقًا ومراجعًا آخر وسبب القرار';end if;
  update clinic_people.pay_adjustments set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=v;
 elsif p_action='attendance_import_review' then
  select * into import_row from clinic_people.imports where id=v for update;
  if not found or import_row.created_by=me then raise exception 'يلزم ملف حضور ومراجع آخر';end if;
  for att in select * from clinic_people.attendance where source_import_id=v and status='pending' for update loop perform public.hr_command('attendance_review',jsonb_build_object('id',att.id,'decision',p_payload->>'decision','review_note',p_payload->>'review_note'));end loop;
 elsif p_action='import_adjustments' then
  if jsonb_typeof(p_payload->'rows')<>'array' or jsonb_array_length(p_payload->'rows') not between 1 and 5000 or coalesce(length(p_payload->>'checksum'),0)<10 then raise exception 'راجع ملف البنود';end if;
  insert into clinic_people.imports(checksum,filename,rows_count,created_by) values(p_payload->>'checksum',p_payload->>'filename',jsonb_array_length(p_payload->'rows'),me) returning id into v;
  for rowj in select * from jsonb_array_elements(p_payload->'rows') loop perform public.hr_payroll_command('adjustment',rowj);end loop;
 elsif p_action='import_attendance' then
  if jsonb_typeof(p_payload->'rows')<>'array' or jsonb_array_length(p_payload->'rows') not between 1 and 5000 or coalesce(length(p_payload->>'checksum'),0)<10 then raise exception 'راجع عدد السطور وبصمة الملف';end if;
  insert into clinic_people.imports(checksum,filename,rows_count,created_by) values(p_payload->>'checksum',p_payload->>'filename',jsonb_array_length(p_payload->'rows'),me) returning id into v;
  for rowj in select * from jsonb_array_elements(p_payload->'rows') loop
   if not exists(select 1 from clinic_people.people where id=(rowj->>'person_id')::uuid and status<>'ended') then raise exception 'موظف غير معروف في ملف الحضور';end if;
   temp:=public.hr_command('attendance',rowj||jsonb_build_object('note','استيراد '||(p_payload->>'filename')||' / '||coalesce(rowj->>'note','')));
   update clinic_people.attendance set source_import_id=v where id=temp;
  end loop;
 elsif p_action='device' then
  insert into clinic_people.device_settings(kind,name,model,branch,note,created_by) values(p_payload->>'kind',p_payload->>'name',p_payload->>'model',coalesce(p_payload->>'branch',''),coalesce(p_payload->>'note',''),me) returning id into v;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_people.audit(actor_id,action,record_id,after_data) values(me,p_action,v,jsonb_build_object('id',v,'source','payroll_workspace'));return v;
end $$;
-- Attendance affects a reviewed payroll request, never a payment directly.
create function public.hr_payroll_calculate(p_person uuid,p_month date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p clinic_people.people%rowtype;r clinic_people.pay_rules%rowtype;c clinic_finance.business_requests%rowtype;dt date:=date_trunc('month',p_month)::date;last_day date:=(dt+interval '1 month'-interval '1 day')::date;late numeric;absent int;extra numeric;bonus numeric;ded numeric;comm numeric;n int;begin
 if not clinic_people.manage() or not clinic_finance.allowed('create') then raise exception 'تحتاج إدارة الموارد البشرية وصلاحية إنشاء استحقاق بالحسابات';end if;
 select * into p from clinic_people.people where id=p_person and status<>'ended';if not found or p.finance_subject is null then raise exception 'اربط الموظف بعقد المرتب أولًا';end if;
 select * into c from clinic_finance.business_requests where kind='employment' and status='approved' and subject=p.finance_subject and dt>=(payload->>'from')::date and last_day<=(payload->>'to')::date;
 if not found then raise exception 'يلزم عقد موظف معتمد يغطي الشهر بالكامل';end if;
 select * into r from clinic_people.pay_rules where person_id=p.id and status='approved' and dt>=valid_from and last_day<=valid_to;
 if not found then raise exception 'اعتمد قواعد أجر تغطي الشهر بالكامل';end if;
 if exists(select 1 from clinic_people.attendance where person_id=p.id and day between dt and last_day and (status='pending' or status='approved' and actual_start is not null and actual_end is null)) then raise exception 'راجع الحضور المعلق أو بصمات الخروج الناقصة أولًا';end if;
 select count(*),coalesce(sum(case when actual_start is not null then greatest(0,extract(epoch from(actual_start-scheduled_start))/60-r.late_grace) else 0 end),0),count(*) filter(where actual_start is null and not exists(select 1 from clinic_people.requests q where q.person_id=p.id and q.status='approved' and q.kind='leave' and clinic_people.attendance.day between q.from_date and q.to_date)),coalesce(sum(case when actual_end is not null then greatest(0,extract(epoch from(actual_end-scheduled_end))/3600) else 0 end),0) into n,late,absent,extra from clinic_people.attendance where person_id=p.id and day between dt and last_day and status='approved';
 if n=0 then raise exception 'لا يوجد جدول ورديات وحضور معتمد للشهر';end if;
 select coalesce(sum(amount) filter(where kind='bonus'),0),coalesce(sum(amount) filter(where kind='deduction'),0),coalesce(sum(amount) filter(where kind='commission'),0) into bonus,ded,comm from clinic_people.pay_adjustments where person_id=p.id and month=dt and status='approved';
 if exists(select 1 from clinic_people.pay_adjustments where person_id=p.id and month=dt and status='pending') then raise exception 'راجع المكافآت والخصومات والنسب المعلقة أولًا';end if;
 return jsonb_build_object('person_id',p.id,'subject',p.finance_subject,'contract_id',c.id,'month',dt,'base',c.amount,'rule_id',r.id,'approved_shifts',n,'late_minutes',round(late,2),'absent_shifts',absent,'overtime_hours',round(extra,2),'bonus',bonus,'commission',comm,'allowance',round(bonus+comm+extra*r.overtime_hour,2),'salary_deduction',round(ded+late*r.late_minute+absent*r.absence_day,2),'pre_tax_net',round(c.amount+bonus+comm+extra*r.overtime_hour-ded-late*r.late_minute-absent*r.absence_day,2),'scope','المحاسبة تشمل الورديات المسجلة والمعتمدة فقط؛ راجع اكتمال جدول الشهر','doctor_commission_separate',p.doctor_key is not null);
end $$;
-- Preserve all previous financial wrappers and their guards.
alter function public.clinic_finance_business_command(text,jsonb,uuid) set schema clinic_people;
alter function clinic_people.clinic_finance_business_command(text,jsonb,uuid) rename to finance_business_v1;
create function public.clinic_finance_business_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;r clinic_finance.business_requests%rowtype;c clinic_finance.business_requests%rowtype;ded numeric:=0;begin
 if p_action='request' and p_payload->>'kind'='payroll' then
  ded:=coalesce((p_payload->>'salary_deduction')::numeric,0);
  if ded<0 or ded::text in ('NaN','Infinity','-Infinity') or ded<>round(ded,2) then raise exception 'خصم مرتب غير صالح';end if;
  select * into c from clinic_finance.business_requests where id=(p_payload->>'contract_id')::uuid;
  if ded+coalesce((p_payload->>'tax')::numeric,0)+coalesce((p_payload->>'insurance')::numeric,0)+coalesce((p_payload->>'recovery')::numeric,0)>c.amount+coalesce((p_payload->>'allowance')::numeric,0) then raise exception 'الاستقطاعات تتجاوز إجمالي المرتب';end if;
 end if;
 if p_action='review' then
  perform clinic_finance.require_access('review');perform clinic_finance.lock_day();
  select * into r from clinic_finance.business_requests where id=(p_payload->>'id')::uuid for update;
 end if;
 v:=clinic_people.finance_business_v1(p_action,p_payload,p_token);
 if p_action='review' and r.kind='payroll' and r.status='pending' and coalesce((p_payload->>'approve')::boolean,false) then
  ded:=coalesce((r.payload->>'salary_deduction')::numeric,0);
  if ded>0 then perform clinic_finance.post('payroll_attendance_deduction',v,'استقطاع مرتب موثق '||r.subject,null,'2131','5211',ded);end if;
 end if;return v;
end $$;
create or replace function clinic_finance.employee_due(p_subject text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select sum(case when kind='payroll' then amount-coalesce((payload->>'tax')::numeric,0)-coalesce((payload->>'insurance')::numeric,0)-coalesce((payload->>'recovery')::numeric,0)-coalesce((payload->>'salary_deduction')::numeric,0) when kind='salary_payment' then -amount else 0 end) from clinic_finance.business_requests where subject=p_subject and status='approved'),0)+coalesce((select sum(credit-debit) from clinic_finance.opening_details where account='2131' and subject=p_subject),0)$$;
create function public.hr_payroll_prepare(p_person uuid,p_month date,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare calc jsonb;begin
 perform pg_advisory_xact_lock(712241025);calc:=public.hr_payroll_calculate(p_person,p_month);
 return public.clinic_finance_business_command('request',jsonb_build_object('kind','payroll','subject',calc->>'subject','contract_id',calc->>'contract_id','month',calc->>'month','allowance',calc->'allowance','salary_deduction',calc->'salary_deduction','tax',coalesce(p_payload->'tax','0'),'insurance',coalesce(p_payload->'insurance','0'),'recovery',coalesce(p_payload->'recovery','0'),'reference',p_payload->>'reference','note',p_payload->>'note','hr_calculation',calc),p_token);end $$;
revoke all on all tables in schema clinic_people from public,anon,authenticated;
revoke all on all functions in schema clinic_people from public,anon,authenticated;
revoke all on function public.hr_payroll_workspace(date),public.hr_payroll_command(text,jsonb),public.hr_payroll_calculate(uuid,date),public.hr_payroll_prepare(uuid,date,jsonb,uuid),public.clinic_finance_business_command(text,jsonb,uuid) from public,anon;
grant execute on function public.hr_payroll_workspace(date),public.hr_payroll_command(text,jsonb),public.hr_payroll_calculate(uuid,date),public.hr_payroll_prepare(uuid,date,jsonb,uuid),public.clinic_finance_business_command(text,jsonb,uuid) to authenticated;
commit;
