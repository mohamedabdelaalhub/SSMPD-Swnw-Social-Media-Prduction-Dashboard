// 20261126190000 «لصق رسالة فيزيتا»: a «فيزيتا شامل» booking discount can carry the pasted Vezeeta SMS as proof instead of the card.
// Server re-validates: «Shamel», the patient's phone (archive first), «Hadayek»; card path unchanged. Sample data only (fake names).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:randomUUID()});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const ksf=(await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]})).id;
 await cmd('availability',{provider_id:provider,starts_at:date+'T00:00:00Z',ends_at:date+'T23:30:00Z'});
 await db.exec('reset role');
 for(const m of ['20261123060000_booking_discount_everywhere','20261123130000_visit_discount_all_services'])await db.exec(fs.readFileSync('supabase/migrations/'+m+'.sql','utf8'));
 await db.exec("alter table clinic_reception.services add column if not exists pricing_evidence jsonb");
 await db.exec(fs.readFileSync('supabase/migrations/20261123200000_offer_no_other_discount.sql','utf8'));
 await db.exec("alter table public.patients add column if not exists phone text; create schema if not exists clinic_people; create table clinic_people.people(id uuid primary key default gen_random_uuid(),code text not null default 'EMP-1',full_name text not null,phone text not null default '',status text not null default 'active',end_date date);");
 await db.exec(fs.readFileSync('supabase/migrations/20261126170000_staff_discount.sql','utf8'));
 const M=fs.readFileSync('supabase/migrations/20261126190000_vezeeta_sms_proof.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 let slot=60;const next=()=>{slot+=20;return date+'T'+String(Math.floor(slot/60)).padStart(2,'0')+':'+String(slot%60).padStart(2,'0')+':00Z';};
 const mk=async(n,ph)=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'V'+n,'مريض '+n,ph,id(1)]))[0].id;
 const P1=await mk(1,'01012345678'),P2=await mk(2,'01099999999');
 const sms=(ph,extra='')=>`Dear Doctor Dina Hosny, You received a new Shamel booking Mona Adel - ${ph} Tomorrow 27/11 - Hadayek El-Ahram${extra}`;
 const vz=t=>({discount_kind:'vezeeta',discount_percent:'40',discount_proof_text:t});
 // book with the SMS as proof (no card) → saved 40% with proof + who/when
 const b1=(await cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,source:'vezeeta',...vz(sms('01012345678'))})).id;
 let a=(await q("select discount_kind,discount_percent,discount_card_path,discount_proof_text,discount_proof_by,discount_proof_at,source from clinic_reception.appointments where id=$1",[b1]))[0];
 assert.equal(a.discount_kind,'vezeeta');assert.equal(+a.discount_percent,40);assert.equal(a.discount_card_path,null);assert.match(a.discount_proof_text,/Shamel booking/);assert.equal(a.discount_proof_by,id(3));assert.ok(a.discount_proof_at);assert.equal(a.source,'vezeeta');
 // arrival → approved 40%
 await cmd('arrive',{id:b1});
 const o=(await q("select o.discount,dr.status from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.discount_requests dr on dr.order_id=o.id where v.appointment_id=$1",[b1]))[0];
 assert.equal(+o.discount,40);assert.equal(o.status,'approved');
 // refusals: not Shamel, other branch, wrong patient phone, too short; and without proof the card is still required
 const NS='Dear Doctor Dina Hosny, You received a new booking Mona Adel - 01012345678 Tomorrow 27/11 - 10:00 AM - Hadayek El-Ahram';
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...vz(NS)}),/مش «فيزيتا شامل»/);
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...vz(sms('01012345678').replace('Hadayek El-Ahram','Nasr City'))}),/لفرع تاني/);
 await assert.rejects(()=>cmd('book',{patient_id:P2,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...vz(sms('01012345678'))}),/رقم تليفون المريض مش هو اللي في رسالة فيزيتا/);
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...vz('Shamel Hadayek')}),/الصق رسالة فيزيتا كاملة/);
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,discount_kind:'vezeeta',discount_percent:'40'}),/رقم كارت فيزيتا شامل إجباري/);
 // the archive phone wins (live mirrors it onto the file)
 const arc=(await q("insert into public.patients(id,phone) values(gen_random_uuid(),'+20 111 222 3334') returning id"))[0].id;await q("update clinic_reception.patients set patient_id=$2 where id=$1",[P2,arc]);
 const b2=(await cmd('book',{patient_id:P2,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...vz(sms('01112223334'))})).id;
 assert.equal((await q("select discount_kind from clinic_reception.appointments where id=$1",[b2]))[0].discount_kind,'vezeeta');
 // switching to another kind drops the stale message proof; clearing too
 await cmd('booking_discount',{id:b2,discount_kind:'special',discount_percent:'10',discount_reason:'سبب'});
 a=(await q("select discount_kind,discount_proof_text from clinic_reception.appointments where id=$1",[b2]))[0];assert.equal(a.discount_kind,'special');assert.equal(a.discount_proof_text,null);
 // walk-in path carries it too
 const P3=await mk(3,'01055566677');
 const wk=(await cmd('walk_in',{patient_id:P3,provider_id:provider,service_id:ksf,same_day_ok:true,...vz(sms('01055566677'))})).id;
 assert.equal((await q("select discount_kind from clinic_reception.appointments where id=$1",[wk]))[0].discount_kind,'vezeeta');
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261126190000_vezeeta_sms_proof.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)') x")).rows[0].x,null);
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='clinic_reception' and table_name='appointments' and column_name='discount_proof_text'")).rows[0].n,0);
 console.log('PASS vezeeta SMS proof: «فيزيتا شامل» 40% with the pasted SMS instead of the card (book + walk-in; who/when stored; arrival approves 40%); not-Shamel / other branch / wrong phone / too short refused; card still required without a message; archive phone wins; switching kind drops the proof; re-apply refused; rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
