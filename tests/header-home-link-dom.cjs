// DOM test (owner 2026-11-17): tapping your name or photo in the header opens «الرئيسية الشخصية» (keyboard too); the «+N» roles button inside keeps its own job.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');const read=n=>fs.readFileSync(__dirname+'/../assets/js/'+n+'.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,12));
(async()=>{const vc=new VirtualConsole();const dom=new JSDOM('<div id="app-root"></div>',{url:'https://test.invalid',runScripts:'outside-only',virtualConsole:vc}),w=dom.window,d=w.document;
 const admin={id:'test',name:'محمد عبدالعال',role:'super_admin',roles:['super_admin','reception','accountant'],active:true};let homes=0;
 w.SSMPDAuth={currentAdmin:admin};w.SSMPD_CONFIG={centerName:'سونو'};w.SSMPDDb={subscribeTable:()=>null,unsubscribe:()=>{}};w.SSMPDPersonalHome={render:el=>{homes++;el.innerHTML='<p data-home>الرئيسية</p>';},mountNotifications:()=>{}};w.SSMPDRenderAccounting={openInventory:()=>{},render:()=>{}};
 for(const n of ['roles','i18n-dictionary','i18n','ui-titles','navigation-ui'])w.eval(read(n));let app=read('app');app=app.slice(0,app.indexOf('  // ---------- تشغيل ----------'))+'window.__t={shell:renderShell,go:switchTab};})();';w.eval(app);w.__t.shell();await tick();
 const acc=d.querySelector('.header-account');assert(acc.classList.contains('is-home-link')&&acc.getAttribute('role')==='button'&&acc.tabIndex===0);
 const isHome=()=>d.querySelector('.brand-section').textContent===w.SSMPDUITitles.tabs.home;const other=Object.keys(w.SSMPDUITitles.tabs).find(k=>k!=='home'&&w.SSMPDRoles.canSeeTab(admin,k));w.__t.go(other);await tick();assert(!isHome(),'left home');
 const before=homes;d.querySelector('.header-account-copy>b').click();await tick();assert(isHome()&&homes>before,'name opens home');
 w.__t.go(other);await tick();d.querySelector('[data-header-photo]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await tick();assert(isHome(),'photo opens home');
 w.__t.go(other);await tick();acc.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();assert(isHome(),'Enter opens home');
 w.__t.go(other);await tick();const roles=d.querySelector('#header-roles-btn');if(roles&&acc.contains(roles)){roles.click();await tick();assert(!isHome(),'roles button keeps its own job');assert(d.querySelector('#user-dropdown').classList.contains('open'));}
 dom.window.close();console.log('PASS header home link: name, photo and Enter open «الرئيسية الشخصية»; inner buttons keep their action.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
