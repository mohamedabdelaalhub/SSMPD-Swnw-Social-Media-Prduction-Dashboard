
-- Additive digital-team discussion and attachment evidence. No changes to existing agents, roles, booking, finance or WhatsApp.
create table if not exists public.digital_agent_messages (
 id uuid primary key default gen_random_uuid(),
 agent_code text not null references public.digital_team_members(code) on delete restrict,
 kind text not null check(kind in ('instruction','comment','question','reply')),
 body text not null check(char_length(btrim(body)) between 2 and 4000),
 reply_to_id uuid references public.digital_agent_messages(id) on delete set null,
 author_admin_id uuid references public.admins(id) on delete set null,
 origin text not null default 'dashboard' check(origin in ('dashboard','agent_advisory')),
 execution_state text not null default 'not_executed'
  check(execution_state in ('not_executed')),
 created_at timestamptz not null default now(),
 check (kind <> 'reply' or (origin='agent_advisory' and reply_to_id is not null))
);
create index if not exists digital_agent_messages_by_agent on public.digital_agent_messages(agent_code,created_at desc,id desc);
alter table public.digital_agent_messages enable row level security;
revoke all on public.digital_agent_messages from public,anon,authenticated;
grant select on public.digital_agent_messages to authenticated;
create policy "digital team managers view discussions" on public.digital_agent_messages
 for select to authenticated using ((select public.business_manager()));

create or replace function public.digital_agent_post_message(p_agent_code text,p_kind text,p_body text)
returns uuid language plpgsql volatile security definer
set search_path=pg_catalog,public
as $$
declare actor uuid; owner_id uuid; new_id uuid;
begin
 select id into actor from public.admins where user_id=auth.uid() and active=true limit 1;
 select owner_admin_id into owner_id from public.administrative_assistant_config where id=1;
 if actor is null or actor is distinct from owner_id then raise exception 'التوجيهات للمالك فقط' using errcode='42501'; end if;
 if p_kind not in ('instruction','comment','question') then raise exception 'نوع الرسالة غير مدعوم' using errcode='22023'; end if;
 if not exists(select 1 from public.digital_team_members where code=p_agent_code and active=true)
   then raise exception 'عضو الفريق غير موجود' using errcode='22023'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 2 and 4000 then raise exception 'راجع طول الرسالة' using errcode='22023'; end if;
 insert into public.digital_agent_messages(agent_code,kind,body,author_admin_id)
 values(p_agent_code,p_kind,btrim(p_body),actor) returning id into new_id;
 return new_id;
end $$;
revoke all on function public.digital_agent_post_message(text,text,text) from public,anon,authenticated;
grant execute on function public.digital_agent_post_message(text,text,text) to authenticated;

-- Optional evidence from a file fetched through an owner-authorized Google Drive connection.
-- Separate from the employee's original immutable work result and its idempotency key.
create table if not exists public.task_attachment_evidence (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 work_result_id uuid not null references public.task_work_results(id) on delete cascade,
 drive_file_id text not null check(length(drive_file_id) between 5 and 200),
 file_name text not null check(length(file_name) between 1 and 300),
 content_excerpt text not null check(length(content_excerpt) between 10 and 18000),
 source text not null check(source in ('authorized_drive_fetch')),
 verification_state text not null default 'verified_content'
   check(verification_state in ('verified_content','stale','retracted')),
 extraction_at timestamptz not null default now(),
 excerpt_max_rows integer check(excerpt_max_rows is null or excerpt_max_rows between 1 and 500),
 unique(work_result_id,drive_file_id)
);
create index if not exists task_attachment_evidence_by_work on public.task_attachment_evidence(work_result_id,verification_state);
alter table public.task_attachment_evidence enable row level security;
revoke all on public.task_attachment_evidence from public,anon,authenticated;
-- Service role Edge Function can read verified excerpts. No direct dashboard access to task evidence.

