-- Uses existing identities with synthetic tasks, wholly rolled back. Does not upload files or contact employees.
begin;
do $test$
declare m uuid;mu uuid;w uuid;wu uuid;p uuid;t uuid;c uuid;r uuid;again uuid;req uuid:=gen_random_uuid();atts jsonb;cnt int;
begin
 select id,user_id into m,mu from public.admins where active and role='super_admin' and user_id is not null limit 1;
 select id,user_id into w,wu from public.admins where active and role='page_manager' and user_id is not null limit 1;
 if mu is null or wu is null then raise exception 'Test identities unavailable';end if;
 perform set_config('request.jwt.claim.sub',mu::text,true);
 p:=public.task_create_project('اختبار تسليم سيُتراجع عنه','اختبار تقني',m,'[]');
 t:=public.task_create(p,null,'اختبار نص ومرفق','نتيجة اختبار','ملف',w,now()+interval '1 day','normal');
 perform set_config('request.jwt.claim.sub',wu::text,true);
 set local role authenticated;
 atts:='[{"name":"اختبار.docx","url":"https://drive.google.com/file/d/task-work-rollback/view","size":123,"mime":"application/octet-stream"}]'::jsonb;
 r:=public.task_submit_work(t,req,'review',repeat('نص اختبار ',1000),'https://docs.google.com/document/d/task-work-rollback',atts);
 again:=public.task_submit_work(t,req,'review',repeat('نص اختبار ',1000),'https://docs.google.com/document/d/task-work-rollback',atts);
 if again<>r then raise exception 'Retry changed result';end if;
 select count(*) into cnt from public.task_work_results where task_id=t;
 if cnt<>1 then raise exception 'Duplicate result';end if;
 if not exists(select 1 from public.tasks where id=t and status='review' and first_submitted_at is not null) then raise exception 'Submission timing missing';end if;
 begin
  perform public.task_submit_work(t,gen_random_uuid(),'review','again','','[]');raise exception 'Should reject duplicate status';
 exception when others then if sqlerrm='Should reject duplicate status' then raise;end if;end;
 reset role;
 perform set_config('request.jwt.claim.sub',mu::text,true);
 set local role authenticated;
 if not exists(select 1 from public.task_work_results where id=r and length(body)>5000 and jsonb_array_length(attachments)=1) then raise exception 'Manager cannot read complete result';end if;
 begin
  perform public.task_submit_work(t,gen_random_uuid(),'review','manager cannot submit','','[]');raise exception 'Should reject foreign assignee';
 exception when others then if sqlerrm='Should reject foreign assignee' then raise;end if;end;
 perform public.task_review(t,false,'تعديل اختبار');
 reset role;
 perform set_config('request.jwt.claim.sub',wu::text,true);
 set local role authenticated;
 begin
  perform public.task_submit_work(t,gen_random_uuid(),'review','bad attachment','','[{"name":"x.pdf","url":"https://drive.google.com.evil.invalid/file","size":10}]');raise exception 'Should reject invalid attachment';
 exception when others then if sqlerrm='Should reject invalid attachment' then raise;end if;end;
 if (select count(*) from public.task_work_results where task_id=t)<>1 then raise exception 'Failed submission left a result';end if;
 if not exists(select 1 from public.tasks where id=t and status='revision') then raise exception 'Failed submission changed state';end if;
 reset role;
end $test$;
select 'PASS long text, valid Drive metadata, assignee submission, manager review, retry, timing, invalid-file rollback' as result;
rollback;
