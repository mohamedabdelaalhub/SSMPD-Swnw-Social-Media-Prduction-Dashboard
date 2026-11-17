// DOM test (owner 2026-11-17): accounts without reception rights get «اطلب صلاحية الاستقبال من الإدارة» instead of raw server errors —
// on load, when saving a booking, and in the archive search.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
const DENY='ليس لديك صلاحية هذه المساحة';
async function boot(snapshotDenied){const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window;Object.defineProperty(w,'crypto',{value:webcrypto});
 w.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};w.SSMPDRoles={canSeeTab:t=>t!=='accounting'};
 const snap={workspace:{id:'w',mode:'live'},can_manage:false,patients:[{id:'pt',file_no:'1',name:'مريض',archive_patient_id:'a1'}],services:[{id:'s1',code:'C',name:'كشف',department:'الجلدية',price:500,minutes:20}],providers:[{id:'as',name:'د. أحمد',department:'الجلدية'}],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
 w.SSMPDDb={receptionWorkspaces:async()=>[{id:'w',mode:'live'}],receptionBootstrap:async()=>'w',receptionSnapshot:async()=>{if(snapshotDenied)throw new Error(DENY);return JSON.parse(JSON.stringify(snap));},
  receptionCommand:async()=>{throw new Error(DENY);},receptionDirectory:async()=>{throw new Error(DENY);},client:{rpc:async()=>({data:null})}};
 for(const f of ['reception-patient-search','reception-workspace'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const q=s=>w.document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();return {w,q,sleep};}
(async()=>{
 let {q}=await boot(true);
 assert(q('.rx-access-card')&&q('.rx-access-card h3').textContent==='اطلب صلاحية الاستقبال من الإدارة','load: friendly card');assert(!q('.rx-error'),'no raw error');
 ({w:globalThis.w,q}=await boot(false));const {sleep}={sleep:ms=>new Promise(r=>setTimeout(r,ms))};
 q('[data-rx-section="appointments"]').click();await sleep(60);q('[data-rx-action="book"]').click();await sleep(30);
 const s=q('.rx-modal [data-archive-search]');s.value='هويدا';s.dispatchEvent(new w.Event('input'));await sleep(400);
 assert(q('.rx-modal [data-archive-status]').textContent.includes('اطلب صلاحية الاستقبال من الإدارة')&&!q('.rx-modal [data-archive-status]').textContent.includes(DENY),'archive search: friendly');
 const set=(n,v)=>{const e=q('.rx-modal [name="'+n+'"]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};set('patient_id','pt');set('service_id','s1');set('provider_id','as');
 const cb=q('.rx-modal [name=walk_in]');cb.checked=true;cb.dispatchEvent(new w.Event('change'));q('.rx-modal form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(60);
 assert.equal(q('.rx-modal [data-rx-status]').textContent,'حسابك مالوش صلاحية الاستقبال في المساحة دي. اطلب صلاحية الاستقبال من الإدارة.','save: friendly');
 console.log('PASS reception access message: load card, archive search and save show «اطلب صلاحية الاستقبال من الإدارة» instead of raw errors.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
