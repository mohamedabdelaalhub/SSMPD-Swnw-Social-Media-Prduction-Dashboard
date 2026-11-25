// 20261125140000 «كارت العيلة» visits from the OLD system (owner 2026-11-25): reception enters the family's old-system count
// with a reason + proof; it counts only after a configured approver (not the person who entered it) approves; family_visits =
// approved old count + new-system visits, same 10/20/30/40/50 cycle; a change needs approval again; reject; config for two
// approvers of different roles; audit; rollback. Real reception functions (PGlite). Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const fam=(a,p)=>rpc('clinic_reception_family',{p_workspace:w,p_action:a,p_payload:p}),leg=(a,p)=>rpc('clinic_reception_family_legacy',{p_workspace:w,p_action:a,p_payload:p});
 const review=(i,ok,note)=>rpc('clinic_reception_family_legacy_review',{p_id:i,p_approve:ok,p_note:note||null}),pending=()=>rpc('clinic_reception_family_legacy_pending',{});
 const q=async(sql,a,who=1)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]});s=await snap();const svc=s.services.find(x=>x.code==='KSF').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 const mk=async(n,ph)=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'F'+n,'مريض '+n,ph,id(1)]))[0].id;
 const A=await mk(1,'01000000001'),B=await mk(2,'01000000002'),D=await mk(4,'01000000004');
 await fam('link',{patient_id:A,relative_id:B,relation:'spouse',proof_path:'u/'+w+'/proof.jpg'});
 let slot=4*60;const next=()=>{slot+=20;const h=String(Math.floor(slot/60)).padStart(2,'0'),m=String(slot%60).padStart(2,'0');return date+'T'+h+':'+m+':00Z';};
 const orderOf=async ap=>{const s2=await snap();return s2.orders.find(o=>s2.visits.find(v=>v.id===o.visit_id).appointment_id===ap);};
 const famVisit=async pat=>{const ap=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:svc,starts_at:next(),same_day_ok:true,discount_kind:'family'})).id;await cmd('arrive',{id:ap});return +(await orderOf(ap)).discount;};
 await db.exec('reset role');await db.exec("insert into admins values('61000000-0000-4000-8000-000000000009','financial_manager',true)");
 const M=fs.readFileSync('supabase/migrations/20261125140000_family_card_legacy_visits.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback').catch(()=>{});
 // 1) reception enters 7 old-system visits on A (validation first)
 await as(3);let st=await leg('status',{patient_id:A});assert.equal(st.legacy_visits,0);assert.equal(st.can_request,true);assert.equal(st.next_percent,10);
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'x',reason:'كارت قديم',proof_note:'دفتر الاستقبال'}),/رقم صحيح/);
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'-2',reason:'كارت قديم',proof_note:'دفتر الاستقبال'}),/رقم صحيح/);
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'7',reason:'',proof_note:'دفتر الاستقبال'}),/السبب/);
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'7',reason:'كارت قديم'}),/مستند أو اكتب ملاحظة/);
 st=await leg('request',{patient_id:A,visits:'7',reason:'كارت العيلة القديم',proof_note:'دفتر الاستقبال 2025 صفحة 14'});
 const r1=st.entries[0];assert.equal(r1.status,'pending');assert.equal(r1.visits,7);assert.equal(st.used,0,'pending does not count');assert.equal(st.can_request,false);
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'8',reason:'تاني',proof_note:'دفتر الاستقبال'}),/مستني الاعتماد/);
 await assert.rejects(()=>leg('request',{patient_id:B,visits:'5',reason:'تاني',proof_note:'دفتر الاستقبال'}),/متسجّلة على ملف مريض 1/,'one entry per family');
 assert.equal((await leg('status',{patient_id:B})).can_request,false);
 // 2) reception is not an approver; the card stays hidden for it
 assert.deepEqual(await pending(),{can_review:false,pending:[]});
 await assert.rejects(()=>review(r1.id,true),/مش من صلاحيتك/);
 // 3) financial manager approves → 7 old visits count for the whole family (A and B): next step 30%
 await as(9);let p=await pending();assert.equal(p.can_review,true);assert.equal(p.pending.length,1);assert.equal(p.pending[0].visits,7);assert.equal(p.pending[0].patient,'مريض 1');
 let rv=await review(r1.id,true);assert.equal(rv.status,'approved');assert.equal(rv.used,7);assert.equal(+rv.next_percent,30);
 await assert.rejects(()=>review(r1.id,true),/اتراجع قبل كده/);
 await as(3);st=await leg('status',{patient_id:B});assert.equal(st.legacy_visits,7);assert.equal(+st.next_percent,30);assert.equal(st.entries[0].approved_by.length,1,'who approved');assert.equal(st.entries[0].status,'approved');
 assert.equal((await fam('list',{patient_id:B})).used,7,'«أفراد العيلة» count includes the old visits');
 assert.equal(await famVisit(B),30,'booking + arrival use the approved count');assert.equal(await famVisit(A),40);
 // 4) a change needs approval again; the old count stays in force until then
 st=await leg('request',{patient_id:A,visits:'3',reason:'الرقم الصح من الدفتر',proof_note:'دفتر الاستقبال 2025 صفحة 15'});const r2=st.entries[0];
 assert.equal(st.legacy_visits,7,'still 7 while the change waits');
 await assert.rejects(()=>leg('request',{patient_id:A,visits:'3',reason:'تاني',proof_note:'دفتر الاستقبال'}),/مستني الاعتماد/);
 await as(2);rv=await review(r2.id,true);assert.equal(rv.status,'approved');assert.equal(rv.used,5,'3 old + 2 new');assert.equal(+rv.next_percent,10);
 assert.deepEqual((await q('select status from clinic_reception.family_legacy_visits where patient_id=$1 order by created_at',[A])).map(x=>x.status),['superseded','approved']);
 // 5) reject: reason required; nothing changes
 await as(3);const r3=(await leg('request',{patient_id:A,visits:'9',reason:'مراجعة',proof_note:'ورقة من الاستقبال'})).entries[0];
 await as(9);await assert.rejects(()=>review(r3.id,false,''),/سبب الرفض/);assert.equal((await review(r3.id,false,'مفيش إثبات كفاية')).status,'rejected');
 await as(3);st=await leg('status',{patient_id:A});assert.equal(st.legacy_visits,3);assert.equal(st.entries.find(e=>e.id===r3.id).review_note,'مفيش إثبات كفاية');
 // 6) maker ≠ checker (a super admin who entered it cannot approve it)
 await as(1);await cmd('member',{admin_id:id(1),capabilities:['view','book']}).catch(()=>{});
 const r4=(await leg('request',{patient_id:D,visits:'2',reason:'كارت قديم',proof_note:'دفتر الاستقبال'})).entries[0];
 await assert.rejects(()=>review(r4.id,true),/مايقدرش يعتمدها/);
 // 7) config: two approvals from different roles
 await q("update clinic_reception.family_legacy_config set required=2, distinct_roles=true");
 await as(2);rv=await review(r4.id,true);assert.equal(rv.status,'pending');assert.equal(rv.approvals,1);
 await assert.rejects(()=>review(r4.id,true),/اعتمدت الطلب ده قبل كده/);
 await as(9);rv=await review(r4.id,true);assert.equal(rv.status,'approved');assert.equal(rv.used,2);
 // audit
 const au=await q("select action,count(*)::int n from clinic_reception.audit where action like 'family_legacy_%' group by action order by action");
 assert.deepEqual(au.map(x=>[x.action,x.n]),[['family_legacy_approve',4],['family_legacy_reject',1],['family_legacy_request',4]]);
 // rollback: family_visits back to new-system visits only
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261125140000_family_card_legacy_visits.rollback.sql','utf8'));
 assert.equal((await q('select clinic_reception.family_visits($1,null) n',[A]))[0].n,2);
 assert.equal((await q("select to_regclass('clinic_reception.family_legacy_visits') t"))[0].t,null);
 console.log('PASS family card old-system visits: enter (number ≥ 0 + reason + proof) → pending, not counted; one entry per family; reception cannot approve; maker ≠ checker; approval counts for the whole family (7 → 30% at booking/arrival); change waits for re-approval (old count in force); reject with reason; 2 approvals of different roles when configured; audited; rollback restores.');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
