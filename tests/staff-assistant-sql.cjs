// 20261128200000 «اسأل المساعد» phase 1 (owner approved the UX5 mockup 2026-11-28): staff requests + owner decisions + notifications,
// private screenshot paths, server-side redaction, daily question cap from the monthly budget, usage counter (tokens only), rollback.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;grant usage on schema public to authenticated, service_role;
  create table admins(id uuid primary key,email text not null,name text,role text,active boolean default true,user_id uuid);
  create table admin_extra_roles(admin_id uuid,role text);
  create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
  create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
  create table public.staff_notifications(id uuid primary key default gen_random_uuid(),recipient_admin_id uuid not null references public.admins(id),
   kind text not null check (kind in ('booking_today','arrived','draft_submitted','draft_returned')),appointment_id uuid,archive_patient_id uuid,
   title text not null check (length(title)<=200),created_at timestamptz not null default now(),read_at timestamptz);
  alter table public.staff_notifications enable row level security;grant select on public.staff_notifications to authenticated;
  create policy staff_notifications_own on public.staff_notifications for select to authenticated using (recipient_admin_id = public.my_admin_id());`);
 const id=n=>'62000000-0000-4000-8000-'+String(n).padStart(12,'0');
 for(const [n,r,nm] of [[1,'super_admin','المالك'],[2,'nursing','هدى'],[3,'reception','هالة']])await db.query('insert into admins(id,email,name,role) values($1,$2,$3,$4)',[id(n),'a'+n+'@x.test',nm,r]);
 const M=fs.readFileSync('supabase/migrations/20261128200000_staff_assistant.sql','utf8');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback').catch(()=>{});
 const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
 const call=async(fn,args=[])=>{const ph=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${fn}(${ph}) r`,args)).rows[0].r;};
 const owner=async(sql,a)=>{await db.exec('reset role');return (await db.query(sql,a)).rows;};
 // staff (nurse, admin 2) opens a request — context redacted on the server (names / phones out, file_no kept)
 await as(2);
 await assert.rejects(()=>call('staff_assistant_request_create',['شغل اليوم','x',null,null]),/اكتب المشكلة/);
 await assert.rejects(()=>call('staff_assistant_request_create',['شغل اليوم','الكرومو بيقول الرصيد مش كفاية',id(3)+'/a.png',null]),/من فولدرك/);
 const ctx={screen:'nursing',patient_name:'مريض حقيقي',phone:'01012345678',file_no:'P-2026-000123',note:'اتصل على 0101 234 5678 بعدين',rows:[{full_name:'س',file_no:'F9'}]};
 const r1=await call('staff_assistant_request_create',['شغل اليوم — التمريض','الكرومو بيقول الرصيد مش كفاية',id(2)+'/shot1.png',JSON.stringify(ctx)]);
 assert(r1.id&&r1.number>=1&&r1.status==='new');
 const stored=(await owner('select context from staff_assistant.requests where id=$1',[r1.id]))[0].context;
 assert.equal(stored.patient_name,undefined);assert.equal(stored.phone,undefined);assert.equal(stored.file_no,'P-2026-000123');assert.equal(stored.rows[0].full_name,undefined);assert.equal(stored.rows[0].file_no,'F9');
 assert(!/\d{4}/.test(stored.note.replace('P-2026','')),'phone digits masked: '+stored.note);
 await as(2);let mine=await call('staff_assistant_my_requests');assert.equal(mine.length,1);assert.equal(mine[0].unseen,false);assert.equal(mine[0].timeline[0].status,'new');assert.equal(mine[0].image_path,undefined,'staff list has no owner fields');
 // another staff member does not see it; non-owner cannot list all / decide
 await as(3);assert.equal((await call('staff_assistant_my_requests')).length,0);
 for(const [fn,a] of [['staff_assistant_all_requests',[null]],['staff_assistant_decide',[r1.id,'approve',null]],['staff_assistant_set_status',[r1.id,'shipped',null]],['staff_assistant_annotate',[r1.id,'{}']],['staff_assistant_settings',['get','{}']]])
  await assert.rejects(()=>call(fn,a),/للمالك بس/,fn);
 await assert.rejects(()=>call('staff_assistant_request_seen',[r1.id]),/مش موجود/);
 // owner: list, annotate, need_info (note required) → staff notified, replies → new → approve → in_progress → shipped
 await as(1);let all=await call('staff_assistant_all_requests',[null]);assert.equal(all.summary.waiting,1);assert.equal(all.requests[0].staff_name,'هدى');assert.equal(all.requests[0].image_path,id(2)+'/shot1.png');
 await call('staff_assistant_annotate',[r1.id,JSON.stringify({category:'improvement',proposal:'نعلّمه «بيتصرف بالعبوة»',impact:'شاشة التمريض والكتالوج بس',touches_money:false})]);
 await assert.rejects(()=>call('staff_assistant_annotate',[r1.id,JSON.stringify({category:'x'})]),/النوع/);
 await assert.rejects(()=>call('staff_assistant_decide',[r1.id,'need_info',null]),/اكتب السبب/);
 await assert.rejects(()=>call('staff_assistant_set_status',[r1.id,'shipped',null]),/يتوافق عليه الأول/);
 await call('staff_assistant_decide',[r1.id,'need_info','الصنف ده إيه بالظبط؟']);
 await as(2);mine=await call('staff_assistant_my_requests');assert.equal(mine[0].status,'need_info');assert.equal(mine[0].unseen,true);assert.equal(mine[0].decision_note,'الصنف ده إيه بالظبط؟');
 let notes=(await db.query('select kind,title,request_id from public.staff_notifications')).rows;assert.equal(notes.length,1);assert.equal(notes[0].kind,'assistant_request');assert.match(notes[0].title,/^طلب \d+: محتاج توضيح منك — الصنف ده إيه/);assert.equal(notes[0].request_id,r1.id);
 await as(3);assert.equal((await db.query('select count(*) n from public.staff_notifications')).rows[0].n,0,'others do not see the notification');
 await as(2);await call('staff_assistant_request_seen',[r1.id]);assert.equal((await call('staff_assistant_my_requests'))[0].unseen,false);
 await call('staff_assistant_request_reply',[r1.id,'الكرومو']);await assert.rejects(()=>call('staff_assistant_request_reply',[r1.id,'تاني']),/مش مستني توضيح/);
 await as(1);await call('staff_assistant_decide',[r1.id,'approve',null]);await assert.rejects(()=>call('staff_assistant_decide',[r1.id,'reject','مش مناسب']),/اتاخد فيه قرار/);
 await call('staff_assistant_set_status',[r1.id,'in_progress',null]);await call('staff_assistant_set_status',[r1.id,'shipped','دوس «فتحت عبوة جديدة» بدل «صرف داخلي»']);
 await as(2);mine=await call('staff_assistant_my_requests');assert.equal(mine[0].status,'shipped');assert.deepEqual(mine[0].timeline.map(x=>x.status),['new','need_info','new','approved','in_progress','shipped']);
 assert.match((await db.query("select title from public.staff_notifications order by created_at desc limit 1")).rows[0].title,/نزل — دوس «فتحت عبوة جديدة»/);
 // rate limit: 20 an hour
 await as(3);for(let i=0;i<20;i++)await call('staff_assistant_request_create',['s','طلب '+i,null,null]);await assert.rejects(()=>call('staff_assistant_request_create',['s','طلب زيادة',null,null]),/طلبات كتير/);
 // usage: cap from the monthly budget (20 $ / 30 / 0.0015 = 444); usage_take reserves one; record is service-role only
 await as(1);let st=await call('staff_assistant_settings',['get','{}']);assert.equal(st.daily_cap,444);assert.equal(+st.monthly_budget_usd,20);
 await as(2);let t=await call('staff_assistant_usage_take');assert.equal(t.ok,true);assert.equal(t.role,'nursing');assert.equal(t.remaining,443);
 await assert.rejects(()=>call('staff_assistant_usage_record',[100,50,9000,0]),/permission denied/);
 await db.exec('reset role');await db.exec('set role service_role');await db.query('select public.staff_assistant_usage_record(1000,500,9000,0)');
 await as(1);st=await call('staff_assistant_settings',['get','{}']);assert.equal(st.today.questions,1);assert(Math.abs(+st.today.cost_usd-((1000*0.10+500*0.50+9000*0.01)/1e6))<1e-9,'cost '+st.today.cost_usd);
 // budget 0.03 $/month → cap 0 → «cap»; disabled → «off»
 await call('staff_assistant_settings',['set',JSON.stringify({monthly_budget_usd:0.03})]);await as(2);assert.deepEqual(await call('staff_assistant_usage_take'),{ok:false,reason:'cap'});
 await as(1);await call('staff_assistant_settings',['set',JSON.stringify({monthly_budget_usd:20,enabled:false})]);await as(2);assert.deepEqual(await call('staff_assistant_usage_take'),{ok:false,reason:'off'});
 await as(1);await call('staff_assistant_settings',['set',JSON.stringify({enabled:true})]);
 // cost cap: today's cost ≥ monthly/30 stops even under the question cap
 await db.exec('reset role');await db.query("update staff_assistant.usage_daily set cost_usd=0.67");await as(2);assert.equal((await call('staff_assistant_usage_take')).reason,'cap');
 assert.equal(+(await owner('select refused from staff_assistant.usage_daily'))[0].refused,3);
 // closed: anon cannot call; authenticated cannot read the tables directly; screenshot policy helper
 await db.exec('reset role');
 for(const f of ['public.staff_assistant_request_create(text,text,text,jsonb)','public.staff_assistant_usage_take()','public.staff_assistant_all_requests(date)'])assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') x",[f])).rows[0].x,false,f);
 assert.equal((await db.query("select has_table_privilege('authenticated','staff_assistant.requests','select') x")).rows[0].x,false);
 await as(2);assert.equal(await call('assistant_shot_allowed',[id(2)+'/a.png',true]),true);assert.equal(await call('assistant_shot_allowed',[id(3)+'/a.png',true]),false);assert.equal(await call('assistant_shot_allowed',[id(3)+'/a.png',false]),false);
 await as(1);assert.equal(await call('assistant_shot_allowed',[id(3)+'/a.png',false]),true,'owner reads any shot');
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261128200000_staff_assistant.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regclass('staff_assistant.requests') x")).rows[0].x,null);
 assert.equal((await db.query("select count(*) n from information_schema.columns where table_name='staff_notifications' and column_name='request_id'")).rows[0].n,0);
 await db.query("insert into public.staff_notifications(recipient_admin_id,kind,title) values($1,'arrived','x')",[id(2)]);
 await assert.rejects(()=>db.query("insert into public.staff_notifications(recipient_admin_id,kind,title) values($1,'assistant_request','x')",[id(2)]),/check/);
 await db.close();console.log('PASS staff assistant: request create (redacted context, own-folder image, rate limit), own list / seen / reply, owner-only list / annotate / decide / status with timeline + notifications to the requester only, daily cap from the monthly budget + cost cap + off switch, usage record service-role only, closed tables, screenshot policy, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
