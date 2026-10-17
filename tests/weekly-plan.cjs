const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/ops-panels.css"></head><body><div id="c"></div><script>
window.SSMPDAuth={currentAdmin:{id:'x',role:'page_manager'}};window.opened=null;
const tomorrow=new Date(Date.now()+864e5).toISOString();
const q=(rows,count)=>({select(){return this},eq(){return this},gte(){return this},lte(){return this},order(){return Promise.resolve({data:rows})},then(r){return Promise.resolve({data:rows,count}).then(r)}});
window.SSMPDDb={getContentLearningBrief:b=>Promise.resolve({mix:{},do_more:[{dimension:'format',value:'carousel',confidence:'strong',evidence:{posts:9,ratio:2.5}}],do_less:[],experiments:[],staff_weak_ratings_30d:[],staff_strong_ratings_30d:[],upcoming_occasions:[{name:'اليوم العالمي للسكري',from:'2026-11-14',to:'2026-11-14',specialty:'internal'}],weekly_recommendations:['كرّر الكاروسيل الصبح'],weekly_report_week_end:'2026-10-16',recent_titles_45d:['عنوان قديم']}),
getAppSettings:()=>Promise.resolve({content_agent_gpt_url:'https://example.com/gpt'}),contentLearnings:()=>Promise.resolve([]),
client:{from(t){return {select(cols,opt){return {eq(){return this},gte(){return this},lte(){return this},order(){return Promise.resolve({data:[{title:'مادة متجدولة',content_format:'image_post',scheduled_publish_at:tomorrow}]})},then(r){return Promise.resolve({data:null,count:2}).then(r)}}}}}}};
window.open=(u)=>{window.opened=u};
</script><script src="/assets/js/learning-brief.js"></script><script src="/assets/js/weekly-plan.js"></script><script src="/assets/js/ops-panels.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
await page.evaluate(()=>SSMPDOpsPanels.learningPanel(document.getElementById('c')));await page.waitForSelector('[data-ops-weekly]');
await page.click('[data-ops-weekly]');await page.waitForSelector('[data-wp-go]');await page.selectOption('[data-wp-count]','14');await page.click('[data-wp-go]');await page.waitForSelector('.wp-text');
const t=await page.inputValue('.wp-text');
for(const k of ['WEEKLY PLAN','Brand: sono','Ideas requested: 14','ALREADY SCHEDULED THIS WEEK','«مادة متجدولة»','READY TO PUBLISH (بدون ميعاد بعد): 2','COVERAGE GAPS','ينقص','PERFORMANCE MEMORY','DO MORE','UPCOMING HEALTH OCCASIONS','WEEKLY REPORT RECOMMENDATIONS','WEEKLY PLAN OUTPUT','SSMPD_STRUCTURED_JSON'])assert(t.includes(k),'missing '+k);
await page.click('[data-wp-agent]');await page.waitForFunction(()=>window.opened==='https://example.com/gpt');
const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'fits '+JSON.stringify(size));assert.deepEqual(errors,[]);await page.close();}
console.log('PASS weekly plan: button always present, Brief has schedule/gaps/memory/output contract, agent link; 1280/390');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
