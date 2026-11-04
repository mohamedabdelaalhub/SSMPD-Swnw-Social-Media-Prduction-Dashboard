
-- Swnw specialist digital team: additive read-only review engines (no automation, logins or permissions to existing accounts).
-- Existing Sia, Hapi and Claude rows are not updated.
insert into public.digital_team_members
 (code,display_name,title_ar,member_kind,agent_key,reports_to_code,authority_note,active,metadata)
values
 ('hor','حور','مدير التشغيل الرقمي','external_agent','hor_operations','sia',
  'مراجعة مؤشرات التشغيل وحالة متابعة المريض فقط. لا يعدل الحجوزات أو السجلات الطبية ولا يرسل رسائل.',
  true,'{"runtime_mode":"review_only","engine":"read_only_metrics","login_allowed":false,"may_message_patients":false,"may_modify_bookings":false,"may_modify_clinical_records":false,"kpi_model":"patient_journey"}'::jsonb),
 ('hotep','حتب','مسؤول تجربة المريض والجودة','external_agent','hotep_patient_experience','sia',
  'يراجع مؤشرات تجربة المريض والشكاوى بصورة مجمعة ويرفع المقترحات للإدارة. لا يقرر تعويضًا أو علاجًا.',
  true,'{"runtime_mode":"review_only","engine":"read_only_metrics","login_allowed":false,"may_message_patients":false,"may_grant_compensation":false,"may_modify_clinical_records":false,"kpi_model":"patient_experience"}'::jsonb),
 ('nefer','نفر','مدير التسويق والنمو الرقمي','external_agent','nefer_growth','sia',
  'يراجع مؤشرات التسويق والتحويل والشراكات ويقترح التطوير. لا يرسل عروضًا أو يفاوض أو ينشر بدون اعتماد.',
  true,'{"runtime_mode":"review_only","engine":"read_only_metrics","login_allowed":false,"may_message_customers":false,"may_publish":false,"may_negotiate":false,"may_change_ad_budget":false,"kpi_model":"marketing_growth"}'::jsonb),
 ('maat','ماعت','المراجع المالي والرقابي الرقمي','external_agent','maat_financial_audit',null,
  'مراجع مستقل يرفع نتائج القراءة للإدارة مباشرة. لا ينفذ صرفًا أو قيدًا أو تسوية أو اتهامًا.',
  true,'{"runtime_mode":"review_only","engine":"read_only_metrics","reports_to":"owner","login_allowed":false,"may_modify_finance":false,"may_approve_spending":false,"may_grant_compensation":false,"kpi_model":"financial_controls"}'::jsonb)
on conflict (code) do nothing;

create table if not exists public.digital_agent_reviews (
 id uuid primary key default gen_random_uuid(),
 agent_code text not null references public.digital_team_members(code) on delete restrict,
 review_mode text not null default 'manual' check(review_mode='manual'),
 status text not null default 'pending_owner' check(status in ('pending_owner','accepted_for_planning','dismissed')),
 metrics jsonb not null default '{}'::jsonb,
 findings jsonb not null default '[]'::jsonb check(jsonb_typeof(findings)='array'),
 review_scope text not null default 'aggregates_only',
 reviewed_at timestamptz not null default now(),
 requested_by uuid references public.admins(id) on delete set null,
 decided_by uuid references public.admins(id) on delete set null,
 decided_at timestamptz,
 decision_note text,
 check (status='pending_owner' or (decided_by is not null and decided_at is not null))
);
create index if not exists digital_agent_reviews_latest on public.digital_agent_reviews(agent_code,reviewed_at desc);
alter table public.digital_agent_reviews enable row level security;
revoke all on public.digital_agent_reviews from public,anon,authenticated;
grant select on public.digital_agent_reviews to authenticated;
create policy "manager read specialist reviews" on public.digital_agent_reviews for select to authenticated
using ((select public.business_manager()));

create or replace function public.digital_agent_run_review(p_code text)
returns jsonb
language plpgsql volatile security definer
set search_path = pg_catalog,public,clinic_finance
as $$
declare
  actor uuid;
  stats jsonb := '{}'::jsonb;
  findings jsonb := '[]'::jsonb;
  rid uuid;
  visits_30 integer := 0;
  followups_pending integer := 0;
  appts_30 integer := 0;
  appts_arrived integer := 0;
  cases_open integer := 0;
  cases_urgent integer := 0;
  ratings_30 integer := 0;
  ratings_total integer := 0;
  leads_30 integer := 0;
  no_response_30 integer := 0;
  lead_ads integer := 0;
  partners integer := 0;
  partner_referrals integer := 0;
  journal_entries integer := 0;
  unbalanced_entries integer := 0;
  invoices integer := 0;
  bank_statements integer := 0;
  pos_statements integer := 0;
