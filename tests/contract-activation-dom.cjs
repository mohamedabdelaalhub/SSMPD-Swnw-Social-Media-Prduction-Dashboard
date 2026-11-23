// DOM: «تفعيل العقد» without terms/signed document; button only for super_admin / financial_manager.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync('assets/js/'+n+'.js','utf8');
async function boot(role){
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window,d=w.document,rpcs=[],toasts=[];
 const query=()=>{const q={select:()=>q,eq:()=>q,order:()=>q,single:()=>q,update:()=>q,insert:()=>q,then:(ok,bad)=>Promise.resolve({data:[],error:null}).then(ok,bad)};return q;};
 w.SSMPD_CONFIG={supabase:{url:'https://db.test',anonKey:'anon'}};
 w.supabase={createClient:()=>({from:query,rpc:(name,args)=>{rpcs.push({name,args});return Promise.resolve({data:{contract_id:args.p_contract_id,status:'active',price_list:'active'},error:null});},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session:null}})},channel:()=>({on(){return this;},subscribe(){return this;}}),storage:{from:()=>({})},functions:{invoke:async()=>({data:null,error:null})}})};
 w.eval(read('roles'));w.eval(read('db'));
 // Finance roles reach this tab only with a module grant (admin_module_permissions).
 w.SSMPDAuth={currentAdmin:{id:'me',name:'المالك',role,roles:[role],module_permissions:[{module_key:'contracting_entities',can_view:true,can_create:true,can_update:true}]}};w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 // A live-like contract: negotiating, no terms, no signer, no agreement date, no document.
 const contract={id:'c1',entity_id:'e1',status:'negotiating',start_date:'2026-01-01',end_date:'2026-12-31',discount_percent:0,cashback_percent:0,terms_notes:null,signed_by_name:null,signed_document_url:null,agreement_date:null,price_list_id:'l1',price_list_link_status:'pending'};
 let reads=0;Object.assign(w.SSMPDDb,{listContractingEntities:async()=>[{entity_id:'e1',entity_name:'ميد نت',category:'insurance',contract_status:'negotiating'}],getContractingEntityDetails:async id=>{reads++;return {entity:{id,name:'ميد نت',category:'insurance',entity_type:'other'},contracts:[Object.assign({},contract)],finance:[],contacts:[],activities:[]};},listPricingServices:async()=>[]});
 for(const n of ['contract-navigation','render-contracting-entities'])w.eval(read(n));
 const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));},host=d.querySelector('main');
 w.SSMPDRenderContractingEntities.render(host);await tick();d.querySelector('[data-open]').click();await tick();
 return {w,d,host,rpcs,toasts,tick,reads:()=>reads};
}
(async()=>{
 for(const role of ['super_admin','financial_manager']){
  const t=await boot(role),btn=t.d.querySelector('[data-activate-contract="c1"]');
  assert(btn,role+' sees «تفعيل العقد»');assert.equal(btn.textContent,'تفعيل العقد');
  const before=t.reads();btn.click();await t.tick();
  assert.equal(JSON.stringify(t.rpcs.filter(r=>r.name==='contracting_contract_activate')),JSON.stringify([{name:'contracting_contract_activate',args:{p_contract_id:'c1'}}]),role+' calls the activation RPC with no terms/document');
  assert(t.toasts.some(([m])=>m==='تم تفعيل العقد واعتماد قائمة أسعاره'),'success toast');assert(t.reads()>before,'file reloads after activation');
  t.d.querySelector('[data-edit-contract="c1"]').click();await t.tick();
  assert(t.d.querySelector('#cee-status option[value=active]'),role+' can pick «تم التعاقد» in the edit form');
  t.w.close();
 }
 for(const role of ['contract_manager','general_manager','accountant']){
  const t=await boot(role);
  assert.equal(t.d.querySelector('[data-activate-contract]'),null,role+' does not see «تفعيل العقد»');
  const edit=t.d.querySelector('[data-edit-contract="c1"]');
  if(edit&&!edit.hidden){edit.click();await t.tick();assert.equal(t.d.querySelector('#cee-status option[value=active]'),null,role+' cannot pick «تم التعاقد»');assert(t.d.querySelector('#cee-status option[value=negotiating]'));}
  assert.equal(t.rpcs.filter(r=>r.name==='contracting_contract_activate').length,0);
  t.w.close();
 }
 // Price-list review button: approver roles only, even for the list's own creator.
 const R=new JSDOM('',{runScripts:'outside-only'}).window;R.eval(read('roles'));
 assert.equal(R.SSMPDRoles.canApproveContracts({role:'super_admin'}),true);assert.equal(R.SSMPDRoles.canApproveContracts({role:'reception',roles:['reception','financial_manager']}),true);
 for(const role of ['general_manager','contract_manager','accountant'])assert.equal(R.SSMPDRoles.canApproveContracts({role}),false,role);
 for(const f of ['contract-price-workspace','workforce-prices'])assert(!/l\.status==='pending'&&l\.created_by!==owner/.test(read(f)),f+' review button no longer depends on another reviewer');
 assert(/canApproveContracts[^;]*data-approve-link/.test(read('price-list-governance')),'link approval button gated by role');
 console.log('PASS contract activation DOM: super_admin and financial_manager activate with no terms/document via contracting_contract_activate; contract manager, general manager and accountant see no activate button or active status; review/link buttons gated by role.');
})().catch(e=>{console.error(e);process.exitCode=1;});
