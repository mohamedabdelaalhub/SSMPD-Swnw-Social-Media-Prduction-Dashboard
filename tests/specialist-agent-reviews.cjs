const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
const markup=()=>'<div id="tabs-bar" style="display:none"><button class="tab-btn" data-tab="home">الرئيسية</button></div><div id="mobile-menu"><div class="mm-tabs"></div></div><div id="user-dropdown"><div class="ud-items"></div></div><div id="brand-section-name"></div><main id="view-container"></main>';
async function test(){
  const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"></div></body></html>',{url:'https://localhost.test/',runScripts:'outside-only'});
  const w=dom.window,d=w.document;let runs=[],decisions=[],recent=[];
  const members=[
    {code:'sia',display_name:'سيا',title_ar:'المساعد الإداري',member_kind:'system_identity',active:true,metrics:{}},
    {code:'hapi',display_name:'حابي',title_ar:'خدمة العملاء',member_kind:'external_agent',active:true,metrics:{}},
    {code:'claude_creative',display_name:'Claude Creative',title_ar:'الإنتاج',member_kind:'existing_admin',active:true,metrics:{roles:['page_manager','designer','approver'],capabilities:[{key:'create',label:'إنشاء',enabled:true,daily_limit:5}]}},
    ...[['hor','حور'],['hotep','حتب'],['nefer','نفر'],['maat','ماعت']].map(([code,display_name])=>({code,display_name,title_ar:'محرك مراجعة',member_kind:'external_agent',metadata:{runtime_mode:'review_only'},active:true,metrics:{}}))
  ];
  w.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin',roles:['super_admin']}};
  w.SSMPD_CONFIG={supabase:{url:'https://fake.invalid',anonKey:'mock'}};
  w.confirm=()=>true;
  w.supabase={createClient:()=>({rpc:async(name,args)=>{
    if(name==='digital_team_dashboard')return {data:{members},error:null};
    if(name==='digital_agent_recent_reviews')return {data:{is_owner:true,reviews:recent},error:null};
    if(name==='digital_agent_run_review'){
      runs.push(args.p_code);
      const row={id:'review1',agent_code:args.p_code,status:'pending_owner',reviewed_at:new Date().toISOString(),metrics:{leads_last30:2},findings:[{title:'فرضية قابلة للمراجعة',reason:'تحتاج تحققًا',source:'aggregate',recommendation:'راجع البيانات مع الإدارة'}]};
      recent=recent.filter(x=>x.agent_code!==args.p_code);recent.push(row);
      return {data:row,error:null};
    }
    if(name==='digital_agent_decide_review'){
      decisions.push(args.p_decision);recent=recent.map(x=>x.id===args.p_review_id?{...x,status:args.p_decision}:x);
      return {data:{status:args.p_decision,execution_started:false},error:null};
    }
    throw Error('Unknown RPC: '+name);
  }})};
  d.getElementById('app-root').innerHTML=markup();
  w.eval(fs.readFileSync('assets/js/digital-team.js','utf8'));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));await sleep(30);
  assert(d.querySelector('#user-dropdown [data-digital-team-tab]'),'existing navigation preserved');
  d.querySelector('#user-dropdown [data-digital-team-tab]').click();await sleep(35);
  assert.equal(d.querySelectorAll('.dt-member').length,7,'seven team members');
  assert(d.body.textContent.includes('صلاحيات Claude الحالية'),'Claude existing rights panel remains');
  assert(d.body.textContent.includes('الحد اليومي'),'Claude daily limits visible');
  assert.equal(runs.length,0,'no analysis automatically runs');
  assert.equal(d.querySelectorAll('[data-dt-run]').length,4,'four specialist manual review controls');
  d.querySelector('[data-dt-run="nefer"]').click();await sleep(35);
  assert.deepEqual(runs,['nefer'],'selected specialist reviewed only on click');
  assert(d.body.textContent.includes('فرضية قابلة للمراجعة'),'findings rendered');
  assert(d.querySelector('[data-dt-decision="accepted_for_planning"]'),'owner planning decision exists');
  d.querySelector('[data-dt-decision="accepted_for_planning"]').click();await sleep(35);
  assert.deepEqual(decisions,['accepted_for_planning'],'decision marked for planning, not execution');
  assert.equal(d.querySelectorAll('.dt-member').length,7,'Claude and other cards preserved');
  d.getElementById('app-root').innerHTML=markup();await sleep(30);
  assert.equal(d.querySelectorAll('#user-dropdown [data-digital-team-tab]').length,1,'navigation rebuilt without duplicate');
  dom.window.close();console.log('PASS four review-only specialists, approval-only path, preserved Claude UI');
}
test().catch(e=>{console.error(e);process.exit(1);});
