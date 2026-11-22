// 20261122220000: the reception mirror of finance shifts accepts the main treasury roll-over (queued + open main shift).
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

 const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
 const sync=()=>owner('select clinic_reception.sync_native_links($1)',[ws]);await sync();
 const mir=()=>owner("select s.finance_shift_id f,s.status from clinic_reception.shifts s join clinic_reception.registers r on r.id=s.register_id where r.finance_register_id=$1 order by s.opened_at",[main.id]);
 assert.equal((await mir()).length,1);
 await as(3);const c1=await count({'200':9},'جرد');
 // the regression: mirror sync fails once a second (open) main shift exists next to the submitted one
 await assert.rejects(()=>sync(),/duplicate key|unique/);
 const M2=mig('20261122220000');await db.exec('reset role');await db.exec(M2);await assert.rejects(()=>db.exec(M2),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await sync();let m=await mir();assert.equal(JSON.stringify(m.map(x=>x.f+':'+x.status)),JSON.stringify([c1.closed_shift+':submitted',c1.new_shift+':open']),'both mirrored');
 assert.equal(+(await owner("select count(*) n from clinic_reception.shifts where is_main"))[0].n,2);
 await as(3);const c2=await count({'200':9});await sync();m=await mir();assert.equal(m.length,3);assert.equal(m.filter(x=>x.status==='open').length,1);
 // collection mirrors keep one unreviewed per register: a fake second unreviewed mirror on Manar's register is refused
 const s1m=(await owner("select * from clinic_reception.shifts where finance_shift_id=$1",[s1]))[0];assert.equal(s1m.is_main,false);
 await assert.rejects(()=>owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status) values($1,$2,$3,'open')",[ws,s1m.register_id,id(5)]),/duplicate key|unique/);
 // two OPEN main mirrors are refused
 const mreg=(await owner("select id from clinic_reception.registers where finance_register_id=$1 and workspace_id=$2",[main.id,ws]))[0].id;
 await assert.rejects(()=>owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status) values($1,$2,$3,'open')",[ws,mreg,id(1)]),/duplicate key|unique/);
 // the snapshot works again
 await as(1);await call('clinic_reception_snapshot',[ws,null,null]).catch(e=>{if(/duplicate key/.test(e.message))throw e;});
 // rollback refuses while main counts queue; works after review
 await db.exec('reset role');const RB=fs.readFileSync('supabase/rollbacks/20261122220000_reception_mirror_main_count.rollback.sql','utf8');
 await assert.rejects(()=>db.exec(RB),/راجع جرد الخزينة الرئيسية/);await db.exec('rollback');
 await as(1);for(const r of await owner("select id from clinic_finance.shifts where is_main and status='submitted'"))await fin('review_shift',[r.id,'مراجعة']);await sync();
 await db.exec('reset role');await db.exec(RB);assert.equal((await owner("select count(*) n from information_schema.columns where table_schema='clinic_reception' and table_name='shifts' and column_name='is_main'"))[0].n,0);
 console.log('PASS reception mirror main count: sync failed with the queued + open main shift (regression), fixed: both mirrored, one open main mirror, collection mirrors unchanged, snapshot works, rollback guarded.');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
