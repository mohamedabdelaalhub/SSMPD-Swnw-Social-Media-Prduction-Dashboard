begin;
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager','psychology_specialist'));
alter table public.admin_extra_roles drop constraint if exists admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager','psychology_specialist'));
create schema psychcare;
revoke all on schema psychcare from public,anon,authenticated;
create function public.is_psychology_specialist() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.has_role('psychology_specialist') and not(public.has_role('super_admin') or public.has_role('general_manager'))$$;
revoke all on function public.is_psychology_specialist() from public,anon;
grant execute on function public.is_psychology_specialist() to authenticated;
create function psychcare.check_role_isolation() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare aid uuid;rs text[];begin
 if tg_table_name='admins' then aid:=new.id;else aid:=case when tg_op='DELETE' then old.admin_id else new.admin_id end;end if;
 select array_agg(distinct x.role) into rs from(select role from public.admins where id=aid union all select role from public.admin_extra_roles where admin_id=aid)x;
 if 'psychology_specialist'=any(rs) and not(rs&&array['super_admin','general_manager']) and exists(select 1 from unnest(rs)r where r<>'psychology_specialist') then raise exception 'دور أخصائي نفسية له صلاحيات مرضى مقيدة؛ احذف الأدوار الأخرى قبل تعيينه';end if;return null;end $$;
