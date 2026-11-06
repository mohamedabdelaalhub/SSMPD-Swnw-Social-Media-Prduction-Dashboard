const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync('assets/js/'+n+'.js','utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function make({agents,hostname='dashboard.swnwclinics.com',jobs}){
 const dom=new JSDOM('<body><div id="app-root"></div><button id="dashboard-help-toggle"></button><div id="view-container"></div></body>',{runScripts:'outside-only',url:'https://'+hostname+'/'}),w=dom.window;
 w.queueMicrotask=fn=>queueMicrotask(()=>{if(w.document)fn();});
 const calls=[];let rooms=[],msgs=[];
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'k'}};
 w.supabase={createClient:()=>({from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(r)=>r({data:[],error:null})};return q;},auth:{getSession:async()=>({data:{session:{access_token:'fixture-token-xyz'}}})}})};
 w.fetch=async(url,o)=>{
  assert.equal(o.headers.Authorization,'Bearer fixture-token-xyz');assert(!url.includes('fixture-token-xyz'));
  const path=url.replace('/api/digital-team',''),body=o.body?JSON.parse(o.body):null;calls.push([o.method,path,body]);
  let value={},status=200;
  if(path==='/bootstrap')value={me:{id:'a'},agents};
  else if(path==='/rooms'&&o.method==='GET')value={rooms};
  else if(path==='/rooms'){const r={id:'room1',title:body.title,agents:body.agents};rooms.push(r);value={id:r.id};}
  else if(/\/messages$/.test(path)&&o.method==='POST'){msgs.push(body);value={message_id:'m'+msgs.length,duplicate:false};}
  else if(/\/messages$/.test(path))value={messages:[],jobs:jobs(msgs.length)};
  return {ok:status===200,json:async()=>value};
 };
 return {w,d:w.document,calls,dom};
}
(async()=>{
 const codex=(chat,connected)=>[{code:'codex',name:'Codex',chat,task:false,connected}];
 // 1) probe: hidden unless chat allowed AND connected
 for(const [chat,conn,want] of [[true,true,true],[false,true,false],[true,false,false]]){
  const t=make({agents:codex(chat,conn),jobs:()=>[]});t.w.eval(read('sono-ai-assist'));
  assert.equal(await t.w.SSMPDSonoAI.probe(),want,'probe '+chat+conn);assert.equal(t.w.SSMPDSonoAI.enabled(),want);
 }
 {const t=make({agents:codex(true,true),hostname:'mohamedabdelaalhub.github.io',jobs:()=>[]});t.w.eval(read('sono-ai-assist'));assert.equal(await t.w.SSMPDSonoAI.probe(),false,'not on the Pages copy');assert.equal(t.calls.length,0,'no request off the Contabo host');}
 // 2) ask: creates one private codex-only room, sends a question to codex only, returns the job text
 {let n=0;const t=make({agents:codex(true,true),jobs:()=>(++n<2?[{message_id:'m1',state:'running',text:'',error:''}]:[{message_id:'m1',state:'complete',text:'الخطوة 1',error:''}])});
  t.w.eval(read('sono-ai-assist'));
  const text=await t.w.SSMPDSonoAI.ask('ازاي اعمل حجز',{interval:5});assert.equal(text,'الخطوة 1');
  const post=t.calls.find(c=>c[0]==='POST'&&c[1]==='/rooms');assert.deepEqual(post[2].agents,['codex']);assert.deepEqual(post[2].users,[]);
  const send=t.calls.find(c=>c[1].endsWith('/messages')&&c[0]==='POST');assert.deepEqual(send[2].targets,['codex']);assert.equal(send[2].kind,'question');
  await t.w.SSMPDSonoAI.ask('تاني',{interval:5,timeout:80}).catch(()=>{});assert.equal(t.calls.filter(c=>c[0]==='POST'&&c[1]==='/rooms').length,1,'room reused');}
 // 3) limit / failure messages come from the server
 {const t=make({agents:codex(true,true),jobs:()=>[{message_id:'m1',state:'limited',text:'',error:'بلغت حصتك اليومية من أسئلة سونو؛ تتجدد 00:00 UTC'}]});t.w.eval(read('sono-ai-assist'));
  await assert.rejects(()=>t.w.SSMPDSonoAI.ask('سؤال',{interval:5}),/حصتك اليومية/);}
 // 4) assistant integration: button only when enabled; reply rendered as TEXT (no HTML injection)
 for(const enabled of [false,true]){
  const t=make({agents:codex(enabled,true),jobs:()=>[{message_id:'m1',state:'complete',text:'<img src=x onerror="window.__xss=1"> رد',error:''}]});
  const {w,d}=t;w.SSMPDAuth={currentAdmin:{id:'a',name:'موظف',role:'reception',active:true}};
  for(const n of ['roles','i18n-dictionary','i18n','ui-titles','search-destinations','dashboard-help-data','dashboard-help-fields','dashboard-help'])w.eval(read(n));
  w.SSMPDDashboardHelp.mount({tab:()=>'reception_services',tabs:()=>['reception_services'],navigate:()=>{}});
  w.eval(read('sono-ai-assist'));w.eval(read('employee-assistant'));
  await wait(1500);
  d.querySelector('.ssmpd-ea-launch').click();
  const inp=d.querySelector('[data-ea-input]');inp.value='ازاي اعمل حجز جديد';d.querySelector('[data-ea-send]').click();await wait(300);
  const btn=d.querySelector('[data-ea-ai]');
  if(!enabled){assert.equal(btn,null,'no AI button when off');continue;}
  assert(btn,'AI button when on');btn.click();await wait(2500);
  assert.equal(w.__xss,undefined,'reply is not executed');assert.equal(d.querySelector('.ssmpd-ea-chat img'),null,'reply is escaped');
  assert(d.querySelector('.ssmpd-ea-chat').textContent.includes('<img src=x'),'reply shown as text');
 }
 console.log('PASS sono-ai-assist');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
