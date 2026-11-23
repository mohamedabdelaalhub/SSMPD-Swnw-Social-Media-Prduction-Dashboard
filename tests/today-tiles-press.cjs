// Hotfix 2026-11-23 (owner, live: «الأطباء النهارده / الغرف والطابور / حجوزات آلية / مكالمات / رسائل / إدارة الغرف» did nothing):
// ui-motion.js marks a pressed button («fx-pressed» + ripple). today-shortcuts compared its tiles HTML with host.innerHTML, so during
// a human-speed press any page mutation rewrote the row and the pressed tile was detached → no click. A 150 ms press must open the sheet.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{const p=await b.newPage({viewport:{width:390,height:844},timezoneId:'Africa/Cairo'}),errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><main id="host"></main><i id="busy"></i></body></html>');
 await p.addStyleTag({content:['styles','today-operations','today-shortcuts'].map(f=>fs.readFileSync('assets/css/'+f+'.css','utf8')).join('\n')});
 await p.evaluate(()=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const ap=(id,pv)=>({id,patient_id:'p'+id,patient_name:'مريض '+id,file_no:'F'+id,phone:'0100',provider_id:pv,provider_name:'د. '+pv,department:'عيادة',service_name:'كشف',starts_at:new Date(Date.now()+36e5).toISOString(),queue_status:'expected',priority:0,wait_minutes:0,can_view_finance:false,patient_due:0,due_invoices:[]});
  const m={day,settings:{},doctor_sessions:[],help_requests:[],events:[],outbox:[{id:'o1',target_role:'patient',status:'draft'}],appointments:[ap('1','d1'),ap('2','d2')]};
  window.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};window.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
  window.SSMPDDb={client:{rpc:async n=>n==='clinic_reception_journey_hub_snapshot'?{data:JSON.parse(JSON.stringify(m)),error:null}:n==='clinic_reception_auto_booking'?{data:{bookings:[]},error:null}:{data:{bookings:[]},error:null},functions:{invoke:async()=>({data:{requests:[]}})}}};
  window.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
  setInterval(()=>{document.getElementById('busy').textContent=Date.now();},16);/* a live page mutates all the time */});
 for(const f of ['ui-motion','today-operations','today-shortcuts','today-auto-bookings'])await p.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await p.evaluate(()=>{const host=document.querySelector('#host');host.innerHTML=window.SSMPDReceptionModules.panel('journey',{host,workspace:'ws1',data:{providers:[]},modal:()=>null,field:()=>'',select:()=>''});});
 await p.waitForSelector('.tds-tile[data-tds-tile="doctors"]');await p.waitForSelector('.tds-tile[data-tds-tile="auto"]');
 for(const k of ['doctors','auto','outbox'])for(let i=0;i<3;i++){const t=await p.locator('.tds-tile[data-tds-tile="'+k+'"]').boundingBox();
  await p.mouse.move(t.x+t.width/2,t.y+t.height/2);await p.mouse.down();await p.waitForTimeout(150);await p.mouse.up();
  await p.waitForFunction(k=>document.querySelector('[data-journey-root]').dataset.tdsOpen===k,k,{timeout:2000}).catch(()=>{throw new Error('a 150 ms press on «'+k+'» did not open its sheet (dead tap)');});
  await p.evaluate(()=>SSMPDTodayShortcuts.close());await p.waitForTimeout(120);}
 assert.deepEqual(errs,[]);}finally{await b.close();}
 console.log('PASS today tiles press: human-speed (150 ms) presses open «الأطباء النهارده», «حجوزات آلية» and «رسائل…» while the page keeps changing (ui-motion press state no longer rewrites the tiles).');
})().catch(e=>{console.error(e);process.exit(1);});
