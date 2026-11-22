// «جرد الخزينة الرئيسية» (20261122200000): the main custodian counts and the main treasury rolls over in one step (old shift closed for
// review, new one open at once); queued reviews no longer block the main treasury; collection treasuries keep the old rule; maker ≠ checker;
// handovers keep landing on the open main shift; status for the box (+24h reviewer nudge); rollback restores the indexes and the trigger.
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
 const r1=await treasury('register_save',{name:'خزينة منار',treasury_kind:'collection',account_code:'0101010102',assigned_to:id(4),parent_register_id:main.id});
 const r2=await treasury('register_save',{name:'خزينة مازن',treasury_kind:'collection',account_code:'0101010103',assigned_to:id(5),parent_register_id:main.id});
 const collect=async(shift,amt,who)=>{const e=(await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id',['fixture',key(),'تحصيل اختبار',shift,id(who)]))[0].id;await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'4110',0,$2)",[e,amt]);};
 await as(3);const sm=await call('clinic_booking_shift',['open',{register_id:main.id},key()]);
 await as(4);const s1=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await collect(s1,1800,4);
 await treasury('end_shift',{shift_id:s1,counts:{'200':9}});await as(3);let t=(await owner("select id from clinic_finance.treasury_transfers where from_shift=$1",[s1]))[0].id;await treasury('transfer_review',{id:t,approve:true,note:'استلمت'});
 const M=mig('20261122200000');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const count=(c,n,k=key())=>call('clinic_finance_main_count',[c,n||'',k]),status=()=>call('clinic_finance_main_count_status',[]);
 const bal=async()=>+(await owner("select clinic_finance.treasury_balance($1) b",[main.id]))[0].b;
 await as(3);let st=await status();assert.equal(st.can_count,true);assert.equal(st.can_open,false);assert.equal(st.pending_reviews,0);assert.equal(st.open_shift.id,sm);assert.equal(st.open_shift.mine,true);
 assert.equal(await bal(),1800);
 // only the custodian of the open main shift counts
 await as(1);await assert.rejects(()=>count({'200':9}),/مفتوحة باسم Test 3/);await as(2);await assert.rejects(()=>count({'200':9}));
 st=await status();assert.equal(st.can_count,false);assert.equal(st.is_custodian,false);
 // count 1: exact
 await as(3);await assert.rejects(()=>count({}),/جرد الفئات/);const k1=key();const c1=await count({'200':9},'جرد آخر اليوم',k1);
 assert.deepEqual([+c1.counted,+c1.expected,+c1.difference,c1.closed_shift],[1800,1800,0,sm]);assert.notEqual(c1.new_shift,sm);
 assert.deepEqual(JSON.parse(JSON.stringify(await count({'200':9},'جرد آخر اليوم',k1))),JSON.parse(JSON.stringify(c1)),'same token replays');
 await assert.rejects(()=>count({'200':8},'',k1),/مفتاح مكرر/);
 const rows=await owner("select id,status,cashier_id from clinic_finance.shifts where register_id=$1 order by opened_at",[main.id]);
 assert.deepEqual(rows.map(r=>r.status),['submitted','open'],'old closed for review, new open at once');assert.equal(rows[1].cashier_id,id(3));
 assert.equal(await bal(),1800,'book balance continuous');
 const lim=+(await owner("select clinic_finance.cash_limit($1) l",[c1.new_shift]))[0].l;assert.equal(lim,1800,'cash limit carries over');
 st=await status();assert.equal(st.pending_reviews,1);assert.equal(st.can_count,true);assert.equal(st.last_count.status,'submitted');assert.equal(+st.last_count.counted,1800);
 // count 2 the same day, short by 100 → cash case; still not blocked by the queued review
 const c2=await count({'200':8,'100':1});assert.equal(+c2.difference,-100);
 assert.equal(+(await owner("select difference from clinic_finance.cash_cases where shift_id=$1",[c2.closed_shift]))[0].difference,-100);
 st=await status();assert.equal(st.pending_reviews,2);assert.equal(st.overdue_reviews,0);
 // another custodian cannot open a second main shift while one is open
 await as(1);await assert.rejects(()=>call('clinic_booking_shift',['open',{register_id:main.id},key()]),/مفتوحة بالفعل|عليها وردية/);
 // maker ≠ checker: custodian cannot review his own; the owner can
 await as(3);await assert.rejects(()=>fin('review_shift',[c1.closed_shift,'مطابقة']),/ورديتك بنفسك/);
 await as(1);await fin('review_shift',[c1.closed_shift,'مطابقة بدون فرق']);st=await status();assert.equal(st.pending_reviews,1);assert.equal(st.can_review,true);
 // 24h nudge
 await owner("update clinic_finance.shifts set closed_at=now()-interval '25 hours' where id=$1",[c2.closed_shift]);await as(1);st=await status();assert.equal(st.overdue_reviews,1);assert.equal(st.pending.length,1);assert.equal(st.pending[0].id,c2.closed_shift);
 // handover after the roll-over lands on the NEW open main shift
 await as(5);const s2=await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);await collect(s2,500,5);await treasury('end_shift',{shift_id:s2,counts:{'100':5}});
 await as(3);t=(await owner("select id from clinic_finance.treasury_transfers where from_shift=$1",[s2]))[0].id;await treasury('transfer_review',{id:t,approve:true,note:'استلمت'});
 assert.equal((await owner("select to_shift from clinic_finance.treasury_transfers where id=$1",[t]))[0].to_shift,c2.new_shift);assert.equal(await bal(),2300);
 // collection rule unchanged: Manar's collection shift is waiting for review → she cannot open another one
 await as(4);await assert.rejects(()=>call('clinic_booking_shift',['open',{register_id:r1.id},key()]),/مستنية المراجعة المالية/);
 // closed old-style (close_shift) main shift then open again also works now (queued review)
 await as(3);await fin('close_shift',[c2.new_shift,{'200':11,'100':1},'إغلاق عادي']);st=await status();assert.equal(st.can_open,true);assert.equal(st.open_shift,null);
 await assert.rejects(()=>count({'200':1}),/مش مفتوحة/);const sm3=await call('clinic_booking_shift',['open',{register_id:main.id},key()]);assert(sm3);
 // rollback refuses with queued reviews, works after they are reviewed
 await db.exec('reset role');const RB=fs.readFileSync('supabase/rollbacks/20261122200000_main_treasury_count.rollback.sql','utf8');
 await assert.rejects(()=>db.exec(RB),/راجع ورديات الخزينة الرئيسية/);await db.exec('rollback');
 await as(1);for(const r of await owner("select id from clinic_finance.shifts where is_main and status='submitted'"))await fin('review_shift',[r.id,'مراجعة قبل الرجوع']);
 await db.exec('reset role');await db.exec(RB);
 assert.equal((await owner("select to_regprocedure('public.clinic_finance_main_count(jsonb,text,uuid)') r"))[0].r,null);
 assert.equal((await owner("select indexdef from pg_indexes where indexname='fin_register_active'"))[0].indexdef.includes("status <> 'reviewed'::text)"),true);
 assert.match(String((await owner("select pg_get_functiondef('clinic_finance.shift_single_active_message()'::regprocedure) d"))[0].d),/اقفلها الأول بـ«جرد وتسليم»، وبعدين افتح/);
 assert(!String((await owner("select pg_get_functiondef('clinic_finance.shift_single_active_message()'::regprocedure) d"))[0].d).includes('مفتوحة بالفعل'),'old trigger restored');
 console.log('PASS main treasury count: custodian-only count rolls the main shift over in one step (closed for review + new open), replay/idempotent, cash case on difference, queued reviews do not block, one OPEN main shift, maker≠checker review, 24h nudge, handover lands on the new shift, collection rule unchanged, rollback.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
