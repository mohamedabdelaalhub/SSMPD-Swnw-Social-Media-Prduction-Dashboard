-- Rollback of 20261117020000_hr_unpaid_leave_balance.sql: reverse the in-place patches; drop the two helpers.
-- (leave_break_labels keeps the extra 'over_balance' label; harmless.)
begin;
do $$ declare def text; patched text; g text := 'unpaid leave balance 20261117020000';
begin
  def := pg_get_functiondef('public.hr_command(text,jsonb)'::regprocedure);
  patched := replace(def,
'   -- ' || g || ': every leave type except excused uses one yearly unpaid balance; over it → owner-level only.
   if r.leave_type<>''excused'' then
    select clinic_people.leave_allowance(extract(year from r.from_date)::int)+coalesce(sum(case when kind=''leave_credit'' then units when kind=''leave'' and leave_type<>''excused'' then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status=''approved'' and extract(year from from_date)=extract(year from r.from_date);
    if balance<r.units and not clinic_people.is_owner_level() then raise exception ''الطلب أكتر من رصيد الأجازات (المتاح % يوم)؛ محتاج اعتماد المدير العام أو السوبر أدمن'',greatest(balance,0);end if;
   end if;',
'   if r.leave_type in (''annual'',''casual'') then
    select coalesce(sum(case when kind=''leave_credit'' then units when kind=''leave'' and leave_type in (''annual'',''casual'') then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status=''approved'' and extract(year from from_date)=extract(year from r.from_date);
    if balance<r.units then raise exception ''رصيد الإجازات لا يكفي؛ راجع الرصيد المعتمد'';end if;
   end if;');
  patched := replace(patched, '||case when r.leave_type<>''excused'' and balance<r.units then array[''over_balance''] else ''{}''::text[] end;', ';');
  if position(g in patched) > 0 then raise exception 'تعذر الرجوع في hr_command'; end if;
  execute patched;

  def := pg_get_functiondef('public.hr_workspace(date)'::regprocedure);
  patched := replace(def, 'when r.kind=''leave'' and r.leave_type<>''excused'' then -r.units else 0 end)', 'when r.kind=''leave'' and r.leave_type in (''annual'',''casual'') then -r.units else 0 end)');
  patched := replace(patched, '+clinic_people.leave_allowance(extract(year from p_month)::int) /* ' || g || ' */', '');
  if position(g in patched) > 0 then raise exception 'تعذر الرجوع في hr_workspace'; end if;
  execute patched;

  def := pg_get_functiondef('public.hr_payroll_calculate(uuid,date)'::regprocedure);
  patched := replace(def, 'dedu numeric;unpaid numeric:=0;begin', 'dedu numeric;begin');
  patched := replace(patched,
' -- ' || g || ': approved leave (not excused) is unpaid: one day''s wage per leave day, closures excluded.
 select coalesce(sum(q.units/(q.to_date-q.from_date+1)::numeric*(select count(*) from generate_series(greatest(q.from_date,dt),least(q.to_date,last_day),interval ''1 day'') g where not clinic_people.center_closed_on(g::date))),0) into unpaid
   from clinic_people.requests q where q.person_id=p.id and q.kind=''leave'' and q.status=''approved'' and q.leave_type<>''excused'' and q.from_date<=last_day and q.to_date>=dt;
 dedu:=least(round(ded+late*r.late_minute+absent*r.absence_day+offs+unpaid*c.amount/30,2),gross);',
' dedu:=least(round(ded+late*r.late_minute+absent*r.absence_day+offs,2),gross);');
  patched := replace(patched, '''unpaid_leave_days'',round(unpaid,2),''unpaid_leave_deduction'',round(unpaid*c.amount/30,2),', '');
  if position(g in patched) > 0 then raise exception 'تعذر الرجوع في hr_payroll_calculate'; end if;
  execute patched;

  def := pg_get_functiondef('clinic_people.leave_refund(uuid,uuid)'::regprocedure);
  patched := replace(def, 'select coalesce(sum(greatest(pr.absence_day - case when r.leave_type = ''excused'' then 0 else clinic_people.day_wage(r.person_id, a.day) end, 0)), 0), count(*) into amt, n /* ' || g || ' */',
    'select coalesce(sum(pr.absence_day), 0), count(*) into amt, n');
  if position(g in patched) > 0 then raise exception 'تعذر الرجوع في leave_refund'; end if;
  execute patched;
end $$;
drop function if exists clinic_people.day_wage(uuid, date);
drop function if exists clinic_people.leave_allowance(integer);
commit;
