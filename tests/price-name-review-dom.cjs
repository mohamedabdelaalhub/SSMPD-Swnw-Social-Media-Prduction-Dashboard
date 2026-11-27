// DOM: «مراجعة أسماء الجهات» — one name reviewed once across lists; every button sends the existing RPC payload.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const src=fs.readFileSync('assets/js/price-name-review.js','utf8');
function rowsA(){return [{name:'موجات صوتيه علي البطن',code:'A1',unit:'',category:'غير مصنف',price:300,confirmed:false},
 {name:'رنين على المخ',code:'A2',unit:'',category:'غير مصنف',price:900,confirmed:false},
 {name:'HBs Ag (ELISA)',code:'A3',unit:'',category:'غير مصنف',price:80,confirmed:true,service_id:'s3'},
 {name:'Copper in Urine',code:'A4',unit:'',category:'غير مصنف',price:100,confirmed:false,review_status:'deferred'}];}
function rowsB(){return [{name:'موجات صوتية على البطن',code:'B1',unit:'',category:'الاشعة',price:350,confirmed:false},
 {name:'رنين على المخ',code:'B2',unit:'',category:'الاشعة',price:950,confirmed:false}];}
async function boot(){
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window,host=w.document.querySelector('main'),calls=[],toasts=[];
 const lists=[{id:'L1',name:'قائمة أسعار شركة ميد نت',list_kind:'reference',status:'draft',revision:5,can_edit:true,valid_to:'2099-12-31'},
  {id:'L2',name:'قائمة أسعار ميد شور',list_kind:'reference',status:'draft',revision:9,can_edit:true,valid_to:'2099-12-31'},
  {id:'L3',name:'لائحة منتهية',list_kind:'reference',status:'draft',revision:1,can_edit:true,valid_to:'2020-01-01'},
  {id:'L4',name:'مش من حقي',list_kind:'reference',status:'draft',revision:1,can_edit:false,valid_to:'2099-12-31'},
  {id:'C1',name:'سونو',list_kind:'center',status:'active',revision:1,can_edit:true}];
 const ws={L1:{batches:[{id:'b1',status:'draft',revision:2,rows:rowsA()}]},L2:{batches:[{id:'b2',status:'draft',revision:7,rows:rowsB()}]}};
 const services=[{id:'s1',name:'موجات صوتية على البطن',code:'0000101',category:'الاشعة',base_price:400,active:true},
  {id:'s2',name:'موجات صوتية على البطن والحوض',code:'0000102',category:'الاشعة',base_price:500,active:true},
  {id:'s3',name:'HBs Ag',code:'0000103',category:'التحاليل',base_price:90,active:true}];
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};w.SSMPDContractPrices={can:()=>true};
 w.SSMPDWorkforceUtils={rpc:async(n,a)=>{calls.push([n,a]);if(n==='price_lists_workspace')return {lists,services};
  if(n==='price_service_mapping_workspace'){assert.ok(['L1','L2'].includes(a.p_list),'only editable, unexpired reference lists are read');return JSON.parse(JSON.stringify(ws[a.p_list]));}
  if(n==='price_service_mapping_command'){const p=a.p_payload;if(p.list_id==='L2'&&p.action==='source_defer'&&p.indexes.includes(1)&&w.__refuse)throw new Error('مرفوض للتجربة');return {count:p.indexes.length,list_revision:p.list_revision+1,batch_revision:p.batch_revision+1};}
  throw new Error('unexpected rpc '+n);}};
 w.eval(src);const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,0));};
 await w.SSMPDPriceNameReview.render(host);await tick();return {w,host,calls,toasts,tick};}
