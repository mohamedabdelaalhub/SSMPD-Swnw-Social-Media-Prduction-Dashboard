-- HR payroll: optional «حد أدنى مضمون» (guaranteed minimum) per pay rule.
-- Owner decision 2026-11-15: some specialists (e.g. aesthetics, speech therapy) get a monthly salary OR their commission,
-- whichever is higher — never both. The flag lives on the pay rule, so it goes through the same four-eyes review.
-- Doctor-ledger fees stay paid by the doctor ledger; payroll reduces the salary by the commission earned in the month,
-- so salary + commission = max(salary, commission). Without the flag nothing changes.
begin;
alter table clinic_people.pay_rules add column if not exists guaranteed_minimum boolean not null default false;

create or replace function public.hr_payroll_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();v uuid:=nullif(p_payload->>'id','')::uuid;r clinic_people.pay_rules%rowtype;a clinic_people.pay_adjustments%rowtype;rowj jsonb;person clinic_people.people%rowtype;am numeric;import_row clinic_people.imports%rowtype;att clinic_people.attendance%rowtype;temp uuid;begin
 if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 perform pg_advisory_xact_lock(712241025);
 if p_action='rule' then
  insert into clinic_people.pay_rules(guaranteed_minimum,person_id,valid_from,valid_to,late_grace,late_minute,absence_day,overtime_hour,note,created_by) values(coalesce((p_payload->>'guaranteed_minimum')::boolean,false),(p_payload->>'person_id')::uuid,(p_payload->>'valid_from')::date,(p_payload->>'valid_to')::date,coalesce((p_payload->>'late_grace')::int,0),coalesce((p_payload->>'late_minute')::numeric,0),coalesce((p_payload->>'absence_day')::numeric,0),coalesce((p_payload->>'overtime_hour')::numeric,0),p_payload->>'note',me) returning id into v;
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

create or replace function public.hr_payroll_calculate(p_person uuid,p_month date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p clinic_people.people%rowtype;r clinic_people.pay_rules%rowtype;c clinic_finance.business_requests%rowtype;dt date:=date_trunc('month',p_month)::date;last_day date:=(dt+interval '1 month'-interval '1 day')::date;late numeric;absent int;extra numeric;bonus numeric;ded numeric;comm numeric;n int;dc numeric:=0;gross numeric;offs numeric:=0;dedu numeric;begin
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
 -- Guaranteed minimum (owner decision 2026-11-15): the person receives the HIGHER of the contract salary and the commission
 -- earned in the month (doctor-ledger fees on invoices of the month + approved employee commission adjustments), never the sum.
 -- The doctor ledger keeps paying its fees; payroll pays only what is left of the salary: offset = least(commission, base).
 if r.guaranteed_minimum then
  if p.doctor_key is not null then
   select coalesce(sum(x.delta),0) into dc from clinic_finance.doctor_accruals x join clinic_finance.invoices i on i.id=x.invoice_id
    where x.doctor_key=p.doctor_key and (i.created_at at time zone 'Africa/Cairo')::date between dt and last_day;
  end if;
  offs:=round(least(greatest(dc,0)+comm,c.amount),2);
 end if;
 gross:=round(c.amount+bonus+comm+extra*r.overtime_hour,2);
 dedu:=least(round(ded+late*r.late_minute+absent*r.absence_day+offs,2),gross);
 return jsonb_build_object('person_id',p.id,'subject',p.finance_subject,'contract_id',c.id,'month',dt,'base',c.amount,'rule_id',r.id,'approved_shifts',n,'late_minutes',round(late,2),'absent_shifts',absent,'overtime_hours',round(extra,2),'bonus',bonus,'commission',comm,'allowance',round(bonus+comm+extra*r.overtime_hour,2),'salary_deduction',dedu,'pre_tax_net',gross-dedu,'guaranteed_minimum',r.guaranteed_minimum,'doctor_commission',round(dc,2),'guarantee_offset',offs,'scope','المحاسبة تشمل الورديات المسجلة والمعتمدة فقط؛ راجع اكتمال جدول الشهر','doctor_commission_separate',p.doctor_key is not null);
end $$;
commit;