begin
 if not public.business_manager() then
   raise exception 'غير مصرح' using errcode='42501';
 end if;
 if p_code not in ('hor','hotep','nefer','maat') or not exists(
   select 1 from public.digital_team_members where code=p_code and active
 ) then
   raise exception 'الوكيل غير متاح للمراجعة' using errcode='22023';
 end if;
 select id into actor from public.admins where user_id=auth.uid() and active=true limit 1;
 if actor is null then raise exception 'حساب الإدارة غير متاح' using errcode='42501'; end if;

 if p_code='hor' then
   select count(*) filter(where visit_date >= current_date-30),
          count(*) filter(where follow_up_date between current_date-30 and current_date-1
             and follow_up_status in ('pending','no_show'))
   into visits_30,followups_pending from public.patient_visits;
   select count(*),count(*) filter(where arrived_at is not null)
   into appts_30,appts_arrived
   from clinic_reception.appointments where starts_at >= now()-interval '30 days';
   select count(*) into cases_open from public.patient360_cases
   where status in ('new','investigating','action_required');
   stats=jsonb_build_object('visits_last30',visits_30,'followup_status_to_review',followups_pending,
     'reception_bookings_last30',appts_30,'reception_arrivals_recorded',appts_arrived,'open_patient360_cases',cases_open);
   if followups_pending>0 then
     findings=findings || jsonb_build_array(jsonb_build_object(
       'title','مراجعة حالات المتابعة المعلقة',
       'level','needs_validation','count',followups_pending,
       'source','patient_visits.follow_up_date + follow_up_status',
       'reason','البيانات تعرض مواعيد متابعة سابقة بحالة انتظار أو عدم حضور. هذا ليس دليل إهمال أو عدم تواصل.',
       'recommendation','تحقق من تحديث حالة المتابعة وتواصل الفريق المسؤول قبل رفع أي تنبيه للمريض.'));
   end if;
   findings=findings || jsonb_build_array(jsonb_build_object(
      'title','تغطية أحداث رحلة المريض',
      'level','data_gap','count',appts_30,
      'source','clinic_reception.appointments مقابل patient_visits',
      'reason','سجل حجوزات الاستقبال قد لا يمثل نظام الحجز الرسمي الخارجي، ولا يمكن إثبات تأخر الطبيب منه وحده.',
      'recommendation','راجع تكامل أحداث الحجز والوصول وبداية الكشف قبل استخراج مؤشر الانتظار.'));

 elsif p_code='hotep' then
   select count(*) into cases_open from public.patient360_cases
   where status in ('new','investigating','action_required');
   select count(*) into cases_urgent from public.patient360_cases
   where status in ('new','investigating','action_required')
     and (severity in ('urgent','critical') or clinical_review_required=true);
   select count(*),count(*) filter(where created_at>=now()-interval '30 days')
   into ratings_total,ratings_30 from public.patient_experience_ratings;
   stats=jsonb_build_object('open_complaints',cases_open,'urgent_or_clinical_complaints',cases_urgent,
      'feedback_total',ratings_total,'feedback_last30',ratings_30);
   if cases_urgent>0 then findings=findings || jsonb_build_array(jsonb_build_object(
       'title','شكاوى تحتاج تقييمًا بشريًا','level','urgent','count',cases_urgent,
       'source','patient360_cases','reason','يوجد بلاغات عاجلة أو ذات جانب طبي تنتظر مراجعة.',
       'recommendation','صعّدها إلى مسؤول الجودة والطبيب المختص، دون تشخيص أو وعد بتعويض آلي.'));
   end if;
   findings=findings || jsonb_build_array(jsonb_build_object(
       'title','تغطية قياس تجربة المريض','level','data_gap','count',ratings_total,
       'source','patient_experience_ratings','reason','حجم التقييمات المسجلة لا يكفي وحده للحكم على رضا جميع المرضى.',
       'recommendation','راقب معدل الرد على استبيان التجربة وانحياز العينة قبل مقارنة الأقسام.'));

 elsif p_code='nefer' then
   select count(*) filter(where received_at>=now()-interval '30 days'),
          count(*) filter(where received_at>=now()-interval '30 days' and current_status='no_response'
               and coalesce(do_not_contact,false)=false),
          count(*) filter(where meta_ad_id is not null or nullif(utm_campaign,'') is not null)
   into leads_30,no_response_30,lead_ads from public.leads;
   select count(*) into partners from public.contracting_entities;
   select count(*) into partner_referrals from public.contracting_referrals;
   stats=jsonb_build_object('leads_last30',leads_30,'no_response_last30_not_opted_out',no_response_30,
      'leads_with_ad_attribution_total',lead_ads,'registered_partner_entities',partners,
      'referrals_in_partner_table',partner_referrals);
   if no_response_30>0 then findings=findings || jsonb_build_array(jsonb_build_object(
      'title','فرص متابعة الاستفسارات غير المكتملة','level','opportunity','count',no_response_30,
      'source','leads.current_status + received_at + do_not_contact',
      'reason','حالة no_response في سجل العملاء لا تثبت سبب عدم الحجز ولا تمنح إذنًا لإرسال رسالة.',
      'recommendation','راجع جودة الرد وتوفر المواعيد، ثم جهّز مسودات متابعة للحالات المصرح بالتواصل معها فقط.'));
   end if;
   findings=findings || jsonb_build_array(jsonb_build_object(
      'title','دقة ربط الحملات بالحجوزات','level','data_gap','count',lead_ads,
      'source','leads.meta_ad_id + leads.utm_campaign',
      'reason','لا يمكن احتساب العائد الإعلاني من المشاهدات وحدها أو افتراض مصدر كل حجز.',
      'recommendation','اختبر نسب اكتمال بيانات المصدر والحملة وربط الحجز الرسمي بالزيارة دون تكرار.'));
   if partners>0 and partner_referrals=0 then findings=findings || jsonb_build_array(jsonb_build_object(
      'title','قياس نشاط الشركاء','level','data_gap','count',partners,
      'source','contracting_entities + contracting_referrals',
      'reason','لا توجد إحالات في جدول الشراكات، وقد تكون الإحالات مسجلة في النظام الرسمي بموضع آخر.',
      'recommendation','استكمل ربط إحالات الجهات بالفواتير قبل الحكم أن الشركاء غير نشطين.'));
   end if;

 elsif p_code='maat' then
   select count(*),count(*) filter(where abs(net)>0.009) into journal_entries,unbalanced_entries
   from (
     select e.id,coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0) as net
     from clinic_finance.entries e left join clinic_finance.lines l on l.entry_id=e.id
     group by e.id
   ) x;
   select count(*) into invoices from clinic_finance.invoices;
   select count(*) into bank_statements from clinic_finance.bank_statements;
   select count(*) into pos_statements from clinic_finance.pos_settlements;
   stats=jsonb_build_object('journal_entries_checked',journal_entries,
      'journal_entries_unbalanced',unbalanced_entries,'invoices_recorded',invoices,
      'bank_statements_imported',bank_statements,'pos_settlements_imported',pos_statements);
   if unbalanced_entries>0 then findings=findings || jsonb_build_array(jsonb_build_object(
      'title','قيود تحتاج تحققًا محاسبيًا','level','needs_validation','count',unbalanced_entries,
      'source','clinic_finance.entries + lines',
      'reason','توجد فروق بين طرفي القيد في السجلات المتاحة. هذا ليس دليلًا على احتيال أو فساد.',
      'recommendation','اطلب مراجعة القيود والمستندات الأصلية من الإدارة المالية.'));
   end if;
   if bank_statements=0 or pos_statements=0 then findings=findings || jsonb_build_array(jsonb_build_object(
      'title','نقص بيانات المطابقة البنكية ونقاط البيع','level','data_gap',
      'count',bank_statements+pos_statements,'source','clinic_finance.bank_statements + pos_settlements',
      'reason','لا يمكن تأكيد التحصيل أو كشف الفروقات دون كشوف البنك والتسويات الواردة.',
      'recommendation','اكمل مصادر المطابقة قبل إصدار تقييم مالي نهائي.'));
   end if;
   findings=findings || jsonb_build_array(jsonb_build_object(
     'title','نطاق المراجعة المحاسبية الحالية','level','review_only','count',journal_entries,
     'source','clinic_finance.entries + clinic_finance.lines',
     'reason','فحص التوازن الحسابي لا يكشف وحده الصرف غير المصرح به أو صحة المستندات.',
     'recommendation','اعتمد مراجعة بشرية للقيود والمستندات والصلاحيات قبل تصنيف أي حالة كمخالفة.'));
 end if;

 insert into public.digital_agent_reviews(agent_code,metrics,findings,requested_by)
 values(p_code,stats,findings,actor) returning id into rid;
 return jsonb_build_object('id',rid,'agent_code',p_code,'metrics',stats,'findings',findings,
   'status','pending_owner','mode','read_only_review','generated_at',now(),
   'disclaimer','ملاحظات وفرضيات للقرار البشري، ولا تعني إهمالًا أو مخالفة أو تحققًا ماليًا نهائيًا.');
