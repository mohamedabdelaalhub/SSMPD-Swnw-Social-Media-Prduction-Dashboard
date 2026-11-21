// base setup copied from treasury-handover-main-sql.cjs; 20261122010000: «الخزينة الرئيسية — <الاسم>» in the peer-handover options (open main shift + custodian) and the review-only open-drawers list.
// The money still moves only through the existing treasury handover (transfer_request / end_shift -> main custodian approves). Rollback restores the peer function byte for byte.
const boot=require('./helpers/reception-bridge.cjs'),fs=require('fs'),assert=require('assert/strict');
(async()=>{const x=await boot(['reception_canonical_catalog']),{db,as,fin,key,id,owner,call}=x;
try{
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.startsWith(n)),'utf8');
 await db.exec('reset role');for(const n of ['20261017212113','20261018205000','20261019001000'])await db.exec(mig(n));if(!(await db.query("select to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') r")).rows[0].r)await db.exec(mig('20261116150000_finance_shift_movements'));
 await owner("insert into admins(id,name,role) values($1,'Rec Two','reception')",[id(5)]);
 const chart=(a,p)=>fin('ledger_command',[a,p,key()]),treasury=(a,p,k=key())=>fin('treasury_command',[a,p,k]);
 await as(1);let parent=null;for(let l=1;l<=5;l++){const a=await chart('account_create',{code:'01'+'01'.repeat(l-1),name:'مستوى '+l,kind:'asset',parent_code:parent,is_postable:l===5});parent=a.code;}
 await chart('account_create',{code:'0101010102',name:'درج 1',kind:'asset',parent_code:'01010101'});await chart('account_create',{code:'0101010103',name:'درج 2',kind:'asset',parent_code:'01010101'});
 const main=await treasury('register_save',{name:'الخزينة الرئيسية',treasury_kind:'main',account_code:parent,assigned_to:id(3),limit:1000});
 const r1=await treasury('register_save',{name:'خزينة منار',treasury_kind:'collection',account_code:'0101010102',assigned_to:id(4),parent_register_id:main.id});
 const r2=await treasury('register_save',{name:'خزينة مازن',treasury_kind:'collection',account_code:'0101010103',assigned_to:id(5),parent_register_id:main.id});
 await as(4);const s1=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await as(5);const s2=await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);
 const collect=async(shift,amt,who)=>{const e=(await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id',['fixture',key(),'تحصيل اختبار',shift,id(who)]))[0].id;await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'4110',0,$2)",[e,amt]);};
 await collect(s1,1800,4);await collect(s2,500,5);
 await db.exec(mig('20261118160000'));
 const md5=async()=>(await owner("select md5(pg_get_functiondef('public.clinic_finance_peer_handover(text,jsonb,uuid)'::regprocedure)) m"))[0].m,before=await md5();
 const M=mig('20261122010000');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await db.exec('reset role');await db.exec(mig('20261122050000'));await assert.rejects(()=>db.exec(mig('20261122050000')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const nudge=(s,n)=>call('clinic_finance_handover_nudge',[s,n||'']),mine=()=>call('clinic_finance_my_handover_nudges',[]),seen=id=>call('clinic_finance_handover_nudge_seen',[id]);
 // reviewer only (financial manager id 3); reception / accountant refused
 await as(4);await assert.rejects(()=>nudge(s2),/صلاح/);await as(2);await assert.rejects(()=>nudge(s2),/صلاح/);
 await as(3);await assert.rejects(()=>nudge('40000000-0000-4000-8000-000000000999'),/مش مفتوحة/);
 const n1=await nudge(s1,'آخر اليوم');assert.equal(n1.replayed,false);assert.equal((await nudge(s1)).replayed,true,'one open nudge per shift');
 // only the cashier of that shift sees it, with the sender's name
 await as(5);assert.deepEqual(await mine(),[]);
 await as(4);let m=await mine();assert.equal(m.length,1);assert.deepEqual([m[0].id,m[0].shift_id,m[0].register,m[0].from_name,m[0].note],[n1.id,s1,'خزينة منار','Test 3','آخر اليوم']);
 // nobody else can mark it seen; the cashier can
 await as(5);await seen(n1.id);await as(4);assert.equal((await mine()).length,1);await seen(n1.id);assert.equal((await mine()).length,0);
 // after seen a new nudge is allowed; an ended shift hides it and cannot be nudged
 await as(3);await nudge(s1);await as(4);assert.equal((await mine()).length,1);
 await as(4);await treasury('end_shift',{shift_id:s1,counts:{'100':18}});assert.equal((await mine()).length,0,'ended shift hides the nudge');
 await as(3);await assert.rejects(()=>nudge(s1),/مش مفتوحة/);
 // nothing moved: no entry was written by nudges
 assert.equal(+(await owner("select count(*) n from clinic_finance.audit where action='handover_nudge'"))[0].n,2);
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122050000_cash_handover_nudge.rollback.sql','utf8'));
 assert.equal((await owner("select to_regclass('clinic_finance.handover_nudges') r"))[0].r,null);
 console.log('PASS cash handover nudge SQL: reviewer only, open collection shift only, one open nudge per shift, only the cashier sees / dismisses it, ended shift hides it, audited, no money moved, rollback.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
