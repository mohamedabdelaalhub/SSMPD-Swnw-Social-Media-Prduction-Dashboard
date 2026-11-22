// Owner 2026-11-22: «فيزيتا شامل» 40% (card no + expiry + photo) and «كارت العيلة» 10→50% by family visits (linked files
// in «أفراد العيلة» with a proof document, plus files on the same phone), applied at arrival on the real reception
// functions; exclusive; syndicate cap unchanged; link/unlink audited; rollback guards.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const fam=(a,p)=>rpc('clinic_reception_family',{p_workspace:w,p_action:a,p_payload:p});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(1);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]});s=await snap();const svc=s.services.find(x=>x.code==='KSF').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 const mk=async(n,ph)=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'F'+n,'مريض '+n,ph,id(1)]))[0].id;
 const A=await mk(1,'01000000001'),B=await mk(2,'01000000002'),C=await mk(3,'0100 000 0001'),D=await mk(4,'01000000004');
 let slot=4*60;const next=()=>{slot+=20;const h=String(Math.floor(slot/60)).padStart(2,'0'),m=String(slot%60).padStart(2,'0');return date+'T'+h+':'+m+':00Z';};
 const book=(pat,extra)=>cmd('book',{patient_id:pat,provider_id:provider,service_id:svc,starts_at:next(),same_day_ok:true,...extra});
 const orderOf=async ap=>{const s2=await snap();return s2.orders.find(o=>s2.visits.find(v=>v.id===o.visit_id).appointment_id===ap);};
 // Vezeeta: card required, fixed 40% whatever is sent
 const vz={discount_kind:'vezeeta',discount_card_no:'VZ1',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/vz.jpg',discount_percent:'10'};
 for(const [bad,re] of [[{discount_card_no:''},/فيزيتا شامل إجباري/],[{discount_card_expiry:'2020-01-01'},/منتهي/],[{discount_card_path:''},/صورة الكارت/]])await assert.rejects(()=>book(D,{...vz,...bad}),re);
 const v1=(await book(D,vz)).id;s=await snap();assert.equal(+s.appointments.find(x=>x.id===v1).discount_percent,40);
 await cmd('arrive',{id:v1});let o=await orderOf(v1);assert.equal(+o.discount,40,'Vezeeta 40% at arrival');
 assert.match((await q('select reason,status from clinic_reception.discount_requests where order_id=$1',[o.id]))[0].reason,/فيزيتا شامل — كارت VZ1/);
 await assert.rejects(()=>cmd('discount',{id:o.id,percent:'3',reason:'إضافي'}),/فيزيتا شامل/,'exclusive');
 // syndicate cap unchanged
 await assert.rejects(()=>book(D,{discount_kind:'special',discount_percent:'35',discount_reason:'سبب'}),/أقصى خصم على الحجز 30/);
 // family: link needs relation + proof; A–B linked (different phones); C shares A's phone
 await assert.rejects(()=>fam('link',{patient_id:A,relative_id:B,relation:'spouse',proof_path:''}),/مستند/);
 await assert.rejects(()=>fam('link',{patient_id:A,relative_id:B,relation:'x',proof_path:'u/p.jpg'}),/صلة القرابة/);
 const L=(await fam('link',{patient_id:A,relative_id:B,relation:'spouse',proof_path:'u/'+w+'/proof.jpg'})).id;
 await assert.rejects(()=>fam('link',{patient_id:B,relative_id:A,relation:'spouse',proof_path:'u/p.jpg'}),/مربوطين/);
 let f=await fam('list',{patient_id:B});assert.deepEqual(f.members.map(m=>m.patient_id).sort(),[A,C].sort(),'linked + same phone of a linked file');assert.equal(f.next_percent,10);assert.equal(f.linked,true);
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='family_link' and entity_id=$1",[L]))[0].n,1);
 // five family visits: 10,20,30,40,50 then back to 10 — across A, B, C
 const pats=[A,B,C,A,B,C],want=[10,20,30,40,50,10];
 for(let i=0;i<pats.length;i++){const ap=(await book(pats[i],{discount_kind:'family'})).id;
  s=await snap();assert.equal(+s.appointments.find(x=>x.id===ap).discount_percent,want[i],'preview at booking '+i);
  await cmd('arrive',{id:ap});o=await orderOf(ap);assert.equal(+o.discount,want[i],'applied at arrival '+i);
  assert.match((await q('select reason from clinic_reception.discount_requests where order_id=$1',[o.id]))[0].reason,new RegExp('كارت العيلة — زيارة العيلة رقم '+(i+1)));}
 f=await fam('list',{patient_id:C});assert.equal(f.used,6);assert.equal(f.next_percent,20);assert.equal(f.visits.length,6);
 // percent recomputed at arrival: two bookings made before either arrives
 const x1=(await book(A,{discount_kind:'family'})).id,x2=(await book(B,{discount_kind:'family'})).id;
 await cmd('arrive',{id:x2});assert.equal(+(await orderOf(x2)).discount,20);await cmd('arrive',{id:x1});assert.equal(+(await orderOf(x1)).discount,30,'second arrival gets the next step');
 // Patient Portal hook: staff-verified link between archive patients (server-side only)
 const arc=(await q("select gen_random_uuid() a, gen_random_uuid() b"))[0];
 await q("insert into public.patients(id) values($1),($2)",[arc.a,arc.b]);await q("update clinic_reception.patients set patient_id=$1 where id=$2",[arc.a,A]);await q("update clinic_reception.patients set patient_id=$1 where id=$2",[arc.b,B]);
 assert.equal((await q('select public.patient_family_verified($1,$2) r',[arc.b,arc.a]))[0].r,'spouse');
 await assert.rejects(()=>db.query('select public.patient_family_verified($1,$2)',[arc.a,arc.b]),/permission denied/,'not callable by staff sessions');
 // D is outside the family
 f=await fam('list',{patient_id:D});assert.equal(f.members.length,0);assert.equal(f.next_percent,10);
 // unlink: reason required, audited; B leaves the family
 await assert.rejects(()=>fam('unlink',{id:L,reason:''}),/سبب/);await fam('unlink',{id:L,reason:'ربط غلط'});
 f=await fam('list',{patient_id:B});assert.equal(f.members.length,0);
 // rollback refuses while family/Vezeeta discounts exist
 await db.exec('reset role');const rb=fs.readFileSync('supabase/rollbacks/20261122110000_discount_vezeeta_family.rollback.sql','utf8');
 await assert.rejects(()=>db.exec(rb),/مينفعش الرجوع/);await db.exec('rollback').catch(()=>{});
 console.log('PASS discount vezeeta + family: Vezeeta 40% with card, family links with proof + same phone, 10→50→10 by family arrivals, recompute at arrival, exclusive, cap unchanged, unlink, rollback guard');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
