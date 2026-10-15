const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/styles.css"></head><body><div id="slot"></div><script>
window.calls=[];window.mode={super:true,can:true,remaining:500};
var jobs=[{id:'j1',status:'done',source:'auto',created_at:new Date().toISOString(),drive_url:'https://drive.google.com/file/d/ABC123/view',est_cost_usd:0.8,usd_to_egp_at_submit:52.5},{id:'j2',status:'queued',source:'manual',created_at:new Date().toISOString()},{id:'j3',status:'failed',source:'manual',created_at:new Date().toISOString(),error:'مشكلة في المفتاح أو الدفع'}];
window.SSMPDDb={
 aiClipOverview:function(){return Promise.resolve({settings:{enabled:true,auto_enqueue:true,monthly_budget_egp:500,usd_to_egp:52.5,default_model:'veo-3.1-fast-generate-preview',clip_seconds:8},spent_egp:42,remaining_egp:mode.remaining,est_clip_egp:42,can_request:mode.can,is_super:mode.super,jobs:jobs})},
 aiClipRequest:function(id,p){calls.push(['request',id,p]);jobs.unshift({id:'n'+calls.length,status:'queued',source:'manual',created_at:new Date().toISOString()});return Promise.resolve('x')},
 aiClipCancel:function(id){calls.push(['cancel',id]);jobs.find(function(j){return j.id===id}).status='cancelled';return Promise.resolve()},
 aiClipSaveSettings:function(s){calls.push(['save',s]);return Promise.resolve()}};
</script><script src="/assets/js/ai-clips.js"></script><script>SSMPDAiClips.mount(document.getElementById('slot'),{id:'c1',content_format:'video'})</script></body></html>`;
(async()=>{const s=http.createServer((q,r)=>{const u=q.url.split('?')[0];if(u==='/'){r.setHeader('content-type','text/html');return r.end(html)}const f=path.join(root,u);if(!fs.existsSync(f)){r.statusCode=404;return r.end()}r.setHeader('content-type',u.endsWith('.css')?'text/css':'text/javascript');r.end(fs.readFileSync(f))}).listen(0);
const b=await chromium.launch({args:['--no-sandbox']});
for(const width of [1100,390]){
 const p=await b.newPage({viewport:{width,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>{errs.push('native dialog');d.dismiss()});
 await p.goto('http://localhost:'+s.address().port+'/');await p.waitForSelector('.ai-clips-list');
 const t=await p.locator('.ai-clips').textContent();
 assert(/42/.test(t)&&/500/.test(t),'budget line');assert(/جاهزة/.test(t)&&/بتتولّد|في الانتظار/.test(t)&&/فشلت/.test(t),'statuses');
 assert(/مشكلة في المفتاح/.test(t),'error shown');
 // معاينة داخل الصفحة
 await p.click('[data-preview="ABC123"]');assert.equal(await p.locator('iframe.ai-clip-frame').getAttribute('src'),'https://drive.google.com/file/d/ABC123/preview');
 // تأكيد من خطوتين قبل أي صرف
 await p.fill('.ai-clips-prompt','عيادة هادية');await p.click('[data-ask]');assert(/تأكيد التوليد/.test(await p.locator('.ai-clips-confirm').textContent()));
 assert.equal(await p.evaluate(()=>calls.length),0,'nothing requested before confirm');
 await p.click('[data-no]');assert.equal(await p.locator('[data-go]').count(),0);
 await p.click('[data-ask]');await p.click('[data-go]');await p.waitForFunction(()=>calls.some(c=>c[0]==='request'));
 assert.deepEqual(await p.evaluate(()=>calls.find(c=>c[0]==='request').slice(1)),['c1','عيادة هادية']);
 // إلغاء طلب منتظر
 await p.click('[data-cancel="j2"]');await p.waitForFunction(()=>calls.some(c=>c[0]==='cancel'));
 // إعدادات للسوبر أدمن
 await p.click('[data-gear]');await p.fill('[data-settings] [name=budget]','300');await p.selectOption('[data-settings] [name=model]','veo-3.1-lite-generate-preview');await p.click('[data-settings] button');
 await p.waitForFunction(()=>calls.some(c=>c[0]==='save'));const saved=await p.evaluate(()=>calls.find(c=>c[0]==='save')[1]);assert.equal(saved.budget,300);assert.equal(saved.model,'veo-3.1-lite-generate-preview');assert.equal(saved.rate,52.5);
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal overflow');
 assert.deepEqual(errs,[]);await p.close();
}
// الحد خلص → الزرار مقفول، وغير المدير مفيش إعدادات
const p=await b.newPage();await p.addInitScript(()=>{});await p.goto('http://localhost:'+s.address().port+'/');await p.evaluate(()=>{mode.remaining=10;mode.super=false;});await p.evaluate(()=>{document.getElementById('slot').innerHTML='';SSMPDAiClips.mount(document.getElementById('slot'),{id:'c1',content_format:'video'})});
await p.waitForSelector('.ai-clips-list');assert.equal(await p.locator('[data-ask]').isDisabled(),true,'disabled when budget is gone');assert.equal(await p.locator('[data-gear]').count(),0,'no settings for non-super');
// مادة مش فيديو → مفيش حاجة
await p.evaluate(()=>{document.getElementById('slot').innerHTML='';SSMPDAiClips.mount(document.getElementById('slot'),{id:'c2',content_format:'image_post'})});assert.equal(await p.locator('.ai-clips').count(),0);
await b.close();s.close();console.log('PASS: Gemini clips panel — budget line, statuses, in-page Drive preview, two-step confirm before any spend, cancel, super-admin settings, disabled at budget limit, hidden for non-video. Mocked RPCs only.');})().catch(e=>{console.error(e);process.exit(1)});
