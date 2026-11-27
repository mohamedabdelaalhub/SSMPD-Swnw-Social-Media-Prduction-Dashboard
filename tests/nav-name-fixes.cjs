// Owner 2026-11-25 (navigation review, main chat: one small display-only PR):
// 1) reception / nursing / sono_doctor saw «المخزن والجرد» twice on the personal home (the inventory tab AND «الحسابات» relabelled as the inventory
//    fallback open the same screen) → shown once; a supply-request-only user still gets «طلب مستلزمات»; a GM keeps «الحسابات» + «المخزن والجرد».
// 2) global search names/paths come from the accounting menu (e.g. «عقود الأطباء» under «الحسابات / الصرف والمستحقات», no removed
//    «الخزينة والدورة المالية» path); old names still find the screen; review-only sections only for reviewers. Real browser.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),{chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/personal-home.css"></head><body><div id="view-container"></div><script>
window.SSMPDToast={show(){},error(){}};window.SSMPDI18n={textHtml:s=>s,t:s=>s,buttonHtml:()=>''};window.SSMPD_CONFIG={centerName:'سونو'};window.SSMPDAuth={currentAdmin:null};
window.SSMPDDb={unsubscribe(){},subscribeTable:()=>null,client:{channel:()=>({on(){return this},subscribe(){return this}}),rpc:()=>Promise.resolve({data:null}),from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[]})}})}};
</script><script src="/assets/js/roles.js"></script><script src="/assets/js/ui-titles.js"></script><script src="/assets/js/accounting-shell.js"></script><script src="/assets/js/search-destinations.js"></script><script src="/assets/js/personal-home.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:'+server.address().port+'/');
const tiles=async admin=>(await page.reload(),page.evaluate(async a=>{SSMPDAuth.currentAdmin=a;if(SSMPDPersonalHome.reset)SSMPDPersonalHome.reset();const el=document.getElementById('view-container');el.innerHTML='';SSMPDPersonalHome.render(el);await new Promise(r=>setTimeout(r,300));return [...el.querySelectorAll('.ph-tile .ph-tile-tx')].map(x=>x.textContent);},admin));
for(const role of ['reception','nursing','sono_doctor']){const t=await tiles({id:'u-'+role,name:'x',role,active:true,inventory_assigned:true});
 assert.equal(t.filter(x=>x==='المخزن والجرد').length,1,role+': «المخزن والجرد» once, got '+JSON.stringify(t));}
const sup=await tiles({id:'u-sup',name:'x',role:'reception',active:true,inventory_assigned:false,inventory_supply_access:true});assert(sup.includes('طلب مستلزمات'),'supply-request-only keeps its tile: '+JSON.stringify(sup));
// search
const r=await page.evaluate(()=>{const S=SSMPDSearchDestinations,T=Object.keys(SSMPDUITitles.tabs),gm={id:'g',role:'super_admin',active:true},acc={id:'a',role:'accountant',active:true,module_permissions:[{module_key:'accounting',can_view:true}]};
 const one=(term,who,id)=>{const x=S.find(term,who,T).find(y=>y.id===id);return x?{label:x.label,path:x.path}:null;};
 return {doc:one('عقود الأطباء',gm,'doctor-contracts'),old:one('الأطباء والأتعاب',gm,'doctor-contracts'),sup:one('موردين',gm,'cash-suppliers'),cases:one('فروق الخزينة',acc,'cash-cases'),audit:one('سجل المراجعة',acc,'cash-audit'),auditGm:one('سجل المراجعة',gm,'cash-audit'),
  paths:S.catalog(gm,T).map(x=>x.path||'')};});
assert.deepEqual(r.doc,{label:'عقود الأطباء',path:'الحسابات / الصرف والمستحقات'});assert(r.old,'the old name still finds it');assert.equal(r.sup.label,'الموردين');
assert(r.cases,'«فروق الخزينة» is searchable');assert.equal(r.audit,null,'review-only section hidden from a non-reviewer');assert(r.auditGm,'shown to the GM');
assert(!r.paths.some(p=>/الخزينة والدورة المالية|التسعير والخدمات والباكجز/.test(p)),'no removed paths');
assert.deepEqual(errors,[]);await page.close();}
console.log('PASS nav name fixes 1280/390: «المخزن والجرد» once for reception/nursing/sono_doctor (supply-request tile kept), search labels/paths from the accounting menu, old names still match, review-only sections gated.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
