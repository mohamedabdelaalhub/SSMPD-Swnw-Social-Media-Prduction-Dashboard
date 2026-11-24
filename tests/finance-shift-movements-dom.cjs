// Owner 2026-11-15: shift movements in detail (self/insurance, method, amount), manager filters, Excel/PDF export.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const d=new JSDOM('<main id="h"></main>',{runScripts:'outside-only',url:'https://x.test/'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
w.eval(fs.readFileSync('assets/js/swnw-print.js','utf8'));w.eval(fs.readFileSync('assets/js/finance-shift-movements.js','utf8'));
const mv=[{at:'2026-11-15T07:14:00Z',cashier_name:'منى',register_name:'خزينة ١',direction:'in',kind:'self',title:'مريض تجربة ١',detail:'كشف · ملف P-1',method:'cash',reference:'R-1',amount:500},
 {at:'2026-11-15T07:40:00Z',cashier_name:'منى',register_name:'خزينة ١',direction:'in',kind:'insurance',title:'مريض تجربة ٢',detail:'جلسة',method:'pos',reference:'VISA 1',amount:150,insurance:{payer:'شركة تأمين (تجربة)',claim:350,total:500,cover:70}},
 {at:'2026-11-15T08:32:00Z',cashier_name:'أحمد',register_name:'خزينة ٢',direction:'in',kind:'self',title:'مريض تجربة ٣',detail:'باكج',method:'instapay',reference:'IP-1',amount:600},
 {at:'2026-11-15T10:20:00Z',cashier_name:'منى',register_name:'خزينة ١',direction:'out',kind:'out',title:'استرداد',detail:'إلغاء خدمة',method:'cash',reference:'',amount:-200},
 {at:'2026-11-15T11:00:00Z',cashier_name:'منى',register_name:'خزينة ١',direction:'fix',kind:'fix',title:'مريض تجربة ٤',detail:'تصحيح',method:'cash>pos',reference:'',amount:300}];
