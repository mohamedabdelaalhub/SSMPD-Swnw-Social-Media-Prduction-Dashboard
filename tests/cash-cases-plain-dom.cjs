// «فروق الخزن» بشكل مفهوم (help 348, owner «موافق على شكل فروق الخزن» 2026-11-27, mockup cash-cases-plain): rendered through the real
// finance-cash.js + finance-controls.js in LIVE mode (mocked server) as a real accountant (maker) and a finance reviewer:
// short rows, one-word state, step-named button + next-step line, details open on tap / Enter and close with ✕ / Escape,
// state filter with counts, type-to-search (Arabic-normalised), the same modals and RPCs as before; the shift cashier gets no button.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const cases=[
 {id:'A',shift_id:'S24',register_name:'خزينة مريم',cashier_name:'مريم',cashier_id:'MAR',difference:2280,status:'responsibility',review_note:'الزيادة 1,190 فلوس اتسلمت قبل تسجيل إيصالاتها',responsibility:'process_error',responsibility_note:'ملاحظة المسؤولية',updated_at:'2026-11-27T10:00:00Z'},
 {id:'B',shift_id:'S22',register_name:'خزينة مريم',cashier_name:'مريم',cashier_id:'MAR',difference:1090,status:'recorded',updated_at:'2026-11-22T15:10:00Z'},
 {id:'C',shift_id:'SX',register_name:'خزينة الاستقبال 2',cashier_name:'سارة',cashier_id:'SAR',difference:-100,status:'decided',review_note:'r',responsibility:'employee',decision:'correct_records',decision_note:'قرار',updated_at:'2026-11-20T07:00:00Z'},
 {id:'D',shift_id:'SM',register_name:'خزينة مازن',cashier_name:'مازن',cashier_id:'MAZ',difference:550,status:'decided',settle_status:'approved',settle_kind:'surplus_income',settle_review_note:'بأمر المالك 11-27: مش زيادة حقيقية — تسليم 550 للخزنة الرئيسية قبل التسجيل',updated_at:'2026-11-23T14:00:00Z'},
 {id:'E',shift_id:'SE',register_name:'خزينة أحمد',cashier_name:'أحمد',cashier_id:'AHM',difference:-40,status:'decided',settle_status:'pending',settle_kind:'shortage_expense',settle_by:'ACC',updated_at:'2026-11-21T07:00:00Z'}];
const shifts=[{id:'S24',register_name:'خزينة مريم',cashier_name:'مريم',opened_at:'2026-11-24T14:48:00Z',status:'submitted',cashier_id:'MAR'}];
async function boot(me,role){const dom=new JSDOM('<!doctype html><body><main id="root"></main></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://x.test/'}),w=dom.window,calls=[];
 const snap={can_create:true,can_review:role==='reviewer',me,shifts,cash_cases:cases,people:[{id:'MAR',name:'مريم'}],invoices:[],payments:[],requests:[],trial:[],entries:[],audit:[],registers:[]};
 w.SSMPDDb={financeSnapshot:async()=>JSON.parse(JSON.stringify(snap)),financeCaseStep:async(...a)=>{calls.push(['financeCaseStep',...a]);return 'A';},
  client:{rpc:async(n,a)=>{calls.push([n,a]);if(n==='clinic_finance_case_settle'&&a.p_action==='list')return {data:[{id:'A',register_balance:-2280,settle_amount:2280},{id:'B',register_balance:-2280,settle_amount:1090},{id:'C',register_balance:100,settle_amount:100},{id:'D',register_balance:0},{id:'E',register_balance:40,settle_amount:40}]};return {data:{settle_status:'pending'}};}}};
 w.SSMPDToast={show(){}};w.eval(fs.readFileSync('assets/js/finance-controls.js','utf8'));w.eval(fs.readFileSync('assets/js/finance-cash.js','utf8'));
 const root=w.document.getElementById('root');w.SSMPDFinanceCash.render(root);await new Promise(r=>setTimeout(r,30));w.SSMPDFinanceCash.navigate('cases');await new Promise(r=>setTimeout(r,80));return {w,root,calls,d:w.document};}
