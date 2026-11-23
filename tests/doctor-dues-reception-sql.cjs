// 20261122290000: «صرف مستحقات بالفواتير» lists the reception invoices (fees posted only in the reception journal) and pays them with the
// same gates; lines are recorded in desk_payout_rx so the desk «صرف الحساب» never pays them again. Reuses the setup of desk-rx-fees-referral-sql.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'desk-rx-fees-referral-sql.cjs'),'utf8');
const cut=src.indexOf('  // desk request uses reception lines');assert(cut>0,'desk-rx-fees-referral-sql.cjs marker moved; update this test');
const prefix=src.slice(0,cut).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
  const M2=mig('20261122290000');await db.exec('reset role');
  await owner("insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,status,created_by) select 'DOC-R','د. أشعة',code,current_date-30,current_date+30,'active',$1 from clinic_reception.services limit 1",[id(1)]).catch(()=>{});
  await db.exec(M2);await assert.rejects(()=>db.exec(M2),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const today=(await owner("select ((now() at time zone 'Africa/Cairo')::date)::text d"))[0].d;
  const dues=async(n)=>{await as(n);return call('clinic_finance_doctor_dues',['DOC-R',today,today]);};
  let r=await dues(2);const rx=r.invoices.filter(i=>i.source==='reception');
  assert.equal(rx.length,1,'reception invoice listed');assert.equal(rx[0].reference,'RX-'+inv.invoice_no);assert.equal(Number(rx[0].fee),270);
  assert.equal(rx[0].dues_status,'payable');assert.equal(rx[0].selectable,true);assert(rx[0].patient_ref.includes('مريض'),'patient shown');
  assert.equal(Number(r.dues.payable_total),270,'totals include it');assert.equal(r.dues.reception_count,1);
  // unpaid second reception invoice → waiting, not selectable
  const app2=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+interval '3 hours',now()+interval '195 min','arrived',$5) returning id",[ws,pat,pR,svc,id(1)]))[0].id;
  const v2=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,app2,pat,id(1)]))[0].id;
  const o2=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,500,0,'{\\"name\\":\\"أشعة ركبة\\"}',$5) returning id",[ws,v2,svc,pR,id(1)]))[0].id;
  const inv2=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',500,'أشعة ركبة') returning id,invoice_no",[ws,pat,v2,o2]))[0];
  await db.exec('reset role');await db.query("select clinic_reception.post($1,'doctor_fee',$2,'استحقاق طبيب','5111','2120',150,$3)",[ws,o2,{patient_id:pat,visit_id:v2,order_id:o2,provider_id:pR,invoice_id:inv2.id}]);
  r=await dues(2);let w2=r.invoices.find(i=>i.invoice_id===inv2.id);assert.equal(w2.dues_status,'waiting_patient');assert.equal(w2.selectable,false);assert.equal(Number(w2.patient_open),500);assert.equal(w2.lines[0].service_name,'أشعة ركبة');
  const pay=(ids,k)=>call('clinic_finance_doctor_payout_invoices',['DOC-R',ids,0,0,'bank',null,'TR-1',today,today,k||key()]);
  await as(2);await assert.rejects(()=>pay([inv2.id]),/لم تُسدَّد بالكامل/,'unpaid reception invoice refused');
  // pay the paid one (accountant creates)
  const k1=key();await as(2);const pid=await pay([inv.id],k1);assert(pid);
  assert.equal(await pay([inv.id],k1),pid,'same token replays');
  const link=await owner("select count(*)::int n,sum(fee)::numeric f from clinic_finance.desk_payout_rx where payout_id=$1",[pid]);assert.equal(link[0].n,1);assert.equal(Number(link[0].f),270);
  const po=await owner("select gross,status,created_by from clinic_finance.doctor_payouts where id=$1",[pid]);assert.equal(Number(po[0].gross),270);assert.equal(po[0].status,'pending');
  r=await dues(2);assert.equal(r.invoices.find(i=>i.invoice_id===inv.id).dues_status,'requested','now requested');
  await as(2);await assert.rejects(()=>pay([inv.id]),/مشمولة بطلب صرف سابق/,'cannot ask twice');
  assert.equal(Number((await owner("select coalesce(sum(fee),0) f from clinic_finance.desk_payable('DOC-R') where invoice_id=$1",[inv.id]))[0].f),0,'desk no longer offers that line');
  // finance-only path untouched: an empty list still goes to the earlier function
  await as(2);await assert.rejects(()=>pay([]),/اختر فاتورة واحدة على الأقل/);
  // rollback
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122290000_doctor_dues_reception_invoices.rollback.sql','utf8'));
  assert.equal((await owner("select to_regprocedure('clinic_finance.doctor_dues_before_rx(text,date,date)') r"))[0].r,null,'rollback restores the earlier functions');
  console.log('PASS doctor dues + reception invoices: listed with RX ref / patient / service, payable vs waiting, totals, paid one requested via the existing payout gate, recorded in desk_payout_rx (desk stops offering it), replay, no double request, unpaid refused, rollback.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'doctor-dues-rx-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
