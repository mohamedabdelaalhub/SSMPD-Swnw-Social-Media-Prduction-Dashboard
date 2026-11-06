/* Contabo conversations use the existing dashboard identity. Legacy advisory chat is preserved. */
(function(w){
'use strict';
if(w.SSMPDServerTeamChat)return;
var db=null,identity=null,rooms=[],users=[],agents=[],active='',dialog=null,timer=null,busy=false,revision=0,returnFocus=null;
var notif={total:0,items:[]},noteTimer=null,showArchived=false,roomQuery='';
var ICON_MSG='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
var base='/api/digital-team',files=[],texts={},uploading=0,pending=null,lastDraw='',grants=[],access=false,authId='';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function client(){if(db)return db;var c=w.SSMPD_CONFIG?.supabase;if(!c||!w.supabase)throw Error('سجّل الدخول أولًا');return db=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});}
async function api(path,body){
 if(w.location.hostname!=='dashboard.swnwclinics.com'&&w.SSMPD_CONFIG?.digitalTeamServer!==true)throw Error('محادثات Codex متاحة بعد ربط نسخة الداشبورد على السيرفر');
 var session=await client().auth.getSession(),token=session.data?.session?.access_token;
 if(!token)throw Error('سجّل الدخول أولًا');
 var response=await w.fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
 var data;try{data=await response.json();}catch(_){throw Error('خدمة محادثات السيرفر لم تُربط بهذه النسخة بعد');}
 if(!response.ok)throw Error(data.error||'تعذر الوصول للمحادثة');return data;
}
function status(text){if(dialog)dialog.querySelector('[data-sc-status]').textContent=text;}
function name(code){return agents.find(function(a){return a.code===code;})?.name||code;}
function node(q){return dialog?.querySelector(q);}
function button(label,attr){return '<button type="button" '+attr+'>'+esc(label)+'</button>';}
function closeMenu(){var m=node('[data-sc-settings]');if(m)m.open=false;}
function kill(){clearTimeout(timer);timer=null;}
var MAX_FILE=700000,MAX_FILES=3,ICON_COPY='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 9h10v10H9zM5 15V5h10"/></svg>',ICON_OK='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5 9-10"/></svg>';
function copyButton(id){return '<button type="button" class="sc-copy" data-sc-copy="'+esc(id)+'" aria-label="نسخ نص الرسالة" title="نسخ">'+ICON_COPY+'</button>';}
function chips(list){return (list&&list.length)?'<ul class="sc-chips">'+list.map(function(f){return '<li>📎 '+esc(f.name)+'</li>';}).join('')+'</ul>':'';}
function md(text){
 // Safe subset: everything is escaped first, then only a few fixed patterns become tags. No links, no raw HTML.
 var parts=String(text==null?'':text).split(/```/),out='';
 parts.forEach(function(part,i){
  if(i%2===1){out+='<pre class="sc-code"><code>'+esc(part.replace(/^[^\n]*\n/,function(m){return /^[\w+-]{0,12}\n$/.test(m)?'':m;}).replace(/\n$/,''))+'</code></pre>';return;}
  var lines=esc(part).split('\n'),html='',list='';
  function endList(){if(list){html+='</'+list+'>';list='';}}
  lines.forEach(function(l){
   var li=/^\s*[-*•]\s+(.*)$/.exec(l),ol=/^\s*\d+[.)]\s+(.*)$/.exec(l);
   if(li||ol){var t=li?'ul':'ol';if(list!==t){endList();html+='<'+t+'>';list=t;}html+='<li>'+inline((li||ol)[1])+'</li>';return;}
   endList();html+=inline(l)+'<br>';
  });
  endList();out+=html.replace(/(<br>)+$/,'');
 });
 return out;
}
function inline(t){return t.replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');}
function avatar(m){
 var agent=String(m.author||'').indexOf('agent:')===0,key=agent?String(m.author):String(m.author||m.name||''),h=0;
 for(var i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))%360;
 var label=String(m.name||'?').trim().charAt(0)||'?';
 return '<span class="sc-avatar'+(agent?' agent':'')+'" style="--h:'+h+'" aria-hidden="true">'+esc(label)+'</span>';
}
function dayLabel(sec){
 var d=new Date(sec*1000),now=new Date(),y=new Date(now.getTime()-864e5),same=function(a,b){return a.toDateString()===b.toDateString();};
 return same(d,now)?'اليوم':same(d,y)?'أمس':d.toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'});
}
function rateRow(m){
 var src=(m.sources&&m.sources.length)?'<span class="sc-sources">المصدر: '+m.sources.map(function(x){return esc(x.title);}).join('، ')+'</span>':'';
 return '<div class="sc-rate">'+button('👍','data-sc-rate="'+esc(m.id)+'" data-value="1" aria-label="رد مفيد" aria-pressed="'+(m.my_rating===1)+'"')+button('👎','data-sc-rate="'+esc(m.id)+'" data-value="-1" aria-label="رد غير مفيد" aria-pressed="'+(m.my_rating===-1)+'"')+button('📝 حوّل إلى مهمة','data-sc-task="'+esc(m.id)+'" title="ينسخ عنوان المهمة وتفاصيلها ثم يفتح شاشة المهام"')+src+'</div>';
}
function messageHtml(m,mine,prev){
 texts[m.id]=m.body;var agent=String(m.author||'').indexOf('agent:')===0;
 var sep=(!prev||new Date(prev.created*1000).toDateString()!==new Date(m.created*1000).toDateString())?'<div class="sc-day" role="separator">'+esc(dayLabel(m.created))+'</div>':'';
 return sep+'<article class="sc-message '+(mine?'mine':'')+(agent?' agent':'')+'">'+avatar(m)+'<div class="sc-msg-body"><div class="sc-msg-head"><b>'+esc(m.name)+'</b>'+copyButton(m.id)+'</div><p>'+(agent?md(m.body):esc(m.body))+'</p>'+chips(m.attachments)+(agent?rateRow(m):'')+'<small>'+esc(new Date(m.created*1000).toLocaleString('ar-EG'))+'</small></div></article>';
}
async function rate(btn){
 var want=Number(btn.dataset.value),on=btn.getAttribute('aria-pressed')==='true';
 try{await api('/messages/'+btn.dataset.scRate+'/rating',{value:on?0:want});lastDraw='';await poll(false);loadBar();}catch(e){status(e.message);}
}
function toast(msg){var t=document.createElement('div');t.className='sc-toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);w.setTimeout(function(){t.remove();},5000);}
function toTask(btn){
 var body=texts[btn.dataset.scTask];if(body==null)return;
 var lines=String(body).split('\n').map(function(l){return l.replace(/[*`#>-]+/g,'').trim();}).filter(Boolean),title=(lines[0]||'مهمة').slice(0,120);
 var html='<h4>طلب مهمة لـ Claude Creative</h4><p class="sc-hint">Claude Creative ينشئ المهمة في المشروع المناسب ويوكلها لمن يخصه الموضوع (المتابعة كل ساعة تقريبًا)، وبيوصلك إشعار.</p>'+
  '<label>عنوان المهمة<input name="sc-task-title" maxlength="160" value="'+esc(title)+'"></label><label>التفاصيل<textarea name="sc-task-body" rows="6" maxlength="8000">'+esc(body)+'</textarea></label>'+
  '<label>مين المسؤول أو أي مشروع؟ (اختياري)<input name="sc-task-hint" maxlength="300" placeholder="مثال: سارة من التسويق"></label><p class="sc-reason" data-sc-task-msg hidden></p>'+button('ابعت الطلب','data-sc-task-send class="sc-primary"')+button('إلغاء','data-sc-task-cancel');
 var host=node('[data-sc-tools]');
 if(host&&!node('[data-sc-answer]'))tools(html);
 else{var box=node('[data-sc-answer]');var old=box.querySelector('[data-sc-task-panel]');if(old)old.remove();var d=document.createElement('div');d.className='sc-task-panel';d.setAttribute('data-sc-task-panel','');d.innerHTML=html;box.appendChild(d);}
 var cancel=node('[data-sc-task-cancel]');
 cancel.onclick=function(){var p=node('[data-sc-task-panel]');if(p)p.remove();else{node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);}};
 node('[data-sc-task-send]').onclick=async function(){
  var b=this,msg=node('[data-sc-task-msg]');b.disabled=true;
  try{
   var r=await client().rpc('chat_task_request_submit',{p_title:node('[name=sc-task-title]').value,p_body:node('[name=sc-task-body]').value,p_hint:node('[name=sc-task-hint]').value||null});
   if(r.error)throw r.error;
   cancel.click();toast('اتسجّل الطلب. Claude Creative هيعمل المهمة ويوكلها وهيوصلك إشعار.');
  }catch(e){
   var m=String(e&&e.message||e);
   msg.hidden=false;msg.textContent=/chat_task_request_submit|function .* does not exist|schema cache/i.test(m)?'الميزة لسه ما اتفعلتش على الداشبورد (محتاجة ترقية قاعدة البيانات).':m;b.disabled=false;
  }
 };
}
async function copyText(text){
 try{if(w.navigator.clipboard&&w.navigator.clipboard.writeText){await w.navigator.clipboard.writeText(text);return true;}}catch(_){}
 var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.setAttribute('aria-hidden','true');ta.style.cssText='position:fixed;top:0;inset-inline-start:0;opacity:0;pointer-events:none';
 (dialog||document.body).appendChild(ta);ta.select();var ok=false;try{ok=!!document.execCommand('copy');}catch(_){ok=false;}ta.remove();return ok;
}
async function onCopy(btn){
 var text=texts[btn.dataset.scCopy];if(text==null)return;var ok=await copyText(text);
 if(!btn.isConnected)btn=node('[data-sc-copy="'+btn.dataset.scCopy+'"]');
 if(btn){btn.innerHTML=ok?ICON_OK:ICON_COPY;btn.classList.toggle('done',ok);btn.setAttribute('aria-label',ok?'تم النسخ':'تعذر النسخ');btn.title=ok?'تم النسخ':'تعذر النسخ';
  w.setTimeout(function(){if(btn.isConnected){btn.innerHTML=ICON_COPY;btn.classList.remove('done');btn.setAttribute('aria-label','نسخ نص الرسالة');btn.title='نسخ';}},1600);}
 status(ok?'تم النسخ':'تعذر النسخ؛ حدّد النص وانسخه يدويًا');
}
function sizeLabel(n){return n>=1000?Math.round(n/1000)+' ك.ب':n+' بايت';}
function renderFiles(){var box=node('[data-sc-files]');if(!box)return;
 box.innerHTML=files.map(function(f,i){return '<span class="sc-file">📎 '+esc(f.name)+' <small>'+esc(sizeLabel(f.size))+'</small><button type="button" data-sc-unfile="'+i+'" aria-label="إزالة المرفق '+esc(f.name)+'">×</button></span>';}).join('')+(uploading?'<span class="sc-file">جارٍ الرفع…</span>':'');
 box.querySelectorAll('[data-sc-unfile]').forEach(function(b){b.onclick=function(){files.splice(Number(b.dataset.scUnfile),1);pending=null;renderFiles();};});
}
function readBase64(blob){return new Promise(function(res,rej){var r=new w.FileReader();r.onload=function(){res(String(r.result).split(',')[1]||'');};r.onerror=function(){rej(Error('تعذر قراءة الملف'));};r.readAsDataURL(blob);});}
async function shrink(file){
 // Large photos are downscaled in the browser so they fit the upload limit; failure falls back to the original.
 if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size<=MAX_FILE*0.8||!w.createImageBitmap)return file;
 try{var bmp=await w.createImageBitmap(file),scale=Math.min(1,1600/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(bmp.width*scale));c.height=Math.max(1,Math.round(bmp.height*scale));var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(bmp,0,0,c.width,c.height);
  var blob=await new Promise(function(r){c.toBlob(r,'image/jpeg',0.82);});
  if(blob)return new w.File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});}catch(_){}
 return file;
}
async function attach(list){
 var room=active;if(!room||!identity?.owner)return;
 for(var i=0;i<list.length;i++){
  if(files.length+uploading>=MAX_FILES){status('الحد الأقصى '+MAX_FILES+' ملفات لكل رسالة');break;}
  var f=await shrink(list[i]);
  if(f.size>MAX_FILE){status('الملف "'+f.name+'" أكبر من 700 كيلوبايت');continue;}
  uploading++;renderFiles();
  try{var data=await readBase64(f);var out=await api('/rooms/'+room+'/attachments',{name:f.name,mime:f.type||'',data:data});
   if(room===active&&dialog){files.push(out);pending=null;status('تم رفع المرفق: '+out.name);}}
  catch(e){if(dialog)status(e.message);}
  finally{uploading--;if(dialog)renderFiles();}
 }
}
function ensureBell(){
 if(!access)return null;var host=document.querySelector('.topbar-tools');if(!host)return null;
 var b=document.getElementById('sc-msg-btn');
 if(!b){b=document.createElement('button');b.type='button';b.id='sc-msg-btn';b.className='sc-bell';b.title='رسائل الفريق';b.innerHTML=ICON_MSG+'<span class="sc-bell-badge" hidden></span>';
  var ref=document.getElementById('notif-bell-btn');if(ref&&ref.parentNode===host)host.insertBefore(b,ref);else host.prepend(b);
  b.onclick=function(){open(undefined,{full:true});};}
 return b;
}
function paintBell(){var b=ensureBell();if(!b)return;var s=b.querySelector('.sc-bell-badge'),n=Number(notif.total)||0;s.hidden=!n;s.textContent=n>99?'99+':String(n);b.setAttribute('aria-label','رسائل الفريق'+(n?' — '+n+' جديد':''));}
async function pollNotes(){if(!access||!authId)return;try{var n=await api('/notifications');notif={total:Number(n.total)||0,items:n.items||[]};}catch(_){}paintBell();}
function startNotes(){clearInterval(noteTimer);ensureBell();pollNotes();noteTimer=w.setInterval(function(){if(!document.hidden)pollNotes();},45000);}
function stopNotes(){clearInterval(noteTimer);noteTimer=null;notif={total:0,items:[]};var b=document.getElementById('sc-msg-btn');if(b)b.remove();}
function markRead(id){return api('/rooms/'+id+'/read',{}).then(function(){return pollNotes();}).catch(function(){});}
function close(){kill();revision++;files=[];texts={};uploading=0;dialog?.remove();dialog=null;returnFocus?.focus();lastDraw='';pollNotes();}
function frame(){
 returnFocus=document.activeElement;
 dialog=document.createElement('dialog');dialog.className='sc-dialog';dialog.dir='rtl';dialog.setAttribute('aria-label','محادثات الفريق على السيرفر');
 dialog.innerHTML='<header class="sc-header"><div><button type="button" class="sc-drawer" data-sc-drawer aria-label="قائمة المحادثات">☰</button><h2>محادثات الفريق</h2><p>Codex على كونتابو · سجل محفوظ</p></div>'+'<span class="sc-header-actions">'+button('تركيز','data-sc-focus aria-pressed="false" title="وضع التركيز (إخفاء القوائم)"')+button('إغلاق','data-sc-close')+'</span></header><div class="sc-bar" data-sc-bar hidden></div>'+
 '<div class="sc-toolbar">'+button('محادثة جديدة','data-sc-new class="sc-primary"')+button('المشاركون','data-sc-members disabled')+(identity.owner?'<details class="sc-settings" data-sc-settings><summary>إعدادات</summary><div class="sc-settings-menu">'+button('لوحة المالك','data-sc-panel')+button('إدارة الوصول','data-sc-access')+button('الحصة اليومية','data-sc-limit')+button('سونو للموظفين','data-sc-emp')+button('تصدير','data-sc-export')+'</div></details>':'')+'</div>'+
 '<div class="sc-layout"><aside aria-label="المحادثات" class="sc-side"><input type="search" data-sc-room-search placeholder="ابحث في المحادثات" aria-label="بحث في المحادثات"><button type="button" class="sc-msg-search" data-sc-msg-search hidden>ابحث في الرسائل</button><div data-sc-hits></div><div data-sc-rooms></div></aside><section class="sc-conversation"><h3 data-sc-title>اختر محادثة</h3><div class="sc-tools" data-sc-tools hidden></div><div class="sc-messages" data-sc-messages aria-live="polite"></div>'+
 '<form data-sc-form class="sc-compose"><div class="sc-compose-options"><label class="sc-opt">النوع <select name="kind" aria-label="نوع الرسالة"><option value="chat">رسالة</option><option value="question">سؤال</option><option value="instruction">تعليمات للنقاش</option><option value="task">طلب تنفيذ</option></select></label><label class="sc-opt">إلى <select name="target" aria-label="الوكيل المطلوب"></select></label></div>'+(identity.owner?'<details class="sc-warn-wrap"><summary>ⓘ تنبيه المرفقات</summary><p class="sc-attach-warn" data-sc-warn>تنبيه: لا ترفع ملفات أو صورًا فيها بيانات تعريف المرضى (الاسم أو الهوية أو الهاتف أو رقم الملف). المرفقات تُحفظ على السيرفر وتُرسل إلى محرك الذكاء الاصطناعي.</p></details><div class="sc-files" data-sc-files aria-live="polite"></div>':'')+'<div class="sc-send">'+(identity.owner?'<button type="button" class="sc-attach" data-sc-attach aria-label="إرفاق ملف أو صورة" title="إرفاق ملف أو صورة (png / jpg / webp / pdf / txt / csv / md — حتى 700 ك.ب)">📎</button><input type="file" data-sc-file hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.csv,.md,text/plain,text/csv,text/markdown">':'')+'<div class="sc-input"><div class="sc-mentions" data-sc-mentions hidden></div><textarea name="body" rows="2" maxlength="200000" placeholder="اكتب رسالتك… (@ لاختيار وكيل)" aria-label="نص الرسالة"></textarea></div><button type="submit">إرسال</button></div><p class="sc-hint">Enter للإرسال · Shift+Enter سطر جديد · @ لاستدعاء وكيل</p></form><p class="sc-status" role="status" data-sc-status></p></section></div>';
 document.body.appendChild(dialog);dialog.showModal();
 node('[data-sc-close]').onclick=close;
 node('[data-sc-room-search]').oninput=function(){roomQuery=this.value;node('[data-sc-msg-search]').hidden=roomQuery.trim().length<2;node('[data-sc-hits]').innerHTML='';refreshRooms().catch(function(e){status(e.message);});};
 node('[data-sc-msg-search]').onclick=searchMessages;
 node('[data-sc-focus]').onclick=function(){var on=dialog.classList.toggle('sc-focus');this.setAttribute('aria-pressed',String(on));};
 dialog.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();var i=node('[data-sc-room-search]');if(i){dialog.classList.remove('sc-focus');node('.sc-layout').classList.add('show-rooms');i.focus();}}
  else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&node('[data-sc-form]')&&!node('[data-sc-form]').hidden){e.preventDefault();node('[data-sc-form]').requestSubmit();}
 });
 node('[data-sc-drawer]').onclick=function(){node('.sc-layout').classList.toggle('show-rooms');};
 dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
 node('[data-sc-new]').onclick=createForm;
 node('[data-sc-members]').onclick=membersForm;
  if(identity.owner)node('[data-sc-panel]').onclick=function(){closeMenu();ownerPanel('usage');};
 if(identity.owner)node('[data-sc-access]').onclick=function(){closeMenu();accessForm();};
 if(identity.owner)node('[data-sc-export]').onclick=function(){closeMenu();exportForm();};
 if(identity.owner)node('[data-sc-limit]').onclick=function(){closeMenu();limitForm();};
 if(identity.owner)node('[data-sc-emp]').onclick=function(){closeMenu();empForm();};
 node('[data-sc-form]').onsubmit=function(e){e.preventDefault();send();};
 node('[name=body]').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();node('[data-sc-form]').requestSubmit();}});
 node('[name=body]').addEventListener('input',function(){pending=null;mentionList();});
 node('[data-sc-messages]').addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-sc-copy]');if(b)onCopy(b);
  var r=e.target.closest&&e.target.closest('[data-sc-rate]');if(r)rate(r);
  var tk=e.target.closest&&e.target.closest('[data-sc-task]');if(tk)toTask(tk);
  var p=e.target.closest&&e.target.closest('[data-sc-prompt]');if(p){var ta=node('[name=body]');ta.value=p.dataset.scPrompt;ta.focus();}});
 if(identity.owner){var pick=node('[data-sc-file]');node('[data-sc-attach]').onclick=function(){pick.click();};pick.onchange=function(){var list=Array.from(pick.files||[]);pick.value='';attach(list);};}
 node('[name=kind]').onchange=function(){pending=null;};node('[name=target]').onchange=function(){pending=null;};
}
async function open(code,opts){
 try{
  var boot=await api('/bootstrap');identity=boot.me;agents=boot.agents;
  if(!code&&!identity.owner&&!(opts&&opts.full)&&!dialog&&agents.some(function(a){return a.code==='codex'&&a.chat;}))return openSimple();
  if(!dialog)frame();
  loadBar();
  await refreshRooms();
  if(code){var existing=rooms.find(function(r){return r.agents.length===1&&r.agents[0]===code&&r.creator===identity.id;});
   // Do not silently reuse a group containing other people as a private direct conversation.
   if(existing){var info=await api('/rooms/'+existing.id+'/members');if(info.members.length===1)return selectRoom(existing.id);}
   var result=await api('/rooms',{agents:[code],users:[],title:name(code)});await refreshRooms();return selectRoom(result.id);
  }
  if(active&&rooms.some(function(r){return r.id===active;}))await selectRoom(active);
  else if(rooms.length)await selectRoom(rooms[0].id);
 }catch(e){if(dialog)status(e.message);else w.alert(e.message);}
}
async function ensureSonoRoom(){
 var r=(await api('/rooms')).rooms.find(function(x){return x.title===SONO_TITLE&&x.agents.length===1&&x.agents[0]==='codex'&&x.creator===identity.id;});
 return r?r.id:(await api('/rooms',{agents:['codex'],users:[],title:SONO_TITLE})).id;
}
var SONO_TITLE='سونو الذكي — إرشاد';
async function openSimple(){
 returnFocus=document.activeElement;
 dialog=document.createElement('dialog');dialog.className='sc-dialog sc-simple';dialog.dir='rtl';dialog.setAttribute('aria-label','اسأل سونو');
 dialog.innerHTML='<header class="sc-header"><div><h2>اسأل سونو</h2><p>إرشاد عن شاشات الداشبورد وخطواتها</p></div><span class="sc-header-actions">'+button('كل المحادثات','data-sc-full')+button('إغلاق','data-sc-close')+'</span></header><div class="sc-bar" data-sc-bar hidden></div>'+
  '<div class="sc-simple-body"><form data-sc-ask class="sc-ask"><textarea name="q" rows="3" maxlength="4000" placeholder="اكتب سؤالك عن الداشبورد…" aria-label="سؤالك"></textarea><button type="submit" class="sc-primary">اسأل</button></form>'+
  '<div class="sc-prompts" data-sc-examples>'+PROMPTS.map(function(t){return button(t,'data-sc-example="'+esc(t)+'"');}).join('')+'</div><div class="sc-answer" data-sc-answer aria-live="polite"></div><p class="sc-status" role="status" data-sc-status></p></div>';
 document.body.appendChild(dialog);dialog.showModal();
 node('[data-sc-close]').onclick=close;dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
 node('[data-sc-full]').onclick=function(){close();open(undefined,{full:true});};
 dialog.querySelectorAll('[data-sc-example]').forEach(function(b){b.onclick=function(){var ta=node('[name=q]');ta.value=b.dataset.scExample;ta.focus();};});
 var form=node('[data-sc-ask]');form.onsubmit=function(e){e.preventDefault();askSono();};
 form.elements.q.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
 loadBar();
}
async function askSono(){
 if(busy)return;var form=node('[data-sc-ask]'),q=form.elements.q.value.trim();if(!q)return;
 var out=node('[data-sc-answer]'),mine=dialog;busy=true;form.querySelector('button[type=submit]').disabled=true;out.innerHTML='<p class="sc-job typing">سونو بيراجع الدليل<span class="sc-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>';
 try{
  var room=await ensureSonoRoom(),sent=await api('/rooms/'+room+'/messages',{body:q,kind:'question',targets:['codex'],request_key:w.crypto.randomUUID()}),deadline=Date.now()+150000;
  while(Date.now()<deadline&&dialog===mine){
   await new Promise(function(r){setTimeout(r,SIMPLE_POLL);});
   var h=await api('/rooms/'+room+'/messages'),job=(h.jobs||[]).find(function(j){return j.message_id===sent.message_id;});
   if(!job)continue;
   if(job.state==='complete'){
    var reply=h.messages.filter(function(m){return String(m.author).indexOf('agent:')===0;}).pop();
    if(dialog!==mine)return;texts[reply.id]=reply.body;
    out.innerHTML='<article class="sc-message agent"><span class="sc-avatar agent" style="--h:210" aria-hidden="true">س</span><div class="sc-msg-body"><div class="sc-msg-head"><b>سونو</b>'+copyButton(reply.id)+'</div><p>'+md(reply.body)+'</p>'+rateRow(reply)+'</div></article>';
    out.querySelector('[data-sc-copy]').onclick=function(){onCopy(this);};
    out.querySelector('[data-sc-task]').onclick=function(){toTask(this);};
    out.querySelectorAll('[data-sc-rate]').forEach(function(b){b.onclick=async function(){var on=b.getAttribute('aria-pressed')==='true';try{await api('/messages/'+b.dataset.scRate+'/rating',{value:on?0:Number(b.dataset.value)});b.setAttribute('aria-pressed',String(!on));var o=out.querySelector('[data-sc-rate][aria-pressed=true]');out.querySelectorAll('[data-sc-rate]').forEach(function(x){if(x!==b)x.setAttribute('aria-pressed','false');});}catch(e){status(e.message);}};});
    form.elements.q.value='';loadBar();return;
   }
   if(['failed','limited','cancelled','interrupted'].indexOf(job.state)>=0){out.innerHTML='<p class="sc-job">'+esc(job.error||stateNames[job.state]||'تعذر الرد الآن')+'</p>';return;}
  }
  if(dialog===mine)out.innerHTML='<p class="sc-job">الرد تأخر؛ جرّب بعد قليل</p>';
 }catch(e){if(dialog===mine)out.innerHTML='<p class="sc-job">'+esc(e.message)+'</p>';}
 finally{busy=false;if(dialog===mine)form.querySelector('button[type=submit]').disabled=false;}
}
var SIMPLE_POLL=1500;
async function refreshRooms(){
 var data=await api('/rooms');rooms=data.rooms;
 if(!dialog)return;
 var q=roomQuery.trim().toLocaleLowerCase(),hit=function(r){return !q||String(r.title).toLocaleLowerCase().indexOf(q)>=0;},live=rooms.filter(function(r){return !r.archived&&hit(r);}),arch=rooms.filter(function(r){return r.archived&&hit(r);});
 function row(r){
  var badge=r.unread?'<span class="sc-unread">'+(r.unread>99?'99+':r.unread)+'</span>':(r.invited?'<span class="sc-new">جديدة</span>':'');
  var sub=r.invited&&r.invited_by?'أضافك '+esc(r.invited_by):(r.last?esc(r.last.name)+': '+esc(r.last.body):'');
  return '<div class="sc-room'+((r.unread||r.invited)?' has-new':'')+'"><button type="button" data-sc-room="'+esc(r.id)+'" aria-current="'+(active===r.id?'true':'false')+'"><span class="sc-room-title">'+esc(r.title)+'</span>'+badge+(sub?'<small>'+sub+'</small>':'')+'</button>'+
   '<button type="button" class="sc-arch" data-sc-arch="'+esc(r.id)+'" data-flag="'+(r.archived?'0':'1')+'" title="'+(r.archived?'إلغاء الأرشفة':'أرشفة')+'" aria-label="'+(r.archived?'إلغاء أرشفة المحادثة':'أرشفة المحادثة')+'">'+(r.archived?'↩':'🗄')+'</button></div>';
 }
 node('[data-sc-rooms]').innerHTML=(live.map(row).join('')||'<p class="sc-empty">ابدأ محادثة مع Codex</p>')+
  (arch.length?'<button type="button" class="sc-arch-toggle" data-sc-archived aria-expanded="'+showArchived+'">الأرشيف ('+arch.length+')</button>'+(showArchived?arch.map(row).join(''):''):'');
 dialog.querySelectorAll('[data-sc-room]').forEach(function(b){b.onclick=function(){selectRoom(b.dataset.scRoom);};});
 dialog.querySelectorAll('[data-sc-arch]').forEach(function(b){b.onclick=async function(){try{await api('/rooms/'+b.dataset.scArch+'/archive',{archived:b.dataset.flag==='1'});await refreshRooms();pollNotes();}catch(e){status(e.message);}};});
 var tg=node('[data-sc-archived]');if(tg)tg.onclick=function(){showArchived=!showArchived;refreshRooms().catch(function(e){status(e.message);});};
}
async function selectRoom(id){
 var lay=node('.sc-layout');if(lay)lay.classList.remove('show-rooms');
 active=id;revision++;pending=null;lastDraw='';files=[];texts={};renderFiles();kill();node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');
 var r=rooms.find(function(x){return x.id===id;});if(!r)return;
 node('[data-sc-title]').textContent=r.title;node('[data-sc-members]').disabled=!r.can_manage;
 node('[data-sc-form]').hidden=!r.can_send;
 node('[name=target]').innerHTML='<option value="">'+(r.agents.length===1?'الرد من '+esc(name(r.agents[0])):'رسالة للمشاركين')+'</option>'+r.agents.map(function(a){return '<option value="'+esc(a)+'">@'+esc(name(a))+'</option>';}).join('')+(r.agents.length>1?'<option value="all">اطلب رأي الوكلاء المشاركين</option>':'');
 await markRead(id);refreshRooms().catch(function(e){status(e.message);});await poll(true);
}
var stateNames={limited:'بلغت حصة المحادثات اليومية',queued:'في الانتظار',running:'يرد الآن',complete:'اكتمل الرد',failed:'تعذر الرد',interrupted:'انقطع التشغيل',cancelled:'أُوقف',awaiting_owner:'طلب تنفيذ ينتظر مراجعة المالك',unconnected:'محرك الوكيل لم يُربط بهذه القناة بعد'};
async function poll(scroll){
 if(!dialog||!active)return;var room=active,ticket=revision;
 try{
  var data=await api('/rooms/'+room+'/messages');if(!dialog||room!==active||ticket!==revision)return;
  var hash=JSON.stringify(data),box=node('[data-sc-messages]'),nearEnd=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  if(hash!==lastDraw){var firstDraw=lastDraw==='';lastDraw=hash;if(!firstDraw){markRead(room);refreshRooms().catch(function(){});}
   if(!data.messages.length&&!data.jobs.length){box.innerHTML='<div class="sc-prompts"><p>جرّب سؤالًا سريعًا:</p>'+PROMPTS.map(function(t){return button(t,'data-sc-prompt="'+esc(t)+'"');}).join('')+'</div>';}else
   box.innerHTML=(data.before?button('رسائل أقدم','data-sc-older="'+data.before+'"'):'')+data.messages.map(function(m,i){return messageHtml(m,m.author===identity.id,data.messages[i-1]);}).join('')+
    data.jobs.filter(function(j){return j.state!=='complete';}).map(function(j){var live=j.state==='queued'||j.state==='running',bad=['failed','interrupted','limited'].indexOf(j.state)>=0;return '<article class="sc-job'+(live?' typing':'')+'"><b>'+esc(name(j.agent))+' · '+esc(stateNames[j.state]||j.state)+(live?'<span class="sc-dots" aria-hidden="true"><i></i><i></i><i></i></span>':'')+'</b><p>'+esc(j.state==='running'?j.text:j.error)+'</p>'+(['queued','running','awaiting_owner'].includes(j.state)?button('إيقاف','data-sc-cancel="'+esc(j.id)+'"'):'')+(bad&&texts[j.message_id]?button('إعادة المحاولة','data-sc-retry="'+esc(j.id)+'" data-agent="'+esc(j.agent)+'" data-msg="'+esc(j.message_id)+'"'):'')+'</article>';}).join('');
   box.querySelectorAll('[data-sc-retry]').forEach(function(b){b.onclick=async function(){b.disabled=true;try{await api('/rooms/'+room+'/messages',{body:texts[b.dataset.msg],kind:'question',targets:[b.dataset.agent],request_key:w.crypto.randomUUID()});poll(false);}catch(e){status(e.message);b.disabled=false;}};});
   box.querySelectorAll('[data-sc-cancel]').forEach(function(b){b.onclick=async function(){try{await api('/rooms/'+room+'/cancel/'+b.dataset.scCancel,{});poll(false);}catch(e){status(e.message);}};});
   var older=box.querySelector('[data-sc-older]');if(older)older.onclick=function(){loadOlder(older,room);};
   if(scroll||nearEnd)box.scrollTop=box.scrollHeight;
  }
  status('الرسائل محفوظة على السيرفر. طلبات التنفيذ تحتاج مسار اعتماد المالك.');
 }catch(e){if(dialog&&ticket===revision){status(e.message);node('[data-sc-messages]').replaceChildren();node('[data-sc-form]').hidden=true;}}
 finally{if(dialog&&ticket===revision){kill();timer=w.setTimeout(function(){poll(false);},3000);}}
}
async function loadOlder(b,room){try{var data=await api('/rooms/'+room+'/messages?before='+encodeURIComponent(b.dataset.scOlder));if(room!==active||!dialog)return;
 var wrap=document.createElement('div');wrap.innerHTML=data.messages.map(function(m){return messageHtml(m,false);}).join('');b.after(wrap);if(data.before)b.dataset.scOlder=data.before;else b.remove();}catch(e){status(e.message);}}
