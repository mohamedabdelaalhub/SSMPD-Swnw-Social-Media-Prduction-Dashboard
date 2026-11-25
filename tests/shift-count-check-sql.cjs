// «جرد الوردية» count check (20261125110000): blind «عدّ تاني», 3 checks max, on/off setting, attempts for reviewers.
const boot=require('./helpers/reception-bridge.cjs'),fs=require('fs'),assert=require('assert/strict');
(async()=>{const x=await boot(['reception_canonical_catalog']),{db,as,fin,key,id,owner,call}=x;
try{
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.startsWith(n)),'utf8');
 await db.exec('reset role');for(const n of ['20261017212113','20261018205000','20261019001000','20261120110000'])await db.exec(mig(n));
 await owner("insert into admins(id,name,role) values($1,'Rec Two','reception')",[id(5)]);
 const chart=(a,p)=>fin('ledger_command',[a,p,key()]),treasury=(a,p,k=key())=>fin('treasury_command',[a,p,k]);
 await as(1);let parent=null;for(let l=1;l<=5;l++){const a=await chart('account_create',{code:'01'+'01'.repeat(l-1),name:'مستوى '+l,kind:'asset',parent_code:parent,is_postable:l===5});parent=a.code;}
 await chart('account_create',{code:'0101010102',name:'درج 1',kind:'asset',parent_code:'01010101'});await chart('account_create',{code:'0101010103',name:'درج 2',kind:'asset',parent_code:'01010101'});
 const main=await treasury('register_save',{name:'الخزينة الرئيسية',treasury_kind:'main',account_code:parent,assigned_to:id(3),limit:1000});
 const r1=await treasury('register_save',{name:'خزينة مازن',treasury_kind:'collection',account_code:'0101010102',assigned_to:id(4),parent_register_id:main.id});
 const r2=await treasury('register_save',{name:'خزينة منار',treasury_kind:'collection',account_code:'0101010103',assigned_to:id(5),parent_register_id:main.id});
 const collect=async(shift,amt,who)=>{const e=(await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id',['fixture',key(),'تحصيل اختبار',shift,id(who)]))[0].id;await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'4110',0,$2)",[e,amt]);};
 const bal=async r=>+(await owner("select clinic_finance.treasury_balance($1) b",[r]))[0].b;
 await as(3);await call('clinic_booking_shift',['open',{register_id:main.id},key()]);
 await as(4);const s=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await collect(s,150,4);
 const M=mig('20261125110000');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const cc=(a,p)=>call('clinic_finance_count_check',[a,p]);
 // the cashier: match / no match — the answer never carries an amount
 await as(4);let r=await cc('check',{shift_id:s,counts:{'100':1,'50':1}});assert.deepEqual([r.enabled,r.match],[true,true]);
 r=await cc('check',{shift_id:s,counts:{'200':1}});assert.equal(r.match,false);assert.ok(!('expected' in r)&&!('difference' in r)&&!JSON.stringify(r).includes('150'),'no amount leaked');
 await assert.rejects(()=>cc('check',{shift_id:s,counts:{'3':1}}),/فئات أو أعداد غير صالحة/);
 r=await cc('check',{shift_id:s,counts:{'50':3}});assert.equal(r.match,true);
 r=await cc('check',{shift_id:s,counts:{'50':1}});assert.equal(r.limit,true,'max 3 checks per shift');
 assert.equal(+(await owner("select count(*) n from clinic_finance.count_attempts where shift_id=$1",[s]))[0].n,3);
 // another employee cannot check this shift
 await as(5);await assert.rejects(()=>cc('check',{shift_id:s,counts:{'50':3}}),/لصاحب الوردية/);
 // settings: reception cannot change; FM turns it off → enabled:false; on again
 await as(4);assert.equal((await cc('settings',{})).can_change,false);await assert.rejects(()=>cc('set',{enabled:false}),/للسوبر أدمن أو المدير المالي/);
 await as(3);await cc('set',{enabled:false});await as(5);const s2=await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);
 assert.deepEqual(await cc('check',{shift_id:s2,counts:{'50':1}}),{enabled:false});
 await as(3);await cc('set',{enabled:true});assert.equal((await cc('settings',{})).enabled,true);
 // end the shift with a wrong count → cash case; reviewers see the attempts, the cashier cannot
 await as(4);await treasury('end_shift',{shift_id:s,counts:{'200':1}});await as(3);{const t=(await owner("select id from clinic_finance.treasury_transfers where from_shift=$1",[s]))[0].id;await treasury('transfer_review',{id:t,approve:true,note:'استلمت'});}await as(4);
 const cs=(await owner("select id from clinic_finance.cash_cases where shift_id=$1",[s]))[0];assert(cs,'case opened as before');
 await assert.rejects(()=>cc('attempts',{case_ids:[cs.id]}),/للمراجعين/);
 await as(3);const at=await cc('attempts',{case_ids:[cs.id]});assert.equal(at[0].attempts.length,3);assert.deepEqual(at[0].attempts.map(a=>a.matched),[true,false,true]);
 assert(+(await owner("select count(*) n from clinic_finance.audit where action='count_check_setting'"))[0].n>=2,'setting changes audited');
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261125110000_shift_count_check.rollback.sql','utf8'));
 assert.equal((await owner("select to_regprocedure('public.clinic_finance_count_check(text,jsonb)') f"))[0].f,null);
 console.log('PASS shift count check: blind match/no-match (no amount leaked), invalid denominations refused, max 3 checks per shift, cashier-only, on/off by super/FM (audited), end_shift unchanged (case opened), attempts for reviewers only, rollback.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
