// 20261127020000: the close-shift screen follows the blind-count switch (owner 2026-11-26 «نأجل تطبيق العد الأعمى مؤقتا»).
// OFF → clinic_finance_snapshot gives the cashier the expected cash + opening of HIS OWN open shift; ON → exactly the previous answer.
// Reuses the live reception setup of tests/reception-bridge.cjs (admin 1 has an open shift with a 110 cash receipt).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','finance_shift_movements'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,args)=>owner(sql,args);await db.exec('reset role');
await db.exec(require('fs').readFileSync('supabase/migrations/20261126220000_day_movements.sql','utf8'));
await as(1);const before=await call('clinic_finance_snapshot',[date,date]);await db.exec('reset role');
const M=require('fs').readFileSync('supabase/migrations/20261127020000_close_shift_blind_switch.sql','utf8');await db.exec(M);
await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
const own=v=>(v.shifts||[]).find(x=>x.cashier_id===id(1)&&x.status==='open');
assert(own(before)&&own(before).expected==null&&own(before).opening_book==null,'fixture: today the own open shift is blind');
// switch OFF (default, trial): the cashier sees expected + opening of his own open shift
await as(1);let v=await call('clinic_finance_snapshot',[date,date]);assert.equal(v.blind_count,false);
const sh=own(v);const cash=+(await q("select clinic_finance.shift_cash($1) c",[sh.id]))[0].c;
assert.equal(+sh.expected,cash,'expected = shift cash');assert(sh.opening_book!=null&&sh.blind_off===true);
// another employee's shifts are not revealed to him
await as(1);const reg4=await call('clinic_finance_save_register',[null,'خزينة تانية (اختبار)',1000,'both']);
await q("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values($1,$2,gen_random_uuid(),100)",[reg4,id(4)]);
await as(1);v=await call('clinic_finance_snapshot',[date,date]);const other=(v.shifts||[]).find(x=>x.cashier_id===id(4));
if(other)assert(!other.blind_off,'other shifts: whatever the previous function gave, never added by the switch');
// switch ON: identical to the previous function (blind)
await as(1);await call('clinic_finance_blind_count',['set',true]);v=await call('clinic_finance_snapshot',[date,date]);assert.equal(v.blind_count,true);
assert(own(v).expected==null&&own(v).opening_book==null&&!own(v).blind_off,'switch ON: blind as before');
const strip=x=>{const y=JSON.parse(JSON.stringify(x));delete y.blind_count;return y;};
await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(1)]);const prevOwner=(await db.query("select clinic_finance.snapshot_pre_blind_switch($1,$2,0) v",[date,date])).rows[0].v;
assert.deepEqual(strip(v).shifts,prevOwner.shifts,'switch ON: shifts exactly as the previous function');
await as(1);await call('clinic_finance_blind_count',['set',false]);
// the inner function is not callable by users
await as(1);await assert.rejects(()=>db.query("select clinic_finance.snapshot_pre_blind_switch($1,$2,0)",[date,date]),/permission denied/);await db.exec('reset role');
// rollback restores the previous function
await db.exec('reset role');await db.exec(require('fs').readFileSync('supabase/rollbacks/20261127020000_close_shift_blind_switch.rollback.sql','utf8'));
assert.equal((await db.query("select to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)') f")).rows[0].f,null);
await as(1);v=await call('clinic_finance_snapshot',[date,date]);assert(!('blind_count' in v)&&own(v).expected==null,'rollback: back to blind, previous answer');
await db.close();console.log('PASS close-shift blind switch: OFF (trial) → cashier sees expected (= shift cash) + opening of his own open shift; other shifts not revealed; ON → identical to the previous snapshot (blind); inner ungranted; re-apply refused; rollback restores.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'close-blind-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
