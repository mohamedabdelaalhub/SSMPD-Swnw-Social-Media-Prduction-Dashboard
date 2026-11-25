// «تسوية فروق الخزن» UI (20261124190000): the cases table shows the drawer balance column and, after «القرار», «تسوية الفرق»
// (maker) / «مراجعة التسوية» (another reviewer); the shift cashier sees nothing; the modal offers only the allowed kinds and previews the entry.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const w=new JSDOM('<div id="b"></div>',{runScripts:'outside-only',url:'https://x.test/'}).window,doc=w.document;
w.eval(fs.readFileSync('assets/js/finance-controls.js','utf8'));const C=w.SSMPDFinanceControls;
const esc=v=>String(v==null?'':v).replace(/</g,'&lt;'),money=v=>Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const btn=(a,id,t)=>'<button type="button" class="btn ghost sm" data-fin-action="'+a+'" data-id="'+id+'">'+t+'</button>';
const table=(head,rows)=>'<table><thead><tr>'+head.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
let modalCall=null;const h={esc,money,btn,table,stamp:x=>x,field:(n,l)=>'<label>'+l+'<input name="'+n+'"></label>',select:(n,l,o)=>'<label>'+l+'<select name="'+n+'">'+o.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+'</select></label>',
 modal:(t,body,save)=>{modalCall={t,body,save};doc.body.insertAdjacentHTML('beforeend','<div class="fc-modal"><form>'+body+'</form></div>');}};
const cases=[{id:'M',register_name:'خزينة مازن',cashier_name:'مازن',cashier_id:'MAZ',difference:550,status:'decided',review_note:'مبلغ غير مسجل',responsibility:'process_error',decision:'correct_records'},
 {id:'N',register_name:'خزينة منار',cashier_name:'منار',cashier_id:'MAN',difference:-1500,status:'decided',responsibility:'employee',responsible_id:'MAN',decision:'refer_management',settle_status:'pending',settle_kind:'shortage_expense',settle_by:'ACC',settle_note:'خدمتين'},
 {id:'R',register_name:'خزينة مريم',cashier_name:'مريم',cashier_id:'MAR',difference:1090,status:'decided',settle_status:'approved'},
 {id:'X',register_name:'خزينة مريم',cashier_name:'مريم',cashier_id:'MAR',difference:2280,status:'recorded'}];
