const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
const shell=()=>'<div id="tabs-bar" style="display:none"><button class="tab-btn" data-tab="home">الرئيسية</button></div><div id="mobile-menu"><div class="mm-tabs"></div></div><div id="user-dropdown"><div class="ud-items"></div></div><div id="brand-section-name"></div><main id="view-container"></main>';
async function run(){
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;const calls=[];
 const fake={
  patient360_contacts:[{id:'c1',display_name:'عميل اختبار',channel:'whatsapp',external_key:'201234567890',contact_consent:'unknown',do_not_contact:false,last_message_at:'2026-11-03T12:00:00Z'}],
  patient360_messages:[{id:'m1',contact_id:'c1',direction:'inbound',body:'ممكن أعرف مواعيد الخدمة؟',sent_at:'2026-11-03T12:00:00Z'}],
  patient360_insights:[],patient360_cases:[],patient360_followups:[]
 };
 const query=table=>({select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:fake[table]||[],error:null});},insert(data){calls.push({table,data});return Promise.resolve({data,error:null});}});
 w.SSMPDAuth={currentAdmin:{id:'admin1',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>({from:query})};
 d.getElementById('app-root').innerHTML=shell();
 w.eval(fs.readFileSync('assets/js/patient360.js','utf8'));
 d.dispatchEvent(new w.Event('DOMContentLoaded'));await sleep(20);
 assert(d.querySelector('#user-dropdown [data-p360-nav]'),'manager account menu entry');
 assert(!d.querySelector('#mobile-menu [data-p360-nav]'),'patient 360 stays outside mobile content tabs');
 d.querySelector('#user-dropdown [data-p360-nav]').click();await sleep(35);
 assert(d.querySelector('[data-p360-root]'),'Patient 360 opens');
 assert(d.querySelector('.p360-message-body').textContent.includes('مواعيد الخدمة'),'message history shown');
 assert(d.querySelector('[data-p360-follow-form]'),'draft followup form exists');
 assert(d.querySelector('[data-p360-case-form]'),'complaint escalation form exists');
 assert.equal(calls.length,0,'viewing history never writes or sends messages');
 d.getElementById('app-root').innerHTML=shell();await sleep(25);
 assert.equal(d.querySelectorAll('#user-dropdown [data-p360-nav]').length,1,'navigation survives shell rebuild');
 w.SSMPDAuth.currentAdmin={id:'staff1',role:'reception'};
 d.getElementById('app-root').innerHTML=shell();await sleep(25);
 assert(!d.querySelector('[data-p360-nav]'),'non-managers cannot open the dashboard');
 dom.window.close();console.log('PASS Patient 360 protected navigation, timeline and draft-only UI');
}
run().catch(e=>{console.error(e);process.exit(1);});
