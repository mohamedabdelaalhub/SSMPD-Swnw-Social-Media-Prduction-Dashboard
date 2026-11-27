// «راجع قبل ما تطلب الصرف» — صرف حساب الطبيب (mig 20261127140000, owner Q1 «يقدر يشيل حالة أو يطلب أقل، بسبب، والمعتمد يشوف»).
// Reuses the live setup of tests/desk-rx-fees-referral-sql.cjs (reception fees payable at the desk) up to the first desk request, then:
// reception removes a case and/or asks a LOWER amount with a reason → still pending for the approver (maker-checker), never above the
// cases kept; the removed case stays payable for the next payout; the approver sees reception_review; detail adds price/discount per case.
// Also the read-only collect review (public.clinic_reception_collect_review) on the same live workspace.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'desk-rx-fees-referral-sql.cjs'),'utf8');const cut=src.indexOf('  // desk request uses reception lines');
assert(cut>0,'desk-rx-fees-referral-sql.cjs markers moved; update this test');
const body=`
  const freg=(await owner("insert into clinic_finance.registers(name,petty_limit,created_by) values('خزينة الاستقبال',100000,$1) returning id",[id(1)]))[0].id;
  const fsh=(await owner("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values($1,$2,gen_random_uuid(),0) returning id",[freg,id(4)]))[0].id;
  await as(4);await db.exec('reset role');await db.query("select clinic_finance.post('fund',gen_random_uuid(),'تغذية',$1,'1111','1112',1000)",[fsh]);
  const rreg=(await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'r','both') returning id",[ws]))[0].id;
  const rsh=(await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,finance_shift_id) values($1,$2,$3,'open',$4) returning id",[ws,rreg,id(4),fsh]))[0].id;
  // a second paid case for د. أشعة (DOC-R): 300 → fee 90
  await db.exec('reset role');
  const ap2=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+interval '2 hour',now()+interval '135 min','arrived',$5) returning id",[ws,pat,pR,svc,id(1)]))[0].id;
  const v2=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,ap2,pat,id(1)]))[0].id;
  const o2=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,300,0,'{\\"name\\":\\"أشعة ركبة\\"}',$5) returning id",[ws,v2,svc,pR,id(1)]))[0].id;
  const inv2=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',300,'أشعة ركبة') returning id,invoice_no",[ws,pat,v2,o2]))[0];
  await db.query("select clinic_reception.post($1,'doctor_fee',$2,'استحقاق طبيب لخدمة منفذة','5111','2120',90,$3)",[ws,o2,{patient_id:pat,visit_id:v2,order_id:o2,provider_id:pR,invoice_id:inv2.id}]);
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values($1,$2,'payment',300)",[ws,inv2.id]);
  const MIG=fs.readFileSync('supabase/migrations/20261127140000_review_before_money.sql','utf8');
  await db.exec('reset role');// the drawer part of the same migration is tested in review-before-money-drawer-sql.cjs: minimal stand-ins here
  if(!(await owner("select to_regclass('clinic_finance.drawer_requests') t"))[0].t)await db.exec(\`create table clinic_finance.drawer_requests(id uuid primary key);
   create function public.clinic_finance_drawer_request(text,jsonb default '{}'::jsonb) returns jsonb language sql as $q$select '{}'::jsonb$q$;\`);
  await db.exec(MIG);await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const c2=(a,p,k)=>call('clinic_reception_doctor_payout',[a,Object.assign({workspace_id:ws},p||{}),k===undefined?key():k]);
  await as(4);let d=await c2('detail',{provider_id:pR});assert.equal(Number(d.payable),360);assert.equal(d.invoices.length,2);
  const knee=d.invoices.find(x=>x.invoice_id===inv2.id),chest=d.invoices.find(x=>x.invoice_id===inv.id);
  assert.equal(Number(knee.gross),300,'detail: list price per case');assert.equal(Number(chest.gross),1000);assert.equal(Number(chest.discount),100,'detail: discount removed first');assert.equal(chest.patient,'مريض');
  // refused: no reason / above the kept cases / unknown case / everything removed
  await assert.rejects(()=>c2('request',{provider_id:pR,remove:[inv2.id]}),/اكتب سبب التعديل/);
  await assert.rejects(()=>c2('request',{provider_id:pR,gross:400,note:'زيادة'}),/أكتر من المحسوب/);
  await assert.rejects(()=>c2('request',{provider_id:pR,remove:[inv2.id],gross:280,note:'شلت الركبة'}),/أكتر من المحسوب للحالات اللي فاضلة \\(270\\)/);
  await assert.rejects(()=>c2('request',{provider_id:pR,remove:['00000000-0000-4000-8000-0000000000aa'],note:'غلط'}),/مش موجودة/);
  await assert.rejects(()=>c2('request',{provider_id:pR,remove:[inv.id,inv2.id],note:'شلت الكل'}),/شلت كل الحالات/);
  await assert.rejects(()=>c2('request',{provider_id:pR,gross:'-5',note:'سالب'}),/غير صالح/);
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_payouts where doctor_key='DOC-R'"))[0].n,0,'refused requests leave nothing');
  // remove the knee case and ask 250 of the 270 kept
  await as(4);const tok=key();let q=await c2('request',{provider_id:pR,remove:[inv2.id],gross:250,note:'الدكتور هيستلم الباقي بكرة'},tok);
  assert.equal(q.status,'pending');assert.equal(Number(q.gross),250);assert.equal(q.invoices.length,1);assert.equal(q.invoices[0].invoice_id,inv.id);
  assert.equal(Number(q.reception_review.computed_full),360);assert.equal(Number(q.reception_review.kept),270);assert.equal(Number(q.reception_review.requested_gross),250);
  assert.equal(q.reception_review.removed.length,1);assert.equal(q.reception_review.removed[0].invoice_id,inv2.id);assert.equal(q.reception_review.note,'الدكتور هيستلم الباقي بكرة');
  assert.equal((await c2('request',{provider_id:pR,remove:[inv2.id],gross:250,note:'الدكتور هيستلم الباقي بكرة'},tok)).id,q.id,'replay = same payout');
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_payouts where doctor_key='DOC-R'"))[0].n,1);
  d=await c2('detail',{provider_id:pR});assert.equal(d.state,'pending');assert.equal(Number(d.payable),90,'the removed case stays payable for next time');
  assert(d.payouts[0].reception_review,'detail payouts carry the review');
  // maker-checker unchanged: reception cannot approve; the approver sees the review and approves 250 (within the 270 kept)
  await assert.rejects(()=>c2('approve',{id:q.id}),/اعتماد صرف/);
  await as(3);const pl=await c2('pending_list',{});const it=pl.items.find(x=>x.id===q.id);assert.equal(it.reception_review.note,'الدكتور هيستلم الباقي بكرة');
  await assert.rejects(()=>c2('approve',{id:q.id,gross:300,note:'أكتر'}),/أكبر من أتعاب الفواتير المشمولة/,'approver cap = cases kept');
  q=await c2('approve',{id:q.id});assert.equal(q.status,'approved');assert.equal(Number(q.gross),250);assert(q.reception_review);
  const line=await owner("select sum(l.debit) d from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='doctor_payment' and e.source_id=$1 and l.account='2120'",[q.id]);assert.equal(Number(line[0].d),250,'posted 250 from the drawer');
  assert.equal((await owner("select count(*)::int n from clinic_finance.audit where action='desk_payout_request_review' and entity_id=$1",[q.id]))[0].n,1,'audited');
  // the plain request (no edits) is unchanged: the knee case is requested later as usual
  await as(4);let q3=await c2('request',{provider_id:pR});assert.equal(Number(q3.gross),90);assert(!q3.reception_review);
  // ---- collect review (read only), as the cashier of this live workspace
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3) on conflict (workspace_id,admin_id) do update set capabilities=excluded.capabilities",[ws,id(4),['book','collect']]);
  const ap3=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+interval '3 hour',now()+interval '195 min','arrived',$5) returning id",[ws,pat,pR,svc,id(1)]))[0].id;
  const v3=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,ap3,pat,id(1)]))[0].id;
  const o3=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by,status) values($1,$2,$3,$4,400,10,'{\\"name\\":\\"كشف باطنة\\"}',$5,'completed') returning id",[ws,v3,svc,pR,id(1)]))[0].id;
  const o4=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,120,0,'{\\"name\\":\\"تحليل سكر\\"}',$5) returning id",[ws,v3,svc,pR,id(1)]))[0].id;
  const inv3=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',360,'كشف باطنة') returning id",[ws,pat,v3,o3]))[0].id;
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values($1,$2,'payment',100)",[ws,inv3]);
  await owner("insert into clinic_reception.discount_requests(workspace_id,order_id,percent,reason,created_by,reviewed_by,status) values($1,$2,10,'مريض متكرر',$3,$4,'approved')",[ws,o3,id(4),id(3)]);
  await owner("insert into clinic_reception.discount_requests(workspace_id,order_id,percent,reason,created_by,status) values($1,$2,20,'ظروف',$3,'pending')",[ws,o4,id(4)]);
  await as(4);const rv=await call('clinic_reception_collect_review',[ws,pat]);
  const vv=rv.visits.find(x=>x.id===v3);assert(vv,'the visit that still owes money');assert.equal(vv.services.length,2);
  const s3=vv.services.find(x=>x.id===o3),s4=vv.services.find(x=>x.id===o4);
  assert.equal(Number(s3.gross),400);assert.equal(Number(s3.discount),40);assert.equal(Number(s3.amount),360);assert.equal(Number(s3.paid),100);assert.equal(Number(s3.owed),260);
  assert.equal(Number(s3.approved.percent),10);assert(s3.approved.by&&s3.approved.approved_by,'who asked / who approved');
  assert.equal(s4.owed,null,'not executed yet: no invoice');assert.equal(Number(s4.pending.percent),20,'pending discount shown');assert.equal(Number(s4.amount),120);
  assert(!rv.visits.some(x=>x.id===v2),'fully paid visits are not listed');assert(Number(rv.totals.owed)>=260);assert.equal(rv.patient.name,'مريض');
  // someone without the collect capability is refused; the call writes nothing
  await owner("update clinic_reception.members set capabilities=$3 where workspace_id=$1 and admin_id=$2",[ws,id(4),['book']]);
  await as(4);await assert.rejects(()=>call('clinic_reception_collect_review',[ws,pat]),'book-only member is refused');
  await owner("update clinic_reception.members set capabilities=$3 where workspace_id=$1 and admin_id=$2",[ws,id(4),['book','collect']]);
  await db.exec('reset role');await db.exec('begin read only');await as(4);await call('clinic_reception_collect_review',[ws,pat]);await db.exec('reset role');await db.exec('rollback');
  // rollback puts the previous function back
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261127140000_review_before_money.rollback.sql','utf8'));
  assert.equal((await owner("select to_regprocedure('public.clinic_reception_collect_review(uuid,uuid)') f"))[0].f,null);
  assert((await owner("select to_regprocedure('public.clinic_reception_doctor_payout(text,jsonb,uuid)') f"))[0].f);
  console.log('PASS review-before-money doctor + collect: remove a case / ask lower with a reason (pending for the approver, never above the cases kept, removed case stays payable, replay, audited), approver sees reception_review and cap = cases kept, plain request unchanged; detail price/discount per case; collect review (price → discount who/approved/pending → paid → owed, unpaid visits only, collect capability, read only); rollback');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'rbm-doctor-'+process.pid+'.cjs');
fs.writeFileSync(file,src.slice(0,cut).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')')+body);
try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
