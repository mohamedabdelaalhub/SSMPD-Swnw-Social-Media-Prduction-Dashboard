// Owner 2026-11-22 «محتاج القيود تظهر باسم الحساب مش رقم الحساب فقط»: posted entry cards (ledger), and the reception journal list,
// show «code — Arabic name». Names come from the line itself or from finance data already loaded in the session; unknown codes stay as the code.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window;
w.SSMPDFinanceControls={panel:()=>'',act:()=>false,due:()=>''};
for(const f of ['finance-labels','finance-cash','ledger-editor'])try{w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));}catch(e){if(f!=='finance-cash')throw e;}
const L=w.SSMPDFinanceLabels,h=w.SSMPDFinanceCash.helpers;
assert.equal(L.accountLabel('4192','مردودات ومسموحات'),'4192 — مردودات ومسموحات');assert.equal(L.accountLabel('9999'),'9999','unknown code stays as the code');
// 1. ledger «القيود المرحلة» cards: name from the line
const d={trial:[],entries:[{id:'e1',description:'إلغاء خدمة مدخلة بالخطأ — غير محصل',business_date:'2026-11-21',source:'reception_service_void_ar',lines:[{account:'4192',account_name:'مردودات ومسموحات المبيعات',debit:100,credit:0},{account:'1122',account_name:'مديونية المرضى',debit:0,credit:100}]}]};
const html=w.SSMPDLedgerEditor.ledger(d,h);const box=w.document.createElement('div');box.innerHTML=html;w.document.body.appendChild(box);
const cells=[...box.querySelectorAll('.le-entry td')].map(t=>t.textContent);
assert(cells.includes('4192 — مردودات ومسموحات المبيعات'),cells.join('|'));assert(cells.includes('1122 — مديونية المرضى'));
// 2. names remembered from a finance snapshot label codes on screens without names
L.rememberSnapshot({finance_accounts:[{code:'2120',name:'مستحقات الأطباء'}],trial:[{code:'5111',name:'أتعاب الأطباء'}],entries:[]});
assert.equal(L.accountLabel('2120'),'2120 — مستحقات الأطباء');assert.equal(L.accountLabel('5111'),'5111 — أتعاب الأطباء');
assert.equal(JSON.parse(w.sessionStorage.getItem('ssmpd_acc_names'))['2120'],'مستحقات الأطباء','kept for the session');
// 3. the reception journal list uses the same label (source check: the cell goes through accountLabel)
assert(/accountLabel\(l\.account,l\.account_name\)/.test(fs.readFileSync('assets/js/reception-services.js','utf8')));
// escaping still applies
const d2={trial:[],entries:[{id:'e2',description:'x',business_date:'2026-11-21',source:'manual',lines:[{account:'1',account_name:'<img src=x>',debit:1,credit:0}]}]};
box.innerHTML=w.SSMPDLedgerEditor.ledger(d2,h);assert.equal(box.querySelector('img'),null);
console.log('PASS entry account names: ledger cards show «code — name» from the line, session-remembered names label other screens, unknown codes stay codes, escaped.');
