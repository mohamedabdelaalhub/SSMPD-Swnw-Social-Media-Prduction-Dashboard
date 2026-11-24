// DOM: «العروض» — offer lists only in their tab; «إنشاء قائمة» there opens an offer (fixed, dated) and saves through
// price_lists_command 'save' with list_kind 'offer'; no «مرجع خدمات المركز» card on an offer; English digits.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window,d=w.document,calls=[];
w.confirm=()=>false;w.SSMPDAuth={currentAdmin:{id:'owner'}};w.SSMPDRoles={canModuleAction:()=>true};w.SSMPDToast={show:()=>{}};
const base={status:'draft',created_by:'owner',can_edit:true,can_clone:true,revision:1,version:1,issue_year:2026,application_year:2026,mode:'fixed',fallback:'base'};
const lists=[Object.assign({id:'c',name:'قائمة أسعار سونو / دار النقاهة',list_kind:'center',valid_from:'2026-10-24',valid_to:'2026-12-31'},base,{status:'active'}),
 Object.assign({id:'o',name:'عرض وايت فرايداي ليزر',list_kind:'offer',valid_from:'2026-11-27',valid_to:'2026-12-03'},base),
 Object.assign({id:'r',name:'قائمة أسعار ميد نت',list_kind:'reference',valid_from:'2026-01-01',valid_to:'2026-12-31'},base)];
const data={lists,items:[{id:'i1',list_id:'o',service_id:'s1',fixed_price:140,section_id:null}],sections:[],contracts:[],services:[{id:'s1',name:'جلسة ليزر إزالة الشعر لمنطقة الوجه كانديلا',canonical_code:'0001239',category:'الجلدية والتجميل',base_price:150,active:true}],aliases:[],proposals:[]};
w.SSMPDDb={client:{rpc:async(fn,args)=>{calls.push([fn,args]);if(fn==='price_lists_workspace')return {data};if(fn==='price_import_workspace')return {data:{batches:[],audit:[]}};if(fn==='price_master_workspace')return {data:null};return {data:'ok'};}}};
let masterCalls=0;
for(const n of ['workforce-prices','price-import-reader','service-mapping-review','service-search-picker','price-list-governance','contract-price-workspace','center-master-review'])w.eval(fs.readFileSync('assets/js/'+n+'.js','utf8'));
const orig=w.SSMPDMasterReview.enhance;w.SSMPDMasterReview.enhance=function(){masterCalls++;return orig.apply(this,arguments);};
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,0));},host=d.querySelector('main');
await w.SSMPDContractPrices.render(host,'offers',{});await tick();
assert.match(host.textContent,/عرض وايت فرايداي ليزر/);assert.doesNotMatch(host.textContent,/قائمة أسعار سونو \/ دار النقاهة/);assert.doesNotMatch(host.textContent,/ميد نت/);
host.innerHTML='';await w.SSMPDContractPrices.render(host,'center',{});await tick();assert.doesNotMatch(host.textContent,/وايت فرايداي/,'offers are not in the center tab');
// «إنشاء قائمة» from the offers tab
host.innerHTML='';await w.SSMPDContractPrices.render(host,'offers',{});await tick();
host.querySelector('[data-pi=new]').click();await tick();
const f=d.querySelector('.wp-overlay form, .modal form, form');assert.ok(f,'editor form');
assert.equal(f.elements.list_kind.value,'offer');assert.ok(f.elements.mode.closest('label').hidden,'mode hidden for offers');assert.equal(f.elements.mode.value,'fixed');
assert.match(f.elements.valid_from.closest('label').textContent,/بداية العرض/);assert.match(f.elements.valid_to.closest('label').textContent,/آخر يوم في العرض/);
f.elements.name.value='عرض اختبار';f.elements.valid_from.value='2026-11-27';f.elements.valid_to.value='2026-12-03';
f.requestSubmit?f.requestSubmit():f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
const save=calls.find(c=>c[0]==='price_lists_command'&&c[1].p_action==='save');assert.ok(save,'save RPC sent');
assert.equal(save[1].p_payload.list_kind,'offer');assert.equal(save[1].p_payload.mode,'fixed');assert.equal(save[1].p_payload.valid_to,'2026-12-03');assert.equal(save[1].p_payload.id,null);
// open the offer: no master-reference card
host.innerHTML='';masterCalls=0;await w.SSMPDContractPrices.render(host,'offers',{});await tick();
const open=host.querySelector('[data-pi=open][data-id=o]');assert.ok(open,'offer row can be opened');open.click();await tick();assert.match(host.textContent,/نظرة عامة|الخدمات والأسعار/);
assert.equal(host.querySelectorAll('.wn-master-card').length,0,'no «مرجع خدمات المركز» on an offer');
assert.ok(!/[٠-٩]/.test(host.textContent),'English digits only');
const nav=fs.readFileSync('assets/js/contract-navigation.js','utf8');assert.match(nav,/<button type="button" data-offer-lists>العروض<\/button>/);assert.match(nav,/render\(view\.querySelector\('\[data-prices-host\]'\),'offers',\{\}\)/);
console.log('offer-price-lists-dom: OK');})().catch(e=>{console.error(e);process.exit(1);});
