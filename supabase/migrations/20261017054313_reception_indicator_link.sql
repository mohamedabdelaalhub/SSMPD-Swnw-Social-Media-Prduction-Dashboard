-- Frozen aggregate reports, independently approved before native indicator publication.
-- The existing HMAC ingest contract is unchanged. Training reports cannot be published.
create table clinic_reception.indicator_publications(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references clinic_reception.workspaces(id),
 snapshot jsonb not null, fingerprint text not null unique, created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references public.admins(id),reviewed_at timestamptz,note text,report_id uuid references public.operational_reports(id),
 check(reviewed_by is null or reviewed_by<>created_by)
);
alter table clinic_reception.indicator_publications enable row level security;
revoke all on clinic_reception.indicator_publications from public,anon,authenticated;
create function public.clinic_reception_indicator_publication(p_workspace uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'reports');r jsonb;s jsonb;fp text;v clinic_reception.indicator_publications%rowtype;rid uuid;pf date;pt date;
begin
 if not public.operations_manager() then raise exception 'تقارير المؤشرات للإدارة المعتمدة' using errcode='42501';end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 if p_action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from clinic_reception.indicator_publications x where workspace_id=p_workspace);
 end if;
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'لا تنشر بيانات التجربة في المؤشرات الفعلية';end if;
 if p_action='prepare' then
  pf:=(p_payload->>'from')::date;pt:=(p_payload->>'to')::date;
  r:=public.clinic_reception_indicator_export(p_workspace,pf,pt);
  s:=jsonb_build_object('schema_version',1,'branch','جميع فروع مساحة الاستقبال','scope','الاستقبال والخدمات','title','مؤشرات الاستقبال والخدمات — '||pf||' إلى '||pt,
   'period_from',pf,'period_to',pt,'kpis',r->'kpis','coverage',r->'coverage',
   'coverage_notice','عمليات نظام الاستقبال البديل فقط؛ النتيجة المسجلة ليست صافي الربح النهائي. اكتمال المصروفات العامة وتكاليف التسويق غير مثبت. التقرير مجمد وقت إعداده.',
   'risks','[]'::jsonb,'recommendations','[]'::jsonb,'plan','[]'::jsonb);
  fp:=encode(sha256(convert_to(p_workspace::text||s::text,'UTF8')),'hex');s:=s||jsonb_build_object('fingerprint',fp);
  insert into clinic_reception.indicator_publications(workspace_id,snapshot,fingerprint,created_by) values(p_workspace,s,fp,me)
   on conflict(fingerprint) do nothing;
  select * into v from clinic_reception.indicator_publications where fingerprint=fp;
 elsif p_action='review' then
  perform clinic_reception.access(p_workspace,'review');
  select * into v from clinic_reception.indicator_publications where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;
  if not found then raise exception 'التقرير غير موجود';end if;
  if v.created_by=me then raise exception 'يلزم مدير مراجع مستقل';end if;
  if v.status<>'pending' then return to_jsonb(v);end if;
  if length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'سجل نتيجة المراجعة';end if;
  if (p_payload->>'approve')::boolean then
   insert into public.operational_reports(fingerprint,source,branch,scope,period_from,period_to,title,snapshot,source_approved_at,source_actor)
   values(v.fingerprint,'reception_services',v.snapshot->>'branch',v.snapshot->>'scope',(v.snapshot->>'period_from')::date,(v.snapshot->>'period_to')::date,v.snapshot->>'title',v.snapshot,now(),me::text)
   on conflict(fingerprint) do nothing;
   select id into rid from public.operational_reports where fingerprint=v.fingerprint and source='reception_services';
   if rid is null then raise exception 'تعارض مصدر التقرير';end if;
  end if;
  update clinic_reception.indicator_publications set status=case when rid is null then 'rejected' else 'approved' end,reviewed_by=me,reviewed_at=now(),note=p_payload->>'note',report_id=rid where id=v.id returning * into v;
 else raise exception 'إجراء غير معروف';end if;
 return to_jsonb(v);
end $$;
revoke all on function public.clinic_reception_indicator_publication(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.clinic_reception_indicator_publication(uuid,text,jsonb) to authenticated;