const tick=(ms=40)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 // ---- finance reviewer (financial manager): case path buttons
 let {w,root,calls,d}=await boot('FM','reviewer');const card=id=>root.querySelector('[data-cs-case="'+id+'"]'),act=id=>card(id).querySelector('.cs-act');
 assert.match(root.textContent,/يعني إيه «فرق خزنة»؟/);for(const s of ['مستني قرار','اتقرر','مستني موافقة','اتقفل'])assert.match(root.querySelector('.cs-explain').textContent,new RegExp(s));
 assert.doesNotMatch(root.textContent,/استكمال المسار/,'old label gone');
 assert.equal(card('A').querySelector('[data-cs-state]').textContent,'مستني قرار');assert.equal(card('C').querySelector('[data-cs-state]').textContent,'اتقرر');
 assert.equal(card('D').querySelector('[data-cs-state]').textContent,'اتقفل');assert.equal(card('E').querySelector('[data-cs-state]').textContent,'مستني موافقة');
 assert.match(card('A').querySelector('.cs-day').textContent,/24 نوفمبر/,'day from the shift');assert.match(card('A').textContent,/\+2,280\.00\s*زيادة/);assert.match(card('C').textContent,/-100\.00\s*ناقص/);
 assert.equal(act('A').querySelector('button').textContent,'سجّل القرار');assert.match(act('A').textContent,/الخطوة الجاية: قرار الإدارة/);
 assert.equal(act('B').querySelector('button').textContent,'سجّل المراجعة');assert.match(act('B').textContent,/الخطوة الجاية: مراجعة المستندات/);
 assert.equal(act('E').querySelector('button').textContent,'راجع التسوية');assert.equal(act('D').querySelector('button'),null,'closed: no button');
 // long notes hidden until the row is tapped; ✕ and Escape close
 const det=card('D').querySelector('[data-cs-det]');assert.equal(det.hidden,true);assert.ok(!card('D').querySelector('.cs-row').textContent.includes('بأمر المالك'),'note not in the row');
 card('D').querySelector('.cs-who').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(det.hidden,false);assert.match(det.textContent,/بأمر المالك 11-27/);assert.equal(card('D').querySelector('[data-cs-toggle]').getAttribute('aria-expanded'),'true');
 det.querySelector('[data-cs-close]').click();assert.equal(det.hidden,true,'✕ closes');
 const row=card('A').querySelector('[data-cs-toggle]');row.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(card('A').querySelector('[data-cs-det]').hidden,false,'Enter opens');
 assert.match(card('A').querySelector('[data-cs-det]').textContent,/الزيادة 1,190 فلوس/);assert.match(card('A').querySelector('[data-cs-det]').textContent,/خطأ في الإجراءات أو التسجيل/);
 row.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(card('A').querySelector('[data-cs-det]').hidden,true,'Escape closes');
 await tick(60);assert.match(card('A').querySelector('[data-cs-bal]').textContent,/-2,280\.00/,'drawer balance filled');
 // the step button does not toggle the row and opens the same modal → financeCaseStep (decision)
 act('A').querySelector('button').click();await tick();assert.equal(card('A').querySelector('[data-cs-det]').hidden,true,'button does not open details');
 let m=d.querySelector('.fc-modal');assert.ok(m,'modal');assert.ok(m.querySelector('.modal-close'),'modal ✕');m.querySelector('[name="note"]').value='تصحيح السجلات';m.querySelector('[name="decision"]').value='correct_records';
 m.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick(80);
 assert.deepEqual(calls.find(c=>c[0]==='financeCaseStep').slice(1,4),['A','decision','تصحيح السجلات']);
 // filter with counts
 const pill=k=>root.querySelector('[data-cs-filter="'+k+'"]');assert.match(pill('all').textContent,/الكل 5/);assert.match(pill('waiting').textContent,/مستني قرار 2/);
 pill('waiting').click();assert.deepEqual([...root.querySelectorAll('[data-cs-case]')].filter(a=>!a.hidden).map(a=>a.dataset.csCase),['A','B']);
 pill('closed').click();assert.deepEqual([...root.querySelectorAll('[data-cs-case]')].filter(a=>!a.hidden).map(a=>a.dataset.csCase),['D']);
 pill('all').click();
 // type-to-search: «احمد» finds «أحمد»; nothing → empty line
 const q=root.querySelector('[data-cs-q]');q.value='احمد';q.dispatchEvent(new w.Event('input',{bubbles:true}));assert.deepEqual([...root.querySelectorAll('[data-cs-case]')].filter(a=>!a.hidden).map(a=>a.dataset.csCase),['E']);
 q.value='سارة';q.dispatchEvent(new w.Event('input',{bubbles:true}));assert.deepEqual([...root.querySelectorAll('[data-cs-case]')].filter(a=>!a.hidden).map(a=>a.dataset.csCase),['C']);
 q.value='zzz';q.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(root.querySelector('[data-cs-none]').hidden,false);
 // «راجع التسوية» → same review modal → clinic_finance_case_settle review
 q.value='';q.dispatchEvent(new w.Event('input',{bubbles:true}));act('E').querySelector('button').click();await tick();m=d.querySelector('.fc-modal');assert.ok(m,'settle review modal');assert.ok(m.querySelector('.modal-close'));m.querySelector('.modal-close').click();
 // ---- accountant (maker, no review): «سوّي الفرق» on C, no case path buttons, own-review blocked
 ({w,root,calls,d}=await boot('ACC','accountant'));
 assert.equal(act('C').querySelector('button').textContent,'سوّي الفرق');assert.ok(act('C').querySelector('.btn-orange'));assert.match(act('C').textContent,/محتاج موافقة شخص تاني/);
 assert.equal(act('A').querySelector('button'),null);assert.match(act('A').textContent,/للمراجِع/);assert.equal(act('E').querySelector('button'),null);assert.match(act('E').textContent,/مستني موافقة شخص تاني/);
 act('C').querySelector('button').click();await tick();m=d.querySelector('.fc-modal');assert.ok(m,'settle modal');assert.deepEqual([...m.querySelector('[name="kind"]').options].map(o=>o.value).filter(Boolean),['shortage_expense']);
 m.querySelector('[name="kind"]').value='shortage_expense';m.querySelector('[name="note"]').value='مستند العجز';m.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick(80);
 const req=calls.find(c=>c[0]==='clinic_finance_case_settle'&&c[1].p_action==='request');assert.ok(req,'request RPC');assert.equal(req[1].p_payload.id,'C');
 // ---- the shift cashier: no action on own case
 ({w,root,calls,d}=await boot('MAR','reviewer'));assert.equal(act('A').querySelector('button'),null);assert.match(act('A').textContent,/ده فرق ورديتك/);
 console.log('PASS cash cases plain: explainer, one-word states, step-named buttons + next-step line, details on tap/Enter with ✕/Escape, filter counts, type-to-search, same modals/RPCs (case step decision, settle request, settle review), cashier blocked.');
})().catch(e=>{console.error(e);process.exit(1);});
