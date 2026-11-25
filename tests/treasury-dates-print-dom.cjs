// Owner 2026-11-24 «محتاج التواريخ هنا، وليه تقرير ال pdf بيطلع بالشكل دا»: (1) the «تسليم التحصيل للخزينة الرئيسية» table shows the
// request date+time and the receipt/decision date+time (Latin digits); (2) the treasury-movements PDF is one table on the letterhead,
// grouped by day with subtotals, a grand total and a by-method summary, period «من … إلى …», no centre name in the title.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const w=new JSDOM('',{runScripts:'outside-only',url:'https://x.test/'}).window;
w.eval(fs.readFileSync('assets/js/swnw-print.js','utf8'));w.eval(fs.readFileSync('assets/js/finance-shift-movements.js','utf8'));
// (1) transfers table
const aw=fs.readFileSync('assets/js/accountant-workspace.js','utf8');
assert(aw.includes("h.table(['تاريخ الطلب','من','إلى','المبلغ','فرق الجرد للمراجعة','المستند','الحالة','تاريخ الاستلام / القرار','الإجراء']"));
assert(aw.includes("[h.esc(tStamp(t.created_at)),")&&aw.includes("h.esc(t.status==='pending'?'—':tStamp(t.reviewed_at))"));
const m=aw.match(/function tStamp\(v\)\{[\s\S]*?\n/);w.eval(m[0]);
assert.equal(w.tStamp('2026-11-23T20:57:00Z'),'23-11-2026 10:57 م');assert.equal(w.tStamp('2026-11-24T06:05:00Z'),'24-11-2026 08:05 ص');assert.equal(w.tStamp(null),'—');
// (2) PDF
const rows=[{at:'2026-11-02T15:18:00Z',title:'منار موسى',detail:'كشف أطفال · ملف P-2026-001200',cashier_name:'منار',method:'cash',kind:'self',direction:'in',reference:'778899',receipt_no:'RC-2026-000125',amount:500},
 {at:'2026-11-03T05:54:00Z',title:'أحمد محمد',detail:'جلسة علاج طبيعي',cashier_name:'منار',method:'pos',kind:'insurance',direction:'in',reference:'V-77',amount:650},
 {at:'2026-11-03T09:00:00Z',title:'صرف نثرية',detail:'أدوات مكتبية',cashier_name:'منار',method:'cash',kind:'out',direction:'out',reference:'',amount:-150}];
const html=w.SSMPDShiftMovements.pdfHtml(rows,{heading:'كشف حركات الخزائن',from:'2026-11-02',to:'2026-11-23',who:'منار موسى عريقي'});
assert.match(html,/<h2>كشف حركات الخزائن<\/h2>/);assert.doesNotMatch(html,/<h2>[^<]*(سونو|Swnw|مركز)/);
assert.match(html,/الفترة:<\/span> من <bdi class="ltr">02-11-2026<\/bdi> إلى <bdi class="ltr">23-11-2026<\/bdi>/);
assert.equal((html.match(/class="dh"/g)||[]).length,2,'one header per day');assert.match(html,/02-11-2026<\/bdi> — حركة واحدة/);assert.match(html,/03-11-2026<\/bdi> — حركتان/);
assert.match(html,/إجمالي يوم <bdi class="ltr">03-11-2026<\/bdi> — المقبوضات <bdi class="ltr">650.00<\/bdi> · المدفوعات <bdi class="ltr">150.00<\/bdi><\/td><td class="amt"><bdi class="ltr">500.00/);
assert.match(html,/الإجمالي العام للفترة — المقبوضات <bdi class="ltr">1,150.00<\/bdi> · المدفوعات <bdi class="ltr">150.00<\/bdi> · الصافي<\/td><td class="amt"><bdi class="ltr">1,000.00/);
assert.match(html,/المقبوضات حسب طريقة الدفع/);assert.match(html,/<td>نقدي<\/td><td class="amt"><bdi class="ltr">500.00/);assert.match(html,/<td>بطاقة<\/td>/);
assert.match(html,/<col style="width:11%">/);assert.match(html,/table-layout:fixed/);
assert.match(html,/<td class="n">كشف أطفال<\/td><td><bdi class="ltr">P-2026-001200<\/bdi><\/td>/,'service and file split');
assert.match(html,/<b>RC-2026-000125<\/b><\/bdi><br><span class="tm"><bdi class="ltr">778899<\/bdi>/,'receipt number + reference under it');assert.match(html,/رقم الإيصال \/ رقم العملية/);
assert(!/[٠-٩]/.test(html),'Latin digits only');
console.log('PASS treasury dates + print: transfer request/decision date+time (Latin), movements PDF one fixed table on the letterhead, per-day headers + subtotals, grand total, by-method summary, period, no centre name.');
