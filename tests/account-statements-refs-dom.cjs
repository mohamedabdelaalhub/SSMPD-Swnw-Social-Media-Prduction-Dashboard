// Owner screenshot 2026-11-22: an internal handover row showed «SHIFT-<uuid>-<uuid>» unbroken over the next columns. Now: a human label,
// a short ref with the full value in the tooltip, wrapping cells on screen and in print; normal refs unchanged; CSV/export untouched.
const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom'),{webcrypto}=require('crypto');
(async()=>{const dom=new JSDOM('<form class="fc-filters"><input name="from" value="2026-11-01"><input name="to" value="2026-11-30"></form>',{runScripts:'outside-only',url:'https://fixture.invalid'}),w=dom.window,d=w.document;let printed='';
Object.defineProperty(w,'crypto',{value:webcrypto});w.SSMPDToast={show:()=>{}};w.SSMPDFinanceControls={panel:()=>'',act:()=>false};w.SSMPDLedgerEditor={ledger:()=>''};w.open=()=>({document:{write:s=>{printed=s},close(){}},print(){}});
const ref='SHIFT-2c7c6883-2435-4f6e-9a3e-1b2c3d4e5f60-7d8e9f00-1111-4222-8333-944455556666';
const rows=[{serial:1,business_date:'2026-11-22',event_no:193,entry_id:'e193',reference:ref,account:'0102010105',account_name:'خزينة منار',register_name:'خزينة منار',description:'تسليم خزينة '+ref,counterpart:'1119 — نقدية في الطريق',debit:0,credit:1800,balance:0},
 {serial:2,business_date:'2026-11-22',event_no:194,entry_id:'e194',reference:'RC-221122-1',account:'0102010105',account_name:'خزينة منار',register_name:'خزينة منار',description:'تحصيل فاتورة',counterpart:'1122',debit:100,credit:0,balance:100}];
w.SSMPDDb={financeAccountStatement:async(code,from,to)=>({code,name:'خزينة منار',from,to,count:2,opening:0,debit:100,credit:1800,closing:100,asof:1,offset:0,rows})};
const data={me:'owner',can_create:true,can_review:true,finance_accounts:[{code:'0102010105',name:'خزينة منار',kind:'asset'}],registers:[{id:'reg',account_code:'0102010105',treasury_kind:'collection',name:'خزينة منار'}],active_shifts:[]};
for(const p of ['finance-treasury','finance-account-statements','finance-cash'])w.eval(fs.readFileSync('assets/js/'+p+'.js','utf8'));const h=w.SSMPDFinanceCash.helpers,tick=()=>new Promise(r=>setImmediate(r)),q=s=>d.querySelector(s);
w.SSMPDFinanceControls.act('treasury-statement','',data,h);await tick();await tick();
const out=q('[data-fas-output]');assert(out,'statement shown');const refs=[...out.querySelectorAll('.fas-ref')],descs=[...out.querySelectorAll('.fas-desc')];
assert.equal(refs[0].textContent,'تسليم نهاية وردية 2c7c6883…');assert.equal(refs[0].title,ref,'full ref in the tooltip');
assert.equal(descs[0].textContent,'تسليم نهاية وردية خزينة منار للخزينة الرئيسية');assert.equal(descs[0].title,'تسليم خزينة '+ref);
assert.equal(refs[1].textContent,'RC-221122-1');assert(!refs[1].hasAttribute('title'),'normal ref unchanged, no tooltip');assert.equal(descs[1].textContent,'تحصيل فاتورة');
assert(!out.textContent.includes('2c7c6883-2435'),'no raw uuid on screen');
const css=fs.readFileSync('assets/css/finance-account-statements.css','utf8');assert(/\.fas-ref[^{]*\{[^}]*overflow-wrap:anywhere/.test(css),'wrapping css');
q('[data-fas-print]').click();await tick();await tick();assert(printed.includes('تسليم نهاية وردية 2c7c6883…'));assert(/overflow-wrap:anywhere/.test(printed),'print wraps');
// the handover table in «الخزائن والورديات» shows the short ref too
const aw=fs.readFileSync('assets/js/accountant-workspace.js','utf8');assert(!aw.includes('h.esc(t.reference)'),'raw handover ref no longer printed');
console.log('PASS statement refs: SHIFT-<uuid> rows get a human label + short ref (full in tooltip), cells wrap on screen and print, normal refs unchanged.');
})().catch(e=>{console.error(e);process.exit(1);});
