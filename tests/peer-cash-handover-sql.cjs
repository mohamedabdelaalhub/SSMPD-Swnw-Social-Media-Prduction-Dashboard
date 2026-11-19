// Owner 2026-11-18 «تسليم تحصيل لزميل»: mid-shift and end-of-shift cash handover between two reception collection shifts,
// confirmed by the receiver; reject / cancel move nothing; pending blocks closing and the main handover; ledger + shift report correct.
const boot=require('./helpers/reception-bridge.cjs'),fs=require('fs'),assert=require('assert/strict');
(async()=>{const x=await boot(['reception_canonical_catalog']),{db,as,fin,key,id,owner,call}=x;
try{
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.startsWith(n)),'utf8');
 await db.exec('reset role');for(const n of ['20261017212113','20261018205000','20261019001000'])await db.exec(mig(n));if(!(await db.query("select to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') r")).rows[0].r)await db.exec(mig('20261116150000_finance_shift_movements'));
 // live already has 20261118140000's shift-report fix (money out on any register cash account); emulate just that part here
 await db.exec(`do $x$declare d text;begin d:=pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);execute replace(d,$s$l.account='1111' and l.credit>0$s$,$s$clinic_finance.is_cash_account(l.account) and l.credit>0$s$);end $x$;`);
 await owner("insert into admins(id,name,role) values($1,'Rec Two','reception')",[id(5)]);
 const chart=(a,p)=>fin('ledger_command',[a,p,key()]),treasury=(a,p,k=key())=>fin('treasury_command',[a,p,k]);
 await as(1);let parent=null;for(let l=1;l<=5;l++){const a=await chart('account_create',{code:'01'+'01'.repeat(l-1),name:'مستوى '+l,kind:'asset',parent_code:parent,is_postable:l===5});parent=a.code;}
 await chart('account_create',{code:'0101010102',name:'درج 1',kind:'asset',parent_code:'01010101'});await chart('account_create',{code:'0101010103',name:'درج 2',kind:'asset',parent_code:'01010101'});
 const main=await treasury('register_save',{name:'الخزينة الرئيسية',treasury_kind:'main',account_code:parent,assigned_to:id(3),limit:1000});
 const r1=await treasury('register_save',{name:'dina',treasury_kind:'collection',account_code:'0101010102',assigned_to:id(4),parent_register_id:main.id});
 const r2=await treasury('register_save',{name:'mahmoud',treasury_kind:'collection',account_code:'0101010103',assigned_to:id(5),parent_register_id:main.id});
 await as(4);const s1=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await as(5);const s2=await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);
 const collect=async(shift,amt,who)=>{const e=(await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id',['fixture',key(),'تحصيل اختبار',shift,id(who)]))[0].id;await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'4110',0,$2)",[e,amt]);};
 await collect(s1,3000,4);await collect(s2,500,5);
 const M=mig('20261118160000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const ph=(a,p,k)=>call('clinic_finance_peer_handover',[a,p,k===undefined?key():k]);const cash=async s=>Number((await owner('select clinic_finance.shift_cash($1) c',[s]))[0].c);
 // options: my shift + colleagues
 await as(4);let o=await ph('options',{});assert.equal(o.shift.id,s1);assert.equal(Number(o.shift.available),3000);assert.deepEqual(o.colleagues.map(c=>c.shift_id),[s2]);
 // mid-shift: over the drawer refused; 1000 requested (idempotent), nothing moves until accepted
 await assert.rejects(()=>ph('request',{from_shift:s1,to_shift:s2,amount:3500}),/أكبر من الكاش/);
 const k1=key();let h=await ph('request',{from_shift:s1,to_shift:s2,amount:1000,note:'ماشي بدري'},k1);assert.equal(h.status,'pending');assert.equal((await ph('request',{from_shift:s1,to_shift:s2,amount:1000},k1)).id,h.id);
 assert.equal(await cash(s1),3000);assert.equal(Number((await ph('options',{})).shift.available),2000,'pending reserves the amount');
 // pending blocks closing and the main handover
 await assert.rejects(()=>treasury('end_shift',{shift_id:s1,counts:{'100':20}}),/معلّق|المعلقة/);
 // only the receiver accepts, with the exact counted amount
 await assert.rejects(()=>ph('accept',{id:h.id,counted:1000}),/مش ليك/);
 await as(5);let ib=await ph('inbox',{},null);assert.equal(ib.incoming.length,1);assert.equal(ib.incoming[0].from_name,'Test 4');
 await assert.rejects(()=>ph('accept',{id:h.id,counted:900}),/مش زي المبلغ/);
 h=await ph('accept',{id:h.id,counted:1000});assert.equal(h.status,'accepted');
 assert.equal(await cash(s1),2000);assert.equal(await cash(s2),1500);assert.equal((await ph('accept',{id:h.id,counted:1000})).status,'accepted','replay harmless');
 assert.equal(Number((await owner("select sum(l.debit-l.credit) b from clinic_finance.lines l where l.account='1119'"))[0].b),0,'transit clears');
 // reject: nothing moves
 await as(4);let h2=await ph('request',{from_shift:s1,to_shift:s2,amount:200});await as(5);await assert.rejects(()=>ph('reject',{id:h2.id}),/سبب الرفض/);
 h2=await ph('reject',{id:h2.id,note:'المبلغ ناقص'});assert.equal(h2.status,'rejected');assert.equal(await cash(s1),2000);
 // cancel by sender only
 await as(4);let h3=await ph('request',{from_shift:s1,to_shift:s2,amount:100});await as(5);await assert.rejects(()=>ph('cancel',{id:h3.id}),/اللي سلّم بس/);await as(4);assert.equal((await ph('cancel',{id:h3.id})).status,'cancelled');
 // end of shift: hand everything (counted 1950 vs expected 2000 → cash case −50) to the colleague; sender stops collecting; reject reopens
 let e1=await ph('request',{from_shift:s1,to_shift:s2,end_shift:true,counts:{'100':19,'50':1}});assert.equal(Number(e1.amount),1950);assert.equal(e1.end_of_shift,true);
 assert((await owner('select ended_at from clinic_finance.shifts where id=$1',[s1]))[0].ended_at,'ended');
 await as(5);await ph('reject',{id:e1.id,note:'العد مش مظبوط'});assert.equal((await owner('select ended_at from clinic_finance.shifts where id=$1',[s1]))[0].ended_at,null,'reopened for recount');
 await as(4);e1=await ph('request',{from_shift:s1,to_shift:s2,end_shift:true,counts:{'100':19,'50':1}});
 await as(5);e1=await ph('accept',{id:e1.id,counted:1950});
 const sh=(await owner('select status,counted from clinic_finance.shifts where id=$1',[s1]))[0];assert.equal(sh.status,'submitted');assert.equal(Number(sh.counted),0);
 assert.equal(Number((await owner('select difference d from clinic_finance.cash_cases where shift_id=$1',[s1]))[0].d),-50,'count difference goes to review');
 assert.equal(await cash(s2),3450);
 // shift report: out on the sender, in on the receiver
 await as(3);const mv1=await call('clinic_finance_shift_movements',[s1,null,null,null,null]);assert.equal(mv1.movements.filter(r=>r.direction==='out').reduce((n,r)=>n+Number(r.amount),0),-2950);
 const mv2=await call('clinic_finance_shift_movements',[s2,null,null,null,null]);const ins=mv2.movements.filter(r=>r.kind==='handover');assert.equal(ins.length,2);assert.equal(ins.reduce((n,r)=>n+Number(r.amount),0),2950);
 assert.equal(Number((await owner('select sum(debit-credit) n from clinic_finance.lines'))[0].n),0,'ledger balanced');
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261118160000_peer_cash_handover.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('public.clinic_finance_peer_handover(text,jsonb,uuid)') r")).rows[0].r,null);
 console.log('PASS peer cash handover: options, mid-shift with reserve, receiver-only exact accept, transit clears, reject/cancel move nothing, pending blocks close/main handover, end-of-shift with recount + cash case, shift report in/out, rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
