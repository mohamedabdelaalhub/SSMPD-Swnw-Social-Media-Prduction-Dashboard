// «الضرائب» box + tax report + doctor payout suggestion (20261122280000): type checkboxes (auto marker), record upload (UUID form),
// pending → confirm only for another reviewer, refuse/unmark with reason, hidden without finance rights; report pills/KPIs/filters/open/CSV,
// FM settings; payout form gets the suggested withholding (not overwriting a typed value); hooks wired in the finance / reception screens.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="b"></div><div id="body"><p>محتوى الضرائب الموجود</p></div><form id="pf"><select name="doctor_key"><option value="DOC-E" selected>د. إلهام</option></select><input name="from" value="2026-11-01"><input name="to" value="2026-11-30"><label>الضريبة<input name="withheld" value="0"></label></form>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,doc=w.document;
let calls=[],ans={};w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);const v=typeof ans[n]==='function'?ans[n](a):ans[n];return Promise.resolve(v instanceof Error?{error:v}:{data:v});}}};
w.URL.createObjectURL=()=>'blob:x';
w.eval(fs.readFileSync('assets/js/tax-status.js','utf8'));const T=w.SSMPDTaxStatus,tick=()=>new Promise(r=>setTimeout(r,5));
const baseDoc={doc_id:'V1',no:'RX-1042',amount:1000,party:'منار',is_tax_invoice:true,is_e_invoice:true,tax_auto:true,e_auto:false,portal_status:'not_uploaded',note:''};
const last=n=>calls.filter(x=>x[0]===n).pop()[1];
(async()=>{
 const el=doc.getElementById('b');
 // accountant, not uploaded
 ans.clinic_finance_invoice_tax_get={can_edit:true,can_review:false,me:'ACC',docs:[baseDoc]};await T.box(el,'visit_invoice','V1');
 assert.equal(el.hidden,false);assert.match(el.textContent,/فاتورة زيارة — RX-1042/);assert.match(el.textContent,/\(تلقائي\)/);assert.match(el.textContent,/اترفعت على بوابة الضرائب؟/);
 assert.equal(el.querySelector('[data-tx-type="is_tax_invoice"]').checked,true);assert.equal(el.querySelector('[data-tx-do="confirm"]'),null);
 // untick e-invoice → set_type
 ans.clinic_finance_invoice_tax={};const e=el.querySelector('[data-tx-type="is_e_invoice"]');e.checked=false;e.dispatchEvent(new w.Event('change'));await tick();
 assert.equal(JSON.stringify(last('clinic_finance_invoice_tax').p_payload),'{"is_e_invoice":false}');assert.equal(last('clinic_finance_invoice_tax').p_action,'set_type');
 // record upload form
 await T.box(el,'visit_invoice','V1');el.querySelector('[data-tx-do="record"]').click();const f=el.querySelector('.tx-form');f.elements.portal_uuid.value='7F3K9Q2MX8C1';f.elements.portal_ref.value='RX-1042';
 f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();let a=last('clinic_finance_invoice_tax');assert.equal(a.p_action,'record_upload');assert.equal(a.p_payload.portal_uuid,'7F3K9Q2MX8C1');assert.match(a.p_token,/^[0-9a-f-]{36}$/);
 // server error shown in Arabic
 ans.clinic_finance_invoice_tax=new Error('رقم البوابة ده متسجّل على فاتورة تانية');await T.box(el,'visit_invoice','V1');el.querySelector('[data-tx-do="record"]').click();const f2=el.querySelector('.tx-form');f2.elements.portal_uuid.value='DUP1';
 f2.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(el.querySelector('[data-tx-status]').textContent,/فاتورة تانية/);ans.clinic_finance_invoice_tax={};
 // pending: recorder sees «مستنية», another reviewer sees confirm/refuse
 const pend={...baseDoc,portal_status:'pending',portal_uuid:'7F3K9Q2MX8C1',uploaded_at:'2026-11-22T13:40:00Z',recorded_by:'أحمد',recorded_by_id:'ACC',recorded_at:'2026-11-22T13:41:00Z'};
 ans.clinic_finance_invoice_tax_get={can_edit:true,can_review:true,me:'ACC',docs:[pend]};await T.box(el,'visit_invoice','V1');assert.equal(el.querySelector('[data-tx-do="confirm"]'),null);assert.match(el.textContent,/مستنية تأكيد المدير المالي/);
 assert.equal(el.querySelector('[data-tx-type="is_tax_invoice"]').disabled,true,'types locked once on the portal');
 ans.clinic_finance_invoice_tax_get={can_edit:true,can_review:true,me:'FM',docs:[pend]};await T.box(el,'visit_invoice','V1');el.querySelector('[data-tx-do="confirm"]').click();await tick();assert.equal(last('clinic_finance_invoice_tax').p_action,'confirm');
 await T.box(el,'visit_invoice','V1');el.querySelector('[data-tx-do="refuse"]').click();const rf=el.querySelector('.tx-form');rf.elements.reason.value='مش موجودة على البوابة';rf.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 a=last('clinic_finance_invoice_tax');assert.equal(JSON.stringify([a.p_action,a.p_payload.reason]),JSON.stringify(['refuse','مش موجودة على البوابة']));
 // uploaded: details + «رجوع» for reviewers
 ans.clinic_finance_invoice_tax_get={can_edit:true,can_review:true,me:'FM',docs:[{...pend,portal_status:'uploaded',confirmed_by:'محمود',confirmed_at:'2026-11-22T15:00:00Z'}]};await T.box(el,'visit_invoice','V1');
 assert.match(el.textContent,/أكّدها\s*محمود/);assert.ok(el.querySelector('[data-tx-do="unmark"]'));assert.ok(el.querySelector('.tx-portal.is-uploaded'));
 // no finance rights → hidden
 ans.clinic_finance_invoice_tax_get=new Error('x');await T.box(el,'visit_invoice','V1');assert.equal(el.hidden,true);assert.equal(el.innerHTML,'');
 // report
 const rows=[{doc_kind:'visit_invoice',doc_id:'V1',no:'RX-1042',party:'منار',date:'2026-11-22T10:00:00Z',amount:1000,is_tax_invoice:true,is_e_invoice:true,portal_status:'uploaded',portal_uuid:'U1',uploaded_at:'2026-11-22T13:00:00Z'},
  {doc_kind:'visit_invoice',doc_id:'V2',no:'RX-1043',party:'منار',date:'2026-11-22T11:00:00Z',amount:650,is_tax_invoice:true,is_e_invoice:true,portal_status:'pending'},
  {doc_kind:'purchase_invoice',doc_id:'P1',no:'SUP-77',party:'مورد',date:'2026-11-20',amount:5000,is_tax_invoice:true,is_e_invoice:false,portal_status:'not_uploaded'},
  {doc_kind:'finance_invoice',doc_id:'F1',no:'FIN-1',party:'',date:'2026-11-21T09:00:00Z',amount:300,is_tax_invoice:false,is_e_invoice:false,portal_status:'not_uploaded'}];
 ans.clinic_finance_tax_report={rows,can_review:true,settings:{tax_invoices_from:'2026-11-01',e_invoices_from:'2026-11-01',doctor_withholding_rate:5},totals:{tax_count:3,tax_amount:6650,uploaded_count:1,uploaded_amount:1000,pending_count:1,not_uploaded_count:2,not_uploaded_amount:5650}};
 const body=doc.getElementById('body');await T.mountIn(body,'taxes');const R=body.querySelector('[data-tx-report]');assert.equal(body.firstChild,R,'report on top of «الضرائب»');assert.match(body.textContent,/محتوى الضرائب الموجود/);
 assert.match(R.textContent,/اترفعت على البوابة\s*1,000.00/);assert.match(R.textContent,/لسه ما اترفعتش\s*5,650.00/);assert.match(R.textContent,/منهم 1 مستني تأكيد/);
 assert.equal(JSON.stringify([...R.querySelectorAll('[data-tx-filter]')].map(b=>b.textContent)),JSON.stringify(['الكل 4','اترفعت 1','لسه 2','مستني تأكيد 1','إلكترونية 2','مشتريات 1']));
 assert.equal(R.querySelectorAll('tbody tr').length,4);R.querySelector('[data-tx-filter="open"]').click();await tick();assert.equal(body.querySelectorAll('[data-tx-report] tbody tr').length,2);
 assert.match(body.querySelector('[data-tx-report] tbody').textContent,/SUP-77/);assert.doesNotMatch(body.querySelector('[data-tx-report] tbody').textContent,/RX-1042/);
 assert.ok(body.querySelector('[data-tx-settings]'),'FM settings');const sf=body.querySelector('[data-tx-settings]');sf.elements.doctor_withholding_rate.value='5';ans.clinic_finance_tax_settings_save={};sf.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(last('clinic_finance_tax_settings_save').p_payload.tax_invoices_from,'2026-11-01');
 body.querySelector('[data-tx-csv]').click();
 ans.clinic_finance_tax_report={...ans.clinic_finance_tax_report,settings:{},can_review:false};await T.report(body);assert.match(body.textContent,/لسه ما اتحددش «الفواتير الضريبية من تاريخ»/);assert.equal(body.querySelector('[data-tx-settings]'),null);
 // doctor payout suggestion
 ans.clinic_finance_doctor_tax_suggest={rate:5,uploaded_fees:6000,uploaded_visits:12,pending_fees:3000,pending_visits:6,suggested:300};const pf=doc.getElementById('pf');T.bindPayout(pf);await tick();
 assert.equal(pf.elements.withheld.value,'300.00');assert.match(pf.querySelector('[data-tx-payout]').textContent,/5% × 6,000.00 أتعاب على 12 فاتورة إلكترونية اترفعت/);assert.match(pf.textContent,/3,000.00 على 6 فاتورة لسه ما اترفعتش/);
 assert.equal(JSON.stringify(last('clinic_finance_doctor_tax_suggest')),JSON.stringify({p_doctor:'DOC-E',p_from:'2026-11-01',p_to:'2026-11-30'}));
 pf.elements.withheld.value='250';pf.elements.withheld.dispatchEvent(new w.Event('input'));pf.elements.to.dispatchEvent(new w.Event('change'));await tick();assert.equal(pf.elements.withheld.value,'250','typed value kept');
 // wiring
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8'),fd=fs.readFileSync('assets/js/finance-doctors.js','utf8'),rb=fs.readFileSync('assets/js/reception-bridge.js','utf8');
 assert(fc.includes("btn('invoice-tax',i.id,'الضرائب')")&&fc.includes("window.SSMPDTaxStatus.open('finance_invoice',id)")&&fc.includes('window.SSMPDTaxStatus.mountIn(body,tab)'));
 assert(fd.includes('window.SSMPDTaxStatus.bindPayout(form)'));assert(rb.includes("window.SSMPDTaxStatus.box(r.querySelector('[data-tax-box]'),'visit_invoice',record.visit_id)"));
 console.log('PASS tax invoices UI: box (types/auto, record UUID, pending→confirm by another reviewer, refuse/unmark reasons, Arabic errors, hidden w/o rights), report (top of «الضرائب», KPIs, pills/filters, CSV, FM settings, missing-date warning), payout suggestion (fills, keeps typed), wiring.');
})().catch(e=>{console.error(e);process.exit(1);});
