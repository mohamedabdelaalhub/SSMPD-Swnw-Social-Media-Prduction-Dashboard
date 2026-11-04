const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
const markup=()=>'<div id="tabs-bar"><button class="tab-btn">الرئيسية</button></div><div id="mobile-menu"><div class="mm-tabs"></div></div><div id="user-dropdown"><div class="ud-items"></div></div><div id="brand-section-name"></div><div id="view-container"></div>';
async function main(){
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;let posts=[],adviceCalls=[],messages=[];
 const members=[
  {code:'sia',display_name:'سيا',title_ar:'الإدارة',member_kind:'system_identity',active:true,metrics:{reviewed:2}},
  {code:'hapi',display_name:'حابي',title_ar:'الاستقبال',member_kind:'external_agent',active:true,metrics:{}},
  {code:'claude_creative',display_name:'Claude Creative',title_ar:'المحتوى',member_kind:'existing_admin',active:true,metrics:{capabilities:[{key:'tasks_create',label:'إنشاء',enabled:true,daily_limit:30}],roles:['page_manager','designer','approver']}},
  {code:'hor',display_name:'حور',title_ar:'التشغيل',member_kind:'external_agent',active:true,metrics:{}},
  {code:'hotep',display_name:'حتب',title_ar:'الجودة',member_kind:'external_agent',active:true,metrics:{}},
  {code:'nefer',display_name:'نفر',title_ar:'التسويق',member_kind:'external_agent',active:true,metrics:{}},
  {code:'maat',display_name:'ماعت',title_ar:'المالية',member_kind:'external_agent',active:true,metrics:{}}
 ];
 const reviews=[{id:'r1',agent_code:'nefer',status:'pending_owner',reviewed_at:new Date().toISOString(),metrics:{leads_last30:23},findings:[{title:'فحص متابعة',source:'leads',reason:'نتيجة',recommendation:'راجع البيانات'}]}];
 const db={
  rpc:async(name,payload)=>{
   if(name==='digital_team_dashboard')return{data:{members},error:null};
   if(name==='digital_agent_recent_reviews')return{data:{is_owner:true,reviews},error:null};
   if(name==='digital_agent_metric_detail')return{data:{source:'leads',period:'آخر 30 يومًا',explanation:'شرح طريقة الحساب',breakdown:[{label:'قيد المتابعة',count:5}]},error:null};
   if(name==='digital_agent_post_message'){posts.push(payload);messages.push({id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',agent_code:payload.p_agent_code,kind:payload.p_kind,body:payload.p_body,created_at:new Date().toISOString()});return{data:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',error:null};}
   throw Error('Unexpected RPC '+name);
  },
  from(table){
   assert.equal(table,'digital_agent_messages');
   return {select(){return this;},order(){return this;},limit(){return Promise.resolve({data:messages.slice().reverse(),error:null});}};
  },
  functions:{invoke:async(name,payload)=>{adviceCalls.push({name,payload});messages.push({id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',agent_code:'nefer',kind:'reply',body:'راجع مصدر الحملة قبل تنفيذ أي تغيير.',created_at:new Date().toISOString()});return{data:{ok:true,reply:'راجع مصدر الحملة قبل تنفيذ أي تغيير.',executed:false},error:null};}}
 };
 w.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>db};
 d.getElementById('app-root').innerHTML=markup();
 w.eval(fs.readFileSync('assets/js/digital-team.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 await sleep(20);
 d.querySelector('#user-dropdown [data-digital-team-tab]').click();await sleep(80);
 assert.equal(d.querySelectorAll('.dt-member').length,7,'all seven members remain');
 assert(d.body.textContent.includes('صلاحيات Claude الحالية'),'Claude preserved');
 const metric=d.querySelector('[data-dt-metric-code="nefer"]');
 assert(metric,'Nefer metric actionable');
 metric.click();await sleep(40);
 assert(d.querySelector('.dt-detail-dialog'),'metric details popup opens');
 assert(d.querySelector('.dt-detail-dialog').textContent.includes('شرح طريقة الحساب'),'metric explanation loaded');
 assert(d.querySelector('.dt-detail-dialog').textContent.includes('قيد المتابعة'),'breakdown loaded');
 d.querySelector('[data-dt-close]').click();
 assert(!d.querySelector('.dt-detail-dialog'),'metric popup closes');
 const discussion=d.querySelector('[data-dt-discuss="nefer"]');assert(discussion,'chat exists');
 discussion.open=true;await sleep(10);
 const form=discussion.querySelector('[data-dt-message-form="nefer"]');
 assert(form,'owner can send per-agent guidance');
 form.elements.kind.value='question';
 form.elements.body.value='اقترح خطة لتحسين متابعة العملاء';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await sleep(120);
 assert.equal(posts.length,1,'one message saved via owner RPC');
 assert.equal(adviceCalls.length,1,'one advisory response requested');
 assert.equal(adviceCalls[0].name,'digital-agent-advice');
 assert(d.body.textContent.includes('راجع مصدر الحملة'),'advisory reply rendered');
 assert(d.body.textContent.includes('لم يُنفَّذ'),'no-automation statement visible');
 assert.equal(d.querySelectorAll('.dt-member').length,7,'cards remain intact after messaging');
 dom.window.close();console.log('PASS seven agent cards, metrics drilldown, owner instruction and no-execution dialogue');
}
main().catch(e=>{console.error(e);process.exit(1);});
