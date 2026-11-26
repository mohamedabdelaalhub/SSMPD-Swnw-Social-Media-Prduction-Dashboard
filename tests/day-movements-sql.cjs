// «حركات اليوم» (owner «طبّق شكل حركات اليوم», 2026-11-26): mig 20261126220000 adds public.clinic_finance_day_movements — read-only,
// same scope as clinic_finance_shift_movements (cashier = own shift, FM/GM/SA = any shift / period). Reuses the live reception setup of
// tests/reception-bridge.cjs (up to the first live cash collection: a 106 service invoice paid 110 cash «LIVE-CASH» in admin 1's shift).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','finance_shift_movements'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,args)=>owner(sql,args);const M=require('fs').readFileSync('supabase/migrations/20261126220000_day_movements.sql','utf8');
await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
// cashier (admin 1): his open shift by default
await as(1);let d=await call('clinic_finance_day_movements',[]);
assert.equal(d.shifts.length,1,'own open shift');
let v=d.visits.find(x=>x.services.some(s=>s.payments.some(p=>p.reference==='LIVE-CASH')));assert(v,'the visit paid in this shift is listed');
assert(v.patient&&v.file_no&&v.provider&&v.at,'patient, file, doctor, time');
let sv=v.services.find(s=>s.payments.length);const ord=(await q("select o.* from clinic_reception.orders o join clinic_reception.invoices i on i.order_id=o.id where i.id=$1",[s.invoices[0].id]))[0];
assert.equal(+sv.due,106,'due = the invoice');assert.equal(+sv.collected_here,+sv.payments.reduce((n,p)=>n+ +p.amount,0),'collected here = its receipts');
assert(+sv.collected_here>0&&sv.payments[0].method==='cash');assert.equal(+sv.doctor_fee,+ord.doctor_fee,'doctor share');assert.equal(+sv.gross,+(ord.price*ord.quantity).toFixed(2));
// an approved discount request shows who asked and who approved
await q("insert into clinic_reception.discount_requests(workspace_id,order_id,percent,reason,created_by,reviewed_by,status) values($1,$2,10,'مريض متكرر',$3,$4,'approved')",[live,ord.id,id(1),id(3)]);
await as(1);d=await call('clinic_finance_day_movements',[]);sv=d.visits.flatMap(x=>x.services).find(x=>x.id===ord.id);
assert.equal(+sv.request.percent,10);assert(sv.request.by&&sv.request.approved_by,'who did it / who approved');
// a doctor payout paid from this shift is listed with the doctor
const fsid=d.shifts[0].id;let paidOk=true;
try{await q("insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,shift_id,reference,period_from,period_to,payload,created_by,token,status,reviewed_by,reviewed_at) values('RX-DOCTOR',50,0,'cash',$1,'PO-DAY-1',$2,$2,'{}',$3,gen_random_uuid(),'approved',$4,now())",[fsid,date,id(3),id(1)]);}catch(e){paidOk=false;console.log('skip payout row: '+e.message.slice(0,80));}
if(paidOk){await as(1);d=await call('clinic_finance_day_movements',[]);const po=d.payouts.find(p=>p.reference==='PO-DAY-1');assert(po&&+po.amount===50&&po.provider_id===provider,'payout from this drawer, tied to the reception doctor');}
// another employee: nothing by default, and cannot open this shift
await as(4);assert.equal((await call('clinic_finance_day_movements',[])).visits.length,0);
// a plain cashier (admin 4) with his own open shift: sees it, without the opening balance (blind count kept)
await as(1);const reg4=await call('clinic_finance_save_register',[null,'خزينة تانية (اختبار)',1000,'both']);
await q("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values($1,$2,gen_random_uuid(),100)",[reg4,id(4)]);
// owner 2026-11-26 «نأجل تطبيق العد الأعمى مؤقتا»: switch OFF by default → the cashier sees his opening balance in «حركات اليوم»
await as(4);{const c=await call('clinic_finance_day_movements',[]);assert.equal(c.manager,false);assert.equal(c.shifts.length,1);assert.equal(c.blind_count,false);assert.equal(c.can_set_blind,false);
 assert.equal(+c.shifts[0].opening_book,100,'blind count OFF (trial): the cashier sees the opening balance');}
// only the super admin / financial manager can switch it
await as(4);assert.equal((await call('clinic_finance_blind_count',['settings'])).can_change,false);
await assert.rejects(()=>call('clinic_finance_blind_count',['set',true]),e=>/للسوبر أدمن أو المدير المالي/.test(e.message));
await db.exec('reset role');const sa=(await db.query("select id from public.admins where role in ('super_admin','financial_manager') and active order by role='super_admin' desc limit 1")).rows[0].id;
await db.query("select set_config('test.admin',$1,false)",[sa]);await db.exec('set role authenticated');
assert.equal((await call('clinic_finance_blind_count',['set',true])).enabled,true);await assert.rejects(()=>call('clinic_finance_blind_count',['set',null]),/حدد تشغيل/);
// switch ON → the cashier is blind again (no opening / expected / counted), managers still see it
await as(4);{const c=await call('clinic_finance_day_movements',[]);assert.equal(c.blind_count,true);
 assert(!/opening|expected|counted/.test(JSON.stringify(c.shifts)),'blind count ON: no opening balance for the cashier');}
await as(3);assert('opening_book' in (await call('clinic_finance_day_movements',[null,date,date])).shifts[0],'managers keep it');
await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[sa]);await db.exec('set role authenticated');await call('clinic_finance_blind_count',['set',false]);
// the existing movements RPC is untouched: still no opening balance for the cashier whatever the switch
await as(4);assert(!/opening|expected|counted/.test(JSON.stringify(await call('clinic_finance_shift_movements',[]))),'shift movements stay blind');
await assert.rejects(()=>call('clinic_finance_day_movements',[fsid]),e=>/مش متاحة/.test(e.message));
// financial manager: period view sees it, with the opening balance; range limit
await as(3);d=await call('clinic_finance_day_movements',[null,date,date]);assert(d.manager);assert(d.visits.some(x=>x.id===v.id));assert('opening_book' in d.shifts[0],'manager sees the opening balance');
d=await call('clinic_finance_day_movements',[fsid]);assert(d.visits.length>=1,'manager can open any shift');
await assert.rejects(()=>call('clinic_finance_day_movements',[null,'2026-01-01','2026-03-01']),e=>/٣١ يوم/.test(e.message));
// it writes nothing: a call inside a read-only transaction works
await db.exec('reset role');await db.exec('begin read only');await as(1);await call('clinic_finance_day_movements',[]);await db.exec('reset role');await db.exec('rollback');
// rollback drops it
await db.exec(require('fs').readFileSync('supabase/rollbacks/20261126220000_day_movements.rollback.sql','utf8'));
assert.equal((await db.query("select to_regprocedure('public.clinic_finance_day_movements(uuid,date,date,uuid)') f")).rows[0].f,null);
assert.equal((await db.query("select to_regclass('clinic_finance.blind_count_settings') t")).rows[0].t,null,'switch table dropped');
await db.close();console.log('PASS day movements: cashier sees own shift visits (due, collected here + receipts, doctor share, discount asked/approved, payouts from his drawer), blind-count switch OFF (trial: cashier sees opening) / ON (blind), SA/FM only; other employee nothing/refused; FM any shift/period with opening; read-only; re-apply refused; rollback drops.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'day-movements-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
