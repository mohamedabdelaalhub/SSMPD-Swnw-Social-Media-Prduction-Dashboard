// Owner 2026-11-15: «تصحيح طريقة الدفع» and «إلغاء خدمة اتدخلت بالغلط» in the financial request form; readable kind labels.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const d=new JSDOM('<main id="h"></main>',{runScripts:'outside-only'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
w.eval(fs.readFileSync('assets/js/reception-controls.js','utf8'));
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sent=null;
const c={esc,money:v=>Number(v).toFixed(2)+' ج.م',btn:(a,id,l)=>'<button data-rx-action="'+a+'" data-id="'+id+'">'+l+'</button>',
 field:(n,t,ty,v,x)=>'<label>'+esc(t)+'<input name="'+n+'" type="'+(ty||'text')+'" value="'+esc(v==null?'':v)+'" '+(x||'required')+'></label>',
 select:(n,t,rows)=>'<label>'+esc(t)+'<select name="'+n+'" required><option value="">اختر</option>'+rows.map(r=>'<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>').join('')+'</select></label>',
 lookup:(l,id)=>({p1:'مريض أ',p2:'مريض ب'}[id]||id),
 modal:(title,body,save)=>{const r=doc.createElement('form');r.className='rx-modal';r.innerHTML='<h3>'+title+'</h3>'+body;doc.body.append(r);r.onsubmit=e=>{e.preventDefault();const v={};new w.FormData(r).forEach((x,k)=>v[k]=x);save(v,'k');};return r;},
 command:(a,p)=>{sent=[a,p];return Promise.resolve({});},
 data:{workspace:{mode:'live'},patients:[],shifts:[],locations:[],
  payments:[{id:'pay1',patient_id:'p1',method:'cash',amount:300,reference:'CASH-1'},{id:'pay2',patient_id:'p2',method:'cash',amount:50,reference:'CASH-2'}],
  invoices:[{id:'inv1',patient_id:'p1',kind:'service',order_id:'o1',description:'جلسة علاج طبيعي',amount:300,invoice_no:'7'},{id:'inv2',patient_id:'p2',kind:'service',order_id:'o2',description:'كشف',amount:50}],
  orders:[{id:'o1',status:'completed'},{id:'o2',status:'ordered'}],
  requests:[{id:'r1',kind:'refund',subject_id:'pay2',status:'pending',amount:50,reason:'استرداد'},{id:'r2',kind:'method_fix',subject_id:'pay1',status:'pending',amount:300,reason:'دفع فيزا',payload:{method_from:'cash',method:'pos'}}],
  can_review:true}};
w.SSMPDReceptionControls.act('request','',c);
const r=doc.querySelector('.rx-modal'),q=n=>r.querySelector('[name="'+n+'"]'),kind=q('kind');
assert.equal(kind.options[1].value,'method_fix');assert.equal(kind.options[2].value,'service_void');kind.value='method_fix';kind.onchange();
const opts=n=>[...q(n).options].filter(o=>o.value).map(o=>o.value);
// method_fix (default): payments without a refund, all methods, reference required except cash, amount hidden
assert.deepEqual(opts('subject_id'),['pay1'],'refund-locked receipt excluded');
assert(q('subject_id').options[1].textContent.includes('مريض أ')&&q('subject_id').options[1].textContent.includes('نقدي'));
assert.deepEqual(opts('method'),['cash','pos','bank','instapay','wallet']);assert.equal(q('method').value,'pos');
assert.equal(q('reference').required,true);q('method').value='cash';q('method').onchange();assert.equal(q('reference').required,false);
assert(q('amount').closest('label').hidden);assert(r.querySelector('[data-correction-hint]').textContent.includes('المدير المالي'));
assert(q('method').closest('label').firstChild.textContent.includes('الطريقة الصحيحة'));
// service_void: only executed service invoices, no method/reference
kind.value='service_void';kind.onchange();
assert.deepEqual(opts('subject_id'),['inv1']);assert(q('method').closest('label').hidden);assert(q('reference').closest('label').hidden);
assert(r.querySelector('[data-correction-hint]').textContent.includes('رصيد للمريض'));
// back to a generic kind restores the original method list and labels
kind.value='refund';kind.onchange();assert(!r.querySelector('[data-correction-hint]'));assert.deepEqual(opts('method'),['bank','instapay','cash']);
assert(!q('method').closest('label').firstChild.textContent.includes('الطريقة الصحيحة'));
// submit a method fix
kind.value='method_fix';kind.onchange();q('subject_id').value='pay1';q('method').value='pos';q('reference').value='VISA-9';q('reason').value='المريض دفع فيزا';q('evidence').value='إيصال الماكينة';
r.dispatchEvent(new w.Event('submit',{cancelable:true}));
assert.equal(sent[0],'request');assert.equal(sent[1].kind,'method_fix');assert.equal(sent[1].subject_id,'pay1');assert.equal(sent[1].method,'pos');assert.equal(sent[1].reference,'VISA-9');
// readable labels in the review list
const html=w.SSMPDReceptionControls.panel('controls',c);assert(html.includes('تصحيح طريقة الدفع: نقدي ← فيزا'));assert(html.includes('استرداد'));assert(!html.includes('>method_fix'));
assert.deepEqual(errors,[]);console.log('PASS correction requests form: method fix (receipts without refunds, all methods, reference rule, hint), service void (executed services only), generic kinds restored, payload, readable labels.');