async function send(){
 if(!active||busy)return;var f=node('[data-sc-form]'),body=f.elements.body.value.trim();if(!body&&files.length)body='(مرفقات)';if(!body)return;
 var r=rooms.find(function(x){return x.id===active;}),target=f.elements.target.value;
 var targets=target==='all'?r.agents:target?[target]:[];
 if(uploading){status('انتظر اكتمال رفع المرفق');return;}
 var data={body:body,kind:f.elements.kind.value,targets:targets,request_key:pending||w.crypto.randomUUID()};if(files.length)data.attachments=files.map(function(x){return x.id;});pending=data.request_key;
 var room=active;busy=true;f.querySelector('button[type=submit]').disabled=true;
 try{await api('/rooms/'+room+'/messages',data);if(dialog&&room===active){f.elements.body.value='';pending=null;files=[];renderFiles();await poll(true);loadBar();}}
 catch(e){status(e.message+'؛ إعادة الإرسال بنفس النص لن تكرر الرسالة.');}
 finally{busy=false;if(dialog)node('[type=submit]').disabled=false;}
}
function tools(html){revision++;kill();node('.sc-conversation').classList.add('sc-editing');node('[data-sc-tools]').hidden=false;node('[data-sc-tools]').innerHTML=html;}
function userChoices(selected,editing){return users.map(function(u){var m=(selected||[]).find(function(p){return p.user_id===u.id;});return '<div class="sc-person"><label><input type="checkbox" data-sc-user="'+esc(u.id)+'" '+(m?'checked':'')+'>'+esc(u.name)+'</label>'+(editing?'<label><input type="checkbox" data-sc-send="'+esc(u.id)+'" '+(!m||m.can_send?'checked':'')+'>مشاركة</label>'+(identity.owner?'<label><input type="checkbox" data-sc-manage="'+esc(u.id)+'" '+(m?.can_manage?'checked':'')+'>إدارة</label>':''):'')+'</div>';}).join('');}
function agentChoices(selected){return agents.filter(function(a){return a.chat;}).map(function(a){return '<label class="sc-person"><input type="checkbox" data-sc-agent="'+esc(a.code)+'" '+(selected?.includes(a.code)?'checked':'')+'>'+esc(a.name)+'</label>';}).join('');}
function selectedAgents(){return Array.from(dialog.querySelectorAll('[data-sc-agent]:checked')).map(function(x){return x.dataset.scAgent;});}
async function createForm(){
 try{var vals=await Promise.all([api('/users'),identity.owner?api('/grants').catch(function(){return {grants:[]};}):Promise.resolve({grants:[]}),identity.owner?api('/employees').catch(function(){return {};}):Promise.resolve({})]);
 users=vals[0].users.filter(function(u){return u.id!==identity.id;});grants=vals[1].grants||[];var codexOpen=!!vals[2].enabled;
 tools('<h4>محادثة جديدة</h4><label>اسم المحادثة<input name="sc-title" maxlength="120" value="محادثة الفريق"></label><h5>الوكلاء <span class="sc-count" data-sc-count></span></h5>'+agentChoices([])+'<h5>المستخدمون</h5><input data-sc-user-search placeholder="ابحث عن مستخدم" aria-label="البحث عن مستخدم">'+userChoices([])+'<div class="sc-reason" data-sc-reason hidden></div>'+button('إنشاء','data-sc-create')+button('إلغاء','data-sc-dismiss'));
 filterUsers();node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 function refresh(){
  var sel=selectedAgents(),picked=Array.from(dialog.querySelectorAll('[data-sc-user]:checked')).map(function(x){return x.dataset.scUser;}),now=Date.now()/1000,missing=[];
  node('[data-sc-count]').textContent=sel.length+'/8';
  if(identity.owner)picked.forEach(function(uid){sel.forEach(function(a){
   var ok=(a==='codex'&&codexOpen)||grants.some(function(g){return g.user_id===uid&&g.agent===a&&g.chat&&(!g.expires||g.expires>now);});
   if(!ok)missing.push((users.find(function(u){return u.id===uid;})||{}).name+' ← '+name(a));});});
  var box=node('[data-sc-reason]');box.hidden=!missing.length&&sel.length<=8;
  box.innerHTML=(sel.length>8?'<p>الحد الأقصى 8 وكلاء في المحادثة الواحدة.</p>':'')+(missing.length?'<p>ناقص صلاحية محادثة: '+missing.map(esc).join('، ')+'</p>'+button('افتح إدارة الوصول','data-sc-open-access'):'');
  var go=node('[data-sc-open-access]');if(go)go.onclick=accessForm;
  node('[data-sc-create]').disabled=sel.length>8||missing.length>0;
 }
 dialog.querySelectorAll('[data-sc-agent],[data-sc-user]').forEach(function(x){x.addEventListener('change',refresh);});refresh();
 node('[data-sc-create]').onclick=async function(){var b=this;b.disabled=true;try{var r=await api('/rooms',{title:node('[name=sc-title]').value,agents:selectedAgents(),users:Array.from(dialog.querySelectorAll('[data-sc-user]:checked')).map(function(x){return x.dataset.scUser;})});await refreshRooms();await selectRoom(r.id);}catch(e){status(e.message);}finally{b.disabled=false;}};
 }catch(e){status(e.message);}
}
async function searchMessages(){
 var q=roomQuery.trim(),box=node('[data-sc-hits]');if(q.length<2)return;
 try{var res=(await api('/search?q='+encodeURIComponent(q))).results||[];
  box.innerHTML=res.length?'<h6>نتائج الرسائل</h6>'+res.map(function(r){return '<button type="button" class="sc-hit" data-sc-hit="'+esc(r.room)+'"><b>'+esc(r.title)+'</b><small>'+esc(r.name)+': '+esc(r.snippet)+'</small></button>';}).join(''):'<p class="sc-empty">لا نتائج في رسائلك</p>';
  box.querySelectorAll('[data-sc-hit]').forEach(function(b){b.onclick=function(){selectRoom(b.dataset.scHit);};});
 }catch(e){status(e.message);}
}
function chip(k,v){return '<span class="sc-pill"><small>'+esc(k)+'</small> <b>'+esc(v)+'</b></span>';}
async function loadBar(){
 var bar=node('[data-sc-bar]');if(!bar)return;
 try{
  var html;
  if(identity.owner){
   var o=await api('/overview'),chatty=agents.filter(function(a){return a.chat;});
   html=chip('الوكلاء المتصلون',chatty.filter(function(a){return a.connected;}).length+'/'+chatty.length)+chip('حصة اليوم',o.quota.used+'/'+o.quota.limit)+chip('سونو للموظفين',o.employees?'شغّال':'متوقف')+
    button('غير موثّق: '+o.unanswered,'data-sc-bar-unans class="sc-pill"')+chip('التقييم','👍 '+o.ratings.up+' · 👎 '+o.ratings.down);
  }else{var q=await api('/quota');html=chip('المتبقي لك اليوم',q.remaining+' من '+q.limit);}
  if(!dialog)return;bar.innerHTML=html;bar.hidden=false;
  var u=bar.querySelector('[data-sc-bar-unans]');if(u)u.onclick=function(){ownerPanel('unans');};
 }catch(_){bar.hidden=true;}
}
function table(head,rows){return '<div class="sc-table-scroll"><table><thead><tr>'+head.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+(rows.length?rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>';}).join('')+'</tr>';}).join(''):'<tr><td colspan="'+head.length+'">لا بيانات</td></tr>')+'</tbody></table></div>';}
function when(sec){return new Date(sec*1000).toLocaleString('ar-EG');}
async function ownerPanel(tab){
 tab=tab||'usage';
 try{
  var body='';
  if(tab==='usage'){var u=await api('/usage'),e=await api('/employees');body='<h5>استدعاءات آخر ٧ أيام</h5>'+table(['اليوم','الاستدعاءات'],(u.days||[]).map(function(d){return [d.day,d.calls];}))+'<h5>الموظفون (٧ أيام)</h5>'+table(['الموظف','عدد الأسئلة'],(u.users||[]).map(function(x){return [x.name,x.calls];}))+'<p>سونو للموظفين: '+(e.enabled?'شغّال':'متوقف')+' · حد الموظف '+esc(e.per_user)+' يوميًا</p>';}
  else if(tab==='unans'){var q=await api('/unanswered');body='<h5>أسئلة ردّ عليها الوكيل بـ«غير موثّق»</h5><p class="sc-hint">كل سطر ثغرة محتملة في دليل المساعدة: أضف مقالًا يغطيها.</p>'+table(['الوقت','السائل','السؤال','المحادثة'],(q.items||[]).map(function(i){return [when(i.created),i.asker,i.question,i.title];}));}
  else{var a=await api('/audit');body='<h5>سجل النشاط</h5>'+table(['الوقت','المنفّذ','الإجراء','الهدف'],(a.items||[]).map(function(i){return [when(i.created),i.actor,i.action,i.target];}));}
  tools('<h4>لوحة المالك</h4><div class="sc-tabs">'+[['usage','الاستخدام'],['unans','أسئلة بلا إجابة'],['audit','سجل النشاط']].map(function(t){return button(t[1],'data-sc-tab="'+t[0]+'" aria-pressed="'+(t[0]===tab)+'"');}).join('')+'</div>'+body+button('رجوع','data-sc-dismiss'));
  node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
  dialog.querySelectorAll('[data-sc-tab]').forEach(function(b){b.onclick=function(){ownerPanel(b.dataset.scTab);};});
 }catch(e){status(e.message);}
}
var PROMPTS=['ازاي أضيف حجز جديد؟','فين أطبع تقرير اليوم؟','إزاي أضيف دكتور وخدمة؟','اشرح لي شاشة المصروفات'];
function mentionList(){
 var box=node('[data-sc-mentions]'),ta=node('[name=body]');if(!box||!ta)return;
 var r=rooms.find(function(x){return x.id===active;}),m=/(?:^|\s)@([^\s@]*)$/.exec(ta.value);
 if(!r||!m){box.hidden=true;box.innerHTML='';return;}
 var q=m[1].toLocaleLowerCase(),list=r.agents.filter(function(a){return name(a).toLocaleLowerCase().indexOf(q)>=0||a.indexOf(q)>=0;});
 if(!list.length){box.hidden=true;box.innerHTML='';return;}
 box.hidden=false;box.innerHTML=list.map(function(a){return button('@'+name(a),'data-sc-mention="'+esc(a)+'"');}).join('');
 box.querySelectorAll('[data-sc-mention]').forEach(function(b){b.onclick=function(){ta.value=ta.value.replace(/(^|\s)@[^\s@]*$/,'$1');node('[name=target]').value=b.dataset.scMention;pending=null;box.hidden=true;ta.focus();};});
}
function filterUsers(){var input=node('[data-sc-user-search]');if(input)input.oninput=function(){var q=input.value.trim().toLocaleLowerCase();dialog.querySelectorAll('.sc-person:has([data-sc-user])').forEach(function(row){row.hidden=!row.textContent.toLocaleLowerCase().includes(q);});};}
async function membersForm(){
 var room=active;
 try{var results=await Promise.all([api('/users'),api('/rooms/'+room+'/members')]);if(room!==active)return;users=results[0].users;var members=results[1].members;
 tools('<h4>المشاركون</h4><input data-sc-user-search placeholder="ابحث عن مستخدم" aria-label="البحث عن مستخدم">'+userChoices(members,true)+'<h5>الوكلاء</h5>'+agentChoices(results[1].agents)+'<label class="sc-person"><input type="checkbox" data-sc-history>إتاحة السجل السابق للمشاركين الجدد</label><p>عند عدم الاختيار، يبدأ وصول المشارك من الرسالة التالية.</p>'+button('حفظ المشاركين','data-sc-save-members')+button('إلغاء','data-sc-dismiss'));
 filterUsers();node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 node('[data-sc-save-members]').onclick=async function(){var b=this;b.disabled=true;try{
 var selected=Array.from(dialog.querySelectorAll('[data-sc-user]:checked')).map(function(x){var id=x.dataset.scUser;return {id:id,send:dialog.querySelector('[data-sc-send="'+id+'"]').checked,manage:identity.owner?dialog.querySelector('[data-sc-manage="'+id+'"]').checked:!!members.find(function(m){return m.user_id===id;})?.can_manage};});
 await api('/rooms/'+room+'/members',{users:selected,agents:selectedAgents(),share_history:node('[data-sc-history]').checked});await refreshRooms();await selectRoom(room);
 }catch(e){status(e.message);}finally{b.disabled=false;}};
 }catch(e){status(e.message);}
}
async function accessForm(){
 try{var values=await Promise.all([api('/users'),api('/grants')]);users=values[0].users;grants=values[1].grants;
 tools('<h4>إدارة الوصول للوكلاء</h4><label>المستخدم<select data-sc-grant-user>'+users.filter(function(u){return u.id!==identity.id;}).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>';}).join('')+'</select></label><div data-sc-grant-table></div>'+button('رجوع','data-sc-dismiss'));
 node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};node('[data-sc-grant-user]').onchange=grantTable;grantTable();
 }catch(e){status(e.message);}
}
function grantTable(){
 var user=node('[data-sc-grant-user]').value;
 node('[data-sc-grant-table]').innerHTML='<div class="sc-table-scroll"><table><thead><tr><th>الوكيل</th><th>المحادثة</th><th>طلب تنفيذ</th><th>انتهاء الوصول</th><th>حفظ</th></tr></thead><tbody>'+agents.map(function(a){var g=grants.find(function(x){return x.user_id===user&&x.agent===a.code;})||{};return '<tr data-sc-grant="'+esc(a.code)+'"><th scope="row">'+esc(a.name)+'</th><td><input type="checkbox" name="chat" aria-label="محادثة '+esc(a.name)+'" '+(g.chat?'checked':'')+'></td><td><input type="checkbox" name="task" aria-label="طلب تنفيذ من '+esc(a.name)+'" '+(g.task?'checked':'')+'></td><td><input type="date" name="expires" aria-label="انتهاء وصول '+esc(a.name)+'" value="'+(g.expires?new Date(g.expires*1000).toISOString().slice(0,10):'')+'"></td><td>'+button('حفظ','data-sc-save-grant')+'</td></tr>';}).join('')+'</tbody></table></div>';
 dialog.querySelectorAll('[data-sc-save-grant]').forEach(function(b){b.onclick=async function(){var tr=b.closest('tr');b.disabled=true;try{var date=tr.querySelector('[name=expires]').value;
 await api('/grants',{user_id:user,agent:tr.dataset.scGrant,chat:tr.querySelector('[name=chat]').checked,task:tr.querySelector('[name=task]').checked,expires:date?new Date(date+'T23:59:59+04:00').getTime()/1000:null});grants=(await api('/grants')).grants;status('تم حفظ الوصول.');}catch(e){status(e.message);}finally{b.disabled=false;}};});
}
function mount(){var root=document.querySelector('.digital-team');if(!root||root.querySelector('[data-server-team-chat]'))return;
 var card=document.createElement('article');card.className='dt-member sc-codex-card';card.innerHTML='<div class="dt-member-head"><div class="dt-id"><h2>Codex</h2><p>تطوير الأنظمة · كونتابو</p></div></div><p>محادثة محفوظة مع نسخة السيرفر. الاتصال والصلاحيات يتحقق منهما عند الفتح.</p>'+button('محادثة Codex','data-server-team-chat')+button('محادثات السيرفر','data-server-team-all');
 if(identity&&!identity.owner&&!agents.find(function(a){return a.code==='codex';})?.chat){card.querySelector('[data-server-team-chat]').remove();}
 var grid=root.querySelector('.dt-grid')||root;grid.prepend(card);var direct=card.querySelector('[data-server-team-chat]');if(direct)direct.onclick=function(){open('codex');};card.querySelector('[data-server-team-all]').onclick=function(){open();};
 if(!(identity&&!identity.owner&&!agents.find(function(a){return a.code==='claude';})?.chat)){
  var cc=document.createElement('article');cc.className='dt-member sc-codex-card sc-claude-card';cc.innerHTML='<div class="dt-member-head"><div class="dt-id"><h2>Claude Code</h2><p>تطوير الأنظمة · كونتابو</p></div></div><p>محادثة حقيقية مع Claude Code على السيرفر، للقراءة والتحليل والاقتراح فقط: يقرأ كود اللوحة ووثائق البنية (نسخة للقراءة قد تتأخر عن آخر إصدار) ولا يرى بيانات Supabase الحية (الحجوزات والعقود والمرضى). لا ينفذ ولا يعدّل. تُحتسب ضمن نفس الحصة اليومية المشتركة مع Codex.</p>'+button('محادثة Claude Code','data-server-team-claude');
  card.after(cc);cc.querySelector('[data-server-team-claude]').onclick=function(){open('claude');};
 }
}
async function refreshAccess(){
 var id=w.SSMPDAuth?.currentAdmin?.id||'';
 if(id===authId)return;authId=id;close();identity=null;db=null;rooms=[];active='';pending=null;access=false;stopNotes();
 if(!id)return;
 try{var boot=await api('/bootstrap');if(authId!==id)return;identity=boot.me;agents=boot.agents;access=identity.owner||agents.some(function(a){return a.chat;});w.SSMPDManagementNavigation?.refresh();if(access)startNotes();}catch(_){}
}

function csvCell(v){v=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function exportText(rows,format){
 if(format==='txt')return rows.map(function(r){return '['+r.time+'] '+r.room+' | '+r.sender+(r.agent?' -> '+r.agent:'')+'\n'+r.text+(r.attachments?'\n[مرفقات: '+r.attachments+']':'')+'\n';}).join('\n');
 return '﻿'+['الوقت','المحادثة','المرسل','الوكيل','النص','المرفقات'].map(csvCell).join(',')+'\r\n'+rows.map(function(r){return [r.time,r.room,r.sender,r.agent,r.text,r.attachments].map(csvCell).join(',');}).join('\r\n')+'\r\n';
}
function exportForm(){
 var now=new Date(),pad=function(n){return String(n).padStart(2,'0');},day=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
 tools('<h4>تصدير المحادثات</h4><p>التوقيت بتوقيت القاهرة. تُصدَّر المحادثات التي أنت عضو فيها فقط.</p>'+
 '<label>من<input type="datetime-local" name="sc-from" value="'+day+'T00:00"></label><label>إلى<input type="datetime-local" name="sc-to" value="'+day+'T23:59"></label>'+
 '<label>المحادثة<select name="sc-export-room"><option value="">كل محادثاتي</option>'+rooms.map(function(r){return '<option value="'+esc(r.id)+'"'+(r.id===active?' selected':'')+'>'+esc(r.title)+'</option>';}).join('')+'</select></label>'+
 '<label>الصيغة<select name="sc-format"><option value="csv">CSV (Excel)</option><option value="txt">نص عادي</option></select></label>'+button('تنزيل','data-sc-export-go')+button('إلغاء','data-sc-dismiss'));
 node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 node('[data-sc-export-go]').onclick=async function(){
  var b=this,from=node('[name=sc-from]').value,to=node('[name=sc-to]').value,room=node('[name=sc-export-room]').value,format=node('[name=sc-format]').value;
  if(!from||!to){status('اختر بداية ونهاية الفترة');return;}
  b.disabled=true;
  try{
   var out=await api('/export?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+(room?'&room='+encodeURIComponent(room):''));
   if(!out.rows.length){status('لا توجد رسائل في هذه الفترة');return;}
   var blob=new w.Blob([exportText(out.rows,format)],{type:format==='txt'?'text/plain;charset=utf-8':'text/csv;charset=utf-8'}),a=document.createElement('a');
   a.href=w.URL.createObjectURL(blob);a.download='swnw-team-chat-'+from.replace(/[^0-9]/g,'').slice(0,12)+'.'+format;document.body.appendChild(a);a.click();a.remove();
   setTimeout(function(){w.URL.revokeObjectURL(a.href);},1000);status('تم التصدير: '+out.rows.length+' رسالة');
  }catch(e){status(e.message);}finally{b.disabled=false;}
 };
}

async function limitForm(){
 try{var info=await api('/limit');
 tools('<h4>الحصة اليومية لرسائل المحركات</h4><p data-sc-limit-info></p><label>الحد اليومي (1 إلى '+esc(info.max)+')<input type="number" name="sc-limit" min="'+esc(info.min)+'" max="'+esc(info.max)+'" step="1" value="'+esc(info.limit)+'"></label>'+button('حفظ','data-sc-limit-save')+button('إغلاق','data-sc-dismiss'));
 var show=function(i){node('[data-sc-limit-info]').textContent='المستخدم اليوم: '+i.used+' من '+i.limit+' · يتجدد 00:00 بتوقيت UTC';};show(info);
 node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 node('[data-sc-limit-save]').onclick=async function(){var b=this;b.disabled=true;try{var v=Number(node('[name=sc-limit]').value);if(!Number.isInteger(v)||v<info.min||v>info.max){status('أدخل رقمًا صحيحًا من '+info.min+' إلى '+info.max);return;}show(await api('/limit',{limit:v}));status('تم حفظ الحصة اليومية');}catch(e){status(e.message);}finally{b.disabled=false;}};
 }catch(e){status(e.message);}
}
async function empForm(){
 try{var info=await api('/employees'),lim=info.limits;
 tools('<h4>سونو الذكي للموظفين</h4><p data-sc-emp-state></p><label><input type="checkbox" name="sc-emp-on"> السماح للموظفين بسؤال سونو الذكي (Codex، قراءة فقط)</label><label>حد كل موظف في اليوم ('+esc(lim.per_user[0])+' إلى '+esc(lim.per_user[1])+')<input type="number" name="sc-emp-user" min="'+esc(lim.per_user[0])+'" max="'+esc(lim.per_user[1])+'" step="1"></label><label>الحد الكلي لكل الموظفين في اليوم ('+esc(lim.total[0])+' إلى '+esc(lim.total[1])+')<input type="number" name="sc-emp-total" min="'+esc(lim.total[0])+'" max="'+esc(lim.total[1])+'" step="1"></label><div data-sc-emp-users></div>'+button('حفظ','data-sc-emp-save')+button('إغلاق','data-sc-dismiss'));
 var show=function(x){node('[name=sc-emp-on]').checked=!!x.enabled;node('[name=sc-emp-user]').value=x.per_user;node('[name=sc-emp-total]').value=x.total;node('[data-sc-emp-state]').textContent=(x.enabled?'شغّال':'متوقف')+' · استخدام الموظفين اليوم: '+x.used_total+' من '+x.total+' · يتجدد 00:00 بتوقيت UTC';node('[data-sc-emp-users]').innerHTML=x.users.length?'<ul>'+x.users.map(function(u){return '<li>'+esc(u.name)+': '+esc(u.calls)+'</li>';}).join('')+'</ul>':'<small>لا استخدام اليوم</small>';};show(info);
 node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 node('[data-sc-emp-save]').onclick=async function(){var b=this;b.disabled=true;try{var u=Number(node('[name=sc-emp-user]').value),t=Number(node('[name=sc-emp-total]').value);if(!Number.isInteger(u)||u<lim.per_user[0]||u>lim.per_user[1]||!Number.isInteger(t)||t<lim.total[0]||t>lim.total[1]){status('أدخل أرقامًا صحيحة داخل النطاق');return;}show(await api('/employees',{enabled:node('[name=sc-emp-on]').checked,per_user:u,total:t}));status('تم الحفظ');}catch(e){status(e.message);}finally{b.disabled=false;}};
 }catch(e){status(e.message);}
}
async function openWorkspace(){
 try{var boot=await api('/bootstrap');identity=boot.me;agents=boot.agents;
 var view=document.getElementById('view-container');if(!view)return;
 view.innerHTML='<section class="digital-team" dir="rtl"><header class="dt-hero"><div><h1>الفريق الرقمي</h1><p>المحادثات المتاحة لحسابك</p></div></header><div class="dt-grid"></div></section>';
 agents.filter(function(a){return a.chat&&a.code!=='codex'&&a.code!=='claude';}).forEach(function(a){var card=document.createElement('article');card.className='dt-member';card.innerHTML='<h2>'+esc(a.name)+'</h2>'+button('محادثة','data-sc-other');card.querySelector('button').onclick=function(){open(a.code);};view.querySelector('.dt-grid').appendChild(card);});
 mount();await open();
 }catch(e){w.alert(e.message);}
}
w.addEventListener('ssmpd-digital-team-rendered',mount);
w.addEventListener('ssmpd-auth-changed',refreshAccess);
var authObserver=new MutationObserver(function(){refreshAccess();if(dialog&&!dialog.isConnected)close();});
authObserver.observe(document.getElementById('app-root')||document.body,{childList:true,subtree:true});
refreshAccess();
w.SSMPDServerTeamChat={open:open,mount:mount,openWorkspace:openWorkspace,canAccess:function(){return access;},notifications:function(){return notif;},refreshNotifications:pollNotes,exportText:exportText,_pollMs:function(ms){SIMPLE_POLL=ms;}};mount();
})(window);
