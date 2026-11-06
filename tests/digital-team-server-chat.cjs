const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body><div id="app-root"><div class="topbar-tools"><button id="notif-bell-btn"></button></div><div id="user-dropdown"><div class="ud-items"></div></div><main id="view-container"><section class="digital-team"><div class="dt-grid"></div></section></main></div></body></html>',{url:'https://dashboard.swnwclinics.com',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.SSMPDAuth={currentAdmin:{id:'owner',name:'محمد',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-auth-token'}}})}})};
 let isOwner=true,jobsMap={},ratingCalls=[],noteTotal=0,grantsSeed=[],readCalls=[],attachCalls=[],rooms=[],members={},messages={},calls=[],savedGrants=[],sendCount=0,failOnce=false,limitVal=4,empState={enabled:false,per_user:3,total:30};
 const agents=[{code:'codex',name:'Codex',chat:true,task:true,connected:true},{code:'claude',name:'Claude Code',chat:true,task:true,connected:true},{code:'sia',name:'سيا',chat:true,task:true}];
 w.fetch=async(url,opts)=>{
  assert.equal(opts.headers.Authorization,'Bearer fixture-auth-token');
  assert(!url.includes('fixture-auth-token'),'token never in URL');
  const data=opts.body?JSON.parse(opts.body):null;calls.push({url,data});let value={};let status=200;
  if(url.endsWith('/notifications'))value={total:noteTotal,items:[]};
  else if(url.endsWith('/read'))readCalls.push(url);
  else if(url.endsWith('/archive')){rooms.find(r=>r.id===url.split('/')[4]).archived=data.archived;value={ok:true};}
  else if(url.endsWith('/overview'))value={quota:{used:2,limit:25},employees:true,unanswered:3,ratings:{up:4,down:1}};
  else if(url.endsWith('/quota'))value={remaining:2,limit:3,used:1};
  else if(url.endsWith('/usage'))value={days:[{day:'2026-11-06',calls:5}],users:[{name:'موظف <b>أ</b>',calls:2}]};
  else if(url.endsWith('/unanswered'))value={items:[{created:1,asker:'موظف',question:'<i>سؤال</i>',title:'سونو'}]};
  else if(url.endsWith('/audit'))value={items:[{created:1,actor:'محمد',action:'grant',target:'staff'}]};
  else if(url.includes('/search?'))value={results:[{room:'room-1',title:'Codex',name:'محمد',snippet:'<b>نتيجة</b>'}]};
  else if(url.endsWith('/rating')){ratingCalls.push({url,data});value={ok:true};}
  else if(url.endsWith('/bootstrap'))value={me:{id:'owner',name:'محمد',owner:isOwner},agents};
  else if(url.endsWith('/grants')){if(data)savedGrants.push(data);value={grants:[...grantsSeed,...savedGrants]};}
  else if(url.endsWith('/attachments')){attachCalls.push(data);value={id:'att'+attachCalls.length,name:data.name,kind:'image',mime:data.mime,size:3};}
  else if(url.endsWith('/users'))value={users:[{id:'owner',name:'محمد'},{id:'staff',name:'موظف الاختبار'}]};
  else if(url.endsWith('/rooms')){
   if(data){let id='room-'+(rooms.length+1);rooms.push({id,title:data.title,creator:'owner',agents:data.agents,can_manage:true,can_send:true});members[id]=[{user_id:'owner',name:'محمد',can_send:true,can_manage:true},...data.users.map(id=>({user_id:id,name:'موظف الاختبار',can_send:true,can_manage:false}))];messages[id]=[];value={id};}
   else value={rooms};
  }else if(url.includes('/employees')){if(data)empState={...empState,...data};value={enabled:empState.enabled,per_user:empState.per_user,total:empState.total,day:'2026-11-06',used_total:2,users:[{name:'موظف <b>أ</b>',calls:2}],limits:{per_user:[1,50],total:[1,500]}};
  }else if(url.includes('/limit')){if(data)limitVal=data.limit;value={limit:limitVal,used:2,day:'2026-11-06',min:1,max:200};}else if(url.includes('/export')){value={rows:[{time:'2026-11-06 15:00:00',room:'غرفة',sender:'محمد',agent:'Codex',text:'=HYPERLINK("x")'},{time:'2026-11-06 15:01:00',room:'غرفة',sender:'Codex',agent:'Codex',text:'رد "مقتبس"'}]};}else{
   const room=url.split('/')[4];
   if(url.endsWith('/members')){
    if(data){members[room]=data.users.map(u=>({user_id:u.id,can_send:u.send,can_manage:u.manage}));rooms.find(r=>r.id===room).agents=data.agents;}
    value={members:members[room],agents:rooms.find(r=>r.id===room)?.agents};
   }else if(url.includes('/messages')){
    if(data){sendCount++;if(failOnce){failOnce=false;throw Error('انقطع الاتصال');}
     messages[room].push({id:'m'+(messages[room].length+1),seq:1,author:'owner',name:'محمد',body:data.body,created:Date.now()/1000,attachments:(data.attachments||[]).map(i=>({id:i,name:'scan.png'}))});value={message_id:'m1'};
     if(String(rooms.find(r=>r.id===room).title).includes('سونو')){messages[room].push({id:'sono-r1',seq:9,author:'agent:codex',name:'Codex',body:'الخطوات **هنا**',created:Date.now()/1000,attachments:[],my_rating:0,sources:[{id:'help:x',title:'إضافة حجز'}]});jobsMap[room]=[{id:'j1',message_id:'m1',agent:'codex',state:'complete',text:'',error:''}];}}
    else value={messages:messages[room],jobs:jobsMap[room]||[]};
   }
  }
  return{ok:status===200,status,json:async()=>value};
 };
 w.eval(fs.readFileSync('assets/js/digital-team-server-chat.js','utf8'));await wait();
 assert(d.querySelector('[data-server-team-chat]'),'Codex is a team member');
 assert(d.querySelector('[data-server-team-claude]'),'Claude Code card is present for the owner');
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
 {
  // new-chat form guards: counter, missing-grant reason + shortcut, create disabled
  d.querySelector('[data-sc-agent=codex]').checked=true;d.querySelector('[data-sc-agent=sia]').checked=true;d.querySelector('[data-sc-user=staff]').checked=true;
  d.querySelector('[data-sc-user=staff]').dispatchEvent(new w.Event('change'));
  assert(d.querySelector('[data-sc-count]').textContent.includes('2/8'),'agent counter');
  assert(!d.querySelector('[data-sc-reason]').hidden&&d.querySelector('[data-sc-reason]').textContent.includes('موظف الاختبار'),'missing grant reason names the user');
  assert.equal(d.querySelector('[data-sc-create]').disabled,true,'create disabled without grants');
  d.querySelector('[data-sc-open-access]').click();await wait();assert(d.querySelector('[data-sc-grant-user]'),'shortcut opens access management');
  grantsSeed.push({user_id:'staff',agent:'codex',chat:1},{user_id:'staff',agent:'sia',chat:1});
  d.querySelector('[data-sc-new]').click();await wait();
 }
 d.querySelector('[data-sc-agent=codex]').checked=true;d.querySelector('[data-sc-agent=sia]').checked=true;d.querySelector('[data-sc-user=staff]').checked=true;d.querySelector('[data-sc-user=staff]').dispatchEvent(new w.Event('change'));
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
 d.querySelector('[data-sc-emp]').click();await wait();
 assert(d.querySelector('[data-sc-emp-state]').textContent.includes('متوقف'),'employees default off');
 assert.equal(d.querySelector('[data-sc-emp-users] b'),null,'employee names are escaped');
 assert(d.querySelector('[data-sc-emp-users]').textContent.includes('<b>'),'name shown as text');
 d.querySelector('[name=sc-emp-on]').checked=true;d.querySelector('[name=sc-emp-user]').value='5';d.querySelector('[name=sc-emp-total]').value='40';d.querySelector('[data-sc-emp-save]').click();await wait();
 assert.deepEqual(empState,{enabled:true,per_user:5,total:40},'employee switch and limits saved');
 assert(d.querySelector('[data-sc-emp-state]').textContent.includes('شغّال'),'state shown');
 d.querySelector('[name=sc-emp-user]').value='99';{const n2=calls.length;d.querySelector('[data-sc-emp-save]').click();await wait();assert.equal(calls.length,n2,'out-of-range employee limit not sent');}

 // --- messenger bell, unread, invitation, archive

 {
  const bell=d.getElementById('sc-msg-btn');assert(bell,'messenger icon injected into the header');
  assert.equal(bell.nextElementSibling.id,'notif-bell-btn','placed before the notification bell');
  noteTotal=3;await w.SSMPDServerTeamChat.refreshNotifications();
  assert.equal(bell.querySelector('.sc-bell-badge').textContent,'3');assert(!bell.querySelector('.sc-bell-badge').hidden,'badge visible');
  noteTotal=0;await w.SSMPDServerTeamChat.refreshNotifications();assert(bell.querySelector('.sc-bell-badge').hidden,'badge hidden at zero');
  rooms[1].unread=2;rooms[1].invited=true;rooms[1].invited_by='<i>محمد</i>';rooms[1].last={name:'محمد',body:'<b>مرحبا</b>',created:1};
  d.querySelector('[data-sc-room=room-1]').click();await wait();await wait();
  const r2=d.querySelector('[data-sc-room=room-2]');assert(r2.textContent.includes('2'),'unread badge in the room list');assert(r2.textContent.includes('أضافك'),'invitation shown');
  assert.equal(r2.querySelector('i'),null,'inviter name escaped');assert.equal(r2.querySelector('b'),null,'last message escaped');
  const before=readCalls.length;r2.click();await wait();await wait();
  assert(readCalls.some(u=>u.endsWith('/rooms/room-2/read')),'opening a room marks it read');assert(readCalls.length>before);
  rooms[1].unread=0;rooms[1].invited=false;
  d.querySelector('[data-sc-arch=room-2]').click();await wait();await wait();
  assert.equal(rooms[1].archived,true,'archive sent');assert.equal(d.querySelector('[data-sc-room=room-2]'),null,'archived room leaves the main list');
  d.querySelector('[data-sc-archived]').click();await wait();await wait();
  assert(d.querySelector('[data-sc-room=room-2]'),'archive section lists it');
  d.querySelector('[data-sc-arch=room-2]').click();await wait();await wait();
  assert.equal(rooms[1].archived,false,'unarchive sent');
  d.querySelector('[data-sc-room=room-1]').click();await wait();await wait();
 }
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
 {
  const ta=d.querySelector('[name=body]');ta.value='مرحبا @co';ta.dispatchEvent(new w.Event('input'));
  const mb=d.querySelector('[data-sc-mention=codex]');assert(mb&&!d.querySelector('[data-sc-mentions]').hidden,'@ opens the agent list');
  mb.click();assert.equal(d.querySelector('[name=target]').value,'codex','mention selects the target');assert.equal(ta.value,'مرحبا ','mention token removed');
  ta.value='';ta.dispatchEvent(new w.Event('input'));assert(d.querySelector('[data-sc-mentions]').hidden);
  assert(d.querySelector('.sc-settings [data-sc-access]'),'admin actions live inside the settings menu');assert(d.querySelector('.sc-toolbar > [data-sc-new]'),'new chat stays primary');
 }
 {
  messages['room-1'].push({id:'agent2',seq:3,author:'agent:codex',name:'Codex',body:'**مهم** والأمر `ls` <img src=x onerror=alert(1)>\n- بند ١\n- بند ٢\n```\necho hi\n```',created:Date.now()/1000,attachments:[]});
  await new Promise(r=>setTimeout(r,3100));
  const am=Array.from(d.querySelectorAll('.sc-message.agent')).at(-1);
  assert(am.querySelector('strong'),'bold rendered');assert(am.querySelector('code'),'inline code');assert.equal(am.querySelectorAll('li').length,2,'list rendered');assert(am.querySelector('pre code').textContent.includes('echo hi'),'fenced block');
  assert.equal(am.querySelector('img'),null,'raw HTML never rendered');assert(am.textContent.includes('<img src=x'),'html shown as text');
  assert(am.querySelector('.sc-avatar.agent'),'agent avatar');assert(d.querySelectorAll('.sc-day').length>=1,'date separator');
  const q=d.querySelector('[data-sc-room-search]');q.value='ماليس';q.dispatchEvent(new w.Event('input'));await wait();assert.equal(d.querySelectorAll('[data-sc-room]').length,0,'room search filters');
  q.value='';q.dispatchEvent(new w.Event('input'));await wait();assert(d.querySelectorAll('[data-sc-room]').length>=2);
 }
 {
  // owner status bar, panel tabs, rating, message search, focus mode
  await w.SSMPDServerTeamChat.open('codex');await wait();await wait();
  const bar=d.querySelector('[data-sc-bar]');assert(!bar.hidden,'status bar shown');
  for(const x of ['2/25','شغّال','غير موثّق: 3','👍 4']) assert(bar.textContent.includes(x),'bar has '+x);
  d.querySelector('[data-sc-bar-unans]').click();await wait();await wait();
  assert(d.querySelector('[data-sc-tools]').textContent.includes('سؤال'),'unanswered list shown');assert.equal(d.querySelector('[data-sc-tools] i'),null,'question escaped');
  d.querySelector('[data-sc-tab=usage]').click();await wait();await wait();assert(d.querySelector('[data-sc-tools]').textContent.includes('<b>'),'usage names escaped as text');assert.equal(d.querySelector('[data-sc-tools] b'),null);
  d.querySelector('[data-sc-tab=audit]').click();await wait();await wait();assert(d.querySelector('[data-sc-tools]').textContent.includes('grant'));
  d.querySelector('[data-sc-dismiss]').click();await wait();
  d.querySelector('[data-sc-room=room-1]').click();await wait();await wait();
  const rb=d.querySelector('[data-sc-rate][data-value="1"]');assert(rb,'agent replies have rating buttons');rb.click();await wait();await wait();
  assert.equal(ratingCalls.at(-1).data.value,1,'rating sent');assert(/messages\/[^/]+\/rating$/.test(ratingCalls.at(-1).url));
  const sq=d.querySelector('[data-sc-room-search]');sq.value='نتيجة';sq.dispatchEvent(new w.Event('input'));
  assert(!d.querySelector('[data-sc-msg-search]').hidden);d.querySelector('[data-sc-msg-search]').click();await wait();await wait();
  assert(d.querySelector('[data-sc-hit=room-1]'),'message search hit');assert.equal(d.querySelector('[data-sc-hits] b:not(:first-child)'),null);assert(d.querySelector('[data-sc-hits]').textContent.includes('<b>نتيجة</b>'),'snippet escaped');
  sq.value='';sq.dispatchEvent(new w.Event('input'));
  d.querySelector('[data-sc-focus]').click();assert(d.querySelector('dialog').classList.contains('sc-focus'),'focus mode on');d.querySelector('[data-sc-focus]').click();
  sq.dispatchEvent(new w.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));assert.equal(d.activeElement,sq,'Ctrl+K focuses the search');
 }
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
 {
  // employee: simple Sono view with quota, example chips, answer, sources, rating
  d.querySelector('[data-sc-close]').click();isOwner=false;w.SSMPDServerTeamChat._pollMs(5);
  await w.SSMPDServerTeamChat.open();await wait();await wait();
  assert(d.querySelector('.sc-simple'),'employees land on the simple view');assert(d.querySelector('[data-sc-bar]').textContent.includes('2 من 3'),'remaining quota shown');
  d.querySelector('[data-sc-example]').click();assert(d.querySelector('[name=q]').value.length>3,'example chip fills the box');
  d.querySelector('[data-sc-ask]').requestSubmit();await new Promise(r=>setTimeout(r,120));await wait();
  const ans=d.querySelector('[data-sc-answer]');assert(ans.querySelector('strong'),'answer rendered');assert(ans.textContent.includes('إضافة حجز'),'source shown');
  ans.querySelector('[data-sc-rate][data-value="-1"]').click();await wait();await wait();assert.equal(ratingCalls.at(-1).data.value,-1);
  d.querySelector('[data-sc-full]').click();await wait();await wait();assert(d.querySelector('.sc-layout'),'full chat reachable');
  d.querySelector('[data-sc-close]').click();isOwner=true;
 }
 w.SSMPDAuth.currentAdmin=null;d.getElementById('app-root').appendChild(d.createElement('div'));await wait();
 assert(!d.querySelector('dialog'),'logout removes private conversation');
 dom.window.close();
 console.log('PASS copy buttons (clipboard + fallback), attachments, server Codex UI, private resume, escaped messages, idempotent retry, mixed group, membership history, grants, logout');
})().catch(e=>{console.error(e);process.exit(1);});
