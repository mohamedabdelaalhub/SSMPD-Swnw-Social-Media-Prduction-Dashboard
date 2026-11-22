// base setup copied from treasury-handover-main-sql.cjs; then 20261122120000 main treasury balance. 20261122010000: «الخزينة الرئيسية — <الاسم>» in the peer-handover options (open main shift + custodian) and the review-only open-drawers list.
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
 const M=mig('20261122120000');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const mb=()=>call('clinic_finance_main_treasury_balance',[]);
 // reception (no finance view) refused; accountant (view, no review) allowed
 await as(4);await assert.rejects(()=>mb(),/صلاح/);
 await as(2);let v=await mb();assert.equal(v.configured,true);assert.equal(v.register,'الخزينة الرئيسية');assert.equal(Number(v.balance),0);assert.equal(v.shift,null,'no main shift open yet');
 // the custodian opens the main shift; Manar hands 1800 over (existing path) and it is approved -> balance 1800, in 1800
 await as(3);const sm=await call('clinic_booking_shift',['open',{register_id:main.id},key()]);
 await as(4);const t=await treasury('end_shift',{shift_id:s1,counts:{'200':5,'100':5,'50':6}});
 await as(3);const tr=(await owner("select id from clinic_finance.treasury_transfers where from_shift=$1 and status='pending'",[s1]))[0].id;await treasury('transfer_review',{id:tr,approve:true,note:'استلمت'});
 await as(2);v=await mb();assert.equal(Number(v.balance),1800);assert.equal(v.shift.id,sm);assert.equal(v.shift.custodian,'Test 3');
 assert.deepEqual([Number(v.shift.opening),Number(v.shift.cash_in),Number(v.shift.cash_out)],[0,1800,0]);assert.equal(Number(v.last_move.amount),1800);
 // equals the existing treasury_balance figure
 assert.equal(Number((await owner('select clinic_finance.treasury_balance($1) b',[main.id]))[0].b),1800);
 // the new function changes no table / snapshot: the existing blind-count tests (clinic-finance-sql) still cover open drawers
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122120000_main_treasury_balance.rollback.sql','utf8'));
 assert.equal((await owner("select to_regprocedure('public.clinic_finance_main_treasury_balance()') r"))[0].r,null);
 console.log('PASS main treasury balance SQL: finance view only (accountant yes, reception no), live balance = treasury_balance, open shift opening/in/out + custodian + last move after a real handover, rollback.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
