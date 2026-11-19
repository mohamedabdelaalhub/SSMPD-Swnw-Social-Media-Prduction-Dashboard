// Owner 2026-11-15: every treasury movement in detail (self-pay vs insurance, method, amount); managers see all shifts.
// Reuses the live reception setup of tests/reception-bridge.cjs (up to the first live cash collection).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','finance_shift_movements'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,args)=>owner(sql,args);await as(1);
let m=await call('clinic_finance_shift_movements',[]);
assert.equal(m.shifts.length,1,'cashier default: own open shift');
let r=m.movements.find(x=>x.reference==='LIVE-CASH');assert(r,'cash receipt listed');
assert.deepEqual([r.direction,r.kind,r.method,+r.amount],['in','self','cash',110]);assert(r.title&&r.detail,'patient and service shown');assert(r.cashier_name);
// an instapay receipt by the same cashier during the shift (no drawer) is part of the shift's movements
await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-MV-1'});
m=await call('clinic_finance_shift_movements',[]);r=m.movements.find(x=>x.reference==='IP-MV-1');assert(r&&r.method==='instapay'&&+r.amount===50);
// a refund of patient credit in cash from this shift = money out
const pay=(await q("select * from clinic_reception.payments where reference='LIVE-CASH'"))[0];await as(1);
const rf=(await cmd(live,'request',{kind:'refund',subject_id:pay.id,amount:4,reference:'RF-MV',shift_id:pay.shift_id,reason:'رد الزيادة',evidence:'إيصال'})).id;
await as(3);await cmd(live,'request_review',{id:rf,approve:true,note:'مطابق'});await as(1);
m=await call('clinic_finance_shift_movements',[]);r=m.movements.find(x=>x.direction==='out');assert(r&&+r.amount===-4&&r.method==='cash','refund out');
// approved method correction shows as a fix row, and the receipt itself now reads card
await assert.rejects(()=>cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'pos',reference:'VISA-MV',reason:'دفع فيزا',evidence:'إيصال الماكينة'}),e=>/استرداد/.test(e.message),'receipt with a refund cannot be re-methoded');
await cmd(live,'collect',{patient_id:pat,amount:30,method:'cash',shift_id:pay.shift_id,reference:'CASH-MV-2'});const p2=(await q("select id from clinic_reception.payments where reference='CASH-MV-2'"))[0].id;await as(1);
const fix=(await cmd(live,'request',{kind:'method_fix',subject_id:p2,method:'pos',reference:'VISA-MV',reason:'دفع فيزا',evidence:'إيصال الماكينة'})).id;
await as(3);await cmd(live,'request_review',{id:fix,approve:true,note:'مطابق'});await as(1);
m=await call('clinic_finance_shift_movements',[]);r=m.movements.find(x=>x.direction==='fix');assert(r&&r.method==='cash>pos'&&+r.amount===30,'fix row');
assert.equal(m.movements.find(x=>x.reference==='VISA-MV').method,'pos','receipt now card');
// insurance: a receipt allocated to an invoice with a payer claim is marked insurance with payer, claim and total
const inv=(await q("select i.id,i.amount from clinic_reception.invoices i where i.workspace_id=$1 and i.kind='service' limit 1",[live]))[0];
const ent=(await q("insert into clinic_reception.entities(workspace_id,name,kind) values($1,'شركة تأمين (تجربة)','insurer') returning id",[live]))[0].id;
await q("insert into clinic_reception.claims(workspace_id,invoice_id,entity_id,amount,authorization_ref,snapshot) values($1,$2,$3,74,'AUTH-TEST','{}')",[live,inv.id,ent]);await as(1);
m=await call('clinic_finance_shift_movements',[]);r=m.movements.find(x=>x.reference==='LIVE-CASH');
assert.equal(r.kind,'insurance');assert.equal(r.insurance.payer,'شركة تأمين (تجربة)');assert.equal(+r.insurance.claim,74);assert.equal(+r.insurance.total,+inv.amount);
// no opening balance / expected cash anywhere in the cashier's answer
assert(!/opening|expected|counted/.test(JSON.stringify(m)),'blind count kept');
// another employee: cannot read this shift, sees nothing by default
const sid=m.shifts[0].id;await as(4);
await assert.rejects(()=>call('clinic_finance_shift_movements',[sid]),e=>/مش متاحة/.test(e.message));
assert.equal((await call('clinic_finance_shift_movements',[])).movements.length,0);
// financial manager: by period and by employee, rows carry the cashier name; range limit
await as(3);m=await call('clinic_finance_shift_movements',[null,date,date]);assert(m.manager);assert(m.movements.length>=3);assert(m.movements.every(x=>x.cashier_name&&x.register_name));
m=await call('clinic_finance_shift_movements',[sid]);assert(m.movements.length>=3,'manager can open any shift');
await assert.rejects(()=>call('clinic_finance_shift_movements',[null,'2026-01-01','2026-03-01']),e=>/٣١ يوم/.test(e.message));
await db.close();console.log('PASS shift movements: cashier sees own shift (cash, instapay without drawer, refund out, insurance payer/claim/total) without expected cash; other staff refused; managers by shift/period with names; range limit.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'shift-movements-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
