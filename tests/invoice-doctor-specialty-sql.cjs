// Owner 2026-11-21 «بيانات الطبيب: الاسم / التخصص» on the invoice: clinic_reception_invoice_print lines carry the
// doctor's specialty (provider department). Runs the real invoice-print test setup, then applies 20261121230000.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-invoice-receipt-sql.cjs'),'utf8');
const hook="assert.equal(p.lines[0].doctor,'د. إلهام');";assert(src.includes(hook),'reception-invoice-receipt-sql.cjs marker moved; update this test');
const extra=hook+`
  await db.exec('reset role');await db.exec(mig('20261121230000'));
  await owner("update clinic_reception.providers set department='طب الأطفال' where id=$1",[prov]);
  await as(4);{const q=await call('clinic_reception_invoice_print',[live,visit]);
   assert.equal(q.lines[0].doctor,'د. إلهام');assert.equal(q.lines[0].specialty,'طب الأطفال','doctor specialty = provider department');
   assert.equal(q.lines[0].department,'الأطفال','service department kept');assert.equal(q.invoice_no,p.invoice_no,'same invoice number');}
  await db.exec('reset role');await db.exec(fs.readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261121230000_invoice_doctor_specialty.rollback.sql'))},'utf8'));
  await as(4);{const q=await call('clinic_reception_invoice_print',[live,visit]);assert.equal(q.lines[0].specialty,undefined,'rollback restores the old function');}
  await owner("update clinic_reception.providers set department='الأطفال' where id=$1",[prov]);await as(4);
  console.log('PASS invoice lines carry the doctor specialty (+ rollback)');`;
const file=path.join(__dirname,'.invoice-doctor-run-'+process.pid+'.cjs');
fs.writeFileSync(file,src.replace(hook,extra));try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
