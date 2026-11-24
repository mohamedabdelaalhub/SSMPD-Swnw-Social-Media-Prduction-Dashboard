// Owner 2026-11-24 21:28Z: customer service sees «إدارة الليدز والتواصل» → «الاستقبال» («استقبال رسالة جديدة») WITHOUT the
// reception role. Clicked as customer_service (live): the form saves through leads-create, whose server gate already allows
// customer_service (supabase/functions/leads-create/index.ts — asserted below); the stub applies that same gate.
// Reception-only «رفع ملف إكسيل» stays hidden; a role with neither stays without the sub-tab.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const edge=fs.readFileSync('supabase/functions/leads-create/index.ts','utf8');
const gate=(edge.match(/const allowed = roleIn\(caller, (\[[^\]]+\])\)/)||[])[1];assert(gate,'leads-create role gate moved; update this test');
const allowed=JSON.parse(gate.replace(/'/g,'"'));assert(allowed.includes('customer_service'),'server allows customer_service');
async function boot(role,extra){
 const dom=new JSDOM('<main id="c"></main>',{url:'https://x.test/',runScripts:'outside-only'}),w=dom.window,errors=[],calls=[],toasts=[];
 w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDAuth={currentAdmin:{id:'u1',role,roles:[role].concat(extra||[]),active:true}};
 w.eval(fs.readFileSync('assets/js/roles.js','utf8'));   // the real role helpers (primary + extra roles)
 const leads=[];
 w.SSMPDDb={listEmployees:async()=>({employees:[]}),listLeads:async()=>({leads:leads.slice(),total:leads.length}),getLeadsStats:async()=>({}),listLeadArchive:async()=>({leads:[]}),
  getLeadRegistrationStats:async()=>({}),
  createLead:async p=>{calls.push(['leads-create',p]);if(![role].concat(extra||[]).some(x=>allowed.includes(x))){const e=new Error('مفيش صلاحية موديول الليدز');e.status=403;throw e;}
   leads.unshift({id:'l'+leads.length,customer_name:p.customer_name,phone_raw:p.phone,source:p.source,current_status:'new',created_at:new Date().toISOString()});return {lead:leads[0]};}};
 const db=w.SSMPDDb;w.SSMPDDb=new Proxy(db,{get:(t,k)=>k in t?t[k]:async()=>({})});
 w.eval(fs.readFileSync('assets/js/render-leads.js','utf8'));
 const c=w.document.querySelector('#c');w.SSMPDRenderLeads.render(c);await new Promise(r=>setTimeout(r,30));
 return {w,c,errors,calls,toasts,subs:[...c.querySelectorAll('[data-sub]')].map(b=>b.dataset.sub)};
}
(async()=>{
 const cs=await boot('customer_service');
 assert(cs.subs.includes('reception'),'customer service sees «الاستقبال»');assert(!cs.subs.includes('bulk'),'«رفع ملف إكسيل» stays reception-only');
 assert.equal(cs.c.querySelector('.tab-btn.active').dataset.sub,'cs','customer service still opens on «خدمة العملاء»');
 cs.c.querySelector('[data-sub="reception"]').click();await new Promise(r=>setTimeout(r,30));
 assert.match(cs.c.textContent,/استقبال رسالة جديدة/);
 const d=cs.w.document;d.getElementById('nl-name').value='عميل تجربة';d.getElementById('nl-phone').value='01000000000';
 d.getElementById('nl-save').click();await new Promise(r=>setTimeout(r,30));
 assert.equal(cs.calls.length,1);assert.equal(cs.calls[0][1].customer_name,'عميل تجربة');
 assert.deepEqual(cs.toasts.pop(),['اتضاف الليد بنجاح',undefined]);assert.match(d.getElementById('nl-recent').textContent,/عميل تجربة/);
 assert.deepEqual(cs.errors,[]);
 // live: no active admin has customer_service as PRIMARY role — it is an EXTRA role (main chat 5)
 const ex=await boot('page_manager',['customer_service']);assert(ex.subs.includes('reception'),'extra-role customer service sees «الاستقبال»');
 ex.c.querySelector('[data-sub="reception"]').click();await new Promise(r=>setTimeout(r,30));const d2=ex.w.document;d2.getElementById('nl-name').value='عميل 2';d2.getElementById('nl-phone').value='01000000001';d2.getElementById('nl-save').click();await new Promise(r=>setTimeout(r,30));assert.equal(ex.calls.length,1,'extra-role CS saves');assert.deepEqual(ex.errors,[]);
 const rec=await boot('reception');assert(rec.subs.includes('reception')&&rec.subs.includes('bulk'),'reception unchanged');
 const des=await boot('designer');assert(!des.subs.includes('reception'),'other roles: no intake');
 console.log('PASS customer service intake: «الاستقبال» sub-tab shown to customer_service (opens on «خدمة العملاء»), «حفظ الليد» → leads-create (server gate allows customer_service) → saved + listed; bulk stays reception-only; reception unchanged; others hidden.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
