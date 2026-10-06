const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let rows=Array.from({length:136},(_,i)=>({id:String(i).padStart(5,'0'),received_by:i<122?'a':'b',assigned_to:'other',customer_name:'lead'+i,current_status:'new',created_at:'2026-10-06T12:00:00Z'})),log=[],fail=false;
const people=[{id:'a',name:'الموظف أ',active:false},{id:'b',name:'زينة',active:true},{id:'c',name:'الموظف ج',active:true}];
class Query{
 constructor(table){assert.equal(table,'leads');this.filters=[];}
 select(fields){log.push(fields);assert(!fields.includes('employee_id'));return this;}
 order(){return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 is(k){this.filters.push(r=>r[k]==null);return this;}
 gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
 lt(k,v){this.filters.push(r=>r[k]<v);return this;}
 or(){return this;}
 range(a,b){log.push([a,b]);const matching=rows.filter(r=>this.filters.every(f=>f(r)));return Promise.resolve(fail?{error:{message:'offline'}}:{data:matching.slice(a,b+1),count:matching.length});}
}
let realtimeCallback;const client={from:t=>new Query(t),rpc:()=>Promise.resolve({data:people}),channel:()=>({on(event,filter,callback){realtimeCallback=callback;return this;},subscribe(){return this;}})};
const window={SSMPD_CONFIG:{supabase:{url:'https://test.supabase.co',anonKey:'public'}},supabase:{createClient:()=>client},SSMPDAuth:{currentAdmin:{id:'owner'}}};
vm.runInNewContext(fs.readFileSync('assets/js/db.js','utf8'),{window,fetch(){throw Error('archive registration must not use last-contact edge filter');},Date,Set,JSON,Number});
(async()=>{
 const db=window.SSMPDDb;
 let all=await db.listLeadArchive({page:1,page_size:20});assert.equal(all.total,136);assert.equal(all.leads.length,20);
 assert.equal((await db.listLeadArchive({received_by:'a'})).total,122);assert.equal((await db.listLeadArchive({received_by:'b'})).total,14);assert.equal((await db.listLeadArchive({received_by:'c'})).total,0);
 let stats=await db.getLeadRegistrationStats({},people,true);assert.equal(stats.total,136);assert.equal(stats.employees.reduce((n,e)=>n+e.count,0),136);assert.equal(stats.employees[0].count,122);assert.equal(stats.employees.find(e=>e.employee_id==='b').count,14);assert.equal(stats.employees.find(e=>e.employee_id==='c').count,0);assert.equal(stats.employees[0].active,false);assert(Math.abs(stats.employees.reduce((n,e)=>n+e.percentage,0)-100)<1e-9);
 rows.push({id:'99999',received_by:null,created_at:'2026-10-06T23:59:59.999Z'});assert.equal((await db.listLeadArchive({received_by:'__unrecorded__',date_to:'2026-10-06'})).total,1);
 rows=Array.from({length:1187},(_,i)=>({id:String(i).padStart(5,'0'),received_by:'a',created_at:'2026-10-06T12:00:00Z'}));log=[];stats=await db.getLeadRegistrationStats({},people,true);assert.equal(stats.total,1187);assert(log.some(x=>Array.isArray(x)&&x[0]===1000));assert(log.includes('id, received_by, created_at'));
 rows=[];stats=await db.getLeadRegistrationStats({},people,true);assert.equal(stats.total,0);assert(stats.employees.every(e=>e.percentage===0));
 rows.push({id:'next',received_by:'b',created_at:'2026-10-06T12:00:00Z'});assert.equal((await db.getLeadRegistrationStats({},people,false)).total,0);let notified=false;db.subscribeTable('leads',()=>notified=true);realtimeCallback({eventType:'INSERT'});assert(notified);assert.equal((await db.getLeadRegistrationStats({},people,false)).total,1);window.SSMPDAuth.currentAdmin={id:'other'};rows=[];assert.equal((await db.getLeadRegistrationStats({},people,false)).total,0);
 fail=true;await assert.rejects(()=>db.getLeadRegistrationStats({},people,true),e=>e.message==='offline');
 console.log('PASS registrar filters 122+14=136, zero/inactive staff, unknown creator, end-date milliseconds, complete 1187-row aggregation and errors');
})().catch(e=>{console.error(e);process.exitCode=1;});
