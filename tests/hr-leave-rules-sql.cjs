// Leave rules (Labor Law 14/2025 + owner decisions): leave types, notice, casual pacing and caps, sick certificate,
// birth day, owner-level exceptions, refund of an absence already deducted, and the fingerprint run waiting for sick leave.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
const iso=d=>d.toISOString().slice(0,10),add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d);};
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261116100000_hr_leave_rules'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
await owner('insert into admins(id,name,role) values($1,$2,$3)',[id(5),'Test 5','general_manager']);
const today=(await owner("select ((now() at time zone 'Africa/Cairo')::date)::text d"))[0].d,ytd=add(today,-1);
// M = the first day of the month after next; Y = its year. Seeded casual days sit in another quarter of Y.
const M=(await owner("select (date_trunc('month',$1::date)+interval '2 months')::date::text d",[today]))[0].d,Y=M.slice(0,4),Mm=+M.slice(5,7);
const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-L',employee_name:'موظفة إجازات',base:6000,from:'2026-01-01',to:'2099-12-31',reference:'CONTRACT-L',note:'عقد اختبار'},key()]);
await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
await as(1);const p=await call('hr_command',['person',{full_name:'موظفة إجازات',finance_subject:'EMP-L',admin_id:id(4)}]);
const rule=await call('hr_payroll_command',['rule',{person_id:p,valid_from:'2026-01-01',valid_to:'2099-12-31',late_grace:15,late_minute:2,absence_day:200,overtime_hour:50,note:'قواعد اختبار'}]);
await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);
const req=(who,body)=>as(who).then(()=>call('hr_command',['request',Object.assign({person_id:p,note:'سبب الطلب'},body)]));
const review=(who,rid,decision='approved')=>as(who).then(()=>call('hr_command',['request_review',{id:rid,decision,review_note:'قرار المراجع'}]));
const row=async rid=>(await owner('select * from clinic_people.requests where id=$1',[rid]))[0];
// Annual credit for year Y (21 days).
for(const yr of new Set([Y,add(today,1).slice(0,4)])){const credit=await req(1,{kind:'leave_credit',from_date:yr+'-01-01',to_date:yr+'-01-21',units:21});await review(3,credit);}
// Annual: 1 day needs 2 days' notice; short notice needs a written exception, which another HR reviewer can accept.
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'annual',from_date:add(today,1),to_date:add(today,1),units:1}),/خارج القواعد.*إخطار/);
const shortA=await req(4,{kind:'leave',leave_type:'annual',from_date:add(today,1),to_date:add(today,1),units:1,notice_reason:'ظرف عائلي'});
assert.deepEqual((await row(shortA)).rule_breaks,['short_notice']);
await review(3,shortA);assert.equal((await row(shortA)).exception_by,id(3),'the reviewer is recorded as the one who granted the exception');
const okA=await req(4,{kind:'leave',from_date:add(today,10),to_date:add(today,10),units:1});
const a=await row(okA);assert.equal(a.leave_type,'annual','leave without a type is annual');assert.deepEqual(a.rule_breaks,[]);
// Casual: legal caps are hard; pacing (2 a month, 3 a quarter) needs an exception.
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'casual',from_date:M,to_date:add(M,2),units:3}),/يومين بالكتير/);
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'casual',from_date:M,to_date:add(M,1),units:1}),/لازم يساوي/);
await owner('alter table clinic_people.requests disable trigger requests_leave_rules');
const seedMonths=Mm<=6?['10','11']:['01','04'];
for(const mo of seedMonths)await owner("insert into clinic_people.requests(person_id,kind,leave_type,from_date,to_date,units,note,status,created_by,reviewed_by) values($1,'leave','casual',$2,$3,2,'عارضة سابقة','approved',$4,$5)",[p,Y+'-'+mo+'-10',Y+'-'+mo+'-11',id(1),id(3)]);
await owner('alter table clinic_people.requests enable trigger requests_leave_rules');
const c1=await req(4,{kind:'leave',leave_type:'casual',from_date:M,to_date:M,units:1});
const c2=await req(4,{kind:'leave',leave_type:'casual',from_date:add(M,1),to_date:add(M,1),units:1});
assert.deepEqual((await row(c2)).rule_breaks,[],'two casual days in a month are fine');
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'casual',from_date:add(M,2),to_date:add(M,2),units:1}),/توزيع العارضة/);
const c3=await req(4,{kind:'leave',leave_type:'casual',from_date:add(M,2),to_date:add(M,2),units:1,notice_reason:'طارئ'});
assert.deepEqual((await row(c3)).rule_breaks,['casual_pace']);
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'casual',from_date:add(M,5),to_date:add(M,5),units:1,notice_reason:'طارئ'}),/7 أيام في السنة/);
const sameDay=(await owner("select clinic_people.leave_break_labels(array['retroactive']) l"))[0].l;assert.deepEqual(sameDay,['بأثر رجعي']);
await review(3,c1);
// Sick: no certificate → only an owner-level reviewer; with a certificate in time, HR approves; no balance used.
const s=await req(4,{kind:'leave',leave_type:'sick',from_date:add(M,10),to_date:add(M,11),units:2});
await assert.rejects(()=>review(3,s),/اعتماد استثنائي.*شهادة/);
await as(4);await assert.rejects(()=>call('hr_command',['sick_certificate',{id:s,certificate_url:'not a link'}]),/https/);
await call('hr_command',['sick_certificate',{id:s,certificate_url:'https://drive.google.com/file/d/abc123/view'}]);
await review(3,s);assert.equal((await row(s)).exception_by,null);
await as(4);const ws=await call('hr_workspace',[M]);const me=ws.people.find(x=>x.id===p);
assert.equal(Number(me.leave_balance),21-4-1-(add(today,1).slice(0,4)===Y?1:0),'balance = credit − annual − casual; sick is not deducted');
assert.equal(ws.owner_level,false);
// Birth: one day, at most three times.
for(const n of [15,16,17])await req(4,{kind:'leave',leave_type:'birth',from_date:add(M,n),to_date:add(M,n),units:1});
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'birth',from_date:add(M,18),to_date:add(M,18),units:1}),/3 مرات/);
// Excused: management only, owner-level approval; the absence already deducted in a salary sent to finance is refunded.
await assert.rejects(()=>req(4,{kind:'leave',leave_type:'excused',from_date:'2026-10-03',to_date:'2026-10-03',units:1,notice_reason:'ظرف قوي'}),/للإدارة/);
await owner("insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,status,created_by,reviewed_by) values($1,'2026-10-03','2026-10-03T08:00+03','2026-10-03T16:00+03',null,null,'غياب','approved',$2,$3)",[p,id(1),id(3)]);
await as(1);let calc=await call('hr_payroll_calculate',[p,'2026-10-01']);assert.equal(calc.absent_shifts,1);
await owner("insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token) values('payroll','EMP-L','PAY-2026-10-L',5800,'{\"month\":\"2026-10-01\"}',$1,gen_random_uuid())",[id(1)]);
const ex=await req(1,{kind:'leave',leave_type:'excused',from_date:'2026-10-03',to_date:'2026-10-03',units:1,notice_reason:'حادثة على الطريق ثبتت بعدين'});
await assert.rejects(()=>review(3,ex),/اعتماد استثنائي/);
await review(5,ex);const exr=await row(ex);assert.equal(exr.exception_by,id(5));assert.ok(exr.refund_adjustment_id,'refund adjustment created');
const adj=(await owner('select * from clinic_people.pay_adjustments where id=$1',[exr.refund_adjustment_id]))[0];
assert.equal(adj.status,'pending');assert.equal(adj.kind,'bonus');assert.equal(Number(adj.amount),200);assert.equal(adj.created_by,id(5));
await as(1);calc=await call('hr_payroll_calculate',[p,'2026-10-01']);assert.equal(calc.absent_shifts,0,'a recalculation no longer counts the excused day');
// Fingerprint run: a reported sick day waits for its certificate (48 h), then becomes an absence with a clear note.
const t=(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values('صباحي','08:00','16:00',15,$1) returning id",[id(1)]))[0].id;
await owner("insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,valid_to,created_by) values($1,extract(dow from $2::date)::int,$3,$2::date,$2::date,$4)",[p,ytd,t,id(1)]);
await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',9,$1)",[p]);
const sr=await req(1,{kind:'leave',leave_type:'sick',from_date:ytd,to_date:ytd,units:1,notice_reason:'الموظفة تليفونها كان مقفول'});
assert.deepEqual((await row(sr)).rule_breaks,['sick_retroactive']);
await as(1);let r=await call('hr_attendance_from_punches',[ytd]);assert.equal(r.created,0,'the sick day waits while the certificate is still due');
await owner("update clinic_people.requests set created_at=now()-interval '3 days' where id=$1",[sr]);
r=await call('hr_attendance_from_punches',[ytd]);assert.equal(r.created,1);assert.equal(r.absent,1);
const note=(await owner('select note from clinic_people.attendance where person_id=$1 and day=$2',[p,ytd]))[0].note;assert.match(note,/مرضية بدون شهادة/);
await assert.rejects(()=>review(3,sr),/اعتماد استثنائي/);await review(5,sr);
// The rollback restores the previous functions and removes the columns.
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261116100000_hr_leave_rules.rollback.sql','utf8'));
assert.equal((await owner("select count(*)::int n from information_schema.columns where table_schema='clinic_people' and table_name='requests' and column_name='leave_type'"))[0].n,0);
console.log('PASS leave rules: annual notice + exception, casual caps (2/time, 7/year) and pacing, sick certificate within 48 h or owner exception, birth day ×3, excused absence with refund, fingerprint run waits for sick leave, rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