create trigger psychology_role_isolation after insert or update of role on public.admins for each row execute function psychcare.check_role_isolation();
create trigger psychology_extra_role_isolation after insert or update or delete on public.admin_extra_roles for each row execute function psychcare.check_role_isolation();
create table psychcare.requests(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),requested_by uuid not null references public.admins(id),reason text not null check(length(reason) between 3 and 1000),status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),reviewed_by uuid references public.admins(id),review_note text,expires_at timestamptz,created_at timestamptz not null default now(),reviewed_at timestamptz);
create unique index psychcare_pending on psychcare.requests(patient_id,requested_by) where status='pending';
create table psychcare.records(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),specialty text not null check(specialty in ('psychology','speech','behavior')),record_kind text not null check(record_kind in ('assessment','session')),data jsonb not null check(jsonb_typeof(data)='object'),created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
create index psychcare_records_patient on psychcare.records(patient_id,created_at desc);
create table psychcare.operations(actor uuid not null references public.admins(id),token uuid not null,action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor,token));
create table psychcare.audit(id uuid primary key default gen_random_uuid(),actor uuid not null,action text not null,patient_id uuid,detail jsonb not null,created_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['requests','records','operations','audit'] loop execute format('alter table psychcare.%I enable row level security',t);execute format('revoke all on psychcare.%I from public,anon,authenticated',t);end loop;end $$;
create function psychcare.phone(v text) returns text language sql immutable set search_path=pg_catalog as $$select case when x ~ '^01[0125][0-9]{8}$' then '20'||substring(x from 2) when x ~ '^1[0125][0-9]{8}$' then '20'||x else regexp_replace(x,'^00','') end from(select regexp_replace(translate(coalesce(v,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') x)s$$;
create function psychcare.name(v text) returns text language sql immutable set search_path=pg_catalog as $$select lower(regexp_replace(translate(trim(coalesce(v,'')),'أإآى','اااي'),'[[:space:]]+',' ','g'))$$;
create function psychcare.check_basics(n text,p text,a integer) returns void language plpgsql set search_path=pg_catalog,public as $$begin
 if trim(coalesce(n,'')) !~ '^[[:alpha:]][[:alpha:] .-]*[[:space:]]+[[:alpha:]][[:alpha:] .-]*$' or length(trim(n))>180 then raise exception 'اسم المريض مطلوب من كلمتين على الأقل';end if;
 if psychcare.phone(p)!~'^[0-9]{8,15}$' then raise exception 'رقم تليفون المريض مطلوب ويجب أن يكون صحيحًا';end if;
 if a is null or a<0 or a>130 then raise exception 'سن المريض مطلوب من صفر إلى 130 سنة';end if;
end $$;
create function psychcare.patient_basics_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare other public.patients%rowtype;begin
 if tg_op='INSERT' or (new.full_name,new.phone,new.age) is distinct from (old.full_name,old.phone,old.age) then
 perform psychcare.check_basics(new.full_name,new.phone,new.age);
 perform pg_advisory_xact_lock(hashtextextended(psychcare.phone(new.phone),781));
 select * into other from public.patients p where p.id<>new.id and psychcare.phone(p.phone)=psychcare.phone(new.phone) and psychcare.name(p.full_name)=psychcare.name(new.full_name) limit 1;
 if found then raise exception 'المريض مسجل بالفعل باسم % ورقم ملف %؛ اختر الملف الحالي',other.full_name,other.patient_code;end if;
 end if;return new;end $$;
create trigger patient_basics_guard before insert or update on public.patients for each row execute function psychcare.patient_basics_guard();
-- A restrictive policy defeats additional permissive policies and stale archive flags.
do $$declare r record;begin for r in select tablename from pg_tables where schemaname='public' and (tablename='patients' or left(tablename,8)='patient_') loop execute format('create policy psychology_isolated on public.%I as restrictive for all to authenticated using(not public.is_psychology_specialist()) with check(not public.is_psychology_specialist())',r.tablename);end loop;end $$;
create or replace function public.has_archive_access() returns boolean language sql stable security definer set search_path=public as $$select not public.is_psychology_specialist() and (coalesce((select has_archive_access from public.admins where user_id=auth.uid() and active limit 1),false) or public.has_role('super_admin'))$$;
create or replace function public.has_archive_review_access() returns boolean language sql stable security definer set search_path=public as $$select not public.is_psychology_specialist() and (coalesce((select has_archive_review_access from public.admins where user_id=auth.uid() and active limit 1),false) or public.has_role('super_admin'))$$;
create or replace function public.can_access_leads() returns boolean language sql stable security definer set search_path=public as $$select not public.is_psychology_specialist() and (public.has_role('reception') or public.has_role('customer_service') or public.has_role('general_manager') or public.has_role('super_admin'))$$;
create function psychcare.full_access(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.can_manage_all_content() or (not public.is_psychology_specialist() and (public.has_archive_access() or public.has_archive_review_access())) or exists(select 1 from psychcare.requests where patient_id=p and requested_by=public.my_admin_id() and status='approved' and expires_at>now())$$;
create function psychcare.own_patient(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.patients where id=p and created_by=public.my_admin_id()) or exists(select 1 from psychcare.records where patient_id=p and created_by=public.my_admin_id()) or exists(select 1 from public.patient_speech_profiles where patient_id=p and created_by=public.my_admin_id()) or exists(select 1 from public.patient_psychology_profiles where patient_id=p and created_by=public.my_admin_id()) or exists(select 1 from public.patient_speech_sessions where patient_id=p and created_by=public.my_admin_id()) or exists(select 1 from public.patient_psychology_sessions where patient_id=p and created_by=public.my_admin_id()) or exists(select 1 from public.patient_development_assessments where patient_id=p and assessment_kind='behavior' and created_by=public.my_admin_id())$$;
create function psychcare.require_staff() returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=public.my_admin_id();begin if me is null or not(public.has_role('psychology_specialist') or public.can_manage_all_content() or public.has_archive_access() or public.has_archive_review_access()) then raise exception 'لا توجد صلاحية للتخصصات النفسية';end if;return me;end $$;
create function public.psychology_lookup(p_query text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=public.my_admin_id();begin
 if me is null or not(public.has_role('psychology_specialist') or public.has_archive_access() or public.can_access_leads() or public.can_manage_all_content()) then raise exception 'لا توجد صلاحية البحث عن مريض';end if;
 if length(trim(coalesce(p_query,'')))<4 then return '[]';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'phone',p.phone,'age',p.age,'patient_code',p.patient_code,'can_open',psychcare.full_access(p.id) or psychcare.own_patient(p.id))),'[]') from(select * from public.patients where patient_code=trim(p_query) or (length(psychcare.phone(p_query))>=8 and psychcare.phone(phone)=psychcare.phone(p_query)) order by full_name limit 30)p);
end $$;
create function public.psychology_snapshot(p_patient uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=psychcare.require_staff();v jsonb;full_view boolean:=psychcare.full_access(p_patient);begin
 v:=jsonb_build_object('me',me,'can_review',public.can_manage_all_content(),'can_write',(public.has_role('psychology_specialist') or public.can_manage_all_content() or public.has_archive_access()),'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('patient_name',p.full_name,'patient_code',p.patient_code,'requester_name',a.name) order by r.created_at desc),'[]') from psychcare.requests r join public.patients p on p.id=r.patient_id join public.admins a on a.id=r.requested_by where public.can_manage_all_content() or r.requested_by=me),'patients',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'phone',p.phone,'age',p.age,'patient_code',p.patient_code) order by p.full_name),'[]') from public.patients p where psychcare.own_patient(p.id) or exists(select 1 from psychcare.requests where patient_id=p.id and requested_by=me and status='approved' and expires_at>now())));
 if p_patient is null then return v;end if;
 if not(full_view or psychcare.own_patient(p_patient)) then raise exception 'أرسل طلب استعراض وانتظر موافقة المدير';end if;
 if not exists(select 1 from public.patients where id=p_patient) then raise exception 'المريض غير موجود';end if;
 v:=v||jsonb_build_object('patient',(select jsonb_build_object('id',id,'full_name',full_name,'phone',phone,'age',age,'patient_code',patient_code) from public.patients where id=p_patient),'full_view',full_view,'records',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from psychcare.records r where patient_id=p_patient and(full_view or created_by=me)),'speech_profiles',(select coalesce(jsonb_agg(s),'[]') from public.patient_speech_profiles s where patient_id=p_patient and(full_view or created_by=me)),'psychology_profiles',(select coalesce(jsonb_agg(s),'[]') from public.patient_psychology_profiles s where patient_id=p_patient and(full_view or created_by=me)),'speech_sessions',(select coalesce(jsonb_agg(s order by session_at desc),'[]') from public.patient_speech_sessions s where patient_id=p_patient and(full_view or created_by=me)),'psychology_sessions',(select coalesce(jsonb_agg(s order by session_at desc),'[]') from public.patient_psychology_sessions s where patient_id=p_patient and(full_view or created_by=me)),'behavior_assessments',(select coalesce(jsonb_agg(s order by created_at desc),'[]') from public.patient_development_assessments s where patient_id=p_patient and assessment_kind='behavior' and(full_view or created_by=me)));
 return v;
end $$;
create function public.psychology_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=psychcare.require_staff();pid uuid:=(p_payload->>'patient_id')::uuid;req psychcare.requests%rowtype;op psychcare.operations%rowtype;p public.patients%rowtype;v jsonb;rid uuid;kind text:=p_payload->>'specialty';d jsonb:=p_payload->'data';begin
 if p_token is null then raise exception 'مفتاح العملية مطلوب';end if;
 perform pg_advisory_xact_lock(hashtextextended('psychcare:'||coalesce(pid::text,me::text),782));
 select * into op from psychcare.operations where actor=me and token=p_token;
 if found then if op.action<>p_action or op.payload<>p_payload then raise exception 'مفتاح العملية مستخدم لبيانات أخرى';end if;return op.result;end if;
 if p_action in ('create_patient','complete_patient','record_add') and not(public.has_role('psychology_specialist') or public.can_manage_all_content() or public.has_archive_access()) then raise exception 'المعاينة لا تسمح بإضافة بيانات';end if;
 if p_action='create_patient' then
 perform psychcare.check_basics(p_payload->>'full_name',p_payload->>'phone',(p_payload->>'age')::integer);
 perform pg_advisory_xact_lock(hashtextextended(psychcare.phone(p_payload->>'phone'),781));
 select * into p from public.patients where psychcare.phone(phone)=psychcare.phone(p_payload->>'phone') and psychcare.name(full_name)=psychcare.name(p_payload->>'full_name') limit 1;
 if found then v:=jsonb_build_object('id',p.id,'existing',true,'full_name',p.full_name,'can_open',psychcare.full_access(p.id) or psychcare.own_patient(p.id));
 else insert into public.patients(full_name,phone,phone_normalized,age,created_by) values(trim(p_payload->>'full_name'),trim(p_payload->>'phone'),'+'||psychcare.phone(p_payload->>'phone'),(p_payload->>'age')::integer,me) returning * into p;pid:=p.id;v:=jsonb_build_object('id',p.id,'existing',false,'full_name',p.full_name,'can_open',true);end if;
 elsif p_action='request_access' then
 if not public.has_role('psychology_specialist') or not exists(select 1 from public.patients where id=pid) then raise exception 'المريض غير متاح للطلب';end if;
 insert into psychcare.requests(patient_id,requested_by,reason) values(pid,me,trim(p_payload->>'reason')) on conflict(patient_id,requested_by) where status='pending' do update set reason=excluded.reason returning id into rid;v:=jsonb_build_object('id',rid);
 elsif p_action in ('review_access','revoke_access') then
 if not public.can_manage_all_content() then raise exception 'الاعتماد للمدير أو السوبر أدمن فقط';end if;
 select * into req from psychcare.requests where id=(p_payload->>'id')::uuid for update;
 if not found or req.requested_by=me then raise exception 'الطلب غير متاح أو يحتاج مراجعًا آخر';end if;
 if length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'اكتب سبب القرار';end if;
 if p_action='revoke_access' then if req.status<>'approved' then raise exception 'لا يوجد استعراض معتمد لإلغائه';end if;
 update psychcare.requests set status='revoked',reviewed_by=me,review_note=p_payload->>'note',reviewed_at=now(),expires_at=now() where id=req.id;
 else
 if req.status<>'pending' then raise exception 'تمت مراجعة الطلب بالفعل';end if;
 if coalesce((p_payload->>'days')::integer,7) not between 1 and 90 then raise exception 'مدة الاستعراض من يوم إلى 90 يومًا';end if;
 update psychcare.requests set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_by=me,review_note=p_payload->>'note',reviewed_at=now(),expires_at=case when (p_payload->>'approve')::boolean then now()+make_interval(days=>coalesce((p_payload->>'days')::integer,7)) else null end where id=req.id;
 end if;pid:=req.patient_id;v:=jsonb_build_object('id',req.id);
 else
 if not(psychcare.full_access(pid) or psychcare.own_patient(pid)) then raise exception 'أرسل طلب استعراض وانتظر موافقة المدير';end if;
 select * into p from public.patients where id=pid for update;
 if not found then raise exception 'المريض غير موجود';end if;
 if p_action='complete_patient' then
 if nullif(trim(p.full_name),'') is null or array_length(regexp_split_to_array(trim(p.full_name),'[[:space:]]+'),1)<2 then p.full_name:=p_payload->>'full_name';end if;
 if psychcare.phone(p.phone)!~'^[0-9]{8,15}$' then p.phone:=p_payload->>'phone';end if;
 if p.age is null then p.age:=(p_payload->>'age')::integer;end if;
 perform psychcare.check_basics(p.full_name,p.phone,p.age);
 update public.patients set full_name=p.full_name,phone=p.phone,phone_normalized='+'||psychcare.phone(p.phone),age=p.age where id=pid;v:=jsonb_build_object('id',pid);
 elsif p_action='record_add' then
 perform psychcare.check_basics(p.full_name,p.phone,p.age);
 if coalesce(kind,'') not in ('psychology','speech','behavior') or coalesce(p_payload->>'record_kind','') not in ('assessment','session') or jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>100000 then raise exception 'راجع نوع السجل وبياناته';end if;
 if p_payload->>'record_kind'='session' then
 if nullif(d->>'session_at','') is null then raise exception 'موعد الجلسة مطلوب';end if;
 perform (d->>'session_at')::timestamptz;
 if length(trim(coalesce(d->>'specialist_notes','')||coalesce(d->>'session_goal','')||coalesce(d->>'goals','')||coalesce(d->>'training_done','')))<3 then raise exception 'اكتب تفاصيل الجلسة أو أهدافها';end if;
 end if;
 -- Ownership and timestamps are generated here; no update/delete endpoint exists.
 insert into psychcare.records(patient_id,specialty,record_kind,data,created_by) values(pid,kind,p_payload->>'record_kind',d-'created_by'-'updated_by'-'created_at'-'updated_at'-'patient_id'-'id',me) returning id into rid;v:=jsonb_build_object('id',rid);
 else raise exception 'إجراء غير معروف';end if;
 end if;
 insert into psychcare.audit(actor,action,patient_id,detail) values(me,p_action,pid,jsonb_build_object('payload',p_payload,'result',v));
 insert into psychcare.operations(actor,token,action,payload,result) values(me,p_token,p_action,p_payload,v);return v;
end $$;
revoke all on all functions in schema psychcare from public,anon,authenticated;
revoke all on function public.psychology_command(text,jsonb,uuid),public.psychology_snapshot(uuid),public.psychology_lookup(text) from public,anon;
grant execute on function public.psychology_command(text,jsonb,uuid),public.psychology_snapshot(uuid),public.psychology_lookup(text) to authenticated;
commit;
