const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const source = stripTypeScriptTypes(fs.readFileSync('supabase/functions/patient-portal-documents/index.ts','utf8').replace(/^import .*;\n/gm,''));
const longText = 'تقرير '.repeat(400);
const fixtures = {
 patient_accounts: [{id:'account',status:'active',activation_completed_at:'2026-01-01'}],
 patient_account_access: [{account_id:'account',patient_id:'p1',verification_status:'approved'}],
 patients: [{id:'p1',patient_code:'TEST',full_name:'Test patient'}],
 patient_medical_reports:[{id:'m1',patient_id:'p1',body_text:longText}],
 patient_echo_reports:[{id:'e1',patient_id:'p1',dimensions:{ef:'60',lvedd:'4.2'},summary_text:'Echo summary',conclusion_text:'Echo conclusion'}],
 patient_dental_reports:[{id:'d1',patient_id:'p1',treatment_plan:'Plan',sessions:[{date:'2026-09-01',tooth:'12',service:'Treatment',notes:'Dental session'}]}],
 patient_physio_reports:[{id:'ph1',patient_id:'p1',diagnosis:'Physio diagnosis',sessions:[{date:'2026-09-02',treatments:['Cryo'],vitals:{pulse:'75',weight:'0'},notes:'Physio session'}],pain_points:[{x:0,y:20,note:'Pain'}]}],
 patient_prescriptions:[{id:'rx1',patient_id:'p1',rx_text:'Prescription'}],
 patient_lab_requests:[{id:'l1',patient_id:'p1',tests:['CBC','TSH']}],
 patient_radiology_requests:[{id:'r1',patient_id:'p1',items:['MRI Brain']}],
 patient_physio_report_images:[{physio_report_id:'ph1',patient_files:{id:'f1',patient_id:'p1',category:'radiology',file_name:'scan.pdf'}},{physio_report_id:'ph1',patient_files:{id:'wrong',patient_id:'p2',category:'radiology'}},{physio_report_id:'ph1',patient_files:{id:'private',patient_id:'p1',category:'id_document'}}],
};
async function run({authenticated=true,access,failed,rows}={}) {
 let handler; const queries=[];
 const db={...fixtures,...rows}; if(access)db.patient_account_access=access;
 function query(table){
  let data=db[table]||[];const q={
   select(){return q},eq(k,v){if(k!=='auth_user_id')data=data.filter(r=>r[k]===v);return q},in(k,values){data=data.filter(r=>values.includes(r[k]));return q},
   order(){return q},range(a,b){data=data.slice(a,b+1);return q},insert(){return q},
   maybeSingle(){return Promise.resolve({data:data[0]||null,error:null})},
   then(resolve,reject){queries.push(table);return Promise.resolve({data,error:failed===table?{message:'test query failure'}:null}).then(resolve,reject)}
  };return q;
 }
 const context={Request,Response,console,Date,Set,Deno:{env:{get:()=>''},serve:f=>handler=f},createClient:()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:'u1'}:null},error:null})},from:query})};
 vm.runInNewContext(source,context);
 const res=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test'}}));
 return {status:res.status,body:await res.json(),queries};
}
(async()=>{
 const result=await run();assert.equal(result.status,200);assert.equal(result.body.documents.length,7);
 const docs=Object.fromEntries(result.body.documents.map(d=>[d.source,d]));
 for(const d of Object.values(docs))assert.ok(d.details.length,d.source);
 assert.equal(docs.medical_report.details[0].value,longText.trim());
 assert.match(JSON.stringify(docs.echo_report.details),/Echo conclusion/);assert.match(JSON.stringify(docs.echo_report.details),/60/);
 assert.match(JSON.stringify(docs.physio_report.details),/Physio diagnosis/);assert.match(JSON.stringify(docs.physio_report.details),/75/);assert.match(JSON.stringify(docs.physio_report.details),/Cryo/);
 assert.deepEqual(docs.physio_report.attachments.map(f=>f.id),['f1']);
 assert.match(JSON.stringify(docs.dental_report.details),/Dental session/);
 assert.equal((await run({authenticated:false})).status,401);
 for(const change of [{revoked_at:'2026-01-01'},{expires_at:'2020-01-01'},{verification_status:'pending'}]){
  const denied=await run({access:[{...fixtures.patient_account_access[0],...change}]});assert.equal(denied.body.documents.length,0);assert.ok(!denied.queries.includes('patient_physio_reports'));
 }
 const failed=await run({failed:'patient_echo_reports'});assert.ok(failed.body.unavailable_sources.includes('patient_echo_reports'));
 const many=await run({rows:{patient_medical_reports:Array.from({length:501},(_,i)=>({id:'m'+i,patient_id:'p1',body_text:'Report'}))}});assert.equal(many.body.documents.filter(d=>d.source==='medical_report').length,501);
 console.log('PASS: seven document types, full text, sessions/vitals, attachment isolation, auth/access expiry/revocation, partial failure, pagination');
})().catch(e=>{console.error(e);process.exitCode=1});