const calls=[];const rpc=(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return Promise.resolve({shifts:[{id:'s1',register_name:'خزينة ١',cashier_name:'منى'}],movements:a.p_cashier==='e2'?mv.filter(x=>x.cashier_name==='أحمد'):mv,manager:true});};
const tick=()=>new Promise(r=>setTimeout(r,10));
// cashier view
let host=doc.createElement('div');doc.body.append(host);w.SSMPDShiftMovements.mount(host,{rpc});await tick();
assert.equal(JSON.stringify(calls[0]),JSON.stringify(['clinic_finance_shift_movements',{}]));
assert.equal(host.querySelectorAll('.mv-row').length,5);assert(!host.querySelector('.mv-emp'),'no employee name in own view');
const rows=[...host.querySelectorAll('.mv-row')];assert(rows[1].classList.contains('ins')&&rows[1].textContent.includes('شركة تأمين (تجربة)')&&rows[1].textContent.includes('70٪'));
assert(rows[0].textContent.includes('خاص — المريض بيدفع كامل')&&rows[0].textContent.includes('نقدي'));assert(rows[3].classList.contains('out'));assert(rows[4].textContent.includes('نقدي ← فيزا'));
const foot=host.querySelector('.mv-foot').textContent;for(const t of ['500.00','200.00','150.00','600.00','350.00'])assert(foot.includes(t),t);
host.querySelector('[data-mv-filter="ins"]').click();assert.equal(host.querySelectorAll('.mv-row').length,1);
host.querySelector('[data-mv-filter="pos"]').click();assert.equal(host.querySelectorAll('.mv-row').length,2,'card incl. the corrected receipt');
// Excel export via SheetJS when present (filtered rows), CSV fallback otherwise
let written=null;w.XLSX={utils:{aoa_to_sheet:a=>({a}),book_new:()=>({}),book_append_sheet:(wb,ws,n)=>{wb.ws=ws;wb.n=n;}},writeFile:(wb,name)=>{written={wb,name};}};
host.querySelector('[data-mv-export="xlsx"]').click();assert(written&&/\.xlsx$/.test(written.name));const aoa=written.wb.ws.a;assert.equal(aoa.length,3,'header + 2 filtered rows');assert.equal(aoa[0][6],'النوع');assert.equal(aoa[1][7],'شركة تأمين (تجربة)');assert.equal(aoa[2][10],'نقدي ← فيزا');
assert.equal(written.wb.Workbook.Views[0].RTL,true);
delete w.XLSX;let blob=null;w.URL.createObjectURL=b=>{blob=b;return 'blob:x';};w.URL.revokeObjectURL=()=>{};
host.querySelector('[data-mv-export="xlsx"]').click();assert(blob);const bytes=new Uint8Array(await blob.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[0xEF,0xBB,0xBF],'CSV starts with a BOM for Excel');assert((await blob.text()).includes('"المبلغ"'));
// PDF (owner 2026-11-24): a table document on the official letterhead in a new window (swnw-print.js), date + time per row, day subtotals, grand total
let html='';w.open=()=>({document:{open(){},write(x){html+=x;},close(){},images:[]},focus(){},print(){}});
host.querySelector('[data-mv-filter="all"]').click();host.querySelector('[data-mv-export="pdf"]').click();
assert.match(html,/swnw-official-letterhead/,'letterhead');assert.match(html,/<h2>كشف حركات الوردية<\/h2>/);assert.doesNotMatch(html,/<h2>[^<]*(سونو|Swnw)/,'no centre name in the title');
assert.match(html,/التاريخ والوقت<\/th><th>المريض \/ البيان<\/th><th>الخدمة<\/th><th>رقم الملف<\/th><th>الموظف<\/th><th>طريقة الدفع<\/th><th>نوع السداد<\/th><th>رقم الإيصال \/ المرجع<\/th><th>المبلغ/);
assert.match(html,/<bdi class="ltr">15-11-2026<\/bdi><br>/,'date on every row');assert.match(html,/>P-1</,'file number split out');assert.match(html,/>كشف</);
assert.match(html,/class="dh"><td colspan="9">[^<]*<bdi class="ltr">15-11-2026<\/bdi> — 5 حركات/,'day header');assert.match(html,/إجمالي يوم/);assert.match(html,/الإجمالي العام للفترة/);
assert.match(html,/تأمين — حصة المريض/);assert.match(html,/صرف من الخزينة/);assert.match(html,/نقدي ← بطاقة/);assert.match(html,/−200.00/);
assert(!/[٠-٩]/.test(html.replace(/مريض تجربة [١-٤]|خزينة [١٢]/g,'')),'Latin digits only (rule 8)');
// manager view: period + employee filters, employee names on rows, open one shift and back
host.remove();host=doc.createElement('div');doc.body.append(host);calls.length=0;
const view=w.SSMPDShiftMovements.mount(host,{rpc,manager:true,staff:[{id:'e1',name:'منى'},{id:'e2',name:'أحمد'}]});await tick();
assert(calls[0][1].p_from&&calls[0][1].p_to&&calls[0][1].p_cashier===null);assert(host.querySelector('.mv-emp'));
const sel=host.querySelector('[data-mv-cashier]');sel.value='e2';sel.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
assert.equal(calls.at(-1)[1].p_cashier,'e2');assert.equal(host.querySelectorAll('.mv-row').length,1);
const from=host.querySelector('[data-mv-from]');from.value='2026-11-01';from.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(calls.at(-1)[1].p_from,'2026-11-01');
view.showShift('s9');await tick();assert.equal(JSON.stringify(calls.at(-1)[1]),JSON.stringify({p_shift:'s9'}));assert(host.querySelector('[data-mv-all]'));
host.querySelector('[data-mv-all]').click();await tick();assert(calls.at(-1)[1].p_from);
// error shown, not thrown
host.remove();host=doc.createElement('div');doc.body.append(host);w.SSMPDShiftMovements.mount(host,{rpc:()=>Promise.reject(new Error('الوردية مش متاحة لك'))});await tick();assert(host.querySelector('.mv-error').textContent.includes('مش متاحة'));
assert.deepEqual(errors,[]);console.log('PASS shift movements UI: own view rows (self/insurance/out/fix), totals, method/kind filters, Excel (RTL, filtered) + CSV fallback, scoped PDF print, manager period/employee/shift drill-down, errors shown.');
})().catch(e=>{console.error(e);process.exit(1);});
