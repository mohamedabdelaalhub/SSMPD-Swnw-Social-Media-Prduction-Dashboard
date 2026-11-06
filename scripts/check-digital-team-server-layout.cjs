const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.SWNW_CHROMIUM_PATH?{executablePath:process.env.SWNW_CHROMIUM_PATH}:fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 const artifacts=process.env.SWNW_CHAT_SCREENSHOTS;
 if(artifacts)fs.mkdirSync(artifacts,{recursive:true});
 try{
  for(const width of [320,390,1280]){
   const page=await browser.newPage({viewport:{width,height:850}});
   const agents=[{code:'codex',name:'Codex',chat:true,task:true},{code:'sia',name:'سيا',chat:true,task:true}];
   const rooms=[{id:'r1',title:'محادثة مع Codex على سيرفر سونو',creator:'owner',agents:['codex'],can_manage:true,can_send:true}];
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/digital-team/')){
     let body={};
     if(url.pathname.endsWith('/bootstrap'))body={me:{id:'owner',name:'محمد',owner:true},agents};
     else if(url.pathname.endsWith('/rooms'))body={rooms};
     else if(url.pathname.endsWith('/messages'))body={messages:[{id:'m',author:'owner',name:'محمد',body:'عايز أراجع حالة السيرفر وأكمل المحادثة من هنا.',created:Date.now()/1000},{id:'n',author:'agent:codex',name:'Codex',body:'المحادثة محفوظة. نقدر نناقش المطلوب ونرجع لنفس السجل.',created:Date.now()/1000}],jobs:[]};
     else if(url.pathname.endsWith('/users'))body={users:[{id:'owner',name:'محمد'},...Array.from({length:12},(_,i)=>({id:'u'+i,name:'مستخدم اختبار باسم عربي للمقارنة '+i}))]};
     else if(url.pathname.endsWith('/grants'))body={grants:[]};
     else if(url.pathname.endsWith('/members'))body={members:[{user_id:'owner',name:'محمد',can_send:true,can_manage:true}],agents:['codex']};
     return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    }
    if(url.pathname==='/' )return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/digital-team.css"><link rel="stylesheet" href="/assets/css/digital-team-server-chat.css"></head><body><div id="app-root"><main id="view-container"><section class="digital-team"><div class="dt-grid"></div></section></main></div><script>window.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin'}};window.SSMPD_CONFIG={digitalTeamServer:true,supabase:{url:'https://fixture.invalid',anonKey:'test'}};window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fake-token'}}})}})};</script><script src="/assets/js/digital-team-server-chat.js"></script></body></html>`});
    const local=path.join(process.cwd(),url.pathname);
    if(local.startsWith(process.cwd()+path.sep)&&fs.existsSync(local)&&fs.statSync(local).isFile())return route.fulfill({path:local});
    return route.fulfill({status:404,body:''});
   });
   await page.goto('https://fixture.invalid/');
   await page.getByRole('button',{name:'محادثات السيرفر',exact:true}).click();
   await page.getByText('المحادثة محفوظة. نقدر نناقش المطلوب ونرجع لنفس السجل.').waitFor();
   const check=async()=>{
    const dims=await page.evaluate(()=>{const d=document.querySelector('dialog');return {page:document.documentElement.scrollWidth,view:innerWidth,dialog:d.scrollWidth,client:d.clientWidth,bottom:d.getBoundingClientRect().bottom,height:innerHeight};});
    assert(dims.page<=dims.view+1,JSON.stringify({width,dims}));assert(dims.dialog<=dims.client+1,JSON.stringify({width,dims}));assert(dims.bottom<=dims.height+1,JSON.stringify({width,dims}));
   };
   await check();if(artifacts)await page.screenshot({path:path.join(artifacts,`chat-${width}.png`)});
   await page.getByRole('button',{name:'إدارة الوصول',exact:true}).click();await page.locator('[data-sc-grant=codex]').waitFor();await check();
   if(artifacts)await page.screenshot({path:path.join(artifacts,`access-${width}.png`)});
   await page.getByRole('button',{name:'محادثة جديدة',exact:true}).click();await page.locator('[data-sc-user-search]').waitFor();
   await page.locator('[data-sc-user-search]').fill('المقارنة 5');assert.equal(await page.locator('.sc-person:not([hidden]):has([data-sc-user])').count(),1);
   await check();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),0);
   await page.close();
  }
  console.log('PASS 320/390/1280 RTL chat, grants, searchable participants, dialog sizing and Escape (synthetic data)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
