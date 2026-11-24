// 20261122010000: «الخزينة الرئيسية — <الاسم>» in the peer-handover options (open main shift + custodian) and the review-only open-drawers list.
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
 const ph=(a,p)=>call('clinic_finance_peer_handover',[a,p,key()]),drawers=()=>call('clinic_finance_open_drawers',[]);
 // 1. no main shift open: main is null, colleagues unchanged
 await as(4);let o=await ph('options',{});assert.equal(o.shift.id,s1);assert.equal(o.main,null);assert.deepEqual(o.colleagues.map(c=>c.shift_id),[s2]);
 // 2. the custodian opens the main shift: listed with his name; still not a peer target
 await as(3);const sm=await call('clinic_booking_shift',['open',{register_id:main.id},key()]);
 await as(4);o=await ph('options',{});assert.deepEqual([o.main.shift_id,o.main.register_id,o.main.register,o.main.name],[sm,main.id,'الخزينة الرئيسية','Test 3']);
 assert(!o.colleagues.some(c=>c.shift_id===sm),'main is not a colleague');await assert.rejects(()=>ph('request',{from_shift:s1,to_shift:sm,amount:100}),/الزميل لازم يكون فاتح ورديته/);
 // the custodian himself (main shift, no collection shift) gets no options shift and no main entry
 await as(3);o=await ph('options',{});assert.equal(o.shift,null);assert.equal(o.main,undefined);
 // 3. the open-drawers list: reviewers only
 await as(4);await assert.rejects(()=>drawers(),/صلاح/);
 await as(2);await assert.rejects(()=>drawers(),/صلاح/,'accountant without review right');
 await as(1);let v=await drawers();assert.equal(v.my_main_shift,null,'the owner has no main shift');assert.equal(v.main_register.id,main.id);
 assert.deepEqual(v.drawers.map(d=>[d.register,Number(d.cash),d.pending,d.rejected]),[['خزينة مازن',500,null,false],['خزينة منار',1800,null,false]]);
 // 4. the routed path = the existing treasury handover: Manar ends with her count -> pending to main, shown in the list
 await as(4);const t=await treasury('end_shift',{shift_id:s1,counts:{'200':5,'100':5,'50':6}});assert.equal(t.status,'awaiting_receipt');
 await as(3);v=await drawers();assert.equal(v.my_main_shift,sm);const m=v.drawers.find(d=>d.shift_id===s1);assert.equal(Number(m.pending.amount),1800);assert.equal(Number(m.end_counted),1800);
 // the custodian approves (existing review) -> drawer leaves the list
 await treasury('transfer_review',{id:m.pending.id,approve:true,note:'استلمت'});v=await drawers();assert(!v.drawers.some(d=>d.shift_id===s1),'handed over drawer is gone');
 // 5. a part from Mazen via transfer_request, then a rejection shows as rejected only after an end
 await as(5);await treasury('transfer_request',{from_shift:s2,to_register:main.id,amount:200,reference:'HO-1',reason:'تسليم تحصيل للخزينة الرئيسية'});
 await as(3);v=await drawers();assert.equal(Number(v.drawers.find(d=>d.shift_id===s2).pending.amount),200);
 // 5b. 20261123180000: options exposes the pending main handover (the «تسليم» choice disables «لزميل» then); rollback restores the wrapper
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261123180000_handover_options_pending.sql','utf8'));
 await as(5);o=await ph('options',{});assert.equal(Number(o.main_pending.amount),200);assert.equal(o.main_pending.reference,'HO-1');assert(o.main,'main still listed');
 await as(4);{const x=await ph('options',{});assert(!x.shift||x.main_pending===null,'no pending on another shift');}
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123180000_handover_options_pending.rollback.sql','utf8'));
 await as(5);o=await ph('options',{});assert.equal(o.main_pending,undefined);
 // 6. rollback restores the peer function byte for byte and removes the list
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122010000_treasury_handover_main_target.rollback.sql','utf8'));
 assert.equal(await md5(),before);assert.equal((await owner("select to_regprocedure('public.clinic_finance_open_drawers()') r"))[0].r,null);
 await as(5);o=await ph('options',{});assert.equal(o.main,undefined);
 console.log('PASS treasury handover main: main shift + custodian in peer options (null when closed, never a peer target), reviewer-only open-drawers list with cash / pending / my main shift, existing end_shift + approval path, rollback byte-identical.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
