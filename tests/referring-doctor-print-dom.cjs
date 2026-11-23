// «الطبيب المحوِّل» on the approved patient invoice (patient-invoice-print.js): one header line, «من بره المركز» tag when external,
// nothing when there is no referrer. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const w=new JSDOM('',{runScripts:'outside-only'}).window;w.eval(fs.readFileSync('assets/js/patient-invoice-print.js','utf8'));
const d={invoice_no:'INV-2026-000045',service_date:'2026-11-23',patient:{name:'مريض تجربة',file_no:'P-1',phone:'01000000000'},
 lines:[{no:1,service:'كشف باطنة',doctor:'د. منى تجريبية',department:'الباطنة',specialty:'الباطنة',price:400,discount:0,net:400}],
 payments:[],totals:{net:400,insurer:0,paid:0,due:400},printed_by:'x',printed_at:'2026-11-23T19:00:00Z'};
let h=w.SSMPDPatientInvoicePrint.documentHtml(d);assert(!/تحويل طبيب/.test(h),'no referrer → no line');
d.referrer={kind:'external',name:'د. سامي تجريبي',specialty:'عظام',clinic:'عيادة خاصة'};h=w.SSMPDPatientInvoicePrint.documentHtml(d);
assert.match(h,/<div class="ref"><span class="k">تحويل طبيب خارجي:<\/span> د\. سامي تجريبي — عظام \(عيادة خاصة\)<\/div>/);assert(!/من بره|المحوِّل/.test(h),'Modern Standard Arabic only on the printed document');
assert.match(h,/الطبيب:<\/span> د\. منى تجريبية<\/div><div class="ref">/,'right after «الطبيب» in the header block');
d.referrer={kind:'internal',name:'د. أحمد تجريبي',specialty:'الباطنة'};h=w.SSMPDPatientInvoicePrint.documentHtml(d);
assert.match(h,/تحويل طبيب داخلي:<\/span> د\. أحمد تجريبي — الباطنة<\/div>/);assert(!/خارجي/.test(h));
d.referrer={kind:'external',name:'<b>x</b>'};assert(w.SSMPDPatientInvoicePrint.documentHtml(d).includes('&lt;b&gt;x&lt;/b&gt;'),'escaped');
console.log('PASS referring doctor on the invoice: «تحويل طبيب داخلي / خارجي» (Modern Standard Arabic) header line, clinic for external, hidden when none, escaped');
