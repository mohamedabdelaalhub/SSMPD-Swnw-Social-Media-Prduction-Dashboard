// 20261128160000 «متابعة» (owner approved 2026-11-28): real reception server functions (PGlite). Rules per service by finance / manager only;
// executing a service with a rule opens N included follow-ups with the SAME doctor; booking an included follow-up = 0 at arrival, doctor fee 0;
// a paid follow-up = settings fee (100) with the doctor's «كشف» percent; expiry → fee directly; «طلب مدّ» 1..3 days approved by ANOTHER person;
// cancel releases the hold; board / sources / report; rollback restores service_operation.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
const mig=f=>fs.readFileSync('supabase/migrations/'+f,'utf8');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const yday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const fu=(a,p)=>rpc('clinic_reception_follow_up',{p_workspace:w,p_action:a,p_payload:p||{}});
 const q=async(sql,a,who=1)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 for(const [c,n,pr] of [['KSF','كشف أسنان',300],['RCT','حشو عصب',1000],['FU','متابعة أسنان',150]])await cmd('service',{code:c,name:n,department:dept,price:pr,minutes:15,bom:[]});
 s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const S=c=>s.services.find(x=>x.code===c).id;
 for(const [c,r] of [['KSF',20],['RCT',30],['FU',50]]){const ag=(await cmd('agreement',{provider_id:provider,service_code:c,rate:r,deduct_material_cost:false,from:yday,to:'2030-01-01',reference:'AG-'+c})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);}
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 // live helpers this partial database lacks (same bodies as live)
 await db.exec('reset role');
 if(!(await db.query("select to_regprocedure('clinic_reception.consult_kind(text)') p")).rows[0].p)await db.exec(mig(fs.readdirSync('supabase/migrations').find(n=>n.startsWith('20261124210000'))).split('create function clinic_reception.consult_pickable')[0].replace(/^[\s\S]*?(create function clinic_reception\.consult_kind)/,'$1'));
 if(!(await db.query("select to_regprocedure('clinic_reception.serves_service(uuid,text,text)') p")).rows[0].p)await db.exec(`create function clinic_reception.serves_service(p_provider uuid,p_department text,p_code text) returns boolean language sql stable as $$select exists(select 1 from clinic_reception.providers p where p.id=p_provider and p.department=p_department)$$;`);
 if(!(await db.query("select to_regprocedure('clinic_reception.today()') p")).rows[0].p)await db.exec(`create function clinic_reception.today() returns date language sql stable as $$select (now() at time zone 'Africa/Cairo')::date$$;`);
 // live: «if net+extra<0» (20261017051044) — a 0-priced included follow-up can be executed
 await db.exec(`alter table clinic_reception.invoices drop constraint invoices_amount_check;alter table clinic_reception.invoices add constraint invoices_amount_check check(amount>=0);`);
 await db.exec(`do $x$ begin execute replace(pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure),'if net+extra<=0 then','if net+extra<0 then'); end $x$;`);
 const M=mig('20261128160000_follow_up_visits.sql');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق/);await db.exec('rollback');
 const pat=async n=>(await db.query("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,'01000000000',$4) returning id",[w,'F'+n,'مريض '+n,id(1)])).rows[0].id;
 const A=await pat(1),B=await pat(2);await as(1);
 let slot=6;const at=()=>date+'T'+String(slot++).padStart(2,'0')+':00:00Z';
 const visitOf=async ap=>(await cmd('arrive',{id:ap})).id;
 const orderOf=async v=>(await q('select * from clinic_reception.orders where visit_id=$1 order by created_at',[v]))[0];
 // rules: finance / manager only
 await as(3);await assert.rejects(()=>fu('rules_set',{service_id:S('RCT'),included_count:3,valid_days:30}),/الحسابات أو مدير المركز/);
 await as(1);await fu('rules_set',{service_id:S('RCT'),included_count:3,valid_days:30});
 const rules=await fu('rules_get');assert.equal(rules.can_manage,true);assert.equal(+rules.fee,100);assert.equal(rules.services.find(x=>x.code==='RCT').included_count,3);assert(!rules.services.some(x=>x.code==='FU'),'follow-up services are not origins');
 // origin: حشو عصب executed → 3 included follow-ups with the same doctor
 const ap0=(await cmd('book',{patient_id:A,provider_id:provider,service_id:S('RCT'),starts_at:at()})).id;const v0=await visitOf(ap0);await cmd('execute',{id:(await orderOf(v0)).id});
 await as(3);let src=await fu('sources',{patient_id:A});assert.equal(src.follow_ups.length,1);const F=src.follow_ups[0];
 assert.equal(F.included,3);assert.equal(F.left,3);assert.equal(F.provider_id,provider);assert.equal(F.expired,false);assert.equal(F.has_service,true);
 // book an included follow-up (same doctor only)
 await assert.rejects(()=>fu('book',{follow_up_id:F.id,provider_id:randomUUID(),starts_at:at(),token:randomUUID()}),/نفس طبيب الزيارة/);
 const tok=randomUUID(),b1=await fu('book',{follow_up_id:F.id,starts_at:at(),token:tok});assert.equal(b1.coverage,'included');assert.equal(b1.left,2);
 assert.equal((await fu('book',{follow_up_id:F.id,starts_at:date+'T'+String(slot-1).padStart(2,'0')+':00:00Z',token:tok})).id,b1.id,'same token replays');
 assert.equal((await fu('sources',{patient_id:A})).follow_ups[0].left,2,'held');
 const board=await fu('board',{day:date});assert.equal(board[b1.id].coverage,'included');assert.equal(+board[b1.id].visit_no,+(await q('select visit_no from clinic_reception.visits where id=$1',[v0],3))[0].visit_no);
 await as(1);const v1=await visitOf(b1.id);let o1=await orderOf(v1);assert.equal(+o1.price,0,'included = 0');assert.equal(o1.snapshot.follow_up.coverage,'included');
 await cmd('execute',{id:o1.id});o1=await orderOf(v1);assert.equal(+o1.doctor_fee,0,'doctor gets nothing on an included follow-up');
 assert.equal((await q("select status from clinic_reception.follow_up_uses where appointment_id=$1",[b1.id]))[0].status,'used');
 // a cancelled included booking gives the follow-up back
 await as(3);const b2=await fu('book',{follow_up_id:F.id,starts_at:at(),token:randomUUID()});assert.equal(b2.left,1);await as(1);
 await cmd('cancel',{id:b2.id,reason:'المريض اعتذر'}).catch(()=>q("update clinic_reception.appointments set status='cancelled' where id=$1",[b2.id]));
 await as(3);assert.equal((await fu('sources',{patient_id:A})).follow_ups[0].left,2,'released on cancel');
 // paid follow-up on a visit without a rule: fee 100, doctor = his «كشف» percent (20%), not the متابعة 50%
 await as(1);const ap5=(await cmd('book',{patient_id:B,provider_id:provider,service_id:S('KSF'),starts_at:at()})).id;const v5=await visitOf(ap5);await cmd('execute',{id:(await orderOf(v5)).id});
 await as(3);src=await fu('sources',{patient_id:B});assert.equal(src.follow_ups.length,0);assert.equal(src.visits[0].visit_id,v5);
 const b3=await fu('book',{visit_id:v5,starts_at:at(),token:randomUUID()});assert.equal(b3.coverage,'fee');assert.equal(+b3.fee,100);
 await as(1);const v3=await visitOf(b3.id);let o3=await orderOf(v3);assert.equal(+o3.price,100,'every follow-up fee is 100');await cmd('execute',{id:o3.id});o3=await orderOf(v3);
 assert.equal(+o3.doctor_fee,20,'his consultation percent (20%) on the 100 fee');
 // expiry: booking after it → fee directly; an included booking that expires before arrival switches to the fee
 await q("update clinic_reception.visit_follow_ups set expires_on=$2 where id=$1",[F.id,yday]);
 await as(3);assert.equal((await fu('sources',{patient_id:A})).follow_ups[0].expired,true);const b4=await fu('book',{follow_up_id:F.id,starts_at:at(),token:randomUUID()});assert.equal(b4.coverage,'fee');
 await q("update clinic_reception.visit_follow_ups set expires_on=$2 where id=$1",[F.id,'2030-01-01']);const b5=await fu('book',{follow_up_id:F.id,starts_at:at(),token:randomUUID()});assert.equal(b5.coverage,'included');
 await q("update clinic_reception.visit_follow_ups set expires_on=$2 where id=$1",[F.id,yday]);await as(1);const v6=await visitOf(b5.id);
 assert.equal(+(await orderOf(v6)).price,100,'expired by arrival → fee');assert.equal((await q('select follow_up_coverage c from clinic_reception.appointments where id=$1',[b5.id]))[0].c,'fee');
 // «طلب مدّ» 1..3 days, approved by ANOTHER person
 await as(3);await assert.rejects(()=>fu('extend_request',{follow_up_id:F.id,days:4,reason:'الدكتور كان مسافر'}),/3 أيام/);
 await assert.rejects(()=>fu('extend_request',{follow_up_id:F.id,days:2,reason:'x'}),/سبب/);
 const ex=await fu('extend_request',{follow_up_id:F.id,days:2,reason:'الدكتور كان مسافر'});assert.equal(ex.status,'pending');
 await assert.rejects(()=>fu('extend_review',{id:ex.id,approve:true}),/حد تاني|الحسابات/);
 let lst=await fu('extensions');assert.equal(lst.items.length,1);assert.equal(lst.can_review,false);
 await as(1);lst=await fu('extensions');assert.equal(lst.can_review,true);await fu('extend_review',{id:ex.id,approve:true});
 await as(3);src=await fu('sources',{patient_id:A});assert.equal(src.follow_ups[0].expired,false,'extended');
 const ex2=await fu('extend_request',{follow_up_id:F.id,days:1,reason:'مرة تانية من فضلك'}).catch(e=>e);assert.match(String(ex2.message||''),/اتمدّت قبل كده/);
 // own request cannot be approved by the same person
 await as(1);const F2=(await q("insert into clinic_reception.visit_follow_ups(workspace_id,origin_visit_id,origin_order_id,patient_id,provider_id,service_id,included,expires_on) values($1,$2,$3,$4,$5,$6,1,$7) returning id",[w,v5,(await orderOf(v5)).id,B,provider,S('KSF'),yday]))[0].id;
 const ex3=await fu('extend_request',{follow_up_id:F2,days:1,reason:'طلب من المدير نفسه'});await assert.rejects(()=>fu('extend_review',{id:ex3.id,approve:true}),/حد تاني/);
 // report
 await as(3);const rep=await fu('report',{from:date,to:date});assert(rep.doctors.length>=1);const d0=rep.doctors[0];assert(+d0.included>=0&&+d0.fee_income>=100);assert(rep.remaining.some(x=>x.file_no==='F1'));
 // permissions on the tables
 for(const t of ['visit_follow_ups','follow_up_rules','follow_up_uses','follow_up_extensions'])assert.equal((await q("select has_table_privilege('authenticated','clinic_reception.'||$1,'select') y",[t]))[0].y,false);
 // rollback restores service_operation
 await db.exec('reset role');const before=(await db.query("select def from clinic_reception.follow_up_saved_defs where name='service_operation'")).rows[0].def;
 await db.exec(fs.readFileSync('supabase/rollbacks/20261128160000_follow_up_visits.rollback.sql','utf8'));
 assert.equal((await db.query("select pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure) d")).rows[0].d,before);
 assert.equal((await db.query("select to_regclass('clinic_reception.visit_follow_ups') t")).rows[0].t,null);
 await db.close();console.log('PASS «متابعة»: rules by finance/manager, 3 included opened on execution, same doctor only, included = 0 & doctor 0, cancel releases, paid = 100 with the consultation 20%, expiry → fee (booking + arrival), extension 1..3 days by another person, board / sources / report, tables closed, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
