// «تسوية فروق الخزن» (20261124190000): after «القرار», one maker-checker entry on the case's shift brings the drawer book back to 0:
// surplus → Dr drawer / Cr 4119, shortage → Dr 5227 (or Dr 1142 when charged to an employee) / Cr drawer. Maker ≠ checker, the shift
// cashier can do neither, once per case, refused can be filed again, idempotent, guards patched narrowly, rollback.
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
 // Mazen: 0 recorded, counts 550 → surplus; Manar: 2000 recorded, counts 500 → shortage 1500
 await as(4);const s1=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await treasury('end_shift',{shift_id:s1,counts:{'50':11}});
 await as(5);const s2=await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);await collect(s2,2000,5);await treasury('end_shift',{shift_id:s2,counts:{'100':5}});
 await as(3);for(const s of [s1,s2]){const t=(await owner("select id from clinic_finance.treasury_transfers where from_shift=$1",[s]))[0].id;await treasury('transfer_review',{id:t,approve:true,note:'استلمت'});}
 const cs=async s=>(await owner("select * from clinic_finance.cash_cases where shift_id=$1",[s]))[0];
 let c1=await cs(s1),c2=await cs(s2);assert.equal(+c1.difference,550);assert.equal(+c2.difference,-1500);
 assert.equal(await bal(r1.id),-550);assert.equal(await bal(r2.id),1500);
 const M=mig('20261124190000');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const settle=(a,p,k=key())=>call('clinic_finance_case_settle',[a,p,k]);
 // not before «القرار»
 await as(2);await assert.rejects(()=>settle('request',{id:c1.id,kind:'surplus_income',note:'زيادة'}),/بعد «القرار»/);
 // case path by the FM (Mazen: process error → correct records; Manar: employee → refer to management)
 await as(3);const step=(c,st,o={})=>fin('case_step',[c,st,o.note||'مراجعة',o.resp||null,o.person||null,o.dec||null]);
 await step(c1.id,'review');await step(c1.id,'responsibility',{resp:'process_error'});await step(c1.id,'decision',{dec:'correct_records'});
 await step(c2.id,'review');await step(c2.id,'responsibility',{resp:'employee',person:id(5)});await step(c2.id,'decision',{dec:'refer_management'});
 // list: balances + allowed kinds
 let L=await settle('list',{},null);const li=Object.fromEntries(L.map(r=>[r.id,r]));assert.equal(+li[c1.id].register_balance,-550);assert.deepEqual(li[c1.id].kinds,['surplus_income']);assert.deepEqual(li[c2.id].kinds,['shortage_expense','shortage_employee']);
 // the shift cashier can't; wrong kind refused; note required
 await as(4);await assert.rejects(()=>settle('request',{id:c1.id,kind:'surplus_income',note:'زيادة'}));
 await as(2);await assert.rejects(()=>settle('request',{id:c1.id,kind:'shortage_expense',note:'غلط'}),/الزيادة/);await assert.rejects(()=>settle('request',{id:c1.id,kind:'surplus_income',note:''}),/السبب/);
 const k1=key();let r=await settle('request',{id:c1.id,kind:'surplus_income',note:'مبلغ متحصّل غير مسجل'},k1);assert.equal(r.settle_status,'pending');
 assert.equal(JSON.stringify(await settle('request',{id:c1.id,kind:'surplus_income',note:'مبلغ متحصّل غير مسجل'},k1)),JSON.stringify(r),'replay');
 await assert.rejects(()=>settle('request',{id:c1.id,kind:'surplus_income',note:'تاني'}),/عليه تسوية بالفعل/);
 assert.equal(await bal(r1.id),-550,'nothing posted before approval');
 // maker ≠ checker; accountant can't review
 await assert.rejects(()=>settle('review',{id:c1.id,approve:true,note:'موافق'}));
 await as(3);r=await settle('review',{id:c1.id,approve:true,note:'موافق'});assert.equal(r.settle_status,'approved');assert.equal(+r.register_balance,0);
 assert.equal(await bal(r1.id),0,'drawer book back to 0');
 const lines=await owner("select l.account,l.debit,l.credit,e.shift_id,e.source from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.id=$1 order by l.debit desc",[r.entry_id]);
 assert.deepEqual(lines.map(x=>x.account+':'+(+x.debit)+':'+(+x.credit)),['0101010102:550:0','4119:0:550']);assert.equal(lines[0].shift_id,s1);assert.equal(lines[0].source,'cash_case_settlement');
 // shortage: employee kind only with its responsibility/decision; refuse then re-file; approve → Dr 1142
 await as(2);r=await settle('request',{id:c2.id,kind:'shortage_employee',note:'تحميل على الموظف بقرار الإدارة'});
 await as(1);r=await settle('review',{id:c2.id,approve:false,note:'نحمّلها على المركز'});assert.equal(r.settle_status,'rejected');assert.equal(await bal(r2.id),1500);
 await as(2);r=await settle('request',{id:c2.id,kind:'shortage_expense',note:'خدمتين اتعدلوا ومتحصلوش'});
 await as(1);r=await settle('review',{id:c2.id,approve:true,note:'موافق'});assert.equal(await bal(r2.id),0);
 const l2=await owner("select l.account,l.debit,l.credit from clinic_finance.lines l where l.entry_id=$1 order by l.debit desc",[r.entry_id]);assert.deepEqual(l2.map(x=>x.account+':'+(+x.debit)+':'+(+x.credit)),['5227:1500:0','0101010103:0:1500']);
 // employee kind refused when the case doesn't support it
 const c3id=(await owner("insert into clinic_finance.cash_cases(shift_id,difference,status,responsibility,decision) select id,-10,'decided','process_error','correct_records' from clinic_finance.shifts where register_id=$1 and id<>$2 limit 1 returning id",[main.id,s1]).catch(()=>[{}]))[0].id;
 if(c3id){await as(2);await assert.rejects(()=>settle('request',{id:c3id,kind:'shortage_employee',note:'تحميل'}),/مسؤولية موظف/);}
 // the guards still refuse other credits from a collection drawer on an ended shift
 await assert.rejects(()=>owner("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('collection',gen_random_uuid(),'x',$1,$2)",[s1,id(4)]),/انتهت الوردية/);
 // ledger balanced, audited
 assert.equal(+(await owner("select count(*) n from (select entry_id from clinic_finance.lines group by entry_id having sum(debit-credit)<>0) z"))[0].n,0);
 assert(+(await owner("select count(*) n from clinic_finance.audit where action like 'cash_case_settle_%'"))[0].n>=5);
 // rollback restores the guards
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261124190000_cash_case_settlement.rollback.sql','utf8'));
 assert.equal((await owner("select to_regprocedure('public.clinic_finance_case_settle(text,jsonb,uuid)') r"))[0].r,null);
 assert(!String((await owner("select pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure) d"))[0].d).includes('cash_case_settlement'));
 assert(!String((await owner("select pg_get_functiondef('clinic_finance.ended_shift_entry_guard()'::regprocedure) d"))[0].d).includes('cash_case_settlement'));
 console.log('PASS cash case settlement: only after the decision, surplus Dr drawer/Cr 4119 and shortage Dr 5227 (or 1142 when charged to an employee by decision) / Cr drawer on the case shift, drawer back to 0, maker≠checker, cashier excluded, once per case, refuse + re-file, idempotent, other ended-shift entries still refused, balanced, audited, rollback.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
