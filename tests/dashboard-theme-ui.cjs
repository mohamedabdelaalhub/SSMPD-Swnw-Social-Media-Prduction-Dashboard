/* Real renderers with the existing smoke test's in-memory fixture. No live API. */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const smoke=fs.readFileSync(path.join(ROOT,'test/smoke.js'),'utf8');
const start=smoke.indexOf('const now ='),end=smoke.indexOf('// ---------- jsdom ----------');
assert(start>=0&&end>start,'smoke fixture boundaries');
const mocks=smoke.slice(start,end);
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1].split('?')[0]).filter(f=>!f.startsWith('http'));
const styles=[...html.matchAll(/<link[^>]+href="([^"]+\.css)[^"]*"/g)].map(m=>m[1]);
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [1600,1280,1000,390,320]){
  const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url()),f=path.resolve(ROOT,'.'+decodeURIComponent(u.pathname));
   if(u.hostname==='theme.test'&&f.startsWith(ROOT+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});
   return r.fulfill({contentType:'application/json',body:'{}'});
  });
  await page.goto('https://theme.test/');
  await page.setContent('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app-root"></div></body></html>');
  await page.addScriptTag({content:mocks+`;window.supabase={createClient:()=>fakeClient};window.__fixture={TABLES,ME};TABLES.content_items[0].title="تمارين لتخفيف آلام الرقبة والظهر في المنزل";TABLES.content_items[0].content_format="video";`});
  // Load the production cascade, including the new theme; retain the late psychology sheet.
  for(const f of styles)if(!f.endsWith('dashboard-theme.css'))await page.addStyleTag({url:'https://theme.test/'+f});
  for(const f of scripts)await page.addScriptTag({url:'https://theme.test/'+f});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded',{bubbles:true})));
  await page.waitForSelector('#view-container');
  await page.evaluate(()=>document.querySelector('#user-dropdown [data-goto="summary"]').click());
  await page.waitForSelector('.kpi-card');
  // The theme must not change texts, form state, destinations or hidden controls.
  const snapshot=()=>page.evaluate(()=>({
   text:document.querySelector('#view-container').textContent,
   controls:[...document.querySelectorAll('input,select,textarea,button,a')].map(e=>({tag:e.tagName,id:e.id,value:e.value,checked:e.checked,disabled:e.disabled,hidden:e.hidden,href:e.getAttribute('href'),display:getComputedStyle(e).display==='none'}))
  }));
  const before=await snapshot();await page.addStyleTag({url:'https://theme.test/assets/css/dashboard-theme.css'});
  assert.deepEqual(await snapshot(),before,'theme preserves content, form state, targets and visibility');
  assert(await page.locator('#view-container>h2').evaluate(e=>getComputedStyle(e).backgroundImage.includes('linear-gradient')));
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  assert(await overflow(),'summary fits viewport '+width);
  if(process.env.RECEPTION_QA)await page.screenshot({path:path.join(process.env.RECEPTION_QA,'theme-summary-'+width+'.png'),fullPage:true});
  const summaryColumns=await page.locator('.kpi-grid').nth(1).evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  assert.equal(summaryColumns,width>=1000?3:2,'six summary metrics in balanced rows');
  await page.evaluate(()=>{SSMPDDb.listMetaAdPerformance=async()=>Array.from({length:110},(_,i)=>({ad_id:'ad-'+i,campaign_id:'campaign-'+(i%93),account_name:'حساب اختبار',campaign_name:'حملة اختبار',spend:i?0:122112.13,reach:i?0:2226133,impressions:i?0:3217179,clicks:i?0:60064,msg_conv:i?0:6917,leads:i?0:90}));SSMPDDb.listMetaSpecialtyPerformance=async()=>[];SSMPDDb.listMetaCreativePerformance=async()=>[];SSMPDDb.listMetaLeadAttribution=async()=>[];SSMPDDb.listContentMetaPerformance=async()=>[];document.querySelector('#tabs-bar [data-tab="metaads"]').click();});
  await page.waitForSelector('#ma-kpis .kpi-card');
  assert.equal(await page.locator('#ma-kpis .kpi-card').count(),10);
  assert.equal(await page.locator('#ma-kpis .value').first().textContent(),'122,112.13 ج.م');
  const metrics=await page.locator('#ma-kpis .kpi-grid').evaluate(e=>({columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,heights:[...e.children].map(c=>c.getBoundingClientRect().height),overflow:[...e.querySelectorAll('.value')].some(v=>v.scrollWidth>v.clientWidth+1),digitWrap:[...e.querySelectorAll('.value')].some(v=>{const t=v.firstChild,m=t.textContent.match(/[0-9][0-9,.]*/);if(!m)return false;const r=document.createRange();r.setStart(t,m.index);r.setEnd(t,m.index+m[0].length);return r.getClientRects().length>1;})}));
  assert.equal(metrics.columns,width>=1000?5:2);assert.equal(new Set(metrics.heights).size,1,'metric cards have equal heights');assert.equal(metrics.overflow,false,'metric values fit');assert.equal(metrics.digitWrap,false,'numbers never split across lines');assert(await overflow());
  if(process.env.RECEPTION_QA)await page.locator('#ma-kpis').screenshot({path:path.join(process.env.RECEPTION_QA,'theme-meta-metrics-'+width+'.png')});
  await page.evaluate(()=>document.querySelector('#tabs-bar [data-tab="review"]').click());
  await page.waitForSelector('[data-id="c1"]');
  assert(await overflow(),'review fits viewport '+width);
  await page.locator('[data-id="c1"]').first().click();
  await page.waitForSelector('.content-review-modal');
  assert(await page.locator('.content-review-modal>.modal-head').evaluate(e=>getComputedStyle(e).backgroundImage.includes('linear-gradient')));
  assert.equal(await page.locator('.content-review-modal [data-delete-item]').count(),1);
  assert(await page.locator('.content-review-modal .modal-close').isVisible());
  const statusColors=await page.locator('.content-review-modal .status-pill').first().evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor]);
  const theme=page.locator('link[href$="dashboard-theme.css"]');await theme.evaluate(e=>e.disabled=true);
  assert.deepEqual(await page.locator('.content-review-modal .status-pill').first().evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor]),statusColors,'status meanings/colors retained');
  await theme.evaluate(e=>e.disabled=false);
  const box=await page.locator('.content-review-modal').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,'modal fits '+width);
  assert(await page.locator('.content-review-modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'modal contents fit '+width);
  if(process.env.RECEPTION_QA)await page.screenshot({path:path.join(process.env.RECEPTION_QA,'theme-review-dialog-'+width+'.png'),fullPage:true});
  await page.locator('.content-review-modal .modal-close').click();assert.equal(await page.locator('.content-review-modal').count(),0);
  await page.locator('#user-menu-btn').click();
  await page.locator('.nav-menu-search input').fill('الحسابات');assert(await page.locator('#user-dropdown [data-goto="accounting"]').isVisible());
  const menu=await page.locator('#user-dropdown').boundingBox();assert(menu.x>=0&&menu.x+menu.width<=width+1&&menu.y+menu.height<=960+1,'menu fits '+width);
  if(process.env.RECEPTION_QA)await page.screenshot({path:path.join(process.env.RECEPTION_QA,'theme-menu-'+width+'.png'),fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#user-dropdown').isVisible(),false);
  await page.evaluate(()=>document.querySelector('#user-dropdown [data-goto="accounting"]').click());
  await page.waitForSelector('.acc-catalog-nav');await page.waitForSelector('.acc-catalog-grid');
  assert(await overflow(),'accounting fits '+width);
  if(process.env.RECEPTION_QA)await page.screenshot({path:path.join(process.env.RECEPTION_QA,'theme-accounting-'+width+'.png'),fullPage:true});
  // Shared screen primitives used by non-social modules and long native form values.
  await page.evaluate(()=>{document.querySelector('#view-container').innerHTML=`<div class="rx-shell"><header class="rx-header"><div><h2>الاستقبال والخدمات</h2><p>متابعة الحجز والتحصيل</p></div><button class="btn" id="theme-action">تحديث</button></header><div class="tabs"><button class="tab-btn active">الحجوزات</button><button class="tab-btn">الحسابات</button></div><div class="section"><form class="rx-form"><label>اسم المريض<input value="قيمة اختبار" required></label><label>للعرض<input value="ثابت" readonly></label><label>غير متاح<select disabled><option>غير نشط</option></select></label><input type="checkbox" checked><button hidden>مخفي</button><button class="btn" type="button" id="theme-event">فتح</button></form></div></div>`;window.themeClicks=0;document.querySelector('#theme-event').onclick=()=>window.themeClicks++;});
  await page.locator('#theme-event').click();assert.equal(await page.evaluate(()=>themeClicks),1);
  assert.equal(await page.locator('input[readonly]').inputValue(),'ثابت');assert(await page.locator('select[disabled]').isDisabled());assert.equal(await page.locator('#view-container button[hidden]').isVisible(),false);assert(await page.locator('input[type=checkbox]').isChecked());assert(await overflow(),'shared primitives fit '+width);
  if(process.env.RECEPTION_QA)await page.screenshot({path:path.join(process.env.RECEPTION_QA,'theme-reception-'+width+'.png'),fullPage:true});
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('.rx-header').evaluate(e=>getComputedStyle(e).backgroundImage),'none','screen theme excluded from print');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS dashboard theme: real summary/review/dialog at 1600/1280/1000/390/320; balanced 6/10 metric grids, equal heights, intact long numbers/currency; unchanged texts, form state, visibility and targets; native disabled/readonly/checked controls; click and close handlers; no overflow/runtime errors; print excluded.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
