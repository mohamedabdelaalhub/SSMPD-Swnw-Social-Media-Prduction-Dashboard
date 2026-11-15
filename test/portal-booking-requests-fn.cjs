// patient-portal-booking: the patient "book" only stores a pending request (no official booking);
// reception staff_confirm creates it via the bridge; non-staff cannot use staff ops.
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const src=stripTypeScriptTypes(fs.readFileSync('supabase/functions/patient-portal-booking/index.ts','utf8').replace(/^import .*;\n/gm,''));
const DOC=(/"doctor_id":"(doc_[a-z0-9]+)"/.exec(src)||[])[1];
const RID='11111111-1111-4111-8111-111111111111';
function setup({staff=false,limit=false}={}){
  const db={
    patient_accounts:[{id:'acc',status:'active',activation_completed_at:'x',auth_user_id:'u1'}],
    patient_account_access:[{account_id:'acc',patient_id:'p1',verification_status:'approved'}],
    patients:[{id:'p1',full_name:'Test P',phone:'0100',status:'active',patient_code:'T'}],
    admins:[{id:'adm',user_id:'u1',active:true,name:'R'}],
    patient_portal_booking_requests:[],patient_portal_audit_log:[],
  };
  const bridgeCalls=[];let handler;
  function q(t){let rows=db[t]||(db[t]=[]),filters=[],op='select',patch=null,inserted=null;
    const apply=()=>rows.filter(r=>filters.every(f=>f(r)));
    const self={select(){return self},eq(k,v){filters.push(r=>r[k]===v);return self},in(k,v){filters.push(r=>v.includes(r[k]));return self},
      or(){return self},order(){return self},limit(){return self},
      insert(o){op='insert';inserted=Object.assign({id:RID,created_at:new Date().toISOString()},o);return self},
      update(p){op='update';patch=p;return self},
      _run(){if(op==='insert'){if(t==='patient_portal_booking_requests'&&limit)return{data:null,error:{message:'PORTAL_BOOKING_LIMIT'}};rows.push(inserted);return{data:inserted,error:null};}
        if(op==='update'){const m=apply();m.forEach(r=>Object.assign(r,patch));return{data:m[0]||null,error:null};}
        return{data:apply(),error:null};},
      maybeSingle(){return Promise.resolve(self._run()).then(r=>({data:Array.isArray(r.data)?r.data[0]||null:r.data,error:r.error}))},
      single(){return self.maybeSingle()},
      then(res,rej){return Promise.resolve(self._run()).then(res,rej)}};return self;}
  const env={SWNW_BOOKING_BRIDGE_URL:'https://bridge.test',SWNW_BOOKING_BRIDGE_TOKEN:'t',SUPABASE_URL:'https://sb.test',SUPABASE_SERVICE_ROLE_KEY:'s',SUPABASE_ANON_KEY:'a'};
  const fetch=async(url,init={})=>{bridgeCalls.push([init.method||'GET',url.replace('https://bridge.test','')]);
    if(url.includes('/availability'))return new Response(JSON.stringify({Times:['10:00']}));
    if(url.endsWith('/bookings'))return new Response(JSON.stringify({OfficialBookingId:'777'}));
    return new Response(JSON.stringify({official_booking_id:'777',doctor_id:JSON.parse(JSON.stringify(src.match(/"official_doctor_id":(\d+)/)[1]))*1,reservation_date:'2099-01-05T10:00:00'}));};
  const ctx={Request,Response,console,Date,Intl,Set,Map,Array,JSON,Number,String,Math,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto,fetch,
    Deno:{env:{get:k=>env[k]},serve:f=>handler=f},
    createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null})},from:q,rpc:async(n)=>({data:n==='can_access_leads'?staff:null,error:null})})};
  vm.runInNewContext(src,ctx);
  const call=async b=>{const r=await handler(new Request('https://f.test',{method:'POST',headers:{Authorization:'Bearer x'},body:JSON.stringify(b)}));return {status:r.status,body:JSON.parse(JSON.stringify(await r.json()))};};
  return {db,bridgeCalls,call};
}
(async()=>{
  assert.ok(DOC,'catalog has a doctor');
  let s=setup();
  let r=await s.call({op:'book',patient_id:'p1',doctor_id:DOC,date:'2099-01-05',time:'10:00'});
  assert.equal(r.status,201);assert.equal(r.body.status,'pending');
  assert.equal(s.db.patient_portal_booking_requests.length,1);
  assert.ok(!s.bridgeCalls.some(c=>c[0]==='POST'),'patient booking never creates an official booking');
  r=await s.call({op:'staff_list'});assert.equal(r.status,403,'patients cannot list');
  r=await s.call({op:'staff_confirm',request_id:RID});assert.equal(r.status,403,'patients cannot confirm');
  r=await s.call({op:'my_requests'});assert.equal(r.body.requests.length,1);
  s=setup({limit:true});
  r=await s.call({op:'book',patient_id:'p1',doctor_id:DOC,date:'2099-01-05',time:'10:00'});
  assert.equal(r.status,409);assert.equal(r.body.error,'PORTAL_BOOKING_LIMIT');
  // staff confirm path
  s=setup({staff:true});
  s.db.patient_portal_booking_requests.push({id:RID,patient_id:'p1',doctor_id:DOC,requested_date:'2099-01-05',requested_time:'10:00',status:'pending'});
  r=await s.call({op:'staff_confirm',request_id:RID});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(s.db.patient_portal_booking_requests[0].status,'confirmed');
  assert.equal(s.db.patient_portal_booking_requests[0].official_booking_id,'777');
  assert.ok(s.bridgeCalls.some(c=>c[0]==='POST'&&c[1]==='/bookings'),'reception confirm books officially');
  r=await s.call({op:'staff_confirm',request_id:RID});assert.equal(r.status,409,'double confirm refused');
  s=setup({staff:true});
  s.db.patient_portal_booking_requests.push({id:RID,patient_id:'p1',doctor_id:DOC,requested_date:'2099-01-05',requested_time:'11:00',status:'pending'});
  r=await s.call({op:'staff_confirm',request_id:RID});
  assert.equal(r.status,409);assert.equal(s.db.patient_portal_booking_requests[0].status,'slot_unavailable','taken slot is marked, nothing booked');
  assert.ok(!s.bridgeCalls.some(c=>c[0]==='POST'));
  console.log('portal booking requests function: OK');
})().catch(e=>{console.error(e);process.exit(1);});
