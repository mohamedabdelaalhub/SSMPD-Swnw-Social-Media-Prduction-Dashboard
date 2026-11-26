// help 298 (owner 2026-11-26): one back arrow for every main screen + the accounting shell sections. Real Chromium, real accounting-shell.js + back-nav.js.
// Main screens: record(tab) history → arrow goes to the previous screen through SSMPDGotoTab; accounting: section history first (phone bar arrow and
// the top-bar arrow share one logic), then the screen before accounting; always present, disabled when there is nowhere to go.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/accounting-shell.css"><link rel="stylesheet" href="/assets/css/back-nav.css"></head><body>
<div class="topbar"><div class="topbar-tools"><button id="other" class="btn ghost sm header-icon" type="button">x</button></div></div><div id="host"></div>
<script>window.SSMPDAuth={currentAdmin:{id:'u1',role:'general_manager'}};window.SSMPDToast={show(){}};window.SSMPDI18n={t:function(v){return v;},textHtml:function(v){return v;}};window.went=[];window.SSMPDGotoTab=function(t){went.push(t);SSMPDBackNav.record(t);};</script>
<script src="/assets/js/accounting-shell.js"></script><script src="/assets/js/back-nav.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 const top=()=>page.locator('#back-nav-btn');
 // direction (owner): left in Arabic (rtl), right in English (ltr)
 await page.evaluate(()=>{SSMPDBackNav.record('home');});
 assert.equal(await top().evaluate(b=>getComputedStyle(b.querySelector('svg')).transform),'none','Arabic: arrow points left (no flip)');
 await page.evaluate(()=>{document.documentElement.dir='ltr';});assert.notEqual(await top().evaluate(b=>getComputedStyle(b.querySelector('svg')).transform),'none','English: flipped to point right');
 await page.evaluate(()=>{document.documentElement.dir='rtl';});
 // 1) main screens: no history → arrow present but disabled
 await page.evaluate(()=>{SSMPDBackNav.record('home');});assert.equal(await top().count(),1,'arrow is always in the top bar');assert.equal(await top().isDisabled(),true,'disabled with no history');
 await page.evaluate(()=>{SSMPDBackNav.record('patients');SSMPDBackNav.record('reception_services');});assert.equal(await top().isDisabled(),false);
 await top().click();assert.deepEqual(await page.evaluate(()=>went),['patients'],'back = previous main screen');assert.deepEqual(await page.evaluate(()=>SSMPDBackNav._t.stack()),['home'],'going back does not add history');
 await top().click();assert.deepEqual(await page.evaluate(()=>went),['patients','home']);assert.equal(await top().isDisabled(),true,'nowhere left');
 // 2) accounting: sections step back first, then the screen before accounting
 await page.evaluate(()=>{SSMPDBackNav.record('patients');SSMPDBackNav.record('accounting');window.sel=[];var ids=[];SSMPDAccountingShell.groups.forEach(function(g){(g.items||g.tabs||[]).forEach(function(i){ids.push(typeof i==='string'?i:i[0]);});});window.ids=ids;window.api=SSMPDAccountingShell.mount(document.getElementById('host'),{allowed:function(){return true;},active:ids[0],onSelect:function(id){sel.push(id);}});});
 const ids=await page.evaluate(()=>ids);assert(ids.length>=3,'shell has sections');
 const sbar=page.locator('[data-acs-back]');assert.equal(await sbar.count(),1,'shell bar has its own arrow');
 if(width<=860){assert.equal(await top().isHidden(),true,'phone: only the bar arrow shows inside accounting');}else{assert.equal(await top().isHidden(),false,'desktop: the top-bar arrow is the one');}
 assert.equal(await page.evaluate(()=>SSMPDBackNav.canBack()),true,'screen before accounting exists');
 await page.evaluate(i=>{document.querySelector('[data-acs-go="'+i+'"]').click();},ids[1]);await page.evaluate(i=>{document.querySelector('[data-acs-go="'+i+'"]').click();},ids[2]);
 assert.deepEqual(await page.evaluate(()=>sel),[ids[1],ids[2]]);
 const press=async()=>{if(width<=860)await sbar.click();else await top().click();};
 await press();assert.deepEqual(await page.evaluate(()=>sel),[ids[1],ids[2],ids[1]],'back = previous section');await press();assert.deepEqual(await page.evaluate(()=>sel).then(x=>x.slice(-1)),[ids[0]],'…then the first one');
 await press();assert.equal((await page.evaluate(()=>went)).slice(-1)[0],'patients','no sections left → the screen before accounting');
 if(width<=860)assert.equal(await page.evaluate(()=>document.body.classList.contains('bn-in-acs')),false);
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS back arrow 1280/390: always present, disabled with no history, previous main screen via SSMPDGotoTab (no history added by going back), accounting sections first then the screen before accounting, phone bar arrow / desktop top-bar arrow.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
