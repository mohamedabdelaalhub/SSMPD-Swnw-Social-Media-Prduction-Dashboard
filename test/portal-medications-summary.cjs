// patient-portal-medications: op "summary" (live drift brought into the repo) counts only
// medications of visits not hidden from the portal; empty patients get the zero summary.
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/patient-portal-medications/index.ts','utf8').replace(/^import .*;\n/gm,''));
const base={
 patient_accounts:[{id:'acc',status:'active',activation_completed_at:'2026-01-01',auth_user_id:'u1'}],
 patient_account_access:[{account_id:'acc',patient_id:'p1',verification_status:'approved'}],
 patient_visits:[{id:'v1',patient_id:'p1'},{id:'v2',patient_id:'p1'}],
 patient_portal_visibility:[{patient_id:'p1',entity_type:'visit',entity_id:'v2',portal_status:'hidden'}],
 patient_visit_medications:[
  {id:'m1',visit_id:'v1',start_date:'2026-11-01',start_time:'08:00',frequency_hours:12,duration_days:2},
  {id:'m2',visit_id:'v2',start_date:'2026-11-01',start_time:'08:00',frequency_hours:6,duration_days:5}],
 patient_medication_dose_completions:[
  {medication_id:'m1',status:'taken',taken_at:'2026-11-01T08:05:00Z'},{medication_id:'m1',status:'missed',taken_at:null},
  {medication_id:'m2',status:'taken',taken_at:'2026-11-03T08:00:00Z'}],
};
async function run(body,rows={}){
 let handler;const db={...base,...rows};
 const query=t=>{let data=db[t]||[];const q={select(){return q},eq(k,v){data=data.filter(r=>r[k]===v);return q},in(k,vs){data=data.filter(r=>vs.includes(r[k]));return q},
  order(){return q},maybeSingle(){return Promise.resolve({data:data[0]||null,error:null})},then(res,rej){return Promise.resolve({data,error:null}).then(res,rej)}};return q;};
 const ctx={Request,Response,console,Date,Intl,Set,Map,Array,JSON,Number,String,Math,
  Deno:{env:{get:()=>'x'},serve:f=>handler=f},createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'u1'}}})},from:query})};
 vm.runInNewContext(source,ctx);
 const r=await handler(new Request('https://t.invalid',{method:'POST',headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:JSON.stringify(body)}));
 return JSON.parse(JSON.stringify(await r.json()));
}
(async()=>{
 const s=await run({op:'summary'});
 assert.deepEqual(s,{total:4,taken:1,missed:1,last_taken_at:'2026-11-01T08:05:00Z'},'hidden visit v2 excluded; m1 = 2 days x 2/day');
 const all=await run({op:'summary'},{patient_portal_visibility:[]});
 assert.equal(all.total,4+20);assert.equal(all.taken,2);assert.equal(all.last_taken_at,'2026-11-03T08:00:00Z');
 const none=await run({op:'summary'},{patient_visits:[]});
 assert.deepEqual(none.summary,{total:0,taken:0,missed:0,last_taken_at:null});
 console.log('portal medications summary: OK');
})().catch(e=>{console.error(e);process.exit(1);});
