const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const b=await require('./helpers/journey-sandbox.cjs')(),{db,owner,as,call,id}=b;
 await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('Live unchanged','live',$1)",[id(1)]);await as(1);
 const dom=new JSDOM('<main id="root"></main>',{url:'https://journey.test/',runScripts:'outside-only'}),w=dom.window,requests=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:id(1),role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
 async function rpc(name,args={}){requests.push({name,args});if(name==='clinic_reception_calls_snapshot_live')return {data:[],error:null};try{const entries=Object.entries(args),sql='select public.'+name+'('+entries.map(([k],i)=>k+'=>$'+(i+1)).join(',')+') v';return {data:(await db.query(sql,entries.map(x=>x[1]))).rows[0].v,error:null};}catch(e){return {data:null,error:{message:e.message}};}}
 w.SSMPDDb={client:{rpc},receptionWorkspaces:()=>call('clinic_reception_workspaces'),receptionBootstrap:()=>call('clinic_reception_bootstrap'),receptionSnapshot:(a,f,t)=>call('clinic_reception_snapshot',[a,f,t]),receptionCommand:(a,n,p,k)=>call('clinic_reception_command',[a,n,p,k])};
 for(const file of ['reception-workspace','today-operations-sandbox','today-operations','today-operations-calls','today-operations-display'])w.eval(fs.readFileSync('assets/js/'+file+'.js','utf8'));
 const q=s=>w.document.querySelector(s),click=s=>{const e=q(s);assert(e,'Missing '+s);e.click();},wait=async fn=>{for(let n=0;n<250;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed: '+w.document.body.textContent);};
 await new Promise(r=>setTimeout(r,5));w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section="journey"]'));if(q('[data-guide-skip]'))click('[data-guide-skip]');
 click('[data-rx-section="journey"]');await wait(()=>q('[data-journey-action="sandbox_enter"]'));
 click('[data-journey-action="sandbox_enter"]');await wait(()=>q('[data-journey-mode="trial"] [data-journey-action="sandbox_book"]'));
 assert(!q('[data-tv-checkin-display]'));assert(!q('[data-journey-action="static_qr"]'));
 const trialStart=requests.length;await new Promise(r=>setTimeout(r,3100));assert(!requests.slice(trialStart).some(r=>r.name.includes('calls_snapshot_live')));
 click('[data-journey-action="sandbox_book"]');const times=q('.rx-modal [name="starts_at"]');times.value=times.options[1].value;click('.rx-modal [type=submit]');await wait(()=>!q('.rx-modal')&&q('[data-journey-action="on_the_way"]'));
 click('[data-journey-action="on_the_way"]');await wait(()=>q('.journey-badge-on_the_way'));
 click('[data-journey-action="arrive"]');click('.rx-modal [type=submit]');await wait(()=>!q('.rx-modal')&&q('[data-journey-action="call"]'));
 click('[data-journey-action="call"]');await wait(()=>q('[data-journey-action="consultation_start"]'));click('[data-journey-action="consultation_start"]');await wait(()=>q('[data-journey-action="visit_detail"]'));
 click('[data-journey-action="visit_detail"]');click('[data-sandbox-order="execute"]');await wait(()=>q('[data-sandbox-orders]').textContent.includes('تم التنفيذ'));click('[data-rx-cancel]');
 click('[data-journey-action="visit_complete"]');click('.rx-modal [type=submit]');await wait(()=>!q('.rx-modal')&&q('[data-journey-action="sandbox_feedback"]'));
 click('[data-journey-action="sandbox_feedback"]');q('[name="comment"]').value='تقييم من الواجهة';click('.rx-modal [type=submit]');await wait(()=>!q('.rx-modal'));
 click('[data-journey-action="sandbox_messages"]');await wait(()=>q('.journey-sandbox-messages').textContent.includes('تمت المحاكاة'));
 assert(!requests.slice(trialStart).some(r=>r.name==='clinic_reception_journey_command'||r.name.includes('communications')||r.name.includes('display_session')));
 click('[data-journey-action="sandbox_exit"]');await wait(()=>q('[data-journey-mode="live"] [data-journey-action="sandbox_enter"]'));assert(!q('[data-journey-root]').textContent.includes('مريض تجربة'));
 click('[data-journey-action="sandbox_enter"]');await wait(()=>q('.journey-badge-completed'));assert.deepEqual(errors,[]);
 dom.window.close();await db.close();console.log('PASS Journey UI + PostgreSQL: enter/exit, booking, arrival, queue, execution, completion, feedback, persisted trial, simulated messages, no live TV/calls/writes.');
})().catch(e=>{console.error(e);process.exit(1);});
