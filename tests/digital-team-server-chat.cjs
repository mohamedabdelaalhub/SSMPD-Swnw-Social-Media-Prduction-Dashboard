const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body><div id="app-root"><div id="user-dropdown"><div class="ud-items"></div></div><main id="view-container"><section class="digital-team"><div class="dt-grid"></div></section></main></div></body></html>',{url:'https://dashboard.swnwclinics.com',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.SSMPDAuth={currentAdmin:{id:'owner',name:'محمد',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-auth-token'}}})}})};
 let attachCalls=[],rooms=[],members={},messages={},calls=[],savedGrants=[],sendCount=0,failOnce=false,limitVal=4;
 const agents=[{code:'codex',name:'Codex',chat:true,task:true,connected:true},{code:'sia',name:'سيا',chat:true,task:true}];
 w.fetch=async(url,opts)=>{
  assert.equal(opts.headers.Authorization,'Bearer fixture-auth-token');
  assert(!url.includes('fixture-auth-token'),'token never in URL');
  const data=opts.body?JSON.parse(opts.body):null;calls.push({url,data});let value={};let status=200;
  if(url.endsWith('/bootstrap'))value={me:{id:'owner',name:'محمد',owner:true},agents};
  else if(url.endsWith('/grants')){if(data)savedGrants.push(data);value={grants:savedGrants};}
  else if(url.endsWith('/attachments')){attachCalls.push(data);value={id:'att'+attachCalls.length,name:data.name,kind:'image',mime:data.mime,size:3};}
  else if(url.endsWith('/users'))value={users:[{id:'owner',name:'محمد'},{id:'staff',name:'موظف الاختبار'}]};
  else if(url.endsWith('/rooms')){
   if(data){let id='room-'+(rooms.length+1);rooms.push({id,title:data.title,creator:'owner',agents:data.agents,can_manage:true,can_send:true});members[id]=[{user_id:'owner',name:'محمد',can_send:true,can_manage:true},...data.users.map(id=>({user_id:id,name:'موظف الاختبار',can_send:true,can_manage:false}))];messages[id]=[];value={id};}
   else value={rooms};
  }else if(url.includes('/limit')){if(data)limitVal=data.limit;value={limit:limitVal,used:2,day:'2026-11-06',min:1,max:200};}else if(url.includes('/export')){value={rows:[{time:'2026-11-06 15:00:00',room:'غرفة',sender:'محمد',agent:'Codex',text:'=HYPERLINK("x")'},{time:'2026-11-06 15:01:00',room:'غرفة',sender:'Codex',agent:'Codex',text:'رد "مقتبس"'}]};}else{
   const room=url.split('/')[4];
   if(url.endsWith('/members')){
    if(data){members[room]=data.users.map(u=>({user_id:u.id,can_send:u.send,can_manage:u.manage}));rooms.find(r=>r.id===room).agents=data.agents;}
    value={members:members[room],agents:rooms.find(r=>r.id===room)?.agents};
   }else if(url.includes('/messages')){
    if(data){sendCount++;if(failOnce){failOnce=false;throw Error('انقطع الاتصال');}
     messages[room].push({id:'m'+(messages[room].length+1),seq:1,author:'owner',name:'محمد',body:data.body,created:Date.now()/1000,attachments:(data.attachments||[]).map(i=>({id:i,name:'scan.png'}))});value={message_id:'m1'};}
    else value={messages:messages[room],jobs:[]};
   }
  }
  return{ok:status===200,status,json:async()=>value};
 };
 w.eval(fs.readFileSync('assets/js/digital-team-server-chat.js','utf8'));await wait();
 assert(d.querySelector('[data-server-team-chat]'),'Codex is a team member');
 await w.SSMPDServerTeamChat.open('codex');await wait();
 assert.equal(rooms.length,1);assert(d.querySelector('dialog[open]'));
 let form=d.querySelector('[data-sc-form]');form.elements.body.value='<script>not executable</script>';
 failOnce=true;form.requestSubmit();await wait();
 const first=calls.filter(c=>c.data?.request_key).at(-1).data.request_key;
 form.requestSubmit();await wait();
 const second=calls.filter(c=>c.data?.request_key).at(-1).data.request_key;
 assert.equal(first,second,'retry reuses idempotency key');
 assert.equal(d.querySelectorAll('[data-sc-messages] script').length,0,'message content escaped');
 assert(d.querySelector('[data-sc-messages]').textContent.includes('<script>'));
 d.querySelector('[data-sc-close]').click();await w.SSMPDServerTeamChat.open('codex');await wait();
 assert.equal(rooms.length,1,'private direct thread resumes');
 d.querySelector('[data-sc-new]').click();await wait();
 d.querySelector('[data-sc-agent=codex]').checked=true;d.querySelector('[data-sc-agent=sia]').checked=true;d.querySelector('[data-sc-user=staff]').checked=true;
 d.querySelector('[data-sc-create]').click();await wait();await wait();
 assert.equal(rooms.length,2,'mixed group created');
 assert.deepEqual(rooms[1].agents,['codex','sia']);
 d.querySelector('[data-sc-members]').click();await wait();
 assert.equal(d.querySelector('[data-sc-history]').checked,false,'new members do not see history by default');
 d.querySelector('[data-sc-save-members]').click();await wait();
 assert(calls.some(c=>c.data?.share_history===false));
 d.querySelector('[data-sc-access]').click();await wait();
 const grant=d.querySelector('[data-sc-grant=codex]');grant.querySelector('[name=chat]').checked=true;grant.querySelector('[data-sc-save-grant]').click();await wait();
 assert.equal(savedGrants[0].user_id,'staff');assert(savedGrants[0].chat);
 let saved=null;w.Blob=class{constructor(p,o){this.p=p;this.o=o;saved=this;}};w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
 d.querySelector('[data-sc-export]').click();await wait();
 d.querySelector('[data-sc-export-go]').click();await wait();
 const ex=calls.filter(c=>c.url.includes('/export')).at(-1);assert(/from=.*T00%3A00&to=.*T23%3A59/.test(ex.url),'export range sent');
 assert(saved&&saved.p[0].startsWith('\ufeff'),'CSV has BOM');assert(saved.p[0].includes("'=HYPERLINK"),'formula injection neutralised');assert(saved.p[0].includes('"رد ""مقتبس"""'),'quotes escaped');
 d.querySelector('[data-sc-limit]').click();await wait();
 assert(d.querySelector('[data-sc-limit-info]').textContent.includes('2 من 4'),'usage shown');
 d.querySelector('[name=sc-limit]').value='25';d.querySelector('[data-sc-limit-save]').click();await wait();
 assert.equal(limitVal,25,'limit saved');assert(d.querySelector('[data-sc-limit-info]').textContent.includes('2 من 25'));
 d.querySelector('[name=sc-limit]').value='999';const nBefore=calls.length;d.querySelector('[data-sc-limit-save]').click();await wait();assert.equal(calls.length,nBefore,'out-of-range not sent');

 // --- copy buttons + attachments (room-1 holds the 'Codex' private chat with the escaped message)
 d.querySelector('[data-sc-room=room-1]').click();await wait();await wait();
 messages['room-1'].push({id:'agent1',seq:2,author:'agent:codex',name:'Codex',body:'رد "مقتبس" <b>x</b>',created:Date.now()/1000,attachments:[]});
 await wait();await new Promise(r=>setTimeout(r,3100));
 const copyButtons=d.querySelectorAll('[data-sc-messages] [data-sc-copy]');
 assert.equal(copyButtons.length,d.querySelectorAll('[data-sc-messages] .sc-message').length,'every message (user and assistant) has a copy button');
 assert(copyButtons.length>=2);
 const cb=copyButtons[0];assert(cb.getAttribute('aria-label').includes('نسخ'),'accessible label');assert.equal(cb.type,'button');assert(cb.querySelector('svg'),'small icon');
 let copied=null;Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async t=>{copied=t;}}});
 const agentBtn=d.querySelector('[data-sc-copy=agent1]');agentBtn.click();await wait();
 assert.equal(copied,'رد "مقتبس" <b>x</b>','raw assistant text copied, not HTML');assert.equal(agentBtn.getAttribute('aria-label'),'تم النسخ');assert(d.querySelector('[data-sc-status]').textContent.includes('تم النسخ'));
 Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:undefined});let execd=false,execText=null;d.execCommand=(c)=>{execd=c==='copy';execText=d.activeElement&&d.activeElement.value;return true;};
 copyButtons[0].click();await wait();assert(execd,'fallback uses execCommand when the Clipboard API is missing');
 assert(!d.querySelector('dialog textarea[readonly]'),'fallback textarea removed');
 // attach
 assert(d.querySelector('[data-sc-warn]').textContent.includes('بيانات تعريف المرضى'),'patient-identifier warning shown');
 const pick=d.querySelector('[data-sc-file]');assert(pick.accept.includes('application/pdf'));
 Object.defineProperty(pick,'files',{configurable:true,value:[new w.File([new Uint8Array([137,80,78,71])],'scan.png',{type:'image/png'})]});
 pick.dispatchEvent(new w.Event('change'));await wait();await wait();await wait();
 assert.equal(attachCalls.length,1,'file uploaded to the attachments endpoint');assert.equal(attachCalls[0].name,'scan.png');assert(attachCalls[0].data.length>0);
 assert(d.querySelector('[data-sc-files]').textContent.includes('scan.png'),'chip shown');
 const big=new w.File([new Uint8Array(700001)],'big.pdf',{type:'application/pdf'});
 Object.defineProperty(pick,'files',{configurable:true,value:[big]});pick.dispatchEvent(new w.Event('change'));await wait();await wait();
 assert.equal(attachCalls.length,1,'oversize file never sent');assert(d.querySelector('[data-sc-status]').textContent.includes('700'));
 form=d.querySelector('[data-sc-form]');form.elements.body.value='حلل الصورة';form.requestSubmit();await wait();await wait();
 const sent=calls.filter(c=>c.data?.request_key).at(-1).data;assert.deepEqual(sent.attachments,['att1'],'message carries attachment ids');
 assert.equal(d.querySelector('[data-sc-files]').children.length,0,'chips cleared after send');
 await new Promise(r=>setTimeout(r,3100));assert(d.querySelector('.sc-chips').textContent.includes('scan.png'),'sent message shows attachment');
 exportCheck: {
  const txt=w.SSMPDServerTeamChat.exportText([{time:'t',room:'r',sender:'s',agent:'a',text:'x',attachments:'scan.png (image/png, 3 bytes)'}],'csv');
  assert(txt.includes('المرفقات')&&txt.includes('scan.png'),'export carries attachments');
 }
 w.SSMPDAuth.currentAdmin=null;d.getElementById('app-root').appendChild(d.createElement('div'));await wait();
 assert(!d.querySelector('dialog'),'logout removes private conversation');
 dom.window.close();
 console.log('PASS copy buttons (clipboard + fallback), attachments, server Codex UI, private resume, escaped messages, idempotent retry, mixed group, membership history, grants, logout');
})().catch(e=>{console.error(e);process.exit(1);});
