const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/patient-portal-nutrition/index.ts','utf8').replace(/^import .*;\n/gm,''));
const id='11111111-1111-4111-8111-111111111111';
async function run(body={},opts={}){
 let handler,writes=[],reads=[];
 const db={patient_accounts:[{id:'a',auth_user_id:'u',status:'active',activation_completed_at:'2026-01-01',...opts.account}],patient_account_access:[{account_id:'a',patient_id:'p',verification_status:'approved',...opts.access}],patient_nutrition_visits:[{id,patient_id:opts.patient||'p',meals:[{id:'meal',name:'Breakfast'}]}],patient_nutrition_meal_completions:[]};
 function from(table){let rows=db[table]||[],write=null;const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q},order(){return q},range(a,b){rows=rows.slice(a,b+1);return q},upsert(data,options){assert.equal(options.onConflict,'visit_id,meal_id');write=data;writes.push({table,data});return q},insert(data){writes.push({table,data});return q},maybeSingle(){return Promise.resolve({data:rows[0]||null})},single(){return Promise.resolve({data:{id:'completion',...write},error:opts.writeError?{code:'FAIL'}:null})},then(resolve,reject){reads.push(table);return Promise.resolve({data:rows,error:opts.auditError&&table==='patient_portal_audit_log'?{code:'FAIL'}:null}).then(resolve,reject)}};return q;}
 vm.runInNewContext(source,{Request,Response,console,Date,Set,Deno:{env:{get:()=>''},serve:f=>handler=f},createClient:()=>({auth:{getUser:async()=>({data:{user:opts.unauth?null:{id:'u'}}})},from})});
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({op:'set_completion',visit_id:id,meal_id:'meal',completed:true,...body})}));return {status:response.status,body:await response.json(),writes,reads};
}
(async()=>{
 const yes=await run({patient_id:'forged',recorded_by_account_id:'forged',recorded_by_admin_id:'forged'});assert.equal(yes.status,200);assert.equal(yes.writes[0].data.recorded_by_account_id,'a');assert.equal(yes.writes[0].data.recorded_by_admin_id,null);assert.equal(yes.writes[1].data.patient_id,'p');assert.equal(yes.body.audit_recorded,true);
 const no=await run({completed:false});assert.equal(no.writes[0].data.completed_at,null);assert.equal(no.writes[0].data.completed,false);
 for(const opts of [{unauth:true},{account:{status:'disabled'}},{account:{activation_completed_at:null}},{patient:'other'},{access:{verification_status:'pending'}},{access:{revoked_at:'2026-01-01'}},{access:{expires_at:'2020-01-01'}},{access:{expires_at:'invalid'}}]){const r=await run({},opts);assert.ok([401,403].includes(r.status));assert.equal(r.writes.length,0);}
 for(const body of [{meal_id:'other'},{completed:'true'},{completed:null},{visit_id:'bad'},{meal_id:''}]){const r=await run(body);assert.equal(r.status,400);assert.equal(r.writes.length,0);}
 const overview=await run({op:'overview'});assert.equal(overview.body.visits.length,1);assert.equal(overview.writes.length,0);
 const denied=await run({op:'overview'},{access:{verification_status:'pending'}});assert.equal(denied.body.visits.length,0);assert.ok(!denied.reads.includes('patient_nutrition_visits'));
 assert.equal((await run({}, {auditError:true})).body.audit_recorded,false);
 assert.equal((await run({}, {writeError:true})).writes.length,1);
 console.log('PASS nutrition: authentication, activation, exact patient access, expiry/revocation, meal membership, strict boolean, server actor, audit and read isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
