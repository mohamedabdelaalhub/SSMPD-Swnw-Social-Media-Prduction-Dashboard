// Owner 2026-11-22: requests table shows who submitted (name + time), who approved/rejected (name + note) and the status in Arabic.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<body></body>',{runScripts:'outside-only'}).window;
w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false};
w.eval(fs.readFileSync('assets/js/reception-controls.js','utf8'));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const c={esc,money:v=>Number(v).toFixed(2)+' ج.م',btn:(a,id,l)=>'<button data-rx-action="'+a+'" data-id="'+id+'">'+l+'</button>',stamp:v=>'T:'+v,lookup:()=>'—',data:{}};
const d={provider_balances:[],requests:[
 {id:'r1',kind:'service_void',status:'approved',reason:'المريض لم يحضر',amount:100,creator_name:'سارة',created_at:'2026-11-22T10:00:00Z',reviewer_name:'مدحت',review_note:'تمت المراجعة'},
 {id:'r2',kind:'refund',status:'pending',reason:'استرداد',amount:50,creator_name:'منى',created_at:'2026-11-22T11:00:00Z'},
 {id:'r3',kind:'refund',status:'rejected',reason:'x',amount:5,creator_name:'منى',created_at:'2026-11-22T12:00:00Z',reviewer_name:'مدحت',review_note:'غير مبرر'}],can_manage:false,can_review:false};
c.data=d;
const html=w.SSMPDReceptionControls.panel('controls',c);
const doc=new JSDOM('<body>'+html+'</body>').window.document;
const th=[...doc.querySelectorAll('th')].map(x=>x.textContent);
for(const h of ['الطلب','مقدّم الطلب','القيمة','الحالة','اعتمده / رفضه'])assert(th.includes(h),'column '+h);
const rows=[...doc.querySelectorAll('tbody tr')].filter(r=>/المريض لم يحضر|استرداد|x$/.test(r.textContent));
const t=rows.map(r=>r.textContent).join('|');
assert(/سارة/.test(t)&&/T:2026-11-22T10:00:00Z/.test(t),'submitter name + time');
assert(/مدحت/.test(t)&&/تمت المراجعة/.test(t)&&/غير مبرر/.test(t),'reviewer name + note');
for(const s of ['معتمد','بانتظار المراجعة','مرفوض'])assert(t.includes(s),'Arabic status '+s);
assert(!/approved|pending|rejected/.test(t),'no raw English status');
console.log('PASS requests table: submitter, reviewer + note, Arabic status.');
