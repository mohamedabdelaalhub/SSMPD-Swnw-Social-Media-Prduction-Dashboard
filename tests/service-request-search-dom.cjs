// «طلب خدمة أثناء الزيارة» end to end in the DOM, as reception on the LIVE today board: click «طلب خدمة» → the real V3 modal opens
// with the search box → type → the service is chosen → «حفظ» sends clinic_reception_journey_request_service with that service.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<!doctype html><body><div data-journey-root><button data-journey-action="request_service" data-id="ap1">طلب خدمة</button></div></body>',{runScripts:'outside-only'});
const w=dom.window,d=w.document,tick=(n=30)=>new Promise(r=>setTimeout(r,n));
(async()=>{
 const services=[];for(let i=0;i<2500;i++)services.push({id:'s'+i,name:'خدمة '+i,code:'C'+i,department:'باقي التحاليل',active:true});
 services.push({id:'cbc',name:'صورة دم كاملة CBC',code:'0001001',department:'التحاليل',active:true});
 const calls=[];
 w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);return Promise.resolve({data:{ok:true},error:null});}}};
 w.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};
 let saveFn=null;const ctx={workspace:'ws1',data:{services},modal:(title,body,save)=>{const m=d.createElement('div');m.className='rx-modal';m.innerHTML='<h3>'+title+'</h3><form>'+body+'<button type="submit">حفظ</button></form>';d.body.appendChild(m);saveFn=()=>save(Object.fromEntries(new w.FormData(m.querySelector('form'))));return m;}};
 w.SSMPDReceptionModules={panel:()=>''};
 for(const f of ['service-select-search','today-operations-service-request-v3'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 await tick(300);w.SSMPDReceptionModules.panel('journey',ctx);
 d.querySelector('[data-journey-action="request_service"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await tick(80);
 const m=d.querySelector('.rx-modal');assert(m,'modal opened');assert.match(m.textContent,/طلب خدمة أثناء الزيارة/);
 const q=m.querySelector('[data-sss-q]');assert(q,'the service list has the search box');
 const sel=m.querySelector('select[name="service_id"]');assert(sel.options.length>2000,'thousands of services behind it');
 q.value='صوره دم';q.dispatchEvent(new w.Event('input'));assert.equal(sel.value,'cbc');
 q.value='0001001';q.dispatchEvent(new w.Event('input'));assert.equal(sel.value,'cbc','by code');
 await saveFn();const c=calls.find(x=>x[0]==='clinic_reception_journey_request_service');
 assert(c,'request sent');assert.equal(c[1].p_service,'cbc');assert.equal(c[1].p_appointment,'ap1');assert.equal(c[1].p_workspace,'ws1');
 console.log('PASS «طلب خدمة أثناء الزيارة» (reception, live board): search box on the real modal, find by name / code among 2,500 services, «حفظ» sends the chosen service');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
