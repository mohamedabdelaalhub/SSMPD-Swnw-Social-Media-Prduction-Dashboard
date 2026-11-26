// «حركات اليوم» (owner «طبّق شكل حركات اليوم», 2026-11-26): tabs المرضى / الأطباء / الخصومات + shift summary on top of
// «حركات الوردية بالتفصيل». Every new button is clicked as a reception cashier (live data shape of clinic_finance_day_movements),
// every popup has ✕ (and → back when nested) — CLAUDE.md rules 9, 10; the existing view («كل الحركات») is untouched (rule 11).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const d=new JSDOM('<main id="h"></main>',{runScripts:'outside-only',url:'https://x.test/'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
for(const f of ['swnw-print','finance-shift-movements','finance-day-movements'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
const tick=()=>new Promise(r=>setTimeout(r,15));
// fake shift: names and numbers are invented
const mv=[{at:'2026-11-26T08:16:00Z',direction:'in',kind:'self',title:'منى عادل',detail:'كشف جلدية',method:'cash',reference:'R-1',amount:600},
 {at:'2026-11-26T09:42:00Z',direction:'in',kind:'self',title:'كريم ناصر',detail:'كشف باطنة',method:'pos',reference:'R-2',amount:360},
 {at:'2026-11-26T10:07:00Z',direction:'in',kind:'self',title:'سارة يوسف',detail:'كشف',method:'cash',reference:'R-3',amount:400},
 {at:'2026-11-26T10:09:00Z',direction:'in',kind:'self',title:'سارة يوسف',detail:'تقشير',method:'instapay',reference:'IP-1',amount:810},
 {at:'2026-11-26T11:31:00Z',direction:'in',kind:'self',title:'أحمد رجب',detail:'كشف عظام',method:'cash',reference:'R-4',amount:500},
 {at:'2026-11-26T12:05:00Z',direction:'out',kind:'out',title:'صرف أتعاب طبيب',detail:'د. هالة',method:'cash',reference:'E-1',amount:-180},
 {at:'2026-11-26T13:20:00Z',direction:'out',kind:'out',title:'مصروف',detail:'أدوات نظافة',method:'cash',reference:'E-2',amount:-120}];
const pay=(m,a,rc)=>[{method:m,amount:a,receipt_no:rc,reference:rc,at:'2026-11-26T08:00:00Z'}];
const svc=(o)=>Object.assign({status:'completed',discount_percent:0,discount:0,claim:0,request:null,finance_invoice_id:null},o);
const day={manager:false,shifts:[{id:'s1',register_name:'خزينة الاستقبال 1',cashier_name:'نهى',status:'open'}],channels:{'f-1':{name:'فيزيتا',kind:'external',payable:'none',platform_share:150},'f-4':{name:'ترشيح د. خارجي',kind:'external',payable:'commission',platform_share:50}},
 visits:[
  {id:'v1',at:'2026-11-26T08:15:00Z',patient:'منى عادل',file_no:'P-2026-900101',provider:'د. سامح فؤاد',provider_id:'p1',source:'whatsapp',discount_kind:'vezeeta',fixes:[],
   services:[svc({id:'o1',name:'كشف جلدية',provider:'د. سامح فؤاد',provider_id:'p1',gross:600,due:600,collected_here:600,collected_total:600,doctor_fee:225,payments:pay('cash',600,'RC-1'),finance_invoice_id:'f-1'})]},
  {id:'v2',at:'2026-11-26T09:40:00Z',patient:'كريم ناصر',file_no:'P-2026-900214',provider:'د. هالة منصور',provider_id:'p2',source:'phone',discount_kind:'special',discount_staff:true,discount_by:'نهى',fixes:[],
   services:[svc({id:'o2',name:'كشف باطنة',provider:'د. هالة منصور',provider_id:'p2',gross:600,discount_percent:40,discount:240,due:360,collected_here:360,collected_total:360,doctor_fee:180,payments:pay('pos',360,'RC-2')})]},
  {id:'v3',at:'2026-11-26T10:05:00Z',patient:'سارة يوسف',file_no:'P-2026-900330',provider:'د. سامح فؤاد',provider_id:'p1',source:'walk_in',fixes:[],
   services:[svc({id:'o3',name:'كشف جلدية',provider:'د. سامح فؤاد',provider_id:'p1',gross:600,due:600,collected_here:400,collected_total:400,doctor_fee:300,payments:pay('cash',400,'RC-3')}),
             svc({id:'o4',name:'جلسة تقشير',provider:'د. سامح فؤاد',provider_id:'p1',gross:900,discount_percent:10,discount:90,due:810,collected_here:810,collected_total:810,doctor_fee:405,payments:pay('instapay',810,'RC-4'),request:{percent:10,reason:'مريضة متكررة',by:'نهى',approved_by:'أ. وليد'}})]},
  {id:'v4',at:'2026-11-26T11:30:00Z',patient:'أحمد رجب',file_no:'P-2026-900417',provider:'د. طارق لطفي',provider_id:'p3',source:'referral',
   fixes:[{at:'2026-11-26T11:42:00Z',from:'pos',to:'cash',amount:500,by:'نهى'}],
   services:[svc({id:'o5',name:'كشف عظام',provider:'د. طارق لطفي',provider_id:'p3',gross:500,due:500,collected_here:500,collected_total:500,doctor_fee:250,payments:pay('cash',500,'RC-5'),finance_invoice_id:'f-4'})]}],
 payouts:[{id:'po1',at:'2026-11-26T12:05:00Z',provider_id:'p2',doctor_name:'د. هالة منصور',amount:180,reference:'E-1'}]};
const calls=[];let dayResult=day;
const rpc=(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return Promise.resolve(n==='clinic_finance_day_movements'?dayResult:{shifts:day.shifts,movements:mv,manager:false});};
// ---- reception cashier (own shift) ----
let host=doc.createElement('div');doc.body.append(host);const view=w.SSMPDShiftMovements.mount(host,{rpc});await tick();
assert.deepEqual(calls.map(c=>c[0]),['clinic_finance_shift_movements','clinic_finance_day_movements'],'one extra read-only call');
assert.deepEqual(calls[1][1],{p_shift:null,p_from:null,p_to:null,p_cashier:null},'same scope as the movements (own open shift)');
// «كل الحركات» is the existing view, unchanged and shown first
assert.equal(host.querySelector('[data-dm-tab][aria-selected=true]').dataset.dmTab,'all');assert.equal(host.querySelectorAll('.mv-row').length,7,'existing rows');assert(!host.querySelector('[data-dm-orig]').hidden);
// summary tiles
const tiles=[...host.querySelectorAll('.dm-tile')].map(t=>t.textContent);
assert(tiles[0].includes('اتحصّل في ورديتك')&&tiles[0].includes('2,670')&&tiles[0].includes('نقدي 1,500')&&tiles[0].includes('فيزا 360')&&tiles[0].includes('إنستا باي 810'));
assert(tiles[1].includes('300')&&tiles[1].includes('للأطباء 180')&&tiles[1].includes('مصروفات وغيرها 120'));
assert(tiles[2].includes('330')&&tiles[2].includes('2 خصم'));
assert(tiles[3].includes('صافي النقدي في ورديتك')&&tiles[3].includes('1,200')&&!/المفروض في الدرج/.test(tiles[3]),'cashier: no expected drawer (blind count kept)');
const popText=()=>host.querySelector('[data-dm-pop]').textContent,ovOpen=()=>!host.querySelector('[data-dm-ov]').hidden;
const closeBtn=()=>host.querySelector('[data-dm-pop] [data-dm-close]'),backBtn=()=>host.querySelector('[data-dm-pop] [data-dm-back]');
// every tile opens its detail with ✕
for(const [i,t] of [[0,'إنستا باي'],[1,'أدوات نظافة'],[2,'كريم ناصر'],[3,'نقدي خارج']]){host.querySelectorAll('.dm-tile')[i].click();assert(ovOpen()&&popText().includes(t),'tile '+i);assert(closeBtn());closeBtn().click();assert(!ovOpen());}
// المرضى
host.querySelector('[data-dm-tab="patients"]').click();assert(host.querySelector('[data-dm-orig]').hidden&&!host.querySelector('[data-dm-pane]').hidden);
let lines=[...host.querySelectorAll('[data-dm-list] .dm-ln')];assert.equal(lines.length,4);
assert(lines[0].textContent.includes('منى عادل')&&lines[0].textContent.includes('فيزيتا'));assert(lines[2].textContent.includes('مش متحصّل')||lines[2].textContent.includes('متحصّل جزئي'));assert(lines[3].textContent.includes('تصحيح طريقة دفع'));
lines[2].click();let t=popText();for(const x of ['سارة يوسف','P-2026-900330','جلسة تقشير','الخصم — خاص 10٪','810','باقي 200','نصيب الطبيب','705'])assert(t.includes(x),x);
assert(closeBtn()&&!backBtn(),'first popup: ✕ only');
host.querySelector('[data-dm-pop] button.dm-r[data-dm-open]').click();t=popText();assert(t.includes('اعتمده')&&t.includes('أ. وليد')&&t.includes('مريضة متكررة'));
assert(backBtn(),'nested popup has → back');backBtn().click();assert(popText().includes('سارة يوسف'),'back returns to the visit');closeBtn().click();assert(!ovOpen());
host.querySelectorAll('[data-dm-list] .dm-ln')[0].click();t=popText();assert(t.includes('نصيب فيزيتا')&&t.includes('150')&&t.includes('225'));closeBtn().click();
host.querySelectorAll('[data-dm-list] .dm-ln')[3].click();t=popText();assert(t.includes('عمولة الترشيح')&&t.includes('50')&&t.includes('تصحيح طريقة الدفع')&&t.includes('فيزا ← نقدي'));
// Esc closes too
host.querySelector('[data-dm-pop]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!ovOpen());
// chip + search
host.querySelector('[data-dm-chip="flag"]').click();assert.equal(host.querySelectorAll('[data-dm-list] .dm-ln').length,2);
host.querySelector('[data-dm-chip=""]').click();const q=host.querySelector('[data-dm-q]');q.value='900214';q.dispatchEvent(new w.Event('input',{bubbles:true}));
assert.equal(host.querySelectorAll('[data-dm-list] .dm-ln').length,1);q.value='';q.dispatchEvent(new w.Event('input',{bubbles:true}));
// Excel (SheetJS) + CSV fallback
let written=null;w.XLSX={utils:{aoa_to_sheet:a=>({a}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},writeFile:(wb,name)=>{written={wb,name};}};
host.querySelector('[data-dm-excel]').click();assert(/المرضى\.xlsx$/.test(written.name));assert.equal(written.wb.ws.a.length,5);assert.equal(written.wb.ws.a[0][1],'المريض');assert.equal(written.wb.Workbook.Views[0].RTL,true);
delete w.XLSX;let blob=null;w.URL.createObjectURL=b=>{blob=b;return 'blob:x';};w.URL.revokeObjectURL=()=>{};host.querySelector('[data-dm-excel]').click();assert((await blob.text()).includes('"نصيب الطبيب"'));
// print on the official paper
let html='';w.open=()=>({document:{open(){},write(x){html+=x;},close(){},images:[]},focus(){},print(){}});host.querySelector('[data-dm-print]').click();
assert.match(html,/swnw-official-letterhead/);assert.match(html,/حركات اليوم — المرضى/);assert.doesNotMatch(html,/<h2>[^<]*(سونو|Swnw)/);assert(!/[٠-٩]/.test(html),'Latin digits');
// الأطباء
host.querySelector('[data-dm-tab="doctors"]').click();lines=[...host.querySelectorAll('[data-dm-list] .dm-ln')];assert.equal(lines.length,3);
assert(lines[0].textContent.includes('د. سامح فؤاد')&&lines[0].textContent.includes('2 حالة')&&lines[0].textContent.includes('930'));assert(lines[1].textContent.includes('باقي 0'));
lines[1].click();t=popText();assert(t.includes('اتصرفله من خزينتك')&&t.includes('180')&&t.includes('E-1'));closeBtn().click();
host.querySelectorAll('[data-dm-list] .dm-ln')[0].click();assert(popText().includes('في ورديتك وخزينتك بس'));
host.querySelector('[data-dm-pop] .dm-ln').click();assert(popText().includes('منى عادل')&&backBtn());backBtn().click();assert(popText().includes('د. سامح فؤاد'));closeBtn().click();
host.querySelector('[data-dm-chip="left"]').click();assert.equal(host.querySelectorAll('[data-dm-list] .dm-ln').length,2,'doctors still owed');
// الخصومات
host.querySelector('[data-dm-tab="discounts"]').click();lines=[...host.querySelectorAll('[data-dm-list] .dm-ln')];assert.equal(lines.length,2);
assert(lines[0].textContent.includes('خصم العاملين بالمركز 40٪')&&lines[0].textContent.includes('تلقائي'));lines[0].click();t=popText();assert(t.includes('عمله')&&t.includes('نهى')&&t.includes('240'));
host.querySelector('[data-dm-pop] .dm-ln').click();assert(popText().includes('كريم ناصر')&&backBtn());closeBtn().click();assert(!ovOpen());
// back to «كل الحركات»: the original filters still work
host.querySelector('[data-dm-tab="all"]').click();host.querySelector('[data-mv-filter="out"]').click();assert.equal(host.querySelectorAll('.mv-row').length,2);
// ---- manager (FM): period view, sees the expected drawer cash with the opening balance ----
host.remove();host=doc.createElement('div');doc.body.append(host);calls.length=0;dayResult=Object.assign({},day,{manager:true,shifts:[Object.assign({opening_book:500},day.shifts[0])]});
const mgr=w.SSMPDShiftMovements.mount(host,{rpc,manager:true,staff:[{id:'e1',name:'نهى'}]});await tick();
assert(calls[1][1].p_from&&calls[1][1].p_to&&calls[1][1].p_cashier===null,'manager: period args passed to the day RPC too');
let last=host.querySelectorAll('.dm-tile')[3].textContent;assert(last.includes('المفروض في الدرج')&&last.includes('1,700'),'500 + 1,500 − 300');
mgr.showShift('s9');await tick();assert.deepEqual(calls.at(-1),['clinic_finance_day_movements',{p_shift:'s9',p_from:null,p_to:null,p_cashier:null}]);
// day RPC error is shown, the existing view still works
host.remove();host=doc.createElement('div');doc.body.append(host);
w.SSMPDShiftMovements.mount(host,{rpc:(n)=>n==='clinic_finance_day_movements'?Promise.reject(new Error('الوردية مش متاحة لك')):Promise.resolve({shifts:[],movements:mv})});await tick();
assert(host.querySelector('.dm-top .mv-error').textContent.includes('مش متاحة'));assert.equal(host.querySelectorAll('.mv-row').length,7);
assert.deepEqual(errors,[]);console.log('PASS day movements UI (reception cashier): summary tiles (collected by method, paid out doctors/expenses, discounts, net cash — no expected drawer), tabs, one-line lists, popups with ✕ and → back, discount/visit/doctor/payout details, chips, search, Excel + CSV, print on letterhead, Esc; «كل الحركات» unchanged; FM sees expected drawer; errors shown.');
})().catch(e=>{console.error(e);process.exit(1);});
