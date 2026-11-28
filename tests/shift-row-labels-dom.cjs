// «الورديات» rows (help 347, owner 2026-11-27 «الكلام مايلزقش في بعضه»): each label on its own line; an ended shift shows ITS end
// count / expected / difference (not shift_cash after the handover entry); a carried drawer book (Mariam 24-11: −1,090) is said apart.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const dom=new JSDOM('<!doctype html><body><main id="root"></main></body>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
const shifts=[
 {id:'m1',register_name:'الخزينة الرئيسية',cashier_name:'محمود',opened_at:'2026-11-27T08:00:00Z',status:'open',is_main:true,counted:null,expected:8405,difference:null,cashier_id:'x'},
 {id:'c24',register_name:'خزينة مريم',cashier_name:'مريم',opened_at:'2026-11-24T14:48:00Z',status:'submitted',is_main:false,ended_at:'2026-11-24T20:00:00Z',
  counted:0,expected:-2280,difference:2280,opening_book:-1090,end_counted:1190,end_expected:-1090,cashier_id:'mariam'},
 {id:'c25',register_name:'خزينة مريم',cashier_name:'مريم',opened_at:'2026-11-25T15:00:00Z',status:'reviewed',is_main:false,ended_at:'2026-11-25T20:00:00Z',
  counted:0,expected:0,difference:0,opening_book:-2280,end_counted:920,end_expected:920,review_note:'تم استلام الخزينة 920 ج',cashier_id:'mariam'},
 {id:'z0',register_name:'خزينة صفر',cashier_name:'سارة',opened_at:'2026-11-26T15:00:00Z',status:'submitted',is_main:false,ended_at:null,counted:0,expected:0,difference:0,opening_book:0,cashier_id:'s'}];
const snap={can_create:true,can_review:true,me:'me',shifts,invoices:[],payments:[],requests:[],trial:[],entries:[],audit:[],registers:[],cases:[],cash_cases:[],claims:[],insurance:[]};
w.SSMPDDb={financeSnapshot:async()=>JSON.parse(JSON.stringify(snap)),client:{rpc:async()=>({error:{message:'no'}})}};w.SSMPDToast={show(){}};
w.eval(fs.readFileSync('assets/js/finance-cash.js','utf8'));
const F=w.SSMPDFinanceCash,root=w.document.getElementById('root');F.render(root);await new Promise(r=>setTimeout(r,30));F.navigate('shifts');await new Promise(r=>setTimeout(r,60));
const rows=[...root.querySelectorAll('tbody tr')];assert.equal(rows.length,4,'4 shift rows');
const cell=(r,i)=>rows[r].querySelectorAll('td')[i];
// every label in the count / difference cells is its own block (no «لسه ماتعدّتشالمتوقع»)
for(const r of rows)for(const i of [2,3]){const td=r.querySelectorAll('td')[i];for(const n of td.childNodes)assert.ok(n.nodeType!==3||!n.textContent.trim(),'no loose text in a cell: '+td.innerHTML);
 for(const s of td.querySelectorAll('small'))assert.ok(s.classList.contains('fc-sub'),'small is a block line: '+s.outerHTML);}
assert.equal([...cell(0,2).children].map(x=>x.textContent).join('|'),'لسه ماتعدّتش|المتوقع 8,405.00');
// Mariam 24-11: her end count, not shift_cash after the handover
assert.equal([...cell(1,2).children].map(x=>x.textContent).join('|'),'1,190.00|المتوقع -1,090.00');
assert.equal([...cell(1,3).children].map(x=>x.textContent).join('|'),'زيادة 2,280.00|منها 1,090.00 زيادة جاية من ورديات قبل كده|الجديد في الوردية دي: زيادة 1,190.00');
// 25-11: matched, no carried line (the difference is zero)
assert.equal([...cell(2,2).children].map(x=>x.textContent).join('|'),'920.00|المتوقع 920.00');
assert.equal(cell(2,3).textContent,'مطابق ✓');
// not-ended shift: old fields as before
assert.equal(cell(3,3).textContent,'مطابق ✓');
// reviewer buttons still there
assert.ok(rows[1].querySelector('[data-fin-action="review-shift"]'),'«راجع الوردية» on the submitted shift');
assert.ok(rows[1].querySelector('[data-fin-action="shift-movements"]'),'«الحركات»');
// CSS: .fc-sub is a block
assert.match(fs.readFileSync('assets/css/finance-today.css','utf8'),/\.fc-sub\{display:block/);
console.log('PASS shift row labels: each label its own line, ended shift shows its end count/expected/difference, carried surplus said apart, buttons kept.');
})().catch(e=>{console.error(e);process.exit(1);});
