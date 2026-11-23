// 20261123120000 «الطبيب المحوِّل» (owner «الاتنين، من جوة المركز او من بره»): set on the booking / arrived visit (internal provider or
// external name), cleared with an empty kind, refused once the visit is collected, and returned by clinic_reception_invoice_print as
// `referrer` for the approved invoice header. Runs the real invoice-print test setup (reception-invoice-receipt-sql.cjs), then applies it.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-invoice-receipt-sql.cjs'),'utf8');
const hook="assert.equal(p.lines[0].doctor,'د. إلهام');";assert(src.includes(hook),'reception-invoice-receipt-sql.cjs marker moved; update this test');
const extra=hook+`
  await db.exec('reset role');await db.exec(mig('20261123120000'));
  const other=(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. أحمد تجريبي','DOC-R','الباطنة','حدائق الأهرام') returning id",[live]))[0].id;
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view,book,collect}') on conflict (workspace_id,admin_id) do update set capabilities=excluded.capabilities",[live,id(4)]);
  const sr=p=>call('clinic_reception_command',[live,'set_referrer',{id:app,...p},require('crypto').randomUUID()]);
  await as(4);assert.equal((await call('clinic_reception_invoice_print',[live,visit])).referrer,undefined,'no referrer → no line');
  await assert.rejects(()=>sr({referrer_kind:'external',referrer_name:'د'}),/اكتب اسم الطبيب المحوِّل/);
  await assert.rejects(()=>sr({referrer_kind:'internal',referrer_provider_id:''}),/من أطباء المركز/);
  await sr({referrer_kind:'external',referrer_name:'د. سامي تجريبي',referrer_specialty:'عظام',referrer_clinic:'عيادة خاصة',referrer_phone:'0100 000 0000'});
  let q=await call('clinic_reception_invoice_print',[live,visit]);
  assert.deepEqual(q.referrer,{kind:'external',name:'د. سامي تجريبي',specialty:'عظام',clinic:'عيادة خاصة'});assert.equal(q.invoice_no,p.invoice_no,'same invoice');
  await sr({referrer_kind:'internal',referrer_provider_id:other});q=await call('clinic_reception_invoice_print',[live,visit]);
  assert.deepEqual(q.referrer,{kind:'internal',name:'د. أحمد تجريبي',specialty:'الباطنة',clinic:null});
  await sr({referrer_kind:''});assert.equal((await call('clinic_reception_invoice_print',[live,visit])).referrer,undefined,'cleared');
  await owner("update clinic_reception.orders set status='completed' where id=$1",[order]);await as(4);
  await assert.rejects(()=>sr({referrer_kind:'external',referrer_name:'د. سامي تجريبي'}),/اتحصّلت/,'locked after collection');
  await owner("update clinic_reception.orders set status='ordered' where id=$1",[order]);
  await db.exec('reset role');await db.exec(fs.readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261123120000_referring_doctor.rollback.sql'))},'utf8'));
  await as(4);assert.equal((await call('clinic_reception_invoice_print',[live,visit])).referrer,undefined,'rollback restores the old print');
  console.log('PASS referring doctor: external / internal set, validation, cleared, locked after collection, on the invoice print as referrer (+ rollback)');`;
const file=path.join(__dirname,'.referring-doctor-run-'+process.pid+'.cjs');
fs.writeFileSync(file,src.replace(hook,extra));try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
