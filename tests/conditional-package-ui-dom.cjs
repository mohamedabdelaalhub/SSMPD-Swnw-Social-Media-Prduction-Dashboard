// Owner 2026-11-15: «عرض مشروط» flag in package pricing + both numbers shown when requesting and reviewing a package cancel.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(async()=>{
const d=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
const quote={package_id:'pk1',conditional:true,method:'conditional',prorata_refund:400,consumed_at_package:200,consumed_at_standard:300,conditional_refund:300,forfeited_discount:100,shortfall:0,refundable:300};
const calls=[];w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);return Promise.resolve({data:quote,error:null});}}};
w.eval(fs.readFileSync('assets/js/reception-controls.js','utf8'));
let sent=null;
const c={esc,money:v=>Number(v).toFixed(2)+' ج.م',workspace:'ws1',btn:(a,id,l)=>'<button data-a="'+a+'" data-id="'+id+'">'+l+'</button>',
 field:(n,t,ty,v,x)=>'<label>'+esc(t)+'<input name="'+n+'" type="'+(ty||'text')+'" value="'+esc(v==null?'':v)+'" '+(x||'required')+'></label>',
 select:(n,t,rows)=>'<label>'+esc(t)+'<select name="'+n+'" required><option value="">اختر</option>'+rows.map(r=>'<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>').join('')+'</select></label>',
 lookup:(l,id)=>id,modal:(title,body,save)=>{const r=doc.createElement('form');r.className='rx-modal';r.innerHTML='<h3>'+title+'</h3>'+body;doc.body.append(r);r.onsubmit=e=>{e.preventDefault();const v={};new w.FormData(r).forEach((x,k)=>v[k]=x);save(v,'k');};return r;},
 command:(a,p)=>{sent=[a,p];return Promise.resolve({});},
 data:{workspace:{mode:'live'},patients:[],shifts:[],locations:[],packages:[{id:'pk1',name:'باكج ٣ جلسات بعرض'}],
  requests:[{id:'rq1',kind:'package_cancel',subject_id:'pk1',status:'pending',amount:300,reason:'إيقاف',payload:{method:'conditional',quote}}],can_review:true}};
w.SSMPDReceptionControls.act('request-package-cancel','pk1',c);await new Promise(r=>setTimeout(r,10));
let f=doc.querySelector('.rx-modal'),box=f.querySelector('[data-package-quote]');
assert.equal(JSON.stringify(calls[0]),JSON.stringify(['clinic_reception_package_cancel_quote',{p_workspace:'ws1',p_package:'pk1'}]));
assert(box&&box.textContent.includes('عرض مشروط')&&box.textContent.includes('300.00')&&box.textContent.includes('400.00')&&box.textContent.includes('100.00'),'both numbers shown');
assert.equal(f.querySelector('[name="amount"]').value,'300');assert.equal(f.querySelector('[name="amount"]').readOnly,true);
f.querySelector('[name="kind"]').value='refund';f.querySelector('[name="kind"]').onchange();f.querySelector('[name="subject_id"]').dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,10));
assert(!f.querySelector('[data-package-quote]'),'quote removed for other kinds');assert.equal(f.querySelector('[name="amount"]').readOnly,false);
f.remove();
w.SSMPDReceptionControls.act('request_review','rq1',c);f=doc.querySelector('.rx-modal');
assert(f.querySelector('[data-package-quote]').textContent.includes('خصم سقط'),'reviewer sees the stored quote');assert(f.textContent.includes('بتتحسب تاني لحظة الاعتماد'));
// pricing screen checkbox
const src=fs.readFileSync('assets/js/render-accounting.js','utf8');assert(src.includes('id="pk-conditional"')&&src.includes("conditional_offer: backdrop.querySelector('#pk-conditional').checked"));
assert.deepEqual(errors,[]);console.log('PASS conditional package UI: quote fetched and both numbers shown on request (amount locked), cleared for other kinds, reviewer sees stored quote, pricing checkbox saved.');
})().catch(e=>{console.error(e);process.exit(1);});