end;
$$;
revoke all on function public.digital_agent_run_review(text) from public,anon,authenticated;
grant execute on function public.digital_agent_run_review(text) to authenticated;

create or replace function public.digital_agent_decide_review(p_review_id uuid,p_decision text,p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = pg_catalog,public
as $$
declare
  actor uuid;
  owner_id uuid;
  rec public.digital_agent_reviews%rowtype;
begin
  select id into actor from public.admins where user_id=auth.uid() and active=true limit 1;
  select owner_admin_id into owner_id from public.administrative_assistant_config where id=1;
  if actor is null or actor is distinct from owner_id then raise exception 'القرار للمالك فقط' using errcode='42501'; end if;
  if p_decision not in ('accepted_for_planning','dismissed') then raise exception 'قرار غير مدعوم' using errcode='22023'; end if;
  update public.digital_agent_reviews set status=p_decision,decided_by=actor,
    decided_at=now(),decision_note=left(coalesce(p_note,''),1000)
  where id=p_review_id and status='pending_owner' returning * into rec;
  if rec.id is null then raise exception 'المراجعة غير متاحة أو تم اتخاذ قرار سابق فيها' using errcode='22023'; end if;
  return jsonb_build_object('review_id',rec.id,'status',rec.status,'decided_at',rec.decided_at,
    'execution_started',false);
end;
$$;
revoke all on function public.digital_agent_decide_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.digital_agent_decide_review(uuid,text,text) to authenticated;
