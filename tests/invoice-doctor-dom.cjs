// Owner 2026-11-21 «بيانات الطبيب: الاسم / التخصص» on invoices: patient invoice + claim invoice print a «الطبيب / التخصص»
// column (name, specialty under it) and الطبيب/التخصص in the header; the on-screen invoices table has the same column.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
for(const f of ['patient-invoice-print','service-orders-rules','service-invoice-print'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
const d={invoice_no:'INV-2026-000045',service_date:'2026-11-21',patient:{name:'سارة تجريبية',file_no:'P-1',phone:'01000000000'},
 lines:[{no:1,service:'كشف',doctor:'د. أ',department:'خدمات الكشف',specialty:'الجلدية',price:400,discount:0,net:400},{no:2,service:'جلسة',doctor:'د. أ',department:'الجلدية',specialty:'الجلدية',price:100,discount:0,net:100}],
 payments:[],totals:{net:500,insurer:0,paid:0,due:500},printed_by:'x',printed_at:'2026-11-21T19:00:00Z'};
let h=w.SSMPDPatientInvoicePrint.documentHtml(d);
assert.match(h,/<th>الطبيب \/ التخصص<\/th>/);assert.match(h,/class="dn">د\. أ<\/b><small class="ds">الجلدية<\/small>/);
assert.match(h,/التخصص:<\/span> الجلدية</,'header specialty = doctor specialty, not «خدمات الكشف»');assert.match(h,/الطبيب:<\/span> د\. أ</);
d.lines[1].doctor='د. ب';d.lines[1].specialty='العظام';h=w.SSMPDPatientInvoicePrint.documentHtml(d);assert.match(h,/أكثر من طبيب/);assert.match(h,/الجلدية، العظام/);
d.lines.forEach(l=>{delete l.specialty;});h=w.SSMPDPatientInvoicePrint.documentHtml(d);assert.match(h,/التخصص:<\/span> خدمات الكشف، الجلدية/,'old server (no specialty) → service department');
const R=w.SWNWServiceOrderRules,mk=(id,doc)=>({id,kind:'service',service:{id,name:'خدمة '+id,price:100},quantity:1,contract:{discountPercent:0,copayPercent:20},performingDoctor:doc});
const inv=R.buildInvoices([mk('a',{id:'p1',name:'د. عظام',specialty:'العظام'}),mk('b',null)]).invoices;
assert.equal(inv[0].lines[0].doctorName,'د. عظام');assert.equal(inv[0].lines[0].doctorSpecialty,'العظام');assert.equal(inv[0].lines[1].doctorName,null);
h=w.SSMPDServiceInvoicePrint.documentHtml(inv,{patientName:'م',date:'2026-11-21'});
assert.match(h,/<th>الخدمة<\/th><th>الطبيب \/ التخصص<\/th>/);assert.match(h,/class="dn">د\. عظام<\/b><small class="ds">العظام<\/small>/);assert.match(h,/<td class="doc">—<\/td>/);assert.match(h,/colspan="3">الإجمالي/);assert.match(h,/الطبيب:<\/span> د\. عظام/);
const so=fs.readFileSync('assets/js/reception-service-orders.js','utf8');assert(/performingDoctor:pr\?\{id:pr\.id,name:pr\.name,specialty:pr\.department\|\|null\}:null/.test(so)&&/,d\.providers\);/.test(so),'claim orders carry the provider');
const rs=fs.readFileSync('assets/js/reception-services.js','utf8'),fn=rs.slice(rs.indexOf('function invoiceDoctor('),rs.indexOf('\n',rs.indexOf('function invoiceDoctor(')));
w.eval(fn+';window.idoc=invoiceDoctor;');const e=v=>String(v);
assert.equal(w.idoc({orders:[{id:'o',provider_id:'p'}],providers:[{id:'p',name:'د. أ',department:'الجلدية'}]},{order_id:'o'},e),'<b>د. أ</b><br><small>الجلدية</small>');
assert.equal(w.idoc({orders:[],providers:[]},{order_id:null},e),'—');assert(/'المريض','الطبيب \/ التخصص','القيمة'/.test(rs));
console.log('PASS invoice doctor name + specialty (patient invoice, claim invoice, invoices table)');
