// Owner 2026-11-25 «الليدز تشوف كلها»: an active admin with has_leads_archive_access sees and works ALL leads (like reception).
// Runs the REAL edge function code (TypeScript transpiled) against a recording fake Supabase client:
//   leads-list: grant holder (customer_service extra role) → no assigned_to filter; plain customer_service → assigned_to = me;
//               grant holder with no leads role (page_manager only) → allowed.
//   leads-update-status / leads-attempt / leads-update-details / lead-invoice-upload / leads-complete-missing-data:
//               a lead assigned to someone else → grant holder passes the scope check, plain customer_service gets 403.
const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(name,state){
 const src=fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8');
 const js=ts.transpileModule(src,{compilerOptions:{target:99,module:1}}).outputText;
 let handler=null;
 const fakeClient=()=>{const mk=(table)=>{const q={table,calls:[]};const b=new Proxy({},{get(_,k){
   if(k==='then'){return (res,rej)=>Promise.resolve(answer(q)).then(res,rej);}
   return (...a)=>{q.calls.push([k,...a]);if(k==='maybeSingle'||k==='single')return Promise.resolve(answer(q,true));return b;};}});state.queries.push(q);return b;};
  return {auth:{getUser:()=>Promise.resolve({data:{user:{id:'user-'+state.caller.id}},error:null})},from:mk,
   rpc:(n,a)=>{state.rpcs.push([n,a]);const r={data:{id:a.p_lead_id||'x'},error:null};return Object.assign(Promise.resolve(r),{single:()=>Promise.resolve(r),maybeSingle:()=>Promise.resolve(r)});},
   storage:{from:()=>({upload:()=>Promise.resolve({data:{path:'p'},error:null}),createSignedUrl:()=>Promise.resolve({data:{signedUrl:'u'},error:null})})}};};
 function answer(q,single){
  if(q.table==='admins')return {data:single?state.caller:[state.caller],error:null};
  if(q.table==='leads')return single?{data:{id:'L1',assigned_to:'someone-else',current_status:'new',patient_id:null,patient_type:null,phone_normalized:'01000000000',customer_name:'x',phone_raw:'0100'},error:null}:{data:[],error:null,count:0};
  return {data:single?null:[],error:null,count:0};}
 const req=(m)=>{if(m==='npm:@supabase/supabase-js@2')return {createClient:()=>fakeClient()};return {};};
 const Deno={env:{get:k=>({SUPABASE_URL:'https://x.test',SUPABASE_SERVICE_ROLE_KEY:'s',SUPABASE_ANON_KEY:'a'})[k]||''},serve:h=>{handler=h;}};
 new Function('require','exports','Deno',js)(req,{},Deno);
 return handler;}
const ZEINA={id:'zeina',role:'page_manager',active:true,has_leads_archive_access:true,admin_extra_roles:[{role:'customer_service'}]};
const CS={id:'cs1',role:'customer_service',active:true,has_leads_archive_access:false,admin_extra_roles:[]};
const GRANT_ONLY={id:'pm1',role:'page_manager',active:true,has_leads_archive_access:true,admin_extra_roles:[]};
const NONE={id:'pm2',role:'page_manager',active:true,has_leads_archive_access:false,admin_extra_roles:[]};
async function call(name,caller,method,body,qs){const state={caller,queries:[],rpcs:[]};const h=load(name,state);
 const r=await h(new Request('https://x.test/functions/v1/'+name+(qs||''),{method,headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));
 return {status:r.status,body:await r.json().catch(()=>null),state};}
const leadsQuery=st=>st.queries.find(q=>q.table==='leads'&&q.calls.some(c=>c[0]==='range'||c[0]==='order'));
(async()=>{
 // leads-list
 let r=await call('leads-list',ZEINA,'GET');assert.equal(r.status,200,JSON.stringify(r.body));
 assert(!leadsQuery(r.state).calls.some(c=>c[0]==='eq'&&c[1]==='assigned_to'),'grant holder: all leads');
 r=await call('leads-list',CS,'GET');assert.equal(r.status,200);
 assert(leadsQuery(r.state).calls.some(c=>c[0]==='eq'&&c[1]==='assigned_to'&&c[2]==='cs1'),'plain CS: assigned only');
 r=await call('leads-list',GRANT_ONLY,'GET');assert.equal(r.status,200,'grant without a leads role is allowed');
 assert(!leadsQuery(r.state).calls.some(c=>c[0]==='eq'&&c[1]==='assigned_to'));
 r=await call('leads-list',NONE,'GET');assert.equal(r.status,403,'no role, no grant');
 r=await call('leads-list',ZEINA,'GET',null,'?stats=1');assert.equal(r.status,403,'management dashboard stays managers only');
 // writes on a lead assigned to someone else
 const writes=[['leads-update-status',{lead_id:'L1',current_status:'in_progress'}],['leads-attempt',{lead_id:'L1',result:'no_answer'}]];
 for(const [fn,body] of writes){
  r=await call(fn,ZEINA,'POST',body);assert.notEqual(r.status,403,fn+' grant holder: '+JSON.stringify(r.body));assert(r.status<400,fn+' '+r.status+' '+JSON.stringify(r.body));
  r=await call(fn,CS,'POST',body);assert.equal(r.status,403,fn+' plain CS on another lead');}
 r=await call('leads-update-status',ZEINA,'POST',{lead_id:'L1',current_status:'in_progress'});assert.deepEqual(r.state.rpcs.map(x=>[x[0],x[1].p_caller_id,x[1].p_current_status]),[['rpc_update_lead','zeina','in_progress']]);
 // the other scoped functions: grant passes the scope check (whatever happens after), plain CS is refused with the scope message
 for(const fn of ['leads-update-details','lead-invoice-upload','leads-complete-missing-data']){
  const src=fs.readFileSync('supabase/functions/'+fn+'/index.ts','utf8');assert.match(src,/has_leads_archive_access/,fn+' loads the flag');assert.match(src,/hasLeadsGrant\(caller\)/,fn+' uses the grant');}
 assert.match(fs.readFileSync('supabase/functions/leads-complete-missing-data/index.ts','utf8'),/from\("lead_activity_log"\)\.insert\(\{\s*admin_id: caller\.id, action: "complete_missing_data"/,'«إكمال البيانات» logged with who');
 console.log('PASS leads archive grant (real edge code): grant holder lists ALL leads (no assigned_to filter), even without a leads role; plain customer_service still assigned-only; no role/no grant 403; management stats stay managers-only; status update + attempt on a lead assigned to someone else work for the grant holder (rpc_update_lead as her) and are refused for plain customer_service.');
})().catch(e=>{console.error(e);process.exit(1);});
