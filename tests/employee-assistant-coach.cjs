const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync('assets/js/'+n+'.js','utf8');
const dom=new JSDOM('<body><div id="app-root"></div><button id="dashboard-help-toggle"></button><div id="view-container"></div></body>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window,d=w.document;
w.queueMicrotask=fn=>queueMicrotask(()=>{if(w.document)fn();});
w.SSMPDAuth={currentAdmin:{id:'rec1',name:'استقبال',role:'super_admin',active:true}};w.SSMPD_CONFIG={};w.SSMPDDb={};
for(const n of ['roles','i18n-dictionary','i18n','ui-titles','search-destinations','dashboard-help-data','dashboard-help-fields','dashboard-help'])w.eval(read(n));
w.SSMPDDashboardHelp.mount({tab:()=>'reception_services',tabs:()=>['reception_services'],navigate:()=>{}});
w.eval(read('employee-assistant'));
setTimeout(()=>{
 const launch=d.querySelector('.ssmpd-ea-launch');assert(launch,'launch');launch.click();
 const inp=d.querySelector('[data-ea-input]');inp.value='ازاي اعمل حجز جديد';d.querySelector('[data-ea-send]').click();
 setTimeout(()=>{
  const b=d.querySelector('[data-ea-coach]');assert(b,'coach button in assistant answer');
  b.click();
  assert(d.querySelector('.ssmpd-ea-panel').hidden,'assistant hides');
  const c=d.getElementById('dh-coach');assert(c&&!c.hidden,'coach shown');
  assert(/خطوة 1 من/.test(c.textContent),'step counter');
  console.log('PASS employee-assistant coach');process.exit(0);
 },300);
},1500);