-- Aggregate-only metric definitions and drilldowns; no individual patient, employee or financial transaction details.
create or replace function public.digital_agent_metric_detail(p_code text,p_key text)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,clinic_finance
as $$
declare details jsonb:='[]'::jsonb; source_name text:='سجل الفريق الرقمي';
        explanation text:='القيمة من أحدث مراجعة متاحة. البيانات المجمعة لا تكفي وحدها للحكم على حالة فردية.';
        period_desc text:='وفق الفترة المستخدمة في مؤشر الوكيل';
begin
 if not public.business_manager() then raise exception 'غير مصرح' using errcode='42501'; end if;
 if not exists(select 1 from public.digital_team_members where code=p_code and active) then
   raise exception 'الوكيل غير موجود' using errcode='22023'; end if;
 if length(coalesce(p_key,'')) > 100 then raise exception 'المؤشر غير صالح' using errcode='22023'; end if;
 if p_code='hor' and p_key='followup_status_to_review' then
   source_name:='patient_visits';
   explanation:='مواعيد متابعة خلال آخر 30 يومًا بحالة pending أو no_show. لا يعني ذلك ثبوت تأخر الموظف أو عدم التواصل.';
   period_desc:='منذ 30 يومًا إلى الأمس';
   select coalesce(jsonb_agg(jsonb_build_object('label',follow_up_status,'count',n) order by n desc),'[]'::jsonb) into details
   from (select follow_up_status,count(*) n from public.patient_visits
    where follow_up_date between current_date-30 and current_date-1 and follow_up_status in ('pending','no_show')
    group by follow_up_status) x;
 elsif p_code='hor' and p_key in ('visits_last30','reception_bookings_last30','reception_arrivals_recorded') then
   source_name:='patient_visits / clinic_reception.appointments';
   explanation:='مقارنة نطاق التغطية بين سجل زيارات المرضى وسجل الاستقبال. نظام الحجز الرسمي قد يحتوي أحداثًا إضافية.';
   period_desc:='آخر 30 يومًا';
   select jsonb_build_array(
    jsonb_build_object('label','زيارات مسجلة','count',(select count(*) from public.patient_visits where visit_date>=current_date-30)),
    jsonb_build_object('label','حجوزات الاستقبال المسجلة','count',(select count(*) from clinic_reception.appointments where starts_at>=now()-interval '30 days')),
    jsonb_build_object('label','أحداث وصول للاستقبال','count',(select count(*) from clinic_reception.appointments where arrived_at is not null and starts_at>=now()-interval '30 days')))
    into details;
 elsif p_code='hotep' and p_key in ('open_complaints','urgent_or_clinical_complaints') then
   source_name:='patient360_cases';
   explanation:='شكاوى Patient 360 المفتوحة، مصنفة حسب فئة المشكلة. الشكوى لا تثبت مسؤولية أي موظف.';
   period_desc:='الشكاوى المفتوحة حاليًا';
   select coalesce(jsonb_agg(jsonb_build_object('label',category,'count',n) order by n desc),'[]'::jsonb) into details
   from (select category,count(*) n from public.patient360_cases where status in ('new','investigating','action_required') group by category) x;
 elsif p_code='hotep' and p_key in ('feedback_total','feedback_last30') then
   source_name:='patient_experience_ratings';
   explanation:='عدد تقييمات تجربة المريض المحفوظة. لا يمكن استنتاج رضا كل المرضى من عينة صغيرة.';
   period_desc:='إجمالي وآخر 30 يومًا';
   select jsonb_build_array(
    jsonb_build_object('label','الإجمالي','count',(select count(*) from public.patient_experience_ratings)),
    jsonb_build_object('label','آخر 30 يومًا','count',(select count(*) from public.patient_experience_ratings where created_at>=now()-interval '30 days')))
    into details;
 elsif p_code='nefer' and p_key in ('leads_last30','no_response_last30_not_opted_out','leads_with_ad_attribution_total') then
   source_name:='leads';
   explanation:='توزيع الاستفسارات المسجلة حسب حالتها. حالة no_response ليست موافقة على المتابعة ولا تفسيرًا لعدم الحجز.';
   period_desc:='آخر 30 يومًا';
   select coalesce(jsonb_agg(jsonb_build_object('label',coalesce(current_status,'غير مصنف'),'count',n) order by n desc),'[]'::jsonb) into details
   from (select current_status,count(*) n from public.leads where received_at>=now()-interval '30 days' group by current_status) x;
 elsif p_code='nefer' and p_key in ('registered_partner_entities','referrals_in_partner_table') then
   source_name:='contracting_entities / contracting_referrals';
   explanation:='تغطية سجلات جهات التعاقد والإحالات. عدم وجود إحالات هنا لا يعني عدم وصول إحالات في نظام الحجز الخارجي.';
   period_desc:='السجلات الحالية';
   select jsonb_build_array(
    jsonb_build_object('label','جهات التعاقد','count',(select count(*) from public.contracting_entities)),
    jsonb_build_object('label','إحالات مسجلة هنا','count',(select count(*) from public.contracting_referrals)))
     into details;
 elsif p_code='maat' and p_key in ('journal_entries_checked','journal_entries_unbalanced') then
   source_name:='clinic_finance.entries / clinic_finance.lines';
   explanation:='فحص توازن مدين ودائن فقط، وليس تدقيقًا على صحة المستندات أو وجود احتيال.';
   period_desc:='القيود الموجودة';
   select jsonb_build_array(
    jsonb_build_object('label','قيود متوازنة','count',count(*) filter (where abs(net)<=0.009)),
    jsonb_build_object('label','قيود تحتاج مراجعة','count',count(*) filter (where abs(net)>0.009)))
   into details
   from (select e.id,coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0) net
         from clinic_finance.entries e left join clinic_finance.lines l on l.entry_id=e.id group by e.id) q;
 elsif p_code='maat' and p_key in ('bank_statements_imported','pos_settlements_imported','invoices_recorded') then
   source_name:='clinic_finance.bank_statements / pos_settlements / invoices';
   explanation:='حجم البيانات المستوردة للمطابقة. غياب الملفات لا يعني عدم حدوث العمليات البنكية خارج هذا السجل.';
   period_desc:='السجلات الحالية';
   select jsonb_build_array(
    jsonb_build_object('label','كشوف بنوك','count',(select count(*) from clinic_finance.bank_statements)),
    jsonb_build_object('label','تسويات POS','count',(select count(*) from clinic_finance.pos_settlements)),
    jsonb_build_object('label','فواتير الحسابات','count',(select count(*) from clinic_finance.invoices)))
    into details;
 elsif p_code='sia' then
   source_name:='administrative_assistant_audit / tasks';
   explanation:='أحداث مساعدة إدارية مسجلة وليست تقييمًا لجودة موظف أو عدد مرضى.';
   period_desc:='آخر 30 يومًا';
   select coalesce(jsonb_agg(jsonb_build_object('label',event_type,'count',n) order by n desc),'[]'::jsonb) into details
   from (select event_type,count(*) n from public.administrative_assistant_audit
       where at>=now()-interval '30 days' group by event_type) x;
 elsif p_code='claude_creative' then
   source_name:='claude_action_log / claude_capabilities / task_work_results';
   explanation:='سجل أنشطة Claude Creative وحسابه الحالي. تفاصيل المهام والمحتوى داخل شاشاته الأصلية وصلاحياته لا تتغير.';
   period_desc:='آخر 30 يومًا';
   select jsonb_build_array(
     jsonb_build_object('label','إجراءات Claude','count',(select count(*) from public.claude_action_log where at>=now()-interval '30 days')),
     jsonb_build_object('label','صلاحيات مفعلة','count',(select count(*) from public.claude_capabilities where enabled))
   ) into details;
 elsif p_code='hapi' then
   source_name:='clinic_reception_agent_health';
   explanation:='حالة محرك الاستقبال، لا تعني وحدها توفر أرشيف كامل لمحادثات حابي أو نجاح كل الحجوزات.';
 end if;
 return jsonb_build_object('agent_code',p_code,'metric_key',p_key,'source',source_name,
    'explanation',explanation,'period',period_desc,'breakdown',details,'identifiable_rows_returned',false);
end $$;
revoke all on function public.digital_agent_metric_detail(text,text) from public,anon,authenticated;
grant execute on function public.digital_agent_metric_detail(text,text) to authenticated;
