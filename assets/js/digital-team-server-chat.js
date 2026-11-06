/* Contabo conversations use the existing dashboard identity. Legacy advisory chat is preserved. */
(function(w){
'use strict';
if(w.SSMPDServerTeamChat)return;
var db=null,identity=null,rooms=[],users=[],agents=[],active='',dialog=null,timer=null,busy=false,revision=0,returnFocus=null;
var base='/api/digital-team',pending=null,lastDraw='',grants=[],access=false,authId='';
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
function kill(){clearTimeout(timer);timer=null;}
function close(){kill();revision++;dialog?.remove();dialog=null;returnFocus?.focus();lastDraw='';}
function frame(){
 returnFocus=document.activeElement;
 dialog=document.createElement('dialog');dialog.className='sc-dialog';dialog.dir='rtl';dialog.setAttribute('aria-label','محادثات الفريق على السيرفر');
 dialog.innerHTML='<header class="sc-header"><div><h2>محادثات الفريق</h2><p>Codex على كونتابو · سجل محفوظ</p></div>'+button('إغلاق','data-sc-close')+'</header>'+
 '<div class="sc-toolbar">'+button('محادثة جديدة','data-sc-new')+button('المشاركون','data-sc-members disabled')+(identity.owner?button('إدارة الوصول','data-sc-access'):'')+(identity.owner?button('تصدير','data-sc-export'):'')+'</div>'+
 '<div class="sc-layout"><aside aria-label="المحادثات" data-sc-rooms></aside><section class="sc-conversation"><h3 data-sc-title>اختر محادثة</h3><div class="sc-tools" data-sc-tools hidden></div><div class="sc-messages" data-sc-messages aria-live="polite"></div>'+
 '<form data-sc-form class="sc-compose"><div class="sc-compose-options"><select name="kind" aria-label="نوع الرسالة"><option value="chat">رسالة</option><option value="question">سؤال</option><option value="instruction">تعليمات للنقاش</option><option value="task">طلب تنفيذ</option></select><select name="target" aria-label="الوكيل المطلوب"></select></div><div class="sc-send"><textarea name="body" rows="2" maxlength="4000" required placeholder="اكتب رسالتك…" aria-label="نص الرسالة"></textarea><button type="submit">إرسال</button></div></form><p class="sc-status" role="status" data-sc-status></p></section></div>';
 document.body.appendChild(dialog);dialog.showModal();
 node('[data-sc-close]').onclick=close;
 dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
 node('[data-sc-new]').onclick=createForm;
 node('[data-sc-members]').onclick=membersForm;
 if(identity.owner)node('[data-sc-access]').onclick=accessForm;
 if(identity.owner)node('[data-sc-export]').onclick=exportForm;
 node('[data-sc-form]').onsubmit=function(e){e.preventDefault();send();};
 node('[name=body]').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();node('[data-sc-form]').requestSubmit();}});
 node('[name=body]').addEventListener('input',function(){pending=null;});
 node('[name=kind]').onchange=function(){pending=null;};node('[name=target]').onchange=function(){pending=null;};
}
async function open(code){
 try{
  var boot=await api('/bootstrap');identity=boot.me;agents=boot.agents;
  if(!dialog)frame();
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
async function refreshRooms(){
 var data=await api('/rooms');rooms=data.rooms;
 if(!dialog)return;
 node('[data-sc-rooms]').innerHTML=rooms.map(function(r){return button(r.title,'data-sc-room="'+esc(r.id)+'" aria-current="'+(active===r.id?'true':'false')+'"');}).join('')||'<p class="sc-empty">ابدأ محادثة مع Codex</p>';
 dialog.querySelectorAll('[data-sc-room]').forEach(function(b){b.onclick=function(){selectRoom(b.dataset.scRoom);};});
}
async function selectRoom(id){
 active=id;revision++;pending=null;lastDraw='';kill();node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');
 var r=rooms.find(function(x){return x.id===id;});if(!r)return;
 node('[data-sc-title]').textContent=r.title;node('[data-sc-members]').disabled=!r.can_manage;
 node('[data-sc-form]').hidden=!r.can_send;
 node('[name=target]').innerHTML='<option value="">'+(r.agents.length===1?'الرد من '+esc(name(r.agents[0])):'رسالة للمشاركين')+'</option>'+r.agents.map(function(a){return '<option value="'+esc(a)+'">@'+esc(name(a))+'</option>';}).join('')+(r.agents.length>1?'<option value="all">اطلب رأي الوكلاء المشاركين</option>':'');
 refreshRooms().catch(function(e){status(e.message);});await poll(true);
}
var stateNames={limited:'بلغت حصة المحادثات اليومية',queued:'في الانتظار',running:'Codex يرد الآن',complete:'اكتمل الرد',failed:'تعذر الرد',interrupted:'انقطع التشغيل',cancelled:'أُوقف',awaiting_owner:'طلب تنفيذ ينتظر مراجعة المالك',unconnected:'محرك الوكيل لم يُربط بهذه القناة بعد'};
async function poll(scroll){
 if(!dialog||!active)return;var room=active,ticket=revision;
 try{
  var data=await api('/rooms/'+room+'/messages');if(!dialog||room!==active||ticket!==revision)return;
  var hash=JSON.stringify(data),box=node('[data-sc-messages]'),nearEnd=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  if(hash!==lastDraw){lastDraw=hash;
   box.innerHTML=(data.before?button('رسائل أقدم','data-sc-older="'+data.before+'"'):'')+data.messages.map(function(m){var mine=m.author===identity.id;return '<article class="sc-message '+(mine?'mine':'')+'"><b>'+esc(m.name)+'</b><p>'+esc(m.body)+'</p><small>'+esc(new Date(m.created*1000).toLocaleString('ar-EG'))+'</small></article>';}).join('')+
    data.jobs.filter(function(j){return j.state!=='complete';}).map(function(j){return '<article class="sc-job"><b>'+esc(name(j.agent))+' · '+esc(stateNames[j.state]||j.state)+'</b><p>'+esc(j.state==='running'?j.text:j.error)+'</p>'+(['queued','running','awaiting_owner'].includes(j.state)?button('إيقاف','data-sc-cancel="'+esc(j.id)+'"'):'')+'</article>';}).join('');
   box.querySelectorAll('[data-sc-cancel]').forEach(function(b){b.onclick=async function(){try{await api('/rooms/'+room+'/cancel/'+b.dataset.scCancel,{});poll(false);}catch(e){status(e.message);}};});
   var older=box.querySelector('[data-sc-older]');if(older)older.onclick=function(){loadOlder(older,room);};
   if(scroll||nearEnd)box.scrollTop=box.scrollHeight;
  }
  status('الرسائل محفوظة على السيرفر. طلبات التنفيذ تحتاج مسار اعتماد المالك.');
 }catch(e){if(dialog&&ticket===revision){status(e.message);node('[data-sc-messages]').replaceChildren();node('[data-sc-form]').hidden=true;}}
 finally{if(dialog&&ticket===revision){kill();timer=w.setTimeout(function(){poll(false);},3000);}}
}
async function loadOlder(b,room){try{var data=await api('/rooms/'+room+'/messages?before='+encodeURIComponent(b.dataset.scOlder));if(room!==active||!dialog)return;
 var wrap=document.createElement('div');wrap.innerHTML=data.messages.map(function(m){return '<article class="sc-message"><b>'+esc(m.name)+'</b><p>'+esc(m.body)+'</p></article>';}).join('');b.after(wrap);if(data.before)b.dataset.scOlder=data.before;else b.remove();}catch(e){status(e.message);}}
async function send(){
 if(!active||busy)return;var f=node('[data-sc-form]'),body=f.elements.body.value.trim();if(!body)return;
 var r=rooms.find(function(x){return x.id===active;}),target=f.elements.target.value;
 var targets=target==='all'?r.agents:target?[target]:[];
 var data={body:body,kind:f.elements.kind.value,targets:targets,request_key:pending||w.crypto.randomUUID()};pending=data.request_key;
 var room=active;busy=true;f.querySelector('button[type=submit]').disabled=true;
 try{await api('/rooms/'+room+'/messages',data);if(dialog&&room===active){f.elements.body.value='';pending=null;await poll(true);}}
 catch(e){status(e.message+'؛ إعادة الإرسال بنفس النص لن تكرر الرسالة.');}
 finally{busy=false;if(dialog)node('[type=submit]').disabled=false;}
}
function tools(html){revision++;kill();node('.sc-conversation').classList.add('sc-editing');node('[data-sc-tools]').hidden=false;node('[data-sc-tools]').innerHTML=html;}
function userChoices(selected,editing){return users.map(function(u){var m=(selected||[]).find(function(p){return p.user_id===u.id;});return '<div class="sc-person"><label><input type="checkbox" data-sc-user="'+esc(u.id)+'" '+(m?'checked':'')+'>'+esc(u.name)+'</label>'+(editing?'<label><input type="checkbox" data-sc-send="'+esc(u.id)+'" '+(!m||m.can_send?'checked':'')+'>مشاركة</label>'+(identity.owner?'<label><input type="checkbox" data-sc-manage="'+esc(u.id)+'" '+(m?.can_manage?'checked':'')+'>إدارة</label>':''):'')+'</div>';}).join('');}
function agentChoices(selected){return agents.filter(function(a){return a.chat;}).map(function(a){return '<label class="sc-person"><input type="checkbox" data-sc-agent="'+esc(a.code)+'" '+(selected?.includes(a.code)?'checked':'')+'>'+esc(a.name)+'</label>';}).join('');}
function selectedAgents(){return Array.from(dialog.querySelectorAll('[data-sc-agent]:checked')).map(function(x){return x.dataset.scAgent;});}
async function createForm(){
 try{users=(await api('/users')).users.filter(function(u){return u.id!==identity.id;});
 tools('<h4>محادثة جديدة</h4><label>اسم المحادثة<input name="sc-title" maxlength="120" value="محادثة الفريق"></label><h5>الوكلاء</h5>'+agentChoices([])+'<h5>المستخدمون</h5><input data-sc-user-search placeholder="ابحث عن مستخدم" aria-label="البحث عن مستخدم">'+userChoices([])+button('إنشاء','data-sc-create')+button('إلغاء','data-sc-dismiss'));
 filterUsers();node('[data-sc-dismiss]').onclick=function(){node('[data-sc-tools]').hidden=true;node('.sc-conversation').classList.remove('sc-editing');poll(false);};
 node('[data-sc-create]').onclick=async function(){var b=this;b.disabled=true;try{var r=await api('/rooms',{title:node('[name=sc-title]').value,agents:selectedAgents(),users:Array.from(dialog.querySelectorAll('[data-sc-user]:checked')).map(function(x){return x.dataset.scUser;})});await refreshRooms();await selectRoom(r.id);}catch(e){status(e.message);}finally{b.disabled=false;}};
 }catch(e){status(e.message);}
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
 (root.querySelector('.dt-grid')||root).prepend(card);var direct=card.querySelector('[data-server-team-chat]');if(direct)direct.onclick=function(){open('codex');};card.querySelector('[data-server-team-all]').onclick=function(){open();};
}
async function refreshAccess(){
 var id=w.SSMPDAuth?.currentAdmin?.id||'';
 if(id===authId)return;authId=id;close();identity=null;db=null;rooms=[];active='';pending=null;access=false;
 if(!id)return;
 try{var boot=await api('/bootstrap');if(authId!==id)return;identity=boot.me;agents=boot.agents;access=identity.owner||agents.some(function(a){return a.chat;});w.SSMPDManagementNavigation?.refresh();}catch(_){}
}

function csvCell(v){v=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function exportText(rows,format){
 if(format==='txt')return rows.map(function(r){return '['+r.time+'] '+r.room+' | '+r.sender+(r.agent?' -> '+r.agent:'')+'\n'+r.text+'\n';}).join('\n');
 return '﻿'+['الوقت','المحادثة','المرسل','الوكيل','النص'].map(csvCell).join(',')+'\r\n'+rows.map(function(r){return [r.time,r.room,r.sender,r.agent,r.text].map(csvCell).join(',');}).join('\r\n')+'\r\n';
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
async function openWorkspace(){
 try{var boot=await api('/bootstrap');identity=boot.me;agents=boot.agents;
 var view=document.getElementById('view-container');if(!view)return;
 view.innerHTML='<section class="digital-team" dir="rtl"><header class="dt-hero"><div><h1>الفريق الرقمي</h1><p>المحادثات المتاحة لحسابك</p></div></header><div class="dt-grid"></div></section>';
 agents.filter(function(a){return a.chat&&a.code!=='codex';}).forEach(function(a){var card=document.createElement('article');card.className='dt-member';card.innerHTML='<h2>'+esc(a.name)+'</h2>'+button('محادثة','data-sc-other');card.querySelector('button').onclick=function(){open(a.code);};view.querySelector('.dt-grid').appendChild(card);});
 mount();await open();
 }catch(e){w.alert(e.message);}
}
w.addEventListener('ssmpd-digital-team-rendered',mount);
w.addEventListener('ssmpd-auth-changed',refreshAccess);
var authObserver=new MutationObserver(function(){refreshAccess();if(dialog&&!dialog.isConnected)close();});
authObserver.observe(document.getElementById('app-root')||document.body,{childList:true,subtree:true});
refreshAccess();
w.SSMPDServerTeamChat={open:open,mount:mount,openWorkspace:openWorkspace,canAccess:function(){return access;},exportText:exportText};mount();
})(window);
