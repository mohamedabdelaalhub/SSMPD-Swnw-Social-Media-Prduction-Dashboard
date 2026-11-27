// «تشغيل اليوم» on phones (owner screenshot 2026-11-22): a long name + «متأخر 157 د» made a pill wider than the screen, the page
// scrolled sideways and the sticky top slid over the cards. Pills now shrink and the name ends with «…»; no page overflow at 360/390/412.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const css=['styles','dashboard-theme','reception-workspace','today-operations'].map(f=>fs.readFileSync('assets/css/'+f+'.css','utf8')).join('\n');
(async()=>{const b=await chromium.launch();try{for(const width of [360,390,412]){const p=await b.newPage({viewport:{width,height:900},timezoneId:'Africa/Cairo'});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="view-container" style="padding:12px"><main id="host"></main></div></body></html>');
 await p.addStyleTag({content:css});
 await p.evaluate(()=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const ago=m=>new Date(Date.now()-m*60000).toISOString();
  const ap=(id,name,q,mins,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'عيادة',service_name:'كشف',starts_at:ago(mins),queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:0,due_invoices:[]},extra||{});
  window.__m={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[
   ap('1','محمود عبد اللطيف عبد الفتاح الشربيني','waiting',60,{wait_minutes:44,visit_id:'v1'}),ap('2','عزه عبد الحميد مختار عبد الرحمن','expected',158),
   ap('3','شهاب الدين ابراهيم حامد السيد','completed',120,{visit_id:'v3',patient_due:1000,patient_payable_total:1000,due_invoices:[{id:'i3',invoice_no:'I3',due:1000}]}),ap('4','إخلاص عدنان أمين','cancelled',90)]};
  window.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};window.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
  window.SSMPDDb={client:{rpc:async n=>n==='clinic_reception_journey_hub_snapshot'?{data:JSON.parse(JSON.stringify(window.__m)),error:null}:{data:null,error:{message:'x'}}}};
  window.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};});
 for(const f of ['today-operations','today-operations-unified'])await p.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await p.evaluate(()=>{const host=document.querySelector('#host');host.innerHTML=window.SSMPDReceptionModules.panel('journey',{host,workspace:'ws1',data:{invoices:[]},modal:()=>null,field:()=>'',select:()=>''});});
 await p.waitForSelector('.journey-hour .journey-chip');
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways page scroll @'+width);
 const W=await p.evaluate(()=>document.documentElement.clientWidth);
 for(const c of await p.locator('.journey-hour .journey-chip').all()){const r=await c.boundingBox();assert(r.x>=0&&r.x+r.width<=W+0.5,'pill inside the screen @'+width);}
 const top=await p.locator('.journey-top').boundingBox();assert(top.width>=W-40,'sticky top spans the screen @'+width);
 assert(await p.locator('.journey-chip-name').first().evaluate(e=>getComputedStyle(e).textOverflow==='ellipsis'),'long name ends with «…»');
 assert.equal(await p.locator('.journey-top').evaluate(e=>getComputedStyle(e).position),'static','owner 2026-11-23: on phones the top scrolls away with the page @'+width);
 await p.setViewportSize({width:1280,height:900});assert.equal(await p.locator('.journey-top').evaluate(e=>getComputedStyle(e).position),'sticky','desktop keeps the sticky top');
 assert.deepEqual(errs,[]);await p.close();}}finally{await b.close();}
 console.log('PASS «تشغيل اليوم» phone fit 360/390/412: long names shorten with «…», pills stay inside the screen, no sideways page scroll, top full width; the top scrolls away on phones (sticky on desktop).');
})().catch(e=>{console.error(e);process.exit(1);});