(async()=>{
 let {w,host,calls,tick}=await boot();
 const cards=()=>[...host.querySelectorAll('.pnr-card')],card=t=>cards().find(c=>c.querySelector('.pnr-name').textContent.includes(t));
 assert.equal(cards().length,2,'2 names: «موجات… البطن» merged across lists; confirmed and deferred rows hidden');
 const us=card('موجات');assert.match(us.textContent,/في 2 لوايح/);assert.match(us.textContent,/من 300 لـ 350/);assert.match(us.textContent,/أقرب خدمة عندنا: موجات صوتية على البطن ·/);
 assert.ok(!/[٠-٩]/.test(host.textContent),'English digits only');
 // «هي دي» → one source_review per list, each with its own revisions and the chosen service
 us.querySelector('.pnr-yes').click();await tick();
 const rev=calls.filter(c=>c[0]==='price_service_mapping_command');assert.equal(rev.length,2);
 assert.deepEqual(rev.map(c=>[c[1].p_payload.action,c[1].p_payload.list_id,c[1].p_payload.list_revision,c[1].p_payload.batch_id,c[1].p_payload.batch_revision,c[1].p_payload.indexes.join(),c[1].p_payload.service_id,c[1].p_payload.details_confirmed]),
  [['source_review','L1',5,'b1',2,'0','s1',true],['source_review','L2',9,'b2',7,'0','s1',true]]);
 assert.ok(rev.every(c=>c[1].p_payload.note.length>=3),'note ≥3 chars (RPC rule)');
 assert.equal(cards().length,1,'linked name leaves the queue');assert.match(host.querySelector('.pnr-msg').textContent,/اتربط 2 سطر/);
 // «مش عندنا» → source_defer on both lists, revisions advanced from the previous call
 card('رنين').querySelector('[data-pnr=absent]').click();await tick();
 const def=calls.filter(c=>c[0]==='price_service_mapping_command').slice(2);
 assert.deepEqual(def.map(c=>[c[1].p_payload.action,c[1].p_payload.list_id,c[1].p_payload.list_revision,c[1].p_payload.batch_revision,c[1].p_payload.service_id]),[['source_defer','L1',6,3,null],['source_defer','L2',10,8,null]]);
 assert.match(def[0][1].p_payload.note,/مش عندنا/);assert.equal(cards().length,0);
 // fresh boot: «بعدين» is local only; bulk «مش عندنا للمختار»; «اختار خدمة تانية» search; a refusal is reported, not hidden
 ({w,host,calls,tick}=await boot());const n0=calls.length;
 card('رنين').querySelector('[data-pnr=later]').click();await tick();assert.equal(calls.length,n0,'«بعدين» writes nothing');assert.equal(cards().length,1);
 host.querySelector('[data-pnr-filter=later]').click();await tick();assert.equal(cards().length,1);card('رنين').querySelector('[data-pnr=later]').click();await tick();
 host.querySelector('[data-pnr-filter=all]').click();await tick();assert.equal(cards().length,2);
 cards().forEach(c=>{const x=c.querySelector('[data-pnr-pick]');x.checked=true;x.dispatchEvent(new w.Event('change'));});await tick();
 assert.match(host.querySelector('.pnr-bulk').textContent,/اخترت 2 اسم/);
 w.__refuse=true;host.querySelector('[data-pnr=bulk-absent]').click();await tick();
 const bulk=calls.slice(n0).filter(c=>c[0]==='price_service_mapping_command');assert.equal(bulk.length,4);assert.ok(bulk.every(c=>c[1].p_payload.action==='source_defer'));
 assert.match(host.querySelector('.pnr-msg').textContent,/ما اتنفذش في: ميد شور: مرفوض للتجربة/);
 ({w,host,calls,tick}=await boot());card('موجات').querySelector('[data-pnr=other]').click();await tick();
 const q=card('موجات').querySelector('[data-pnr-other-q]');q.value='الحوض';q.dispatchEvent(new w.Event('input'));await tick();
 const res=[...card('موجات').querySelectorAll('.pnr-res')];assert.equal(res.length,1);assert.match(res[0].textContent,/0000102 · 500 ج/);
 res[0].click();await tick();const oth=calls.filter(c=>c[0]==='price_service_mapping_command');assert.equal(oth.length,2);assert.ok(oth.every(c=>c[1].p_payload.service_id==='s2'&&c[1].p_payload.action==='source_review'));
 // normalization parity with the server matcher
 const N=w.SSMPDPriceNameReview._norm;assert.equal(N('جبٌرة تحت الكوع )غير شامل المستلزمات('),N('جبيرة تحت الكوع'));assert.equal(N('شعة مقطعٌية'),N('اشعة مقطعية'));
 // nav: the third tab exists only for users who pass the price-list permission
 const nav=fs.readFileSync('assets/js/contract-navigation.js','utf8');assert.match(nav,/nameReview\?'<button type="button" data-name-review>مراجعة أسماء الجهات<\/button>'/);
 console.log('price-name-review-dom: OK');
})().catch(e=>{console.error(e);process.exit(1);});
