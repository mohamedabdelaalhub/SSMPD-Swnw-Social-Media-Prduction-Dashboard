// Owner rule 2026-11-19 (docs/ui-references/PRINT-DOCUMENTS.md): every printed invoice/receipt/claim uses the letterhead look
// from assets/js/swnw-print.js, with no brand name in titles.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ctx={URL,Intl,location:{href:'https://example.test/'}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('assets/js/swnw-print.js','utf8'),ctx);
const P=ctx.SSMPDPrint;
assert.equal(P.words(750),'سبعمائة وخمسون جنيهًا فقط لا غير');
assert.equal(P.words(3500),'ثلاثة آلاف وخمسمائة جنيهًا فقط لا غير');
assert.equal(P.words(1250.5),'ألف ومائتان وخمسون جنيهًا وخمسون قرشًا فقط لا غير');
const r=P.receiptHtml({receipt_no:'RC-2026-000002',reference:'778899',method:'pos',amount:750,has_proof:true,created_at:'2026-11-19T19:42:00Z',patient_name:'مريضة <b>',file_no:'F-1',cashier:'دينا',invoice:{no:'INV-2026-000001',total:1750,due:0},applied:750});
for(const s of ['swnw-official-letterhead.png','إيصال سداد','RC-2026-000002','INV-2026-000001','778899','سبعمائة وخمسون','مسدّدة بالكامل','ختم المركز','مرفقة في النظام'])assert(r.includes(s),'receipt shows '+s);
assert(r.includes('مريضة &lt;b&gt;'),'escaped');
const cash=P.receiptHtml({reference:'RC-1',method:'cash',amount:100,created_at:'2026-11-19T10:00:00Z'});
assert(!cash.includes('رقم العملية'),'cash has no transaction number row');
const fl=P.documentHtml('x',P.flow(P.title('فاتورة خدمة','رقم','X-1')));assert(fl.includes('class="bgf"')&&fl.includes('sp-top')&&fl.includes('sp-bot'),'flow layout repeats the letterhead');
// no printed document title carries a brand name, and no money document is hand-written plain HTML anymore
const files=['finance-cash','reception-bridge','finance-controls','reception-doctor-payout','entity-claims-print','patient-invoice-print','service-invoice-print','swnw-print'];
for(const f of files){const src=fs.readFileSync('assets/js/'+f+'.js','utf8');
 assert(!/<h[12]>\s*(سونو|Swnw|Sono)/.test(src),f+': brand name in a printed title');
 assert(!/<title>[^<'"]*(سونو|Sono)/.test(src),f+': brand name in a document title');}
for(const f of ['finance-cash','reception-bridge','finance-controls','reception-doctor-payout','entity-claims-print'])assert(/SSMPDPrint/.test(fs.readFileSync('assets/js/'+f+'.js','utf8')),f+' prints through SSMPDPrint');
console.log('PASS printed documents: one letterhead look via SSMPDPrint, amounts in words, no brand name in titles.');
