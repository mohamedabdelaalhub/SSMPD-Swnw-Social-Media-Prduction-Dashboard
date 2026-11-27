// «راجع قبل ما تصرف» — طلب صرف من الدرج (mig 20261127140000, owner Q2 «لو صرف أقل الباقي يتلغي»). Reuses the PGlite setup of
// tests/drawer-requests-sql.cjs (real cash_line_guard + the drawer_payout narrow exception) up to the first request, then:
// pay LESS than the approved amount (note required, the rest is cancelled), never more; the guards still accept only that exact amount.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'drawer-requests-sql.cjs'),'utf8');const cut=src.indexOf('  // ---- advance: request');
assert(cut>0&&src.includes("const call=(a,p)=>"),'drawer-requests-sql.cjs markers moved; update this test');
const body=`
  // stubs for the doctor-payout / collect-review parts of the same migration (tested in review-before-money-doctor-sql.cjs)
  await db.exec(\`create schema if not exists clinic_reception;create function clinic_reception.due(uuid) returns numeric language sql as $$select 0::numeric$$;
   create function clinic_reception.access(uuid,text) returns uuid language sql as $$select null::uuid$$;
   create table clinic_finance.doctor_payouts(id uuid primary key);create table clinic_finance.desk_payouts(payout_id uuid);create table clinic_finance.desk_payout_rx(payout_id uuid);
   create function public.clinic_reception_doctor_payout(text,jsonb,uuid default null) returns jsonb language sql as $$select '{}'::jsonb$$;\`);
  const MIG=fs.readFileSync('supabase/migrations/20261127140000_review_before_money.sql','utf8');
  await db.exec(MIG);await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const approve=async(a)=>{await as('gm');a=await call('review',{id:a.id,ok:true});await as('fm');a=await call('review',{id:a.id,ok:true});await as('cashier');return a;};
  // advance 400 approved → the cashier pays 300 with a reason → 100 cancelled
  await as('cashier');let a=await call('request',{kind:'advance',subject:'EMP-7',amount:'400',reason:'سلفة شخصية',token:randomUUID()});a=await approve(a);
  st=await call('status');let mine=st.mine.find(x=>x.id===a.id);assert.equal(mine.status,'approved');assert('employee_advance' in mine,'the cashier sees the employee advance balance before paying');
  await assert.rejects(()=>call('pay',{id:a.id,amount:'500'}),/أكتر من المبلغ المعتمد/);
  await assert.rejects(()=>call('pay',{id:a.id,amount:'300'}),/ليه هتصرف أقل/);
  await assert.rejects(()=>call('pay',{id:a.id,amount:'0'}),/غير صالح/);
  await assert.rejects(()=>call('pay',{id:a.id,amount:'10.555',note:'xxxx'}),/غير صالح/);
  await as('other');await assert.rejects(()=>call('pay',{id:a.id,amount:'300',note:'الموظف طلب 300 بس'}),/مش موجود/,'only the requester');
  await as('cashier');a=await call('pay',{id:a.id,amount:'300',note:'الموظف طلب 300 بس'});
  assert.equal(a.status,'paid');assert.equal(+a.amount,300);assert.equal(+a.approved_amount,400);assert.equal(+a.cancelled_rest,100);assert.equal(a.pay_less_note,'الموظف طلب 300 بس');
  const ln=(await q("select l.account,l.debit,l.credit from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source='drawer_payout' and e.source_id=$1 order by l.debit desc",[a.id])).rows;
  assert.deepEqual(ln.map(x=>[x.account,+x.debit,+x.credit]),[['1142',300,0],['1131',0,300]],'only 300 left the drawer');
  assert.equal(+(await one("select clinic_finance.employee_advance('EMP-7') v")).v,300,'advance balance = what was paid');
  assert.equal((await call('pay',{id:a.id,amount:'300',note:'تاني'})).status,'paid','replay is a no-op');
  assert.equal((await q("select 1 from clinic_finance.entries where source='drawer_payout' and source_id=$1",[a.id])).rows.length,1);
  assert.equal((await one("select count(*)::int n from clinic_finance.audit where action='drawer_pay_less' and entity_id=$1",[a.id])).n,1,'audited');
  await assert.rejects(()=>q("select clinic_finance.post('drawer_payout',$1,'x',$2,'1142','1111',100)",[a.id,S1]),/للاستلام فقط/,'the cancelled rest opens nothing');
  // the same amount as approved needs no note (the normal path)
  let b=await call('request',{kind:'incentive',subject:'EMP-7',amount:'50',reason:'حافز',token:randomUUID()});b=await approve(b);
  b=await call('pay',{id:b.id,amount:'50'});assert.equal(b.status,'paid');assert.equal(+b.amount,50);assert(!('approved_amount' in b));
  // paying less still respects the drawer cash and rolls back cleanly on refusal
  let c=await call('request',{kind:'incentive',subject:'EMP-7',amount:'5000',reason:'حافز كبير',token:randomUUID()});c=await approve(c);
  await assert.rejects(()=>call('pay',{id:c.id,amount:'4000',note:'جزء منه'}),/أقل من المبلغ/);
  c=(await call('status')).mine.find(x=>x.id===c.id);assert.equal(+c.amount,5000,'refused pay-less leaves the approved amount');assert(!('approved_amount' in c));
  // the plain pay without amount works as before; finance list shows the approved amount
  await as('acc');const it=(await call('list',{})).items.find(x=>x.id===a.id);assert.equal(+it.approved_amount,400);
  // rollback puts the previous function back
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261127140000_review_before_money.rollback.sql','utf8'));
  assert.equal((await one("select to_regprocedure('clinic_finance.drawer_request_before_pay_less(text,jsonb)') f")).f,null);
  assert((await one("select to_regprocedure('public.clinic_finance_drawer_request(text,jsonb)') f")).f);
  console.log('PASS review-before-money drawer: pay less with a reason (rest cancelled, audited, approved amount kept), never more, only the requester, replay no-op, cash limit kept, normal pay unchanged, rollback');
 }catch(e){console.error(e.message,e.where||'');process.exitCode=1;}
})();`;
const file=path.join(require('os').tmpdir(),'rbm-drawer-'+process.pid+'.cjs');
fs.writeFileSync(file,src.slice(0,cut).replace("require('@electric-sql/pglite')","require("+JSON.stringify(require.resolve('@electric-sql/pglite',{paths:[__dirname]}))+")")+body);
try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
