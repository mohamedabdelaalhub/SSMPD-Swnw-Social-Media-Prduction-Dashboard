// owner screenshot 2026-11-26: «الساعات الإضافية» on a phone — a long task title in the «المهمة» select and the native date / month inputs made the
// form wider than its card and shifted the whole page. Real Chromium, real styles.css + hr-overtime.js with a long task title.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const data={settings:{pay_enabled:false,task_tolerance_pct:20,repeat_count:3,alert_minutes:60},me_person:'p1',people:[{id:'p1',name:'أنا'},{id:'p2',name:'موظف تاني باسم طويل جدًا جدًا جدًا جدًا جدًا جدًا'}],
 my_tasks:[{id:'t1',title:'مهمة بعنوان طويل جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا'}],mine:[],to_review:[],report:[],repeaters:[],is_hr:true,can_settings:true};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"></head><body><main style="padding:12px"><div id="host"></div></main><script>
window.SSMPDDb={client:{rpc:async()=>({data:${JSON.stringify(data)},error:null})}};</script><script src="/assets/js/hr-overtime.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const width of [390,360,1280]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.evaluate(()=>SSMPDHROvertime.mount(document.getElementById('host'),true));await page.waitForSelector('.ot-form select[name=task_id]');
 const r=await page.evaluate(()=>{const card=document.querySelector('.ot-card').getBoundingClientRect(),out=[];document.querySelectorAll('.ot-form input,.ot-form select,.ot-head input').forEach(e=>{const b=e.getBoundingClientRect();out.push([e.name||e.type,Math.round(b.left),Math.round(b.right),Math.round(card.left),Math.round(card.right)]);});return {out,sw:document.documentElement.scrollWidth,iw:innerWidth};});
 assert(r.sw<=r.iw+1,'no sideways scroll at '+width+' ('+r.sw+' > '+r.iw+')');
 r.out.forEach(x=>assert(x[1]>=x[3]-1&&x[2]<=x[4]+1,'field '+x[0]+' stays inside its card at '+width+': '+x.join(',')));
 if(width<=480){const w=await page.evaluate(()=>[...document.querySelectorAll('.ot-form input[name=day],.ot-form select[name=task_id],.ot-head input')].map(e=>Math.round(e.getBoundingClientRect().width)));assert(w.every(x=>x>=200),'date / task / month fields are full width on a phone: '+w);}
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS overtime layout 390/360/1280: long task title and native date/month inputs stay inside the card, no sideways scroll, fields full width on phones.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
