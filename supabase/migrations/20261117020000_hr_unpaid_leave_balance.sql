-- HR: one yearly UNPAID leave balance of 30 days (owner decision 2026-11-16, temporary, «لحين دخول الشركة هيئة التأمينات
-- الاجتماعية»; departs from Labor Law 14/2025 art. 124 — revisit at insurance registration; docs/LEGAL-LEAVE-REFERENCE.md).
-- Owner's words: «عايز اضيف لكل الموظفين أجازة بدون مرتب …» · «بدل السنوية المدفوعة» · «خليهم ٣٠ أيام» ·
-- «كل أنواع الأجازات بدون راتب حاليا ما عدا الراحة الأسبوعية» · sick/birth «بدون مرتب وبيتخصموا من الرصيد» ·
-- renews yearly «ايوة» · label «يظهر أجازة» · over the limit «يحتاج اعتماد مني».
--   * every active employee has clinic_people.leave_allowance(year) = 30 days each calendar year (no carry-over),
--     plus approved leave_credit rows (manual credits, «يوم بديل»);
--   * every approved leave type (annual, casual, sick, birth) uses that balance and is unpaid: payroll deducts one day's
--     wage (contract ÷ 30) per leave day, never an absence penalty; center-closure days inside a leave are not deducted;
--   * an «excused» absence (owner exception) stays outside the balance and unpaid-deduction (it forgives the absence);
--   * over the balance: not refused, but only an owner-level reviewer (super admin / general manager) can approve it,
--     marked 'over_balance' with the review note as the reason;
--   * attendance keeps showing «إجازة» (no change); the absence refund for a leave approved after payroll was sent now
--     refunds the absence minus the day's wage (the day stays unpaid).
-- Technique: guarded in-place patches of the LIVE bodies (as in 20261115230000 / 20261116120000); refuses if a fragment
-- is missing or if already applied.
begin;

create or replace function clinic_people.leave_allowance(p_year integer) returns numeric
language sql immutable as $$ select 30::numeric $$;

create or replace function clinic_people.day_wage(p_person uuid, p_day date) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select b.amount / 30 from clinic_finance.business_requests b join clinic_people.people p on p.finance_subject = b.subject
                    where p.id = p_person and b.kind = 'employment' and b.status = 'approved'
                      and p_day between (b.payload->>'from')::date and (b.payload->>'to')::date
                    order by b.created_at desc limit 1), 0)
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
      when 'over_balance' then 'أكتر من رصيد الأجازات'
      else u.b end order by u.o), '{}')
  from unnest(coalesce(p, '{}')) with ordinality u(b, o)
$$;

revoke all on function clinic_people.leave_allowance(integer), clinic_people.day_wage(uuid, date) from public, anon, authenticated;

do $$ declare def text; patched text;
  procedure_guard text := 'unpaid leave balance 20261117020000';
