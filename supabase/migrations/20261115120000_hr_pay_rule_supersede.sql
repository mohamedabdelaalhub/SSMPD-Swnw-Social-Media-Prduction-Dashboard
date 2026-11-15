-- HR pay rules: a reviewed replacement can supersede an approved rule (owner request 2026-11-15).
-- Approved rules could not be changed or ended, so a corrected rule (e.g. turning on «حد أدنى مضمون» for a rule
-- approved before that option existed) was blocked by the overlap guard. Now a new PENDING rule may name the approved
-- rule it replaces; only when a different reviewer approves it, the old rule is shortened to the day before the new one
-- starts, or marked 'superseded' when the new one starts on/before it. Audited in clinic_people.audit. Nothing else changes.
begin;
alter table clinic_people.pay_rules add column if not exists supersedes uuid references clinic_people.pay_rules(id);
alter table clinic_people.pay_rules drop constraint if exists pay_rules_status_check;
alter table clinic_people.pay_rules add constraint pay_rules_status_check check (status in ('pending','approved','rejected','superseded'));

create or replace function public.hr_payroll_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();v uuid:=nullif(p_payload->>'id','')::uuid;r clinic_people.pay_rules%rowtype;a clinic_people.pay_adjustments%rowtype;rowj jsonb;person clinic_people.people%rowtype;am numeric;import_row clinic_people.imports%rowtype;att clinic_people.attendance%rowtype;temp uuid;old clinic_people.pay_rules%rowtype;begin
 if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 perform pg_advisory_xact_lock(712241025);
 if p_action='rule' then
   if nullif(p_payload->>'supersedes','') is not null and not exists(select 1 from clinic_people.pay_rules x where x.id=(p_payload->>'supersedes')::uuid and x.status='approved' and x.person_id=(p_payload->>'person_id')::uuid) then raise exception 'القاعدة المستبدلة يجب أن تكون معتمدة ولنفس الموظف';end if;
  insert into clinic_people.pay_rules(supersedes,guaranteed_minimum,person_id,valid_from,valid_to,late_grace,late_minute,absence_day,overtime_hour,note,created_by) values(nullif(p_payload->>'supersedes','')::uuid,coalesce((p_payload->>'guaranteed_minimum')::boolean,false),(p_payload->>'person_id')::uuid,(p_payload->>'valid_from')::date,(p_payload->>'valid_to')::date,coalesce((p_payload->>'late_grace')::int,0),coalesce((p_payload->>'late_minute')::numeric,0),coalesce((p_payload->>'absence_day')::numeric,0),coalesce((p_payload->>'overtime_hour')::numeric,0),p_payload->>'note',me) returning id into v;
 elsif p_action='rule_review' then
  select * into r from clinic_people.pay_rules where id=v for update;
  if not found or r.status<>'pending' or r.created_by=me then raise exception 'تحتاج قاعدة معلقة ومراجعًا آخر';end if;
  if coalesce(p_payload->>'decision','') not in ('approved','rejected') or length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'اكتب القرار وسببه';end if;
  -- A reviewed replacement ends the approved rule it supersedes: shortened to the day before, or marked superseded
  -- when the replacement starts on/before it. Same reviewer, same transaction, audited.
  if p_payload->>'decision'='approved' and r.supersedes is not null then
   select * into old from clinic_people.pay_rules where id=r.supersedes for update;
   if not found or old.status<>'approved' or old.person_id<>r.person_id then raise exception 'القاعدة المستبدلة لم تعد معتمدة؛ أعد إنشاء القاعدة';end if;
   if r.valid_from<=old.valid_from then update clinic_people.pay_rules set status='superseded' where id=old.id;
   else update clinic_people.pay_rules set valid_to=least(old.valid_to,r.valid_from-1) where id=old.id;end if;
   insert into clinic_people.audit(actor_id,action,record_id,before_data,after_data) values(me,'rule_superseded',old.id,to_jsonb(old),(select to_jsonb(x) from clinic_people.pay_rules x where x.id=old.id));
  end if;
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
commit;
