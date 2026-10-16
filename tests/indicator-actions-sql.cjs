const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10),stamp=n=>new Date(Date.now()+n*864e5).toISOString();
(async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create table admins(id uuid primary key,name text,email text,role text,active boolean default true);
 create function my_admin_id() returns uuid language sql stable as $$select (select id from admins where id=nullif(current_setting('test.admin',true),'')::uuid and active)$$;
 create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
 grant usage on schema public to authenticated,service_role;grant select on admins to authenticated;`);
 await db.exec(fs.readFileSync(root+'/supabase/migrations/202610120001_tasks_module.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 const migration=fs.readFileSync(root+'/supabase/migrations/202610170001_indicator_actions.sql','utf8');await db.exec(migration);await db.exec(migration);
 for(const [n,role] of [[1,'super_admin'],[2,'page_manager'],[3,'designer'],[4,'general_manager'],[5,'page_manager']])await db.query('insert into admins(id,name,email,role) values($1,$2,$3,$4)',[id(n),'user '+n,'u'+n+'@example.invalid',role]);
 const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);await db.exec('set role authenticated');};
 const call=async(fn,args=[])=> (await db.query('select '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
 const owner=async(q,args=[])=>{await db.exec('reset role');return db.query(q,args);};
 const doc=(n,from,to,risks=[{id:'bookLoss',title:'الحجوزات الضائعة',area:'التشغيل',sev:'high',value:'25%',metric:'فقد الحجوزات',finding:'25 من 100',target:'15%'}])=>({schema_version:1,fingerprint:String(n).padStart(64,'0'),branch:'حدائق الأهرام',scope:'الحجوزات',title:'تقرير الحجز',period_from:date(from),period_to:date(to),kpis:{revenue:100},risks,recommendations:[],plan:[]});
 async function ingest(doc){await db.exec('reset role;set role service_role');return call('operations_ingest_snapshot',[doc,new Date().toISOString(),id(1)]);}
 const r1=await ingest(doc(1,-30,-21));assert.equal((await ingest(doc(1,-30,-21))).duplicate,true);
 await as(1);let issues=(await db.query('select * from operational_issues')).rows;const issue=issues[0].id;assert.equal(issues[0].appearance_count,1);
 await ingest(doc(2,-30,-21));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.appearance_count,1,'same-period revision');
 await ingest(doc(3,-25,-18));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.appearance_count,1,'overlap is not another independent recurrence');
 await ingest(doc(4,-17,-10));await as(1);let detail=await call('operations_issue_detail',[issue]);assert.equal(detail.issue.appearance_count,2);assert.equal(detail.issue.status,'persistent');
 const project=await call('task_create_project',['معالجة الحجوزات','',id(1),[]]);
 const args=[issue,project,'مراجعة فقد الحجوزات','راجع أسباب الإلغاء وعدم الرد','جدول أسباب موثق',id(2),stamp(3),date(4),'content','sono','dentistry',[{title:'جمع الأسباب',output:'جدول الأسباب',due_at:stamp(1)},{title:'تجربة الرسالة',output:'نسختان معتمدتان',due_at:stamp(2),assignee_id:id(3)}]];
 const action=await call('operations_create_action',args);await assert.rejects(()=>call('operations_create_action',args),/التكليف موجود/);
 detail=await call('operations_issue_detail',[issue]);const task=detail.actions[0].task_id;const children=(await db.query('select id,assignee_id from tasks where parent_task_id=$1 order by due_at',[task])).rows;assert.equal(children.length,2);
 await as(2);assert((await call('operations_content_brief',['sono','dentistry'])).includes('راجع أسباب'));assert.equal(await call('operations_content_brief',['dr_dina','dentistry']),'');
 assert.equal((await db.query('select * from operational_reports')).rows.length,0,'staff cannot read financial reports');
 await assert.rejects(()=>call('operations_issue_detail',[issue]),/غير مسموح/);assert.equal((await call('operations_task_context',[task])).appearances,2);
 await as(5);assert.equal(await call('operations_content_brief',['sono','dentistry']),'');await assert.rejects(()=>call('operations_task_context',[task]),/غير مسموح/);
 await as(2);await call('task_set_status',[task,'in_progress','بدأت المراجعة']);await call('task_set_status',[task,'review','تم العمل وإرفاق المخرجات']);
 await as(1);await assert.rejects(()=>call('task_review',[task,true,'اعتماد']),/كل مراحل/);
 for(const [index,actor] of [[0,2],[1,3]]){await as(actor);await call('task_set_status',[children[index].id,'review','المخرج جاهز للمراجعة']);await as(1);await call('task_review',[children[index].id,true,'تم التحقق']);}
 await as(1);await call('task_review',[task,true,'تم التحقق من النتائج']);
 detail=await call('operations_issue_detail',[issue]);assert(detail.actions[0].submitted_at);assert(detail.actions[0].accepted_at);assert.equal(detail.actions[0].employee_late_seconds,0,'submission independent of acceptance');
 const frozen=(await db.query('select first_submission_due_at from tasks where id=$1',[task])).rows[0].first_submission_due_at;
 const before=(await db.query('select original_due_at from tasks where id=$1',[task])).rows[0].original_due_at;
 await owner('update tasks set due_at=due_at+interval \'1 day\' where id=$1',[task]);const after=(await db.query('select original_due_at from tasks where id=$1',[task])).rows[0].original_due_at;assert.equal(String(before),String(after));assert.equal(String((await db.query('select first_submission_due_at from tasks where id=$1',[task])).rows[0].first_submission_due_at),String(frozen),'later deadline edits do not rewrite submission lateness');assert((await db.query('select count(*) n from operational_task_events where task_id=$1',[task])).rows[0].n>=3);
 await ingest(doc(5,-9,0,[]));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.status,'persistent','absence alone does not close');
 await assert.rejects(()=>call('operations_record_outcome',[action,r1.id,'resolved','10%','نسبة الحجوزات تحسنت بعد التنفيذ']),/تقرير متابعة|لم يحن/);
 const latest=(await db.query('select id from operational_reports where fingerprint=$1',[String(5).padStart(64,'0')])).rows[0].id;
 await as(2);await assert.rejects(()=>call('operations_record_outcome',[action,latest,'resolved','10%','تحسنت بعد التنفيذ']),/للإدارة/);
 await owner('update operational_actions set measure_after=current_date where id=$1',[action]);await as(1);
 await call('operations_record_outcome',[action,latest,'resolved','10%','تمت مراجعة السجلات وانخفض الفقد إلى المستهدف']);
 assert.equal((await call('operations_issue_detail',[issue])).issue.status,'resolved');
 // Late delivery is retained without undoing a newer resolution.
 await ingest(doc(6,-50,-40));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.status,'resolved');
 // A corrected follow-up that still reports the problem invalidates a previously reviewed resolution and records its first appearance for that previously clear follow-up window.
 const countBefore=(await call('operations_issue_detail',[issue])).issue.appearance_count;
 await ingest(doc(9,-9,0));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.status,'reopened');assert.equal((await call('operations_issue_detail',[issue])).issue.appearance_count,countBefore+1);
 await ingest(doc(10,-9,0));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.appearance_count,countBefore+1,'correcting that window again does not inflate recurrence');
 // A genuine future period after resolution reopens the same issue (no duplicate registry row).
 await ingest(doc(7,1,4));await as(1);assert.equal((await call('operations_issue_detail',[issue])).issue.status,'reopened');assert.equal((await db.query('select count(*) n from operational_issues')).rows[0].n,1);
 await db.exec('reset role;set role anon');await assert.rejects(()=>call('operations_issue_detail',[issue]),/permission denied/);
 await db.exec('reset role;set role authenticated');await assert.rejects(()=>call('operations_ingest_snapshot',[doc(8,5,6),new Date().toISOString(),id(1)]),/permission denied/);
 await as(1);for(let k=0;k<20;k++)assert.equal(await call('operations_advice_limit'),true);assert.equal(await call('operations_advice_limit'),false);
 await db.close();console.log('PASS indicator SQL: repeat activation, delivery/revision/overlap dedupe, recurrence/reopening/backfill, RLS and worker-only ingress, approved task milestones, timing/deadline audit, content scope, measured resolution and AI quotas');
})().catch(e=>{console.error(e);process.exit(1)});