begin
  -- 1) hr_command: one yearly balance for every leave type except excused; over it needs an owner-level reviewer.
  def := pg_get_functiondef('public.hr_command(text,jsonb)'::regprocedure);
  if position(procedure_guard in def) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  patched := replace(def,
'   if r.leave_type in (''annual'',''casual'') then
    select coalesce(sum(case when kind=''leave_credit'' then units when kind=''leave'' and leave_type in (''annual'',''casual'') then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status=''approved'' and extract(year from from_date)=extract(year from r.from_date);
    if balance<r.units then raise exception ''رصيد الإجازات لا يكفي؛ راجع الرصيد المعتمد'';end if;
   end if;',
'   -- ' || procedure_guard || ': every leave type except excused uses one yearly unpaid balance; over it → owner-level only.
   if r.leave_type<>''excused'' then
    select clinic_people.leave_allowance(extract(year from r.from_date)::int)+coalesce(sum(case when kind=''leave_credit'' then units when kind=''leave'' and leave_type<>''excused'' then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status=''approved'' and extract(year from from_date)=extract(year from r.from_date);
    if balance<r.units and not clinic_people.is_owner_level() then raise exception ''الطلب أكتر من رصيد الأجازات (المتاح % يوم)؛ محتاج اعتماد المدير العام أو السوبر أدمن'',greatest(balance,0);end if;
   end if;');
  patched := replace(patched,
    'then array[''no_certificate''] else ''{}''::text[] end;',
    'then array[''no_certificate''] else ''{}''::text[] end||case when r.leave_type<>''excused'' and balance<r.units then array[''over_balance''] else ''{}''::text[] end;');
  if position(procedure_guard in patched) = 0 or position('array[''over_balance'']' in patched) = 0 then
    raise exception 'جسم hr_command اتغير — راجعه قبل التطبيق';
  end if;
  execute patched;

  -- 2) hr_workspace: the shown balance.
  def := pg_get_functiondef('public.hr_workspace(date)'::regprocedure);
  patched := replace(def,
    'when r.kind=''leave'' and r.leave_type in (''annual'',''casual'') then -r.units else 0 end) from clinic_people.requests r where r.person_id=p.id and r.status=''approved'' and r.from_date>=date_trunc(''year'',p_month)::date and r.from_date<(date_trunc(''year'',p_month)+interval ''1 year'')::date),0)',
    'when r.kind=''leave'' and r.leave_type<>''excused'' then -r.units else 0 end) from clinic_people.requests r where r.person_id=p.id and r.status=''approved'' and r.from_date>=date_trunc(''year'',p_month)::date and r.from_date<(date_trunc(''year'',p_month)+interval ''1 year'')::date),0)+clinic_people.leave_allowance(extract(year from p_month)::int) /* ' || procedure_guard || ' */');
  if patched = def then raise exception 'جسم hr_workspace اتغير — راجعه قبل التطبيق'; end if;
  execute patched;

  -- 3) hr_payroll_calculate: one day's wage per unpaid leave day (no absence penalty).
  def := pg_get_functiondef('public.hr_payroll_calculate(uuid,date)'::regprocedure);
  patched := replace(def, 'dedu numeric;begin', 'dedu numeric;unpaid numeric:=0;begin');
  patched := replace(patched, ' dedu:=least(round(ded+late*r.late_minute+absent*r.absence_day+offs,2),gross);',
' -- ' || procedure_guard || ': approved leave (not excused) is unpaid: one day''s wage per leave day, closures excluded.
 select coalesce(sum(q.units/(q.to_date-q.from_date+1)::numeric*(select count(*) from generate_series(greatest(q.from_date,dt),least(q.to_date,last_day),interval ''1 day'') g where not clinic_people.center_closed_on(g::date))),0) into unpaid
   from clinic_people.requests q where q.person_id=p.id and q.kind=''leave'' and q.status=''approved'' and q.leave_type<>''excused'' and q.from_date<=last_day and q.to_date>=dt;
 dedu:=least(round(ded+late*r.late_minute+absent*r.absence_day+offs+unpaid*c.amount/30,2),gross);');
  patched := replace(patched, '''guarantee_offset'',offs,', '''guarantee_offset'',offs,''unpaid_leave_days'',round(unpaid,2),''unpaid_leave_deduction'',round(unpaid*c.amount/30,2),');
  if position(procedure_guard in patched) = 0 or position('unpaid numeric:=0' in patched) = 0 or position('''unpaid_leave_days''' in patched) = 0 then
    raise exception 'جسم hr_payroll_calculate اتغير — راجعه قبل التطبيق';
  end if;
  execute patched;

  -- 4) leave_refund: the day stays unpaid, so refund the absence minus the day's wage (excused: the full absence).
  def := pg_get_functiondef('clinic_people.leave_refund(uuid,uuid)'::regprocedure);
  patched := replace(def, 'select coalesce(sum(pr.absence_day), 0), count(*) into amt, n',
    'select coalesce(sum(greatest(pr.absence_day - case when r.leave_type = ''excused'' then 0 else clinic_people.day_wage(r.person_id, a.day) end, 0)), 0), count(*) into amt, n /* ' || procedure_guard || ' */');
  if patched = def then raise exception 'جسم leave_refund اتغير — راجعه قبل التطبيق'; end if;
  execute patched;
end $$;

commit;
