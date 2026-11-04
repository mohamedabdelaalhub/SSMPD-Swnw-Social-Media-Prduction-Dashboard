const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"><div id="tabs-bar"></div><div id="mobile-menu"><div class="mm-tabs"></div></div><div id="user-dropdown"><div class="ud-items"></div></div><div id="brand-section-name"></div><main id="view-container"></main></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;let direct=[],groups=0;
 const members=[
 {code:'sia',display_name:'سيا',title_ar:'مساعد إداري',member_kind:'system_identity',active:true,metrics:{}},
 {code:'hapi',display_name:'حابي',title_ar:'استقبال',member_kind:'external_agent',active:true,metrics:{}},
 {code:'claude_creative',display_name:'Claude Creative',title_ar:'محتوى',member_kind:'existing_admin',active:true,metrics:{roles:['page_manager'],capabilities:[{key:'tasks_create',label:'إنشاء مهام',enabled:true,daily_limit:30}]}},
 ...[['hor','حور'],['hotep','حتب'],['nefer','نفر'],['maat','ماعت']].map(([code,display_name])=>({code,display_name,title_ar:'محرك مراجعة',member_kind:'external_agent',active:true,metrics:{}}))
 ];
 w.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fake.invalid',anonKey:'mock'}};
 w.SSMPDDigitalChat={openDirect:x=>direct.push(x),openGroup:()=>{groups++;}};
 w.supabase={createClient:()=>({rpc:async(name)=>{
   if(name==='digital_team_dashboard')return{data:{members},error:null};
   if(name==='digital_agent_recent_reviews')return{data:{is_owner:true,reviews:[{id:'r1',agent_code:'nefer',status:'pending_owner',reviewed_at:new Date().toISOString(),metrics:{leads_last30:20},findings:[]}]},error:null};
   if(name==='digital_agent_metric_detail')return{data:{source:'leads',period:'30 يومًا',explanation:'قياس من السجلات',breakdown:[{label:'قيد المتابعة',count:4}]},error:null};
   throw Error(name);
 }})};
 w.eval(fs.readFileSync('assets/js/digital-team.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 await sleep(25);w.SSMPDDigitalTeam.open();await sleep(45);
 assert.equal(d.querySelectorAll('.dt-member').length,7);
 assert(d.body.textContent.includes('صلاحيات Claude الحالية'),'Claude role and capability display preserved');
 assert(d.querySelector('[data-dt-open-group]'),'group messenger entry');
 assert.equal(d.querySelectorAll('[data-open-digital-chat]').length,7);
 assert(!d.querySelector('[data-dt-discuss]'),'obsolete per-card discussion forms retired');
 d.querySelector('[data-open-digital-chat="nefer"]').click();assert.deepEqual(direct,['nefer']);
 d.querySelector('[data-dt-open-group]').click();assert.equal(groups,1);
 d.querySelector('[data-dt-metric-code="nefer"]').click();await sleep(20);
 assert(d.querySelector('.dt-detail-dialog')?.textContent.includes('قياس من السجلات'));
 dom.window.close();console.log('PASS seven preserved agent cards, direct/group launcher and KPI drilldown');
})().catch(e=>{console.error(e);process.exit(1);});