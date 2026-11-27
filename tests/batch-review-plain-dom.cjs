// «مراجعة دفعة» in plain words (owner «طبّق شكل مراجعة الملف» 2026-11-27): tiles, one primary button, renamed advanced
// actions (old names kept visible), the ✕ close (rule 10). Live-workspace payloads, mocked RPC.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
async function open(rows,{confirm=true,failReview=0}={}){const dom=new JSDOM('<main></main><button data-name-review>مراجعة أسماء الجهات</button>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window,d=w.document,calls=[];let reviewOpened=false;
d.querySelector('[data-name-review]').onclick=()=>{reviewOpened=true;};w.confirm=()=>confirm;w.SSMPDAuth={currentAdmin:{id:'owner'}};w.SSMPDRoles={canModuleAction:()=>true};w.SSMPDToast={show:()=>{}};
const services=[{id:'s1',name:'كشف باطنة',canonical_code:'S1',category:'الباطنة',active:true},{id:'s2',name:'سونار بطن',canonical_code:'S2',category:'الأشعة',active:true}];
const l={id:'l',name:'قائمة أسعار نقابة اختبار',status:'draft',created_by:'owner',can_edit:true,revision:9,version:1,issue_year:2026,application_year:2026},batch={id:'b',list_id:'l',status:'draft',revision:2,filename:'نقابة.xlsx',operation:'append',rows};
const data={lists:[l],items:[],sections:[],contracts:[],services,aliases:[],proposals:[]};
w.SSMPDDb={client:{rpc:async(fn,args)=>{if(fn==='price_lists_workspace')return {data};if(fn==='price_import_workspace')return {data:{batches:[batch],audit:[]}};calls.push(Object.assign({fn},args));if(fn==='price_service_mapping_command'){if(failReview&&calls.filter(c=>c.fn===fn).length===failReview)return {error:{message:'السطر مرفوض للاختبار'}};return {data:{list_revision:20+calls.length,batch_revision:30+calls.length}};}return {data:'ok'};}}};
for(const n of ['workforce-prices','price-import-reader','service-mapping-review','service-search-picker','contract-price-workspace'])w.eval(fs.readFileSync('assets/js/'+n+'.js','utf8'));
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};w.SSMPDContractPrices.render(d.querySelector('main'),'center');await tick();d.querySelector('[data-pi=open]').click();await tick();d.querySelector('[data-pi=batch]').click();await tick();
return {w,d,calls,tick,reviewOpened:()=>reviewOpened,dom};}
const row=(o)=>Object.assign({name:'بند',code:'',category:'',unit:'',price:100,row:2,sheet:'ملف',service_id:'',confirmed:false},o);
(async()=>{
 // 1) everything decided: 2 linked, 2 «مش عندنا», 1 proposed → finish = discard_batch
 let t=await open([row({name:'كشف',service_id:'s1',confirmed:true}),row({name:'سونار',service_id:'s2',confirmed:true}),row({review_status:'deferred'}),row({review_status:'deferred'}),row({review_status:'proposed'})]);
 let d=t.d,tile=k=>d.querySelector('[data-brp-tile="'+k+'"] b').textContent;
 assert.equal(tile('linked'),'2');assert.equal(tile('off'),'3');assert.equal(tile('left'),'0');
 assert(d.querySelector('[data-brp-tile="off"] small').textContent.includes('1 اتقترحوا'));
 assert.equal(d.querySelector('[type=submit]').hidden,true,'footer submit moved under «خيارات متقدمة»');
 assert.equal(d.querySelector('[data-pi=go-review]'),null);
 const fin=d.querySelector('[data-pi=finish]');assert.equal(fin.textContent,'خلّصت — اقفل الملف واحفظ الأسعار');
 assert(d.querySelector('.brp-hint').textContent.includes('الـ 2 خدمة المربوطة'));
 const adv=[...d.querySelectorAll('.brp-row')].map(r=>r.textContent);
 for(const [now,old] of [['احفظ وكمّل بعدين','حفظ التعديلات والمتابعة لاحقًا'],['أكّد الخدمات اللي اخترتها في الصفحة دي','تأكيد مراجعة الخدمات المختارة في الصفحة'],['احفظ المراجعة وضمّ البنود للايحة','حفظ واعتماد المراجعة'],['اقفل الملف من غير ما أضيف حاجة تانية','استبعاد دفعة الاستيراد بالكامل']])
   assert(adv.some(x=>x.includes(now)&&x.includes(old)),'advanced action renamed, old name shown: '+now);
 assert.equal(d.querySelector('footer [data-close]').textContent,'اقفل من غير ما تغيّر حاجة');
 assert(d.querySelector('.wp-modal header [data-close]'),'✕ close (rule 10)');
 fin.click();await t.tick();
 // the 2 rows were linked only inside this file: they are written to the list first (source_review), then the file closes
 assert.deepEqual(t.calls.map(c=>c.p_action||c.p_payload.action),['batch','source_review','source_review','discard_batch']);
 assert.equal(t.calls[0].p_payload.rows[0].confirmed,false,'saved unconfirmed so source_review can confirm it');
 assert.equal(JSON.stringify(t.calls[1].p_payload.indexes),'[0]');assert.equal(t.calls[1].p_payload.service_id,'s1');assert.equal(t.calls[1].p_payload.details_confirmed,true);
 assert.equal(JSON.stringify(t.calls[2].p_payload.indexes),'[1]');assert.equal(t.calls[2].p_payload.service_id,'s2');
 const last=t.calls.at(-1);assert.equal(last.p_payload.id,'b');assert.equal(last.p_payload.list_id,'l');assert.equal(last.p_payload.revision,t.calls[2].p_payload.batch_revision+1);
 assert.equal(d.querySelector('.wp-modal [data-brp]'),null,'window closed after finishing');t.dom.window.close();
 // 1c) a row is refused half-way: the error names the row, rows before it stay saved, and «خلّصت» resumes from it
 t=await open([row({name:'كشف',service_id:'s1',confirmed:true}),row({name:'سونار',service_id:'s2',confirmed:true}),row({review_status:'deferred'})],{failReview:2});d=t.d;
 d.querySelector('[data-pi=finish]').click();await t.tick();
 assert.deepEqual(t.calls.map(c=>c.p_action||c.p_payload.action),['batch','source_review','source_review']);
 assert.equal(t.calls[0].p_payload.rows[1].finish_pending,true,'rows waiting for «خلّصت» are marked so they still count as linked');
 assert(d.querySelector('.wp-modal [role=alert]').textContent.includes('وقفت عند السطر رقم 2 «سونار»'),'error names the row');
 assert.equal(d.querySelector('[data-pi=finish]').disabled,false);t.dom.window.close();
 // …reopened as saved on the server: row 1 done, row 2 still waiting → counted as linked, nothing left, «خلّصت» does only row 2
 t=await open([row({name:'كشف',service_id:'s1',confirmed:true,review_status:'approved'}),row({name:'سونار',service_id:'s2',confirmed:false,finish_pending:true}),row({review_status:'deferred'})]);d=t.d;
 assert.equal(d.querySelector('[data-brp-tile="linked"] b').textContent,'2');assert.equal(d.querySelector('[data-brp-tile="left"] b').textContent,'0');
 d.querySelector('[data-pi=finish]').click();await t.tick();
 assert.deepEqual(t.calls.map(c=>c.p_action||c.p_payload.action),['batch','source_review','discard_batch']);assert.equal(JSON.stringify(t.calls[1].p_payload.indexes),'[1]');t.dom.window.close();
 // 1b) rows already linked through «مراجعة أسماء الجهات» (review_status approved) → just close the file
 t=await open([row({service_id:'s1',confirmed:true,review_status:'approved'}),row({review_status:'deferred'})]);d=t.d;
 d.querySelector('[data-pi=finish]').click();await t.tick();assert.deepEqual(t.calls.map(c=>c.p_action||c.p_payload.action),['discard_batch']);assert.equal(t.calls[0].p_payload.revision,2);t.dom.window.close();
 // 2) rows left: orange tile, blue «كمّل» jumps to «مراجعة أسماء الجهات», no finish
 t=await open([row({service_id:'s1',confirmed:true}),row({}),row({}),row({review_status:'deferred'})]);d=t.d;
 assert.equal(d.querySelector('[data-brp-tile="left"] b').textContent,'2');assert(d.querySelector('[data-brp-tile="left"]').classList.contains('left'));
 assert.equal(d.querySelector('[data-pi=finish]'),null);const go=d.querySelector('[data-pi=go-review]');assert(go.textContent.includes('كمّل الـ 2 سطر'));
 go.click();await t.tick();assert.equal(t.reviewOpened(),true);assert.equal(d.querySelector('.wp-modal [data-brp]'),null);assert.equal(t.calls.length,0,'no server call');t.dom.window.close();
 // 3) ✕ closes without any call (rule 10); advanced «اقفل الملف» keeps its confirmation
 t=await open([row({service_id:'s1',confirmed:true}),row({review_status:'deferred'})],{confirm:false});d=t.d;
 d.querySelector('[data-pi=discard]').click();await t.tick();assert.equal(t.calls.length,0,'discard still asks first');
 d.querySelector('.wp-modal header [data-close]').click();await t.tick();assert.equal(d.querySelector('.wp-overlay'),null);assert.equal(t.calls.length,0);t.dom.window.close();
 // 4) all linked, nothing deferred → finish uses the existing save + apply path
 t=await open([row({service_id:'s1',confirmed:true}),row({service_id:'s2',confirmed:true})]);d=t.d;
 d.querySelector('[data-pi=finish]').click();await t.tick();assert.deepEqual(t.calls.map(c=>c.p_action),['batch','apply_batch']);t.dom.window.close();
 console.log('PASS batch review in plain words: tiles, «خلّصت» = discard_batch (resumes after a refused row) (or apply when all linked), «كمّل» jumps to name review, renamed advanced actions with old names, ✕ close');
})().catch(e=>{console.error(e);process.exitCode=1;});
