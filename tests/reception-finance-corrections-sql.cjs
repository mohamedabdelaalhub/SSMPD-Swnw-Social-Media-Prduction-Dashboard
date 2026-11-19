// Owner 2026-11-15: receptionist requests, financial manager approves —
// «تصحيح طريقة الدفع» (cash→card) and «إلغاء خدمة اتدخلت غلط»; plus the cashier's own shift collections per method.
// Reuses the live reception setup of tests/reception-bridge.cjs (up to the first live cash collection) so the flow is real.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');
const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,args)=>owner(sql,args);const bal=async acc=>+(await q('select coalesce(sum(l.debit-l.credit),0) n from clinic_finance.lines l where account=$1',[acc]))[0].n;
const pay=(await q("select * from clinic_reception.payments where reference='LIVE-CASH'"))[0];
const inv=s.invoices[0].id;await as(1);
// cashier sees own collections per method, never the drawer expectation
let mine=await call('clinic_finance_my_shift_collections',[]);assert.equal(mine.length,1);assert.deepEqual(mine[0].methods.map(m=>[m.method,+m.amount,+m.receipts]),[['cash',110,1]]);assert(!('expected' in mine[0])&&!('opening_book' in mine[0]),'no expected/opening');
// method_fix: validation at request time
await assert.rejects(()=>cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'cash',reference:'X',reason:'نفس الطريقة',evidence:'إيصال'}),e=>/مختلفة عن المسجلة/.test(e.message));
await assert.rejects(()=>cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'pos',reason:'من غير مرجع',evidence:'إيصال'}),e=>/مرجع العملية/.test(e.message));
const fix=(await cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'pos',reference:'VISA-778',amount:1,reason:'المريض دفع فيزا والموظف اختار نقدي',evidence:'إيصال الماكينة 778'})).id;
let r=(await q('select * from clinic_reception.requests where id=$1',[fix]))[0];assert.equal(+r.amount,110,'amount from the receipt, not the form');assert.equal(r.payload.method_from,'cash');
await assert.rejects(()=>cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'pos',reference:'VISA-779',reason:'تكرار',evidence:'إيصال'}),e=>/مستني المراجعة/.test(e.message));
await assert.rejects(()=>cmd(live,'request_review',{id:fix,approve:true,note:'اعتماد ذاتي'}),e=>/مراجعًا آخر/.test(e.message));
const cash0=await bal('1111'),card0=await bal('1114');
await as(3);await cmd(live,'request_review',{id:fix,approve:true,note:'مطابق لإيصال الماكينة'});await as(1);
assert.equal((await q('select method,reference from clinic_reception.payments where id=$1',[pay.id]))[0].method,'pos');
assert.equal((await q('select reference from clinic_reception.payments where id=$1',[pay.id]))[0].reference,'VISA-778');
assert.equal(await bal('1111'),cash0-110,'cash book lowered');assert.equal(await bal('1114'),card0+110,'card clearing raised');
const fsid=(await q('select finance_shift_id f from clinic_reception.shifts where id=$1',[pay.shift_id]))[0].f;
assert.equal(+(await q("select coalesce(sum(l.debit-l.credit),0) n from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.shift_id=$1 and l.account='1111'",[fsid]))[0].n,0,'shift expected cash no longer counts the card payment');
mine=await call('clinic_finance_my_shift_collections',[]);assert.deepEqual(mine[0].methods.map(m=>[m.method,+m.amount]),[['pos',110]]);
// reject path
const back=(await cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'cash',reason:'تجربة رفض',evidence:'لا يوجد'})).id;
await as(3);await assert.rejects(()=>cmd(live,'request_review',{id:back,approve:false,note:''}),e=>/سبب القرار/.test(e.message));await cmd(live,'request_review',{id:back,approve:false,note:'الإيصال فيزا فعلا'});await as(1);
assert.equal((await q('select status from clinic_reception.requests where id=$1',[back]))[0].status,'rejected');assert.equal((await q('select method from clinic_reception.payments where id=$1',[pay.id]))[0].method,'pos');
// service_void: executed service entered by mistake; paid amount becomes patient credit; doctor fee reversed
const credit=async()=>-(+(await q("select coalesce(sum(l.debit-l.credit),0) n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=$1 and l.account='2150' and j.dimensions->>'patient_id'=$2",[live,pat]))[0].n);
const credit0=await credit(),doc0=+(await q('select clinic_finance.doctor_balance($1) n',['RX-DOCTOR']))[0].n;
const sv=(await cmd(live,'request',{kind:'service_void',subject_id:inv,amount:0,reason:'الموظف دخل جلسة بدل كشف',evidence:'إفادة الطبيب'})).id;
assert.equal(+(await q('select amount from clinic_reception.requests where id=$1',[sv]))[0].amount,106);
await as(3);await cmd(live,'request_review',{id:sv,approve:true,note:'الخدمة لم تقدم'});await as(1);
const ord=(await q('select o.status from clinic_reception.orders o join clinic_reception.invoices i on i.order_id=o.id where i.id=$1',[inv]))[0];assert.equal(ord.status,'cancelled');
assert.equal(await credit(),credit0+106,'paid amount is now patient credit');
assert.equal(+(await q('select clinic_finance.doctor_balance($1) n',['RX-DOCTOR']))[0].n,doc0-20,'doctor fee reversed');
await assert.rejects(()=>cmd(live,'request',{kind:'service_void',subject_id:inv,reason:'مرة تانية',evidence:'مستند'}),e=>/مش منفذة/.test(e.message));
// closed shift: method fix refused with a clear message
await q("update clinic_reception.shifts set status='submitted' where id=$1",[pay.shift_id]);await as(1);
await assert.rejects(()=>cmd(live,'request',{kind:'method_fix',subject_id:pay.id,method:'cash',reason:'بعد الإغلاق',evidence:'مستند'}),e=>/اتقفلت/.test(e.message));
await db.close();console.log('PASS finance corrections: method fix (amount from receipt, maker≠checker, cash→card moves 1111→1114 and lowers shift cash, reject path, closed shift refused), service void (paid → patient credit, doctor fee reversed, order cancelled), cashier sees own collections per method without expected cash.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'finance-corrections-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
