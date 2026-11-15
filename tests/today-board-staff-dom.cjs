// Owner 2026-11-15: names as small buttons that open the details; managers' «حجوزات الموظفين» filter (day / other day / period).
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
async function boot(role){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const later=new Date(Date.now()+90*60000).toISOString(),past=new Date(Date.now()-40*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,provider_id:'d1',provider_name:'د. سارة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[ap('1','شهاب الدين','expected',{starts_at:past}),ap('2','معتز','expected'),ap('3','كريم','waiting',{wait_minutes:35})]};
 const staffRows=[{id:'b1',created_at:new Date().toISOString(),created_by:'e1',created_by_name:'منى',patient_name:'مريض أ',file_no:'F9',provider_name:'د. يحيى',service_name:'كشف تغذية',starts_at:later,status:'booked'},{id:'b2',created_at:new Date().toISOString(),created_by:'e2',created_by_name:'هدى',patient_name:'مريض ب',provider_name:'د. يحيى',service_name:'متابعة',starts_at:later,status:'cancelled'}];
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role}};w.SSMPDRoles={rolesOf:()=>[role],hasRole:(a,r)=>r===role,hasAnyRole:(a,l)=>l.includes(role)};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args]);if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
  if(name==='clinic_reception_bookings_by_staff'){const rows=staffRows.filter(r=>!args.p_staff||r.created_by===args.p_staff);return {data:{from:args.p_from,to:args.p_to,staff:[{id:'e1',name:'منى',count:1},{id:'e2',name:'هدى',count:1}],rows},error:null};}
  return {data:null,error:{message:'unexpected '+name}};}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)];
 for(let n=0;n<200&&!q('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 return {w,q,qa,calls,errors,day,close:()=>dom.window.close()};
}
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 let {w,q,qa,calls,errors,day,close}=await boot('super_admin');
 // compact: only names visible, details hidden
 assert.deepEqual(qa('.journey-board .journey-chip').map(b=>b.textContent),['شهاب الدين','معتز','كريم']);
 assert(qa('.journey-board .journey-card-detail').every(d=>d.hidden),'details collapsed');
 assert(q('.journey-card[data-appointment="1"]').classList.contains('is-late'),'late marked by colour, no text');
 assert(q('.journey-card[data-appointment="3"]').classList.contains('is-long-wait'));
 q('[data-journey-open="1"]').click();
 assert.equal(q('.journey-card[data-appointment="1"] .journey-card-detail').hidden,false);assert.equal(q('[data-journey-open="1"]').getAttribute('aria-expanded'),'true');
 assert(q('.journey-card[data-appointment="1"] .journey-card-detail').textContent.includes('متأخر'));
 q('[data-journey-open="2"]').click();
 assert.equal(q('.journey-card[data-appointment="1"] .journey-card-detail').hidden,true,'one open at a time');assert.equal(q('.journey-card[data-appointment="2"] .journey-card-detail').hidden,false);
 q('[data-journey-open="2"]').click();assert(qa('.journey-board .journey-card-detail').every(d=>d.hidden),'tap again closes');
 // staff report
 assert(!q('[data-journey-staff]'));q('[data-staff-toggle]').click();await tick();
 let last=calls.filter(c=>c[0]==='clinic_reception_bookings_by_staff').pop();
 assert.deepEqual([last[1].p_from,last[1].p_to,last[1].p_staff],[day,day,null],'opens on today');
 assert.deepEqual(qa('[data-staff-pick]').map(b=>b.textContent),['منى1','هدى1']);
 assert.deepEqual(qa('[data-journey-staff] .journey-chip').map(b=>b.textContent),['مريض أ','مريض ب']);
 assert(qa('[data-journey-staff] .journey-card-detail').every(d=>d.hidden));
 q('[data-staff-open="b2"]').click();const det=q('[data-staff-row="b2"] .journey-card-detail');assert.equal(det.hidden,false);
 for(const t of ['د. يحيى','متابعة','ملغي','هدى','اتحجز امتى'])assert(det.textContent.includes(t),t);
 q('[data-staff-pick="e1"]').click();await tick();last=calls.filter(c=>c[0]==='clinic_reception_bookings_by_staff').pop();
 assert.equal(last[1].p_staff,'e1');assert.deepEqual(qa('[data-journey-staff] .journey-chip').map(b=>b.textContent),['مريض أ']);assert.equal(q('[data-staff-who]').value,'e1');
 q('[data-staff-range="yesterday"]').click();await tick();last=calls.filter(c=>c[0]==='clinic_reception_bookings_by_staff').pop();
 assert.equal(last[1].p_from,last[1].p_to);assert(last[1].p_from<day);assert.equal(last[1].p_staff,'e1','employee kept');
 const from=q('[data-staff-from]');from.value='2026-11-01';from.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 const to=q('[data-staff-to]');to.value='2026-11-10';to.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 last=calls.filter(c=>c[0]==='clinic_reception_bookings_by_staff').pop();assert.deepEqual([last[1].p_from,last[1].p_to],['2026-11-01','2026-11-10'],'custom period');
 const who=q('[data-staff-who]');who.value='';who.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 last=calls.filter(c=>c[0]==='clinic_reception_bookings_by_staff').pop();assert.equal(last[1].p_staff,null);
 q('[data-staff-close]').click();assert(!q('[data-journey-staff]'));
 assert.deepEqual(errors,[]);close();
 // reception: no staff report button
 ({q,errors,close}=await boot('reception'));assert(!q('[data-staff-toggle]'),'reception has no staff report');assert(q('.journey-board .journey-chip'));assert.deepEqual(errors,[]);close();
 console.log('PASS today board compact names (tap to open, one at a time, late/wait by colour) + managers-only «حجوزات الموظفين»: today default, per-employee, yesterday, custom period, details on tap.');
})().catch(e=>{console.error(e);process.exit(1);});
