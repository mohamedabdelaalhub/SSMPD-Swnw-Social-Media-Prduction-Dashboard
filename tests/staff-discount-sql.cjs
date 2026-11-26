// 20261126170000 «خصم العاملين بالمركز» (owner 2026-11-26): kind 'staff', typed 1–30%, auto-approved; the patient must BE an active
// employee (HR person, same phone, active, not ended by the visit day). Book / booking_discount / order_discount / arrival. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const ksf=(await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]})).id;
 await cmd('availability',{provider_id:provider,starts_at:date+'T00:00:00Z',ends_at:date+'T23:30:00Z'});
 await db.exec('reset role');
 for(const m of ['20261123060000_booking_discount_everywhere','20261123130000_visit_discount_all_services'])await db.exec(fs.readFileSync('supabase/migrations/'+m+'.sql','utf8'));
 await db.exec("alter table clinic_reception.services add column if not exists pricing_evidence jsonb");
 await db.exec(fs.readFileSync('supabase/migrations/20261123200000_offer_no_other_discount.sql','utf8'));
 // HR people (live-shaped subset)
 await db.exec(`create schema if not exists clinic_people; create table clinic_people.people(id uuid primary key default gen_random_uuid(),code text not null,full_name text not null,phone text not null default '',status text not null default 'active',end_date date);`);
 const today=date,yday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 const E1=(await db.query("insert into clinic_people.people(code,full_name,phone) values('EMP-000101','هدى موظفة','+20 100 000 0001') returning id")).rows[0].id;
 const E3=(await db.query("insert into clinic_people.people(code,full_name,phone,status,end_date) values('EMP-000103','موظف سابق','01000000003','ended',$1) returning id",[yday])).rows[0].id;
 const E4=(await db.query("insert into clinic_people.people(code,full_name,phone) values('EMP-000104','موظف هيمشي','01000000004') returning id")).rows[0].id;
 const M=fs.readFileSync('supabase/migrations/20261126170000_staff_discount.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 let slot=60;const next=()=>{slot+=20;return date+'T'+String(Math.floor(slot/60)).padStart(2,'0')+':'+String(slot%60).padStart(2,'0')+':00Z';};
 const mk=async n=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'F'+n,'مريض '+n,'0100000000'+n,id(1)]))[0].id;
 const P1=await mk(1),P2=await mk(2),P3=await mk(3),P4=await mk(4),P5=await mk(5);
 const staff=(pid)=>rpc('clinic_reception_staff_discount',{p_workspace:w,p_patient:pid});
 const NOT=/خصم العاملين للموظفين الشغالين وقرايبهم من الدرجة الأولى بس/;
 // picker: only the matching active employee
 assert.deepEqual(JSON.parse(JSON.stringify((await staff(P1)).staff)).map(x=>x.code),['EMP-000101']);
 assert.equal((await staff(P2)).staff.length,0);assert.equal((await staff(P3)).staff.length,0,'ended employee not offered');
 const st=(pct,sid)=>({discount_kind:'staff',discount_percent:String(pct),discount_staff_id:sid});
 // book: 31 refused, non-employee refused, ended refused, missing pick refused; 30 ok
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(31,E1)}),/أقصى خصم/);
 await assert.rejects(()=>cmd('book',{patient_id:P2,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(20,E1)}),NOT);
 await assert.rejects(()=>cmd('book',{patient_id:P3,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(20,E3)}),NOT);
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,discount_kind:'staff',discount_percent:'20'}),/اختار الموظف/);
 const b1=(await cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(30,E1)})).id;
 let a=(await q("select discount_kind,discount_percent,discount_staff_id,discount_reason from clinic_reception.appointments where id=$1",[b1]))[0];
 assert.equal(a.discount_kind,'staff');assert.equal(+a.discount_percent,30);assert.equal(a.discount_staff_id,E1);assert.match(a.discount_reason,/خصم العاملين بالمركز — هدى موظفة \(EMP-000101\)/);
 // arrival: auto-approved 30%, labelled
 await cmd('arrive',{id:b1});
 let o=(await q("select o.id,o.discount,dr.status,dr.reason from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.discount_requests dr on dr.order_id=o.id where v.appointment_id=$1",[b1]))[0];
 assert.equal(+o.discount,30);assert.equal(o.status,'approved');assert.match(o.reason,/^خصم الحجز: خصم العاملين بالمركز — هدى موظفة/);
 // a second discount on that visit is refused, naming the staff kind
 await assert.rejects(()=>cmd('order_discount',{order_id:o.id,discount_kind:'special',discount_percent:'10',discount_reason:'تجربة'}),/عليها خصم بالفعل|عليه خصم/);
 // employee ended between booking and arrival → arrival refused
 const b4=(await cmd('book',{patient_id:P4,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(25,E4)})).id;
 await q("update clinic_people.people set status='ended',end_date=$2 where id=$1",[E4,yday]);
 await assert.rejects(()=>cmd('arrive',{id:b4}),NOT);
 // «خصم على الزيارة» after arrival (no booking discount): staff 25 ok, labelled; booking_discount edit keeps it / clears it
 await q("update clinic_people.people set phone='01000000005' where id=$1",[E4]);await q("update clinic_people.people set status='active',end_date=null where id=$1",[E4]);
 const b5=(await cmd('book',{patient_id:P5,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true})).id;await cmd('arrive',{id:b5});
 const o5=(await q("select o.id from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id where v.appointment_id=$1",[b5]))[0].id;
 await assert.rejects(()=>cmd('order_discount',{order_id:o5,...st(31,E4)}),/أقصى خصم/);
 await assert.rejects(()=>cmd('order_discount',{order_id:o5,...st(25,E1)}),NOT);
 const r5=await cmd('order_discount',{order_id:o5,...st(25,E4)});assert.equal(r5.status,'approved');assert.equal(+r5.percent,25);
 const d5=(await q("select dr.reason,o.discount,a.discount_kind,a.discount_staff_id from clinic_reception.discount_requests dr join clinic_reception.orders o on o.id=dr.order_id join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.appointments a on a.id=v.appointment_id where dr.order_id=$1",[o5]))[0];
 assert.match(d5.reason,/^خصم الحجز: خصم العاملين بالمركز — موظف هيمشي \(EMP-000104\) \(بعد الوصول\)/);assert.equal(+d5.discount,25);assert.equal(d5.discount_kind,'staff');assert.equal(d5.discount_staff_id,E4);
 // edit a booked staff discount to «خاص» clears the staff link; other kinds unchanged
 const b6=(await cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(10,E1)})).id;
 await cmd('booking_discount',{id:b6,discount_kind:'special',discount_percent:'10',discount_reason:'سبب تاني'});
 a=(await q("select discount_kind,discount_staff_id from clinic_reception.appointments where id=$1",[b6]))[0];assert.equal(a.discount_kind,'special');assert.equal(a.discount_staff_id,null);
 // first-degree relatives (owner 2026-11-26): linked DIRECTLY in «أفراد العيلة» to the employee's file → ok; relative of an
 // ENDED employee → refused; a relative's relative (2nd degree) → refused
 const R1=await mk(6),R3=await mk(7),R2=await mk(8);
 await q("update clinic_reception.patients set phone=$2 where id=$1",[R1,'01055500006']);await q("update clinic_reception.patients set phone=$2 where id=$1",[R3,'01055500007']);await q("update clinic_reception.patients set phone=$2 where id=$1",[R2,'01055500008']);
 const link=(a,b,rel)=>q("insert into clinic_reception.patient_relatives(workspace_id,patient_id,relative_id,relation,proof_path,created_by) values($1,$2,$3,$4,'u/proof.jpg',$5)",[w,a,b,rel,id(1)]);
 await link(P1,R1,'child');await link(P3,R3,'spouse');await link(R1,R2,'sibling');
 const pr1=JSON.parse(JSON.stringify((await staff(R1)).staff));assert.deepEqual(pr1.map(x=>[x.code,x.relation]),[['EMP-000101','child']]);
 assert.equal((await staff(R3)).staff.length,0,'relative of an ended employee not offered');assert.equal((await staff(R2)).staff.length,0,'2nd degree not offered');
 const br=(await cmd('book',{patient_id:R1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(30,E1)})).id;
 a=(await q("select discount_kind,discount_reason from clinic_reception.appointments where id=$1",[br]))[0];assert.equal(a.discount_kind,'staff');assert.match(a.discount_reason,/قريب درجة أولى \(ابن \/ بنت\) لـ هدى موظفة \(EMP-000101\)/);
 await cmd('arrive',{id:br});
 assert.match((await q("select dr.reason from clinic_reception.discount_requests dr join clinic_reception.orders o on o.id=dr.order_id join clinic_reception.visits v on v.id=o.visit_id where v.appointment_id=$1",[br]))[0].reason,/^خصم الحجز: خصم العاملين بالمركز — قريب درجة أولى/);
 await assert.rejects(()=>cmd('book',{patient_id:R3,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(20,E3)}),NOT);
 await assert.rejects(()=>cmd('book',{patient_id:R2,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...st(20,E1)}),NOT);
 // an unlinked relation (removed link) no longer qualifies
 await q("update clinic_reception.patient_relatives set removed_at=now(),removed_by=$2,removed_reason='test' where patient_id=$1",[P1,id(1)]);
 assert.equal((await staff(R1)).staff.length,0,'removed link no longer qualifies');
 // anon cannot call the picker
 await db.exec('reset role');assert.equal((await db.query("select has_function_privilege('anon','public.clinic_reception_staff_discount(uuid,uuid,date)','execute') x")).rows[0].x,false);
 // rollback
 await db.exec(fs.readFileSync('supabase/rollbacks/20261126170000_staff_discount.rollback.sql','utf8'));
 assert.equal((await db.query("select count(*)::int n from clinic_reception.appointments where discount_kind='staff'")).rows[0].n,0);
 assert.equal((await db.query("select to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)') x")).rows[0].x,null);
 console.log('PASS staff discount (employee + first-degree relatives): picker lists only the matching active employee; book 30 ok (staff link + reason), 31 / non-employee / ended / no pick refused; arrival auto-approves 30% «خصم العاملين بالمركز»; second discount refused; ended before arrival → arrival refused; «خصم على الزيارة» staff 25 ok, 31 / wrong employee refused; edit to خاص clears the link; relative linked in «أفراد العيلة» (child) ok + labelled, relative of ended / 2nd degree / removed link refused; anon no; re-apply refused; rollback converts to خاص.');
})().catch(e=>{console.error(e);process.exit(1);});
