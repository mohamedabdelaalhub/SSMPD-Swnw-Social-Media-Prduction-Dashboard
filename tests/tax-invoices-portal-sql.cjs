// «الفواتير الضريبية والإلكترونية + اترفعت على بوابة الضرائب؟» (20261122280000): automatic tax / e-invoice from the start dates (FM
// setting), per-invoice override, accountant records the upload (UUID required, unique), FM confirms (another person) or refuses with a
// reason, review-only «رجوع» with a reason, report totals split uploaded / not, doctor withholding suggestion = one rate × fees on
// uploaded e-invoices (pending part apart), metadata only (no entries), idempotent, audited, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs'),{randomUUID}=require('crypto');
(async()=>{const b=await boot([]);const {db,as,owner,call,id}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  if(!(await owner("select count(*)::int n from information_schema.columns where table_schema='clinic_finance' and table_name='supplier_receipts' and column_name='invoice_date'"))[0].n)await db.exec(mig('20261017182845'));
  await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table if not exists storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;`);await db.exec(mig('20261119030000'));
  const M=mig('20261122280000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date()),yest=new Date(Date.now()-864e5).toISOString().slice(0,10),old='2026-01-05';
  // fixture documents (FKs off): live workspace, 2 visits today (patient + doctor fees), 1 old visit, 1 finance invoice, 1 purchase invoice
  await db.exec("set session_replication_role=replica");
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F1','منار أحمد','',$2) returning id",[ws,id(1)]))[0].id;
  const prov=(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. إلهام','DOC-E','الأطفال','حدائق الأهرام') returning id",[ws]))[0].id;
  const visit=async(at)=>{const v=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by,opened_at) values($1,gen_random_uuid(),$2,$3,$4) returning id",[ws,pat,id(1),at]))[0].id;
   const o=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,snapshot,created_by,status,doctor_fee,completed_at) values($1,$2,gen_random_uuid(),$3,1000,'{}',$4,'completed',400,$5) returning id",[ws,v,prov,id(1),at]))[0].id;
   await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',1000,'كشف')",[ws,pat,v,o]);return v;};
  const v1=await visit(new Date().toISOString()),v2=await visit(new Date().toISOString()),v0=await visit(old+'T10:00:00Z');
  const fi=(await owner("insert into clinic_finance.invoices(reference,patient_ref,description,amount,created_by,token) values('FIN-1','مريض','خدمة',300,$1,gen_random_uuid()) returning id",[id(1)]))[0].id;
  const pi=(await owner("insert into clinic_finance.supplier_receipts(supplier_id,order_id,reference,invoice_date,invoice_total,payload,created_by,token) values(gen_random_uuid(),gen_random_uuid(),'SUP-77',$1,5000,'[]',$2,gen_random_uuid()) returning id",[today,id(1)]).catch(e=>{throw Error('purchase fixture: '+e.message);}))[0].id;
  await db.exec("set session_replication_role=origin");
  const entries0=+(await owner("select count(*) n from clinic_finance.entries"))[0].n;
  const tax=(k,i,a,p,t=randomUUID())=>call('clinic_finance_invoice_tax',[k,i,a,p||{},t]),get=(k,ids)=>call('clinic_finance_invoice_tax_get',[k,ids]),rep=()=>call('clinic_finance_tax_report',[old,today]);
  // nothing is a tax invoice until the start date is set
  await as(2);let g=await get('visit_invoice',[v1]);assert.equal(g.docs[0].is_tax_invoice,false);
  // settings: review only (accountant refused, FM sets)
  await assert.rejects(()=>call('clinic_finance_tax_settings_save',[{tax_invoices_from:yest,e_invoices_from:yest,doctor_withholding_rate:'5'}]));
  await as(3);await assert.rejects(()=>call('clinic_finance_tax_settings_save',[{doctor_withholding_rate:'120'}]),/من 0 لـ 100/);
  await call('clinic_finance_tax_settings_save',[{tax_invoices_from:yest,e_invoices_from:yest,doctor_withholding_rate:'5'}]);
  await as(2);g=await get('visit_invoice',[v1,v0]);const byId=Object.fromEntries(g.docs.map(d=>[d.doc_id,d]));
  assert.equal(byId[v1].is_tax_invoice,true);assert.equal(byId[v1].is_e_invoice,true);assert.equal(byId[v1].tax_auto,true);assert.equal(+byId[v1].amount,1000);
  assert.equal(byId[v0].is_tax_invoice,false,'before the start date');
  g=await get('purchase_invoice',[pi]);assert.equal(g.docs[0].is_tax_invoice,true);assert.equal(g.docs[0].is_e_invoice,false,'purchases are not e-invoices by default');assert.equal(g.docs[0].party,null);
  // per-invoice override (accountant)
  let r=await tax('visit_invoice',v0,'set_type',{is_tax_invoice:true});assert.equal(r.is_tax_invoice,true);assert.equal(r.tax_auto,false);
  // accountant records the upload; UUID required + unique; confirm by another person
  await assert.rejects(()=>tax('visit_invoice',v1,'record_upload',{portal_uuid:'x'}),/UUID/);
  const k1=randomUUID();r=await tax('visit_invoice',v1,'record_upload',{portal_uuid:'7F3K9Q2MX8C1',portal_ref:'RX-1042'},k1);assert.equal(r.portal_status,'pending');
  assert.equal(JSON.stringify(await tax('visit_invoice',v1,'record_upload',{portal_uuid:'7F3K9Q2MX8C1',portal_ref:'RX-1042'},k1)),JSON.stringify(r),'replay');
  await assert.rejects(()=>tax('visit_invoice',v2,'record_upload',{portal_uuid:'7f3k9q2mx8c1'}),/فاتورة تانية/);
  await assert.rejects(()=>tax('visit_invoice',v1,'confirm',{}),/صلاح|review|غير مسموح/i,'accountant cannot confirm');
  await as(3);r=await tax('visit_invoice',v1,'confirm',{});assert.equal(r.portal_status,'uploaded');assert.equal(r.confirmed_by,'Test 3');
  // FM records v2, FM cannot confirm his own record; super refuses with a reason → back to not_uploaded
  r=await tax('visit_invoice',v2,'record_upload',{portal_uuid:'AAAA-2222'});await assert.rejects(()=>tax('visit_invoice',v2,'confirm',{}),/غير اللي سجّل/);
  await as(1);await assert.rejects(()=>tax('visit_invoice',v2,'refuse',{}),/سبب/);r=await tax('visit_invoice',v2,'refuse',{reason:'الرقم مش موجود على البوابة'});assert.equal(r.portal_status,'not_uploaded');assert.match(r.note,/رفض التأكيد/);
  // cannot untick «tax» while on the portal; «رجوع» is review-only with a reason
  await as(2);await assert.rejects(()=>tax('visit_invoice',v1,'set_type',{is_tax_invoice:false}),/ارجع حالة البوابة/);
  await assert.rejects(()=>tax('visit_invoice',v1,'unmark',{reason:'اتلغت'}));
  // purchase + finance invoice in the report
  r=await tax('purchase_invoice',pi,'record_upload',{portal_uuid:'SUP-UUID-77'});await as(3);await tax('purchase_invoice',pi,'confirm',{});
  await as(2);const R=await rep();const kinds=R.rows.map(x=>x.doc_kind).sort().join(',');assert.equal(kinds,'finance_invoice,purchase_invoice,visit_invoice,visit_invoice,visit_invoice');
  assert.equal(R.totals.uploaded_count,2);assert.equal(+R.totals.uploaded_amount,6000);assert.equal(R.totals.tax_count,5);assert.equal(R.totals.not_uploaded_count,3);assert.equal(+R.totals.not_uploaded_amount,2300);
  assert.equal(R.rows.find(x=>x.doc_id===pi).no,'SUP-77');assert.equal(R.rows.find(x=>x.doc_id===fi).no,'FIN-1');
  // doctor withholding suggestion: 5% × fees on uploaded e-invoices (v1 = 400) → 20; v2 (400) pending; v0 is before the e-invoice date and not ticked e
  let s=await call('clinic_finance_doctor_tax_suggest',['DOC-E',old,today]);assert.deepEqual([+s.rate,+s.uploaded_fees,s.uploaded_visits,+s.pending_fees,s.pending_visits,+s.suggested],[5,400,1,400,1,20]);
  // «رجوع» by review with reason → suggestion drops
  await as(3);await assert.rejects(()=>tax('visit_invoice',v1,'unmark',{}),/سبب/);await tax('visit_invoice',v1,'unmark',{reason:'الفاتورة اتلغت على البوابة'});
  s=await call('clinic_finance_doctor_tax_suggest',['DOC-E',old,today]);assert.equal(+s.suggested,0);
  // metadata only, audited, reception staff without finance rights refused
  assert.equal(+(await owner("select count(*) n from clinic_finance.entries"))[0].n,entries0,'no entries posted');
  assert(+(await owner("select count(*) n from clinic_finance.audit where action like 'invoice_tax_%'"))[0].n>=8);
  await as(4);await assert.rejects(()=>get('visit_invoice',[v1]));await assert.rejects(()=>tax('visit_invoice',v1,'set_type',{is_e_invoice:false}));
  // rollback
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122280000_tax_invoices_portal.rollback.sql','utf8'));
  assert.equal((await owner("select to_regclass('clinic_finance.invoice_tax_status') r"))[0].r,null);
  console.log('PASS tax invoices portal: start-date defaults (purchases not e), override, record/confirm by another person/refuse/unmark with reasons, UUID unique, report split uploaded/not across visit/finance/purchase invoices, doctor withholding suggestion (one rate, uploaded e-invoices only), metadata only, audited, permissions, rollback.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
