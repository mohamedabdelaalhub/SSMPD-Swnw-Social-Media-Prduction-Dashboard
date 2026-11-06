const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync('assets/js/'+n+'.js','utf8');
(async()=>{const dom=new JSDOM('<body><button id="dashboard-help-toggle"></button><div id="view-container"></div></body>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window,d=w.document,nav=[];
w.queueMicrotask=fn=>queueMicrotask(()=>{if(w.document)fn();});
w.SSMPDAuth={currentAdmin:{id:'rec1',name:'استقبال',role:'super_admin',active:true}};w.SSMPD_CONFIG={};
w.SSMPDRenderAccounting={selectSection:(...x)=>nav.push(['acc',...x]),render:()=>{},openInventory:()=>nav.push('inv')};w.SSMPDFinanceCash={openSection:s=>nav.push(['cash',s])};w.SSMPDDb={};
for(const n of ['roles','i18n-dictionary','i18n','ui-titles','search-destinations','dashboard-help-data','dashboard-help-fields','dashboard-help'])w.eval(read(n));
const H=w.SSMPDDashboardHelp,q=s=>d.querySelector(s);
const cfg={tab:()=>'reception_services',tabs:()=>['reception_services','accounting','patients','inventory'],navigate:t=>nav.push(['tab',t])};
H.mount(cfg);
// 1. article has the start button, panel opens
H.open('booking-inactive');assert(q('[data-dh-coach="booking-inactive"]'),'start button');
// 2. starting closes the panel and shows step 1 of N
q('[data-dh-coach="booking-inactive"]').click();assert(!q('.dh-panel'),'panel closed');const bar=q('#dh-coach');assert(bar,'coach bar');
const n=w.SSMPDHelpData.articles.find(a=>a.id==='booking-inactive').steps.length;
assert(bar.textContent.includes('خطوة 1 من '+n),'step counter');assert(bar.textContent.includes('احجز')||bar.textContent.includes('الحسابات'),'step text shown');
// 3. each step offers a button that opens the screen
const go=bar.querySelector('[data-dh-coach-go]');assert(go,'open-screen button');go.click();assert(nav.length>0,'navigation happened');
// 4. next / previous move through steps
q('[data-dh-coach-next]').click();assert(q('#dh-coach').textContent.includes('خطوة 2 من '+n));q('[data-dh-coach-prev]').click();assert(q('#dh-coach').textContent.includes('خطوة 1 من '+n));
// 5. progress survives re-mount (page re-render) for the same admin
q('[data-dh-coach-next]').click();H.dispose();assert(!q('#dh-coach'),'dispose removes bar');H.mount(cfg);assert(q('#dh-coach').textContent.includes('خطوة 2 من '+n),'restored');
// 6. a different admin never inherits the coach
H.dispose();w.SSMPDAuth.currentAdmin={id:'other',role:'super_admin',active:true};H.mount(cfg);assert(!q('#dh-coach'),'not for another user');
w.SSMPDAuth.currentAdmin={id:'rec1',role:'super_admin',active:true};
// 7. finish shows what comes next, then stop clears
H.coachStart('booking-inactive');for(let i=0;i<n;i++)q('[data-dh-coach-next]').click();assert(q('#dh-coach').textContent.includes('خلصت'),'finish view');assert(q('[data-dh-coach-open]'),'next guides offered');
q('[data-dh-coach-open]').click();assert(q('#dh-coach').textContent.includes('خطوة 1 من '),'next guide started');
q('[data-dh-coach-stop]').click();assert(!q('#dh-coach'));H.mount(cfg);assert(!q('#dh-coach'),'stopped stays stopped');
// 8. open modal blocks navigation with a clear message
H.coachStart('booking-inactive');const m=d.createElement('div');m.className='modal-backdrop';m.innerHTML='<section class="modal" role="dialog"></section>';d.body.appendChild(m);const before=nav.length;const g2=q('[data-dh-coach-go]');if(g2){g2.click();assert.equal(nav.length,before);assert(q('[data-dh-coach-note]').textContent.includes('نموذج مفتوح'));}
m.remove();
// 9. help panel hides the coach while open
H.open();assert(q('#dh-coach').hidden===true);H.close();assert(q('#dh-coach').hidden===false);
// 10. no step is rendered as raw html
w.SSMPDHelpData.articles.push({id:'xss',title:'t',tab:'home',terms:'xss',meaning:'m',reason:'r',owner:'o',links:[],steps:['<img src=x onerror=alert(1)>']});H.coachStart('xss');assert(!q('#dh-coach img'));assert(q('#dh-coach').textContent.includes('<img'));
console.log('dashboard-help-coach OK');})().catch(e=>{console.error(e);process.exit(1);});
