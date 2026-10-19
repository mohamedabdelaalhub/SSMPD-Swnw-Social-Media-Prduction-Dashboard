begin;
create table clinic_finance.reconciliation_followups(row_id uuid primary key references clinic_finance.bank_rows(id),task_id uuid not null,assignee_id uuid not null references public.admins(id),created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
create table clinic_finance.reconciliation_projects(manager_id uuid not null references public.admins(id),assignee_id uuid not null references public.admins(id),project_id uuid not null,primary key(manager_id,assignee_id));
alter table clinic_finance.reconciliation_followups enable row level security;
alter table clinic_finance.reconciliation_projects enable row level security;
revoke all on clinic_finance.reconciliation_followups,clinic_finance.reconciliation_projects from public,anon,authenticated;
create function public.clinic_finance_reconciliation_task(p_row uuid,p_assignee uuid,p_due timestamptz,p_note text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');r clinic_finance.bank_rows%rowtype;s clinic_finance.bank_statements%rowtype;v uuid;project uuid;person text;begin
 perform clinic_finance.lock_day();perform pg_advisory_xact_lock(hashtextextended(p_row::text,0));
 if p_token is null or length(trim(coalesce(p_note,''))) not between 3 and 1000 or p_due is null or p_due<=now() then raise exception 'حدد موعدًا قادمًا وسبب طلب المراجعة';end if;
 select * into r from clinic_finance.bank_rows where id=p_row;if not found or r.line_id is not null then raise exception 'اختر اختلافًا غير مطابق';end if;
 select task_id into v from clinic_finance.reconciliation_followups where row_id=r.id;if found then return v;end if;
 select * into s from clinic_finance.bank_statements where id=r.statement_id;
 select name into person from public.admins where id=p_assignee and active;if not found then raise exception 'اختر موظفًا مفعّلًا';end if;
 select project_id into project from clinic_finance.reconciliation_projects where manager_id=me and assignee_id=p_assignee;
 if project is null then
 insert into public.task_projects(title,description,created_by,manager_id) values('متابعة المطابقة — '||left(person,100),'طلبات تحقق من اختلافات التحصيل. التكليف لا يعني تحميل الموظف مسؤولية الفرق.',me,me) returning id into project;
 insert into public.task_project_members(project_id,admin_id,role_name) values(project,me,'manager');
 insert into clinic_finance.reconciliation_projects values(me,p_assignee,project);
 end if;
 v:=public.task_create(project,null,'مراجعة مرجع تحصيل '||left(r.reference,100),'الكشف '||s.reference||E'\nمرجع العملية '||r.reference||E'\nالتاريخ '||r.day::text||E'\nالمطلوب '||trim(p_note),'توضيح العملية وإرفاق إثباتها للمراجعة المالية. لا تعدّل الأرصدة لتسوية الفرق دون اعتماد.',p_assignee,p_due,'high');
 insert into clinic_finance.reconciliation_followups values(r.id,v,p_assignee,me,now());
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'reconciliation_task',r.id,jsonb_build_object('task_id',v,'assignee_id',p_assignee,'due',p_due));return v;
end $$;
revoke all on function public.clinic_finance_reconciliation_task(uuid,uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.clinic_finance_reconciliation_task(uuid,uuid,timestamptz,text,uuid) to authenticated;
commit;
