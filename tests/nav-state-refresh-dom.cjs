// F5 must keep the user inside the page/section/group they were on (per user, session only).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const js=f=>fs.readFileSync(__dirname+'/../assets/js/'+f,'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fixture={can_create:true,can_review:true,me:'me',closed_through:null,registers:[],shifts:[],invoices:[],payments:[],requests:[],trial:[],entries:[],audit:[],disbursements:[],suppliers:[],doctor_contracts:[],employment_contracts:[]};
// one "page load": fresh DOM, but sessionStorage content carried over like a real F5
function load(store,adminId,scripts){
  const dom=new JSDOM('<body><div id="root"></div></body>',{url:'https://dash.test/',runScripts:'outside-only'});
  const w=dom.window;
  if(store)Object.keys(store).forEach(k=>w.sessionStorage.setItem(k,store[k]));
  w.crypto.randomUUID=w.crypto.randomUUID||(()=>'u-'+Math.random());
  w.scrollTo=()=>{};
  w.SSMPDAuth={currentAdmin:{id:adminId}};
  w.SSMPDRoles={canSeeTab:()=>true,canModuleAction:()=>true};
  w.SSMPDDb={financeSnapshot:async()=>fixture,receptionCatalogIssues:async()=>[],listPricingSupplies:async()=>[],listPricingServices:async()=>[],listPricingPackages:async()=>[],pricingDoctorContracts:async()=>[]};
  w.SSMPDToast={show(){}};
  scripts.forEach(f=>w.eval(js(f)));
  return dom;
}
const snap=dom=>{const o={};for(let i=0;i<dom.window.sessionStorage.length;i++){const k=dom.window.sessionStorage.key(i);o[k]=dom.window.sessionStorage.getItem(k);}return o;};
(async()=>{
  // ---- helper ----
  let d=load(null,'a1',['nav-state.js']),N=d.window.SSMPDNavState;
  assert.equal(N.get('x'),null);
  N.set('x',{group:'dues',tab:'doctors',bad:{a:1},long:'y'.repeat(500),num:5});
  assert.equal(JSON.stringify(N.get('x')),JSON.stringify({group:'dues',tab:'doctors'}),'only short strings are kept (no objects/numbers/huge text)');
  assert.equal(N.once('x').tab,'doctors');assert.equal(N.once('x'),null,'restored once per page load');
  let s=snap(d);
  let d2=load(s,'a1',['nav-state.js']);assert.equal(d2.window.SSMPDNavState.get('x').group,'dues','survives reload');
  let d3=load(s,'other-user',['nav-state.js']);assert.equal(d3.window.SSMPDNavState.get('x'),null,'ignored for another user');
  d2.window.SSMPDNavState.clear();assert.equal(d2.window.SSMPDNavState.get('x'),null,'cleared on sign-out');
  d2.window.sessionStorage.setItem('ssmpd_nav_state_v1','{garbage');assert.equal(d2.window.SSMPDNavState.get('x'),null,'corrupt storage is harmless');

  // ---- finance cash: group + section ----
  d=load(null,'a1',['nav-state.js','finance-cash.js']);
  d.window.SSMPDFinanceCash.render(d.window.document.getElementById('root'));await wait(50);
  const doc=()=>d.window.document;
  doc().querySelector('[data-fc-group="dues"]').click();await wait(10);
  const firstTab=doc().querySelector('[data-fc-tab]').dataset.fcTab;doc().querySelector('[data-fc-tab="'+firstTab+'"]').click();await wait(50);
  assert(doc().querySelector('[data-fc-back]'),'inside a section');
  s=snap(d);
  d=load(s,'a1',['nav-state.js','finance-cash.js']);
  d.window.SSMPDFinanceCash.render(d.window.document.getElementById('root'));await wait(80);
  assert(doc().querySelector('[data-fc-back]'),'after F5 still inside the section');
  assert.equal(doc().querySelector('[data-fc-group][aria-pressed="true"]').dataset.fcGroup,'dues');
  assert.equal(doc().querySelector('.fc-modal'),null,'never restores a modal');
  // section not allowed for this role -> falls back safely
  const bad=JSON.parse(s['ssmpd_nav_state_v1']);bad.m.finance_cash={group:'dues',tab:'no-such-section'};
  d=load({ssmpd_nav_state_v1:JSON.stringify(bad)},'a1',['nav-state.js','finance-cash.js']);
  d.window.SSMPDFinanceCash.render(d.window.document.getElementById('root'));await wait(80);
  assert(!doc().querySelector('[data-fc-back]')&&doc().querySelector('[data-fc-tab]'),'unknown section ignored, group cards shown');
  bad.m.finance_cash={group:'nope',tab:'x'};
  d=load({ssmpd_nav_state_v1:JSON.stringify(bad)},'a1',['nav-state.js','finance-cash.js']);
  d.window.SSMPDFinanceCash.render(d.window.document.getElementById('root'));await wait(80);
  assert(doc().querySelector('[data-fc-group]'),'unknown group ignored');

  // ---- accounting: sub tab ("الخزينة") survives F5 ----
  d=load(null,'a1',['nav-state.js','finance-cash.js','render-accounting.js']);
  d.window.SSMPDRenderAccounting.render(d.window.document.getElementById('root'));await wait(30);
  d.window.document.querySelector('[data-sub="cash"]').click();await wait(60);
  s=snap(d);
  d=load(s,'a1',['nav-state.js','finance-cash.js','render-accounting.js']);
  d.window.SSMPDRenderAccounting.render(d.window.document.getElementById('root'));await wait(80);
  assert.equal(d.window.document.querySelector('[data-sub].active').dataset.sub,'cash','accounting stays on the cash tab after F5');
  assert(d.window.document.querySelector('.fc-workspace'));
  // without saved state: default is unchanged
  d=load(null,'a1',['nav-state.js','finance-cash.js','render-accounting.js']);
  d.window.SSMPDRenderAccounting.render(d.window.document.getElementById('root'));await wait(30);
  assert.equal(d.window.document.querySelector('[data-sub].active').dataset.sub,'pricing');

  // ---- app.js wiring (static) ----
  const app=js('app.js');
  assert(/doLogout[\s\S]{0,400}SSMPDNavState\.clear/.test(app),'sign-out clears nav state');
  assert(/signIn\(email, pass\)[\s\S]{0,700}SSMPDNavState\.clear/.test(app),'fresh sign-in clears nav state');
  const idx=fs.readFileSync(__dirname+'/../index.html','utf8');
  assert(idx.indexOf('nav-state.js')>0&&idx.indexOf('nav-state.js')<idx.indexOf('finance-cash.js'),'nav-state.js loads before the modules');
  console.log('PASS nav-state: helper (owner/once/clear/sanitize), finance-cash group+section, accounting sub tab, invalid saved state ignored, sign-out/sign-in clear.');
})().catch(e=>{console.error(e);process.exit(1);});
