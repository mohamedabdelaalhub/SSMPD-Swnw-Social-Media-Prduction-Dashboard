// Help articles may carry one local walkthrough video; only docs/*.mp4 paths render.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync('assets/js/'+n+'.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{const dom=new JSDOM('<div id="app-root"></div>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window,d=w.document;
w.queueMicrotask=fn=>queueMicrotask(()=>{if(w.document)fn();});w.HTMLElement.prototype.scrollIntoView=function(){};w.SSMPDAuth={currentAdmin:{id:'owner',name:'اختبار',role:'super_admin',active:true}};w.SSMPD_CONFIG={};w.SSMPDPersonalHome={render:()=>{},mountNotifications:()=>{}};w.SSMPDDb={subscribeTable:()=>null,unsubscribe:()=>{}};w.SSMPDRenderAccounting={selectSection:()=>{},render:()=>{},openInventory:()=>{}};w.SSMPDFinanceCash={openSection:()=>{}};
for(const n of ['roles','i18n-dictionary','i18n','ui-titles','search-destinations','dashboard-help-data','dashboard-help-fields','dashboard-help'])w.eval(read(n));let app=read('app');w.eval(app.slice(0,app.indexOf('  // ---------- تشغيل ----------'))+'window.__helpShell=renderShell;})();');w.__helpShell();await tick();
const H=w.SSMPDDashboardHelp,a=w.SSMPDHelpData.articles.find(x=>x.id==='personal'),src=a.video&&a.video.src;
assert(src&&fs.existsSync(src),'home walkthrough video exists: '+src);
H.open('personal');await tick();let v=d.querySelector('.dh-article video');
assert(v,'video rendered');assert.equal(v.getAttribute('src'),src);assert(v.hasAttribute('controls')&&v.hasAttribute('muted'));assert.equal(v.getAttribute('preload'),'none');
for(const bad of ['https://evil.test/x.mp4','docs/../x.mp4','javascript:alert(1)','docs/a.mp4" onerror="x']){a.video={src:bad};H.open('personal');await tick();assert(!d.querySelector('.dh-article video'),'rejected '+bad);}
a.video=undefined;H.open('personal');await tick();assert(!d.querySelector('.dh-article video'));
H.dispose();w.close();console.log('PASS help video: local docs/*.mp4 renders muted with controls; external, traversal and injected paths are ignored');})().catch(e=>{console.error(e);process.exit(1);});
