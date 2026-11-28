// clinic_reception_reference_free (20261128020000, «رقم العملية من الصورة»): the suggested reference never repeats — base, then -2, -3 …
// within the same method group (bank + instapay together, like the existing unique index); other groups don't block; signed-in only;
// bad input refused; second run refused; rollback drops it.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs');
const M=path.join(__dirname,'..','supabase','migrations','20261128020000_payment_reference_free.sql'),R=path.join(__dirname,'..','supabase','rollbacks','20261128020000_payment_reference_free.rollback.sql');
(async()=>{const {db,rpc,as,id}=await boot(['reception_services_packages']);await db.exec('reset role');
 const MIG=fs.readFileSync(M,'utf8');assert(MIG.indexOf("raise exception 'تم تطبيق هذا الملف من قبل'")<MIG.indexOf('\nbegin;'));
 // the live dry-run file: body = migration, runs here and rolls back
 {const LIVE=fs.readFileSync(path.join(__dirname,'payment-reference-free-live-rollback.sql'),'utf8'),i=LIVE.indexOf('<<<\n',LIVE.indexOf('-- >>> BEGIN migration body'))+4,j=LIVE.indexOf('\n-- >>> END migration body <<<');
  assert.equal(LIVE.slice(i,j),MIG.split('\n').filter(l=>l!=='begin;'&&l!=='commit;').join('\n').replace(/\n+$/,''),'live body = migration');globalThis.__LIVE=LIVE;}
 await db.exec(MIG);
 const ws=(await db.query('select id from clinic_reception.workspaces limit 1')).rows[0]?.id||(await rpc('clinic_reception_bootstrap'));await db.exec('reset role');
 let pat=(await db.query('select id from clinic_reception.patients where workspace_id=$1 limit 1',[ws])).rows[0];
 if(!pat){pat=(await db.query("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'T1','مريض','0101',$2) returning id",[ws,id(1)])).rows[0];}
 const pay=(m,r)=>db.query('insert into clinic_reception.payments(workspace_id,patient_id,method,amount,reference,created_by) values($1,$2,$3,400,$4,$5)',[ws,pat.id,m,r,id(1)]);
 await pay('wallet','VF-01012345678-27-11');await pay('instapay','IP-1234-27-11');await pay('instapay','IP-1234-27-11-2');
 await as(3);
 const f=(m,b)=>rpc('clinic_reception_reference_free',{p_method:m,p_base:b});
 assert.equal(await f('wallet','VF-01012345678-27-11'),'VF-01012345678-27-11-2','taken → -2');
 assert.equal(await f('wallet','VF-01099999999-27-11'),'VF-01099999999-27-11','free → as is');
 assert.equal(await f('instapay','IP-1234-27-11'),'IP-1234-27-11-3','-2 taken too → -3');
 assert.equal(await f('bank','IP-1234-27-11'),'IP-1234-27-11-3','bank + instapay are one group');
 assert.equal(await f('pos','IP-1234-27-11'),'IP-1234-27-11','another group does not block');
 await assert.rejects(()=>f('pos','x'),/مرجع غير صالح/);await assert.rejects(()=>f('pos','VF 0101'),/مرجع غير صالح/);
 await db.exec('reset role');await db.query("select set_config('test.admin','',false)");await db.exec('set role authenticated');
 await assert.rejects(()=>db.query("select public.clinic_reception_reference_free('pos','CC-1-27-11')"),/سجّل دخولك الأول/);
 await db.exec('reset role');await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);
 await db.exec(require('fs').readFileSync(R,'utf8'));
 {const res=await db.exec(globalThis.__LIVE),sum=res[res.length-2].rows;if(process.env.SHOW_LIVE)console.log(sum);assert(sum.length>=3);assert.deepEqual(sum.filter(r=>!r.ok),[],'live dry-run ok');}
 assert.equal((await db.query("select to_regprocedure('public.clinic_reception_reference_free(text,text)') t")).rows[0].t,null,'live rolled back');
 await db.exec(MIG);
 await db.exec(fs.readFileSync(R,'utf8'));assert.equal((await db.query("select to_regprocedure('public.clinic_reception_reference_free(text,text)') t")).rows[0].t,null);
 await db.close();console.log('PASS reference_free: base / -2 / -3, bank+instapay one group, other groups free, bad input + anonymous refused, second run refused, rollback');
})().catch(e=>{console.error(e);process.exit(1);});
