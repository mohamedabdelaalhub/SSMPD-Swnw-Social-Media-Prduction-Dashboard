// 20261127110000 «التحصيل بضغطة واحدة»: a second collect for the same patient + amount + method within 2 minutes is refused
// (hint duplicate_collect) unless confirm_duplicate; the confirmed one is noted; a replayed token returns the first answer.
// Reuses the live reception setup of tests/reception-bridge.cjs (admin 1, live workspace, patient pat).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','finance_shift_movements'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,args)=>owner(sql,args);const M=require('fs').readFileSync('supabase/migrations/20261127110000_collect_once.sql','utf8');
await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
await as(1);const k1=key();const r1=await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-1'},k1);
const n0=+(await q("select count(*) n from clinic_reception.payments where workspace_id=$1",[live]))[0].n;
// same token again (double click / network retry): the first answer, no new receipt, no warning
await as(1);const r1b=await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-1'},k1);assert.equal(JSON.stringify(r1b),JSON.stringify(r1),'replay returns the first answer');
// a NEW window, same patient / amount / method within 2 minutes → refused with the message + hint
let err=null;await as(1);try{await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-2'});}catch(e){err=e;}
assert(err,'second collect refused');assert.match(err.message,/اتسجل للمريض ده نفس المبلغ \\(50 ج\\.م إنستا باي\\) من \\d+ ثانية — إيصال/);assert.match(err.message,/حصّل تاني برضه/);
assert.equal(+(await q("select count(*) n from clinic_reception.payments where workspace_id=$1",[live]))[0].n,n0,'nothing recorded');
await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(1)]);await db.exec('set role authenticated');
try{await db.query("select public.clinic_reception_command($1,'collect',$2::jsonb,gen_random_uuid())",[live,JSON.stringify({patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-2'})]);assert.fail('should refuse');}
catch(e){assert.equal(e.hint,'duplicate_collect');const d=JSON.parse(e.detail);assert.equal(+d.amount,50);assert.equal(d.method,'instapay');assert(d.seconds>=1);}
await db.exec('reset role');
// confirmed → saved, with the note naming the earlier receipt
await as(1);const r2=await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-2',confirm_duplicate:true});
await q("alter table clinic_reception.payments add column if not exists note text").catch(()=>{});
const p2=(await q("select to_jsonb(p)->>'note' note from clinic_reception.payments p where id=$1",[r2.id]))[0];
if(p2.note==null){await as(1);const r2b=await cmd(live,'collect',{patient_id:pat,amount:52,method:'instapay',reference:'IP-ONCE-2B'});await as(1);const r2c=await cmd(live,'collect',{patient_id:pat,amount:52,method:'instapay',reference:'IP-ONCE-2C',confirm_duplicate:true});
 assert.match((await q("select note from clinic_reception.payments where id=$1",[r2c.id]))[0].note,/تحصيل تاني متأكد منه — الإيصال السابق/,'note on the confirmed receipt');}
else assert.match(p2.note,/تحصيل تاني متأكد منه — الإيصال السابق/);
// different amount / different method / different patient → no warning
await as(1);await cmd(live,'collect',{patient_id:pat,amount:51,method:'instapay',reference:'IP-ONCE-3'});
await as(1);await cmd(live,'collect',{patient_id:pat,amount:50,method:'bank',reference:'BANK-ONCE-1'});
// after 2 minutes → no warning (age the earlier receipts)
await q("update clinic_reception.payments set created_at=created_at-interval '3 minutes' where workspace_id=$1",[live]);
await as(1);await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-4'});
// collect_multi goes through the same guard
await as(1);let em=null;try{await cmd(live,'collect_multi',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-5',invoice_ids:[]});}catch(e){em=e;}
assert(em&&/نفس المبلغ/.test(em.message),'collect_multi guarded');
// other actions untouched
await db.exec('reset role');
// rollback restores the previous command
await db.exec(require('fs').readFileSync('supabase/rollbacks/20261127110000_collect_once.rollback.sql','utf8'));
assert.equal((await db.query("select to_regprocedure('clinic_reception.command_before_collect_once(uuid,text,jsonb,uuid)') f")).rows[0].f,null);
await as(1);await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-6'});await as(1);await cmd(live,'collect',{patient_id:pat,amount:50,method:'instapay',reference:'IP-ONCE-7'});
await db.close();console.log('PASS collect once: same token replay = first answer; second window same patient/amount/method within 2 min refused (message + hint duplicate_collect, nothing recorded); confirmed → saved with note; other amount/method or after 2 min → no warning; collect_multi guarded; re-apply refused; rollback restores.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'collect-once-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