const base={cash_cases:cases,can_review:true,can_create:true};
// accountant (maker, no review)
let html=C.panel('cases',{...base,can_review:false,me:'ACC'},h);doc.getElementById('b').innerHTML=html;let B=doc.getElementById('b');
assert.match(B.querySelector('thead').textContent,/رصيد الخزينة دلوقتي/);assert.match(B.textContent,/← تسوية الفرق/);
const rowOf=id=>B.querySelector('[data-cs-bal="'+id+'"]').closest('tr');
assert.ok(rowOf('M').querySelector('[data-fin-action="case-settle"].btn-orange'),'orange «تسوية الفرق» after the decision');
assert.match(rowOf('N').textContent,/مستني موافقة التسوية/);assert.match(rowOf('N').textContent,/مستني موافقة شخص تاني/);assert.equal(rowOf('N').querySelector('button'),null,'maker cannot review own');
assert.match(rowOf('R').textContent,/تمت التسوية/);assert.equal(rowOf('X').querySelector('button'),null,'accountant cannot run the case path');
assert.match(rowOf('M').textContent,/\+550.00 زيادة/);assert.match(rowOf('N').textContent,/-1,500.00 عجز/);
// FM (reviewer): review button on N; the cashier sees nothing on own case
html=C.panel('cases',{...base,me:'FM'},h);B.innerHTML=html;assert.ok(rowOf('N').querySelector('[data-fin-action="case-settle-review"]'));assert.ok(rowOf('X').querySelector('[data-fin-action="case-step"]'));
html=C.panel('cases',{...base,me:'MAZ'},h);B.innerHTML=html;assert.equal(rowOf('M').querySelector('button'),null,'shift cashier sees no action');
// settle modal: surplus → only income + warning + entry preview; submit calls the RPC
let calls=[];w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);return Promise.resolve({data:n==='clinic_finance_case_settle'&&a.p_action==='list'?[{id:'M',register_balance:-550},{id:'R',register_balance:0}]:{settle_status:'pending'}});}}};
C.act('case-settle','M',{...base,me:'ACC'},h);let f=doc.querySelector('.fc-modal:last-child form');
assert.equal(JSON.stringify([...f.elements.kind.options].map(o=>o.value)),JSON.stringify(['surplus_income']));assert.match(modalCall.body,/الأفضل تسجّل التحصيل نفسه/);
assert.match(f.textContent,/من حـ\/ خزينة مازن\s*550.00/);assert.match(f.textContent,/إلى حـ\/ إيراد فروق زيادة الخزينة/);
await0();
async function await0(){await modalCall.save({kind:'surplus_income',note:'مبلغ متحصّل غير مسجل'},'tok-1');const c=calls.pop();assert.equal(c[0],'clinic_finance_case_settle');assert.equal(JSON.stringify(c[1]),JSON.stringify({p_action:'request',p_payload:{id:'M',kind:'surplus_income',note:'مبلغ متحصّل غير مسجل'},p_token:'tok-1'}));
 // shortage with employee responsibility + refer_management → two kinds; switching updates the preview
 doc.querySelectorAll('.fc-modal').forEach(x=>x.remove());const N2={...cases[1],settle_status:null};C.act('case-settle','N',{...base,cash_cases:[N2],me:'ACC'},h);f=doc.querySelector('.fc-modal form');
 assert.equal(JSON.stringify([...f.elements.kind.options].map(o=>o.value)),JSON.stringify(['shortage_expense','shortage_employee']));assert.match(f.textContent,/من حـ\/ مصروف عجز الخزينة/);
 f.elements.kind.value='shortage_employee';f.elements.kind.onchange();assert.match(f.textContent,/من حـ\/ سلف وذمم الموظفين/);assert.match(f.textContent,/إلى حـ\/ خزينة منار/);
 // review modal → review RPC
 doc.querySelectorAll('.fc-modal').forEach(x=>x.remove());C.act('case-settle-review','N',{...base,me:'FM'},h);assert.match(modalCall.body,/مصروف عجز الخزينة/);
 await modalCall.save({approve:'true',note:'موافق'},'tok-2');assert.equal(JSON.stringify(calls.pop()[1]),JSON.stringify({p_action:'review',p_payload:{id:'N',approve:true,note:'موافق'},p_token:'tok-2'}));
 // balance fill
 html=C.panel('cases',{...base,me:'FM'},h);B.innerHTML=html;await w.SSMPDCaseSettleFill(B,'cases');assert.match(B.querySelector('[data-cs-bal="M"]').innerHTML,/cs-neg">-550.00/);assert.equal(B.querySelector('[data-cs-bal="X"]').textContent,'—');
 // cap (20261125050000): a case already included elsewhere → no button; a partial one → warning + capped preview
 w.SSMPDDb={client:{rpc:(n,a)=>Promise.resolve({data:a.p_action==='list'?[{id:'M',register_balance:-1190,settle_amount:0},{id:'P',register_balance:-1190,settle_amount:1190}]:{}})}};
 const P={id:'P',register_name:'خزينة مريم',cashier_name:'مريم',cashier_id:'MAR',difference:2280,status:'decided',responsibility:'process_error',decision:'correct_records'};
 html=C.panel('cases',{...base,cash_cases:[cases[0],P],me:'ACC'},h);B.innerHTML=html;await w.SSMPDCaseSettleFill(B,'cases');
 assert.equal(rowOf('M').querySelector('[data-fin-action="case-settle"]'),null,'included case: no settle button');assert.match(rowOf('M').textContent,/مفيش رصيد يتسوّى/);
 assert.ok(rowOf('P').querySelector('[data-fin-action="case-settle"]'));
 doc.querySelectorAll('.fc-modal').forEach(x=>x.remove());C.act('case-settle','P',{...base,cash_cases:[P],me:'ACC'},h);f=doc.querySelector('.fc-modal form');
 assert.match(f.textContent,/هيتسوّى 1,190.00 بس من الفرق/);assert.match(f.textContent,/من حـ\/ خزينة مريم\s*1,190.00/);
 assert(fs.readFileSync('assets/js/finance-cash.js','utf8').includes('if(window.SSMPDCaseSettleFill)window.SSMPDCaseSettleFill(body,tab);'));
 console.log('PASS cash case settlement UI: cap (included case → no button, partial → capped preview); balance column, orange «تسوية الفرق» after decision (maker), «مراجعة التسوية» for another reviewer, nothing for the shift cashier, allowed kinds only (employee kind by decision), entry preview, request/review RPC payloads, balance fill.');}
