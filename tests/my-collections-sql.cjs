// «اتحصّل في ورديتك حسب طريقة الدفع» (20261125240000): the cashier sees count + total per method for HER open collection shift only;
// no expected cash / balance keys; another cashier's receipts and receipts before the shift are excluded; no open shift → empty.
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
 await db.exec('reset role');const M=mig('20261125240000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const mine=async n=>{await as(n);const r=(await db.query('select public.clinic_finance_my_collections() v')).rows[0].v;await db.exec('reset role');return r;};
 // no open shift yet → empty
 let r=await mine(4);assert.equal(r.shift,null);assert.equal(+r.count,0);
 const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('اختبار','live',$1) returning id",[id(1)]))[0].id;
 const pt=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,created_by) values($1,'F-1','مريض',$2) returning id",[ws,id(1)]))[0].id;
 const pay=(m,a,by,at)=>owner("insert into clinic_reception.payments(workspace_id,patient_id,method,amount,reference,created_by,created_at) values($1,$2,$3,$4,gen_random_uuid()::text,$5,$6)",[ws,pt,m,a,by,at]);
 await pay('cash',999,id(4),'2020-01-01');                       // before the shift → excluded
 await as(4);const s=await call('clinic_booking_shift',['open',{register_id:r1.id},key()]);await db.exec('reset role');
 await as(5);await call('clinic_booking_shift',['open',{register_id:r2.id},key()]);await db.exec('reset role');
 const now=new Date(Date.now()+1000).toISOString();
 await pay('cash',500,id(4),now);await pay('cash',250,id(4),now);await pay('instapay',300,id(4),now);await pay('wallet',100,id(4),now);
 await pay('cash',700,id(5),now);                                 // another cashier → excluded
 r=await mine(4);
 assert.equal(r.shift.id,s);assert.equal(r.shift.register,'خزينة مازن');
 assert.deepEqual(r.methods.map(m=>[m.method,+m.count,+m.total]),[['cash',2,750],['instapay',1,300],['wallet',1,100]]);
 assert.equal(+r.count,4);assert.equal(+r.total,1150);
 assert.deepEqual(Object.keys(r).sort(),['count','methods','shift','total']);assert.deepEqual(Object.keys(r.shift).sort(),['id','opened_at','register'],'no expected/balance keys');
 r=await mine(5);assert.deepEqual(r.methods.map(m=>[m.method,+m.total]),[['cash',700]]);
 console.log('PASS my collections by method: own open shift only, per-method count/total, excludes others and pre-shift, no expected-cash keys, empty without a shift');
}catch(e){console.error(e);process.exit(1);}process.exit(0);})();
