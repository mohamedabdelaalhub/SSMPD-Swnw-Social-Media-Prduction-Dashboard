// DOM test (owner 2026-11-17): «إجازة أو تغيير مؤقت لدكتور» — settings button, off by default, hours fields only for «ساعات مختلفة»,
// sends the exact payload, shows the affected bookings to call, lists coming exceptions and cancels one.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};w.confirm=()=>true;const toasts=[];w.SSMPDToast={show:m=>toasts.push(m)};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[],services:[],providers:[{id:'as',name:'د. أحمد سمير',department:'الجلدية'}],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
const rpcs=[];let list=[{id:'e1',provider_id:'as',provider_name:'د. أحمد سمير',from:'2026-12-01',to:'2026-12-07',kind:'hours',slots:[{starts:'20:00',ends:'23:00'}],reason:'تغيير <b>x</b>'}];
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async()=>({id:'n'}),
 client:{rpc:async(n,a)=>{assert.equal(n,'clinic_reception_schedule_exception');rpcs.push(JSON.parse(JSON.stringify(a)));if(a.p_action==='list')return {data:{exceptions:list}};if(a.p_action==='add')return {data:{id:'e2',removed:3,added:0,affected:[{id:'ap1',starts_at:'2026-12-02T08:00:00Z',patient:'منى',phone:'0100'}]}};if(a.p_action==='cancel'){list=[];return {data:{id:a.p_payload.id}};}}}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));const q=s=>w.document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();
q('[data-rx-section="settings"]').click();await sleep(30);const b=q('[data-rx-action="schedule-exception"]');assert(b&&b.textContent==='إجازة أو تغيير مؤقت لدكتور');b.click();await sleep(40);
const f=q('.rx-modal form');assert.equal(f.elements.kind.value,'off');assert(q('[data-exc-hours]').hidden,'hours hidden for off');
assert(q('[data-exc-list]').textContent.includes('د. أحمد سمير')&&q('[data-exc-list]').textContent.includes('20:00–23:00')&&!q('[data-exc-list] b b'),'list shown, escaped');
f.elements.kind.value='hours';f.elements.kind.dispatchEvent(new w.Event('change'));assert(!q('[data-exc-hours]').hidden);
f.elements.provider_id.value='as';f.elements.from.value='2026-12-01';f.elements.to.value='2026-12-03';f.elements.reason.value='سفر مؤتمر';
q('[data-exc-from="1"]').value='18:00';f.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(30);
assert(q('.rx-modal [role=alert]')?.textContent.includes('أكمل')||!rpcs.some(r=>r.p_action==='add'),'half-filled period refused');
q('[data-exc-to="1"]').value='21:00';f.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(120);
const add=rpcs.find(r=>r.p_action==='add');assert.deepEqual(add.p_payload,{provider_id:'as',from:'2026-12-01',to:'2026-12-03',kind:'hours',slots:[{starts:'18:00',ends:'21:00'}],reason:'سفر مؤتمر'});
assert(toasts.some(t=>t.includes('1 حجز')),'toast says bookings to call');const m=q('.rx-modal');assert(m&&m.textContent.includes('منى')&&m.textContent.includes('حجوزات محتاجة تتغيّر'),'affected bookings listed');
const c=m.querySelector('[data-rx-cancel],.modal-close');if(c)c.click();await sleep(20);
q('[data-rx-action="schedule-exception"]').click();await sleep(40);q('[data-exc-cancel="e1"]').click();await sleep(40);
assert(rpcs.some(r=>r.p_action==='cancel'&&r.p_payload.id==='e1'));assert(q('[data-exc-list]').textContent.includes('مفيش استثناءات'));
assert.deepEqual(errors,[]);console.log('PASS schedule exceptions UI: settings button, off default, hours fields, exact payload, affected bookings shown, list + cancel.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
