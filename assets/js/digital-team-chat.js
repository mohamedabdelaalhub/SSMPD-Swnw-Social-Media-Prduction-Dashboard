/* Messenger-style owner conversations. These are independent advisory agents, not operational runtime impersonations. */
(function(w){
'use strict';
if(w.SSMPDDigitalChat)return;
var client=null,threads=[],people={},active='',shown=false,processing=false,timer=null,seq=0,showCreate=false;
var agents={sia:'سيا',hapi:'حابي',claude_creative:'Claude Creative',hor:'حور',hotep:'حتب',nefer:'نفر',maat:'ماعت'};
var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
function db(){if(client)return client;var c=w.SSMPD_CONFIG?.supabase;if(!c||!w.supabase)return null;client=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return client;}
function host(){return document.querySelector('.digital-team');}
function panel(){return host()?.querySelector('[data-chat-window]');}
function textStatus(msg){var e=panel()?.querySelector('[data-chat-status]');if(e)e.textContent=msg||'';}
function name(k){return agents[k]||k||'سونو';}
function date(v){if(!v)return '';return new Date(v).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function human(){return w.SSMPDAuth?.currentAdmin?.name||'الإدارة';}
function make(){
 var h=host();if(!h||!w.SSMPDDigitalTeam?.isOwner?.()||h.querySelector('[data-chat-launcher]'))return;
 var launch=document.createElement('button');launch.type='button';launch.className='dc-launcher';launch.setAttribute('data-chat-launcher','');
 launch.innerHTML='<span class="dc-launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg></span><span>دردشة الفريق</span>';
 launch.onclick=function(){openWindow();};h.appendChild(launch);
 var box=document.createElement('section');box.className='dc-window';box.setAttribute('data-chat-window','');box.dir='rtl';box.hidden=!shown;
 box.innerHTML='<header class="dc-top"><div><b>دردشة الفريق الرقمي</b><small>رسائل فردية وجماعية · متابعة التعليمات</small></div>'+
 '<div><button type="button" data-chat-create title="محادثة جماعية">+ مجموعة</button><button type="button" data-chat-close aria-label="إغلاق">×</button></div></header>'+
 '<div class="dc-layout"><aside class="dc-sidebar"><h4>المحادثات</h4><div data-chat-threads></div></aside>'+
 '<div class="dc-conversation"><div class="dc-room-head" data-chat-title>اختر محادثة، أو ابدأ محادثة جديدة</div>'+
 '<div class="dc-create" data-chat-create-panel hidden><b>مين تحب يكون في المحادثة؟</b><div class="dc-choose">'+
 Object.keys(agents).map(function(k){return '<label><input type="checkbox" value="'+esc(k)+'" data-chat-person>'+esc(agents[k])+'</label>';}).join('')+
 '</div><div class="dc-create-actions"><button type="button" data-chat-all>اختيار الكل</button><button type="button" data-chat-start>ابدأ المحادثة</button></div></div>'+
 '<div class="dc-messages" data-chat-messages><div class="dc-empty">ابدأ بكلمة بسيطة، أو سؤال، أو مهمة.</div></div>'+
 '<div class="dc-info" data-chat-saved></div>'+
 '<form class="dc-compose" data-chat-compose><div class="dc-compose-top"><select name="kind" aria-label="نوع الرسالة"><option value="chat">رسالة عادية</option><option value="question">سؤال</option><option value="instruction">تعليمات</option><option value="task">تكليف بمهمة</option></select><label data-chat-memory hidden><input type="checkbox" name="memorize"> احفظها في تعليمات الوكلاء</label><label data-chat-repeat hidden><input type="checkbox" name="repeat"> متابعة دورية</label></div>'+
 '<div data-chat-schedule hidden class="dc-schedule"><select name="frequency"><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option></select>'+
 '<select name="weekday" data-chat-weekday hidden><option value="0">الأحد</option><option value="1">الاثنين</option><option value="2">الثلاثاء</option><option value="3">الأربعاء</option><option value="4">الخميس</option><option value="5">الجمعة</option><option value="6">السبت</option></select>'+
 '<input type="time" name="time" value="09:00" aria-label="موعد المتابعة بتوقيت الإمارات"><small>بتوقيت الإمارات، متابعة تحليلية فقط</small></div>'+
 '<div class="dc-send-row"><textarea name="body" placeholder="اكتب رسالتك هنا..." rows="2" maxlength="4000" required></textarea><button type="submit">إرسال</button></div>'+
 '<div class="dc-safety">الردود من محركات التحليل. Claude وحابي لا يتم تمثيلهما كأن محركيهما استلما الرسالة قبل الربط.</div></form>'+
 '<div class="dc-status" data-chat-status role="status"></div></div></div>';
 h.appendChild(box);
 box.querySelector('[data-chat-close]').onclick=closeWindow;
 box.querySelector('[data-chat-create]').onclick=function(){newGroup();};
 box.querySelector('[data-chat-all]').onclick=function(){box.querySelectorAll('[data-chat-person]').forEach(function(x){x.checked=true;});};
 box.querySelector('[data-chat-start]').onclick=createSelected;
 box.querySelector('[data-chat-compose]').onsubmit=function(e){e.preventDefault();send(box.querySelector('[data-chat-compose]'));};
 var form=box.querySelector('[data-chat-compose]');
 form.elements.kind.onchange=updateKind;
 form.querySelector('[name="body"]').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
 form.elements.repeat.onchange=updateKind;
 form.elements.frequency.onchange=updateKind;
 form.elements.time.onchange=function(){};
 updateKind();
 if(shown){loadThreads().then(function(){if(active)showThread(active);});beginRefresh();}
}
function openWindow(){
 shown=true;make();var p=panel();if(!p)return;p.hidden=false;
 loadThreads().then(function(){if(active)showThread(active);}).catch(function(e){textStatus('تعذر قراءة المحادثات: '+(e.message||e));});
 beginRefresh();setTimeout(function(){p.querySelector('[name="body"]')?.focus();},0);
}
function closeWindow(){shown=false;var p=panel();if(p)p.hidden=true;stopRefresh();}
function beginRefresh(){stopRefresh();timer=w.setInterval(function(){if(shown&&active&&!processing)loadMessages(active,false);},15000);}
function stopRefresh(){if(timer){w.clearInterval(timer);timer=null;}}
function renderThreads(){
 var e=panel()?.querySelector('[data-chat-threads]');if(!e)return;
 var items=threads.map(function(t){
  var names=(people[t.id]||[]).map(name).join('، ')||t.title;
  return '<button type="button" class="dc-thread'+(t.id===active?' selected':'')+'" data-chat-thread="'+esc(t.id)+'"><b>'+esc(names)+'</b><small>'+esc(date(t.updated_at))+'</small></button>';
 }).join('');
 e.innerHTML=items||'<div class="dc-empty">لا توجد محادثات بعد.</div>';
 e.querySelectorAll('[data-chat-thread]').forEach(function(x){x.onclick=function(){showThread(x.dataset.chatThread);};});
}
async function loadThreads(){
 var r=await db().from('digital_chat_threads').select('id,title,updated_at').order('updated_at',{ascending:false}).limit(50);
 if(r.error)throw r.error;threads=r.data||[];people={};
 var ids=threads.map(function(x){return x.id;});
 if(ids.length){
  var m=await db().from('digital_chat_participants').select('thread_id,agent_code').in('thread_id',ids);
  if(m.error)throw m.error;(m.data||[]).forEach(function(x){if(!people[x.thread_id])people[x.thread_id]=[];people[x.thread_id].push(x.agent_code);});
 }
 renderThreads();
}
function newGroup(){
 openWindow();var p=panel();if(!p)return;
 showCreate=true;p.querySelector('[data-chat-create-panel]').hidden=false;
 p.querySelectorAll('[data-chat-person]').forEach(function(x){x.checked=false;});
 p.querySelector('[data-chat-messages]').innerHTML='<div class="dc-empty">حدد المشاركين وبعدين ابدأ.</div>';
 p.querySelector('[data-chat-saved]').innerHTML='';p.querySelector('[data-chat-title]').textContent='محادثة جماعية جديدة';
 p.querySelector('[data-chat-compose]').hidden=true;
}
async function createSelected(){
 var ids=Array.from(panel().querySelectorAll('[data-chat-person]:checked')).map(function(x){return x.value;});
 if(!ids.length){textStatus('اختر وكيلًا واحدًا على الأقل.');return;}
 await createThread(ids);
}
async function createThread(ids){
 try{
  textStatus('جارٍ إنشاء المحادثة…');
  var r=await db().rpc('digital_chat_create',{p_agents:ids,p_title:ids.map(name).join(' و ').slice(0,120)});
  if(r.error)throw r.error;
  active=r.data;showCreate=false;await loadThreads();await showThread(active);
  textStatus('المحادثة جاهزة.');
 }catch(e){textStatus('تعذر إنشاء المحادثة: '+(e.message||e));}
}
async function openDirect(code){
 if(!agents[code])return;
 openWindow();
 if(!threads.length){try{await loadThreads();}catch(_){}}
 var found=threads.find(function(t){return (people[t.id]||[]).length===1&&people[t.id][0]===code;});
 if(found){await showThread(found.id);return;}
 await createThread([code]);
}
function updateKind(){
 var form=panel()?.querySelector('[data-chat-compose]');if(!form)return;
 var kind=form.elements.kind.value,recurring=kind==='task'&&form.elements.repeat.checked;
 form.querySelector('[data-chat-memory]').hidden=kind!=='instruction';
 form.querySelector('[data-chat-repeat]').hidden=kind!=='task';
 form.querySelector('[data-chat-schedule]').hidden=!recurring;
 form.querySelector('[data-chat-weekday]').hidden=form.elements.frequency.value!=='weekly';
}
function scheduleIso(form){
 var time=String(form.elements.time.value||'09:00').split(':').map(Number);
 var nowUae=new Date(Date.now()+4*3600000),target=new Date(nowUae.getTime());
 target.setUTCHours(time[0]||0,time[1]||0,0,0);
 if(target<=new Date(nowUae.getTime()+60000))target.setUTCDate(target.getUTCDate()+1);
 if(form.elements.frequency.value==='weekly'){
  var day=Number(form.elements.weekday.value);while(target.getUTCDay()!==day)target.setUTCDate(target.getUTCDate()+1);
 }
 return new Date(target.getTime()-4*3600000).toISOString();
}
async function send(form){
 if(!active||processing)return;
 var body=String(form.elements.body.value||'').trim(),kind=form.elements.kind.value;
 if(!body)return;
 var save=kind==='instruction'&&form.elements.memorize.checked;
 var repeat=kind==='task'&&form.elements.repeat.checked;
 var p={p_thread:active,p_kind:kind,p_body:body,p_save_instruction:save,
  p_frequency:repeat?form.elements.frequency.value:null,p_first_run:repeat?scheduleIso(form):null};
 processing=true;var button=form.querySelector('[type="submit"]');button.disabled=true;
 try{
  var r=await db().rpc('digital_chat_send',p);
  if(r.error)throw r.error;
  form.elements.body.value='';form.elements.memorize.checked=false;form.elements.repeat.checked=false;updateKind();
  await loadMessages(active,true);textStatus('اتحفظت رسالتك. جاري رد المشاركين…');
  var answer=await db().functions.invoke('digital-chat-reply',{body:{message_id:r.data.message_id}});
  if(answer.error||!answer.data?.ok)throw Error(answer.data?.error||answer.error?.message||'لم تصل استجابة');
  await loadMessages(active,true);await loadThreads();
  var pending=(answer.data.replies||[]).filter(function(x){return x.state==='awaiting_runtime';}).length;
  textStatus(pending?('تم تسجيل الردود، و'+pending+' وكيل لم يصل لمحركه التشغيلي بعد.'):'تمت الردود الاستشارية. لم يحدث تنفيذ خارجي.');
 }catch(e){textStatus('رسالتك تظل محفوظة إذا ظهرَت في المحادثة. تعذرت الاستجابة: '+(e.message||e));if(active)await loadMessages(active,true).catch(function(){});}
 finally{processing=false;button.disabled=false;}
}
function bubble(m){
 if(m.sender_type==='system')return '<div class="dc-bubble system"><span>'+esc(m.body)+'</span><small>'+esc(date(m.created_at))+'</small></div>';
 var owner=m.sender_type==='owner';
 var person=owner?human():name(m.agent_code);
 var simulated=!owner&&m.verification==='runtime_unavailable';
 var typeLabels={chat:'رسالة',question:'سؤال',instruction:'تعليمات',task:'مهمة',reply:'رد',schedule_notice:'متابعة دورية'};
 var type=typeLabels[m.kind]||m.kind;
 return '<article class="dc-bubble '+(owner?'mine':'theirs')+'">'+
 '<div class="dc-bubble-name">'+esc(person)+(simulated?' <span class="dc-simulated">محاكاة</span>':'')+' <small>'+esc(type)+(owner?'':simulated?' · غير متصل بالمحرك الفعلي':' · رد تحليلي')+'</small></div>'+
 '<p>'+esc(m.body)+'</p><div class="dc-bubble-footer">'+esc(date(m.created_at))+
 (m.process_state==='processing'?' · جاري الرد':m.process_state==='failed'?' · لم يكتمل الرد':'')+'</div>'+
 (owner&&m.process_state==='failed'?'<button type="button" data-chat-retry="'+esc(m.id)+'" class="dc-retry">إعادة الرد دون تكرار الرسالة</button>':'')+'</article>';
}
async function loadMessages(id,scroll){
 var ticket=++seq;
 var r=await db().from('digital_chat_messages').select('id,sender_type,agent_code,kind,body,process_state,created_at,verification')
  .eq('thread_id',id).order('created_at',{ascending:false}).limit(120);
 if(r.error)throw r.error;
 if(id!==active||ticket!==seq||!panel())return;
 var e=panel().querySelector('[data-chat-messages]');
 e.innerHTML=(r.data||[]).length?(r.data||[]).reverse().map(bubble).join(''):'<div class="dc-empty">قول مساء الخير، أو اسأل عن شغل الوكيل.</div>';
 e.querySelectorAll('[data-chat-retry]').forEach(function(button){button.onclick=function(){retryMessage(button.dataset.chatRetry);};});
 if(scroll)e.scrollTop=e.scrollHeight;
}
async function retryMessage(id){
 if(!active||processing||!id)return;
 processing=true;
 try{
  textStatus('جارٍ التحقق وإعادة الرد على الرسالة المحفوظة…');
  var result=await db().rpc('digital_chat_retry',{p_message:id});
  if(result.error)throw result.error;
  if(result.data!==true)throw Error('لا يمكن إعادة الرسالة لأنها ليست فاشلة، أو يوجد رد سابق. لم يتم إنشاء رسالة مكررة.');
  var answer=await db().functions.invoke('digital-chat-reply',{body:{message_id:id}});
  if(answer.error||!answer.data?.ok)throw Error(answer.data?.error||answer.error?.message||'تعذر الرد');
  textStatus('تمت إعادة محاولة الرد دون إعادة حفظ الرسالة أو التعليمات.');
 }catch(e){textStatus('تعذرت إعادة المحاولة: '+(e.message||e));}
 finally{processing=false;if(active){await loadMessages(active,true).catch(function(){});await loadSaved(active).catch(function(){});}}
}
async function loadSaved(id){
 if(id!==active||!panel())return;
 var [a,b]=await Promise.all([
  db().from('digital_chat_instructions').select('id,agent_code,body,status,created_at').eq('thread_id',id).order('created_at',{ascending:false}).limit(30),
  db().from('digital_chat_schedules').select('id,agent_code,prompt,status,frequency,next_run_at,enabled,last_run_at').eq('thread_id',id).order('created_at',{ascending:false}).limit(30)
 ]);
 if(a.error||b.error)return;
 if(id!==active||!panel())return;
 var rules=a.data||[],jobs=b.data||[],target=panel().querySelector('[data-chat-saved]');
 if(!rules.length&&!jobs.length){target.innerHTML='';return;}
 var rowRules=rules.map(function(x){return '<div class="dc-saved-item"><span>'+esc(name(x.agent_code))+' · '+esc(x.body.slice(0,120))+' <small>'+(x.status==='advisory_active'?'مفعلة في التحليل':x.status==='disabled'?'موقوفة':'بانتظار ربط المحرك')+'</small></span>'+
 '<button data-memory-id="'+esc(x.id)+'" data-memory-active="'+(x.status==='disabled'?'1':'0')+'">'+(x.status==='disabled'?'تفعيل':'إيقاف')+'</button></div>';}).join('');
 var rowJobs=jobs.map(function(x){return '<div class="dc-saved-item"><span>'+esc(name(x.agent_code))+' · '+esc(x.prompt.slice(0,110))+' <small>'+
 (x.frequency==='daily'?'كل يوم':'كل أسبوع')+' · '+(x.status==='awaiting_runtime'?'بانتظار ربط المحرك':x.enabled?'المرة القادمة '+esc(date(x.next_run_at)):'متوقفة')+'</small></span>'+
 '<button data-schedule-id="'+esc(x.id)+'" data-schedule-active="'+(x.enabled?'0':'1')+'">'+(x.enabled?'إيقاف':'تفعيل')+'</button></div>';}).join('');
 target.innerHTML='<details class="dc-saved-details"><summary>تعليمات محفوظة ('+rules.length+') ومتابعات دورية ('+jobs.length+')</summary>'+
 '<div class="dc-saved-list">'+rowRules+rowJobs+'</div></details>';
 target.querySelectorAll('[data-memory-id]').forEach(function(x){x.onclick=function(){toggleItem('digital_chat_set_instruction',{p_id:x.dataset.memoryId,p_active:x.dataset.memoryActive==='1'},id);};});
 target.querySelectorAll('[data-schedule-id]').forEach(function(x){x.onclick=function(){toggleItem('digital_chat_set_schedule',{p_id:x.dataset.scheduleId,p_active:x.dataset.scheduleActive==='1'},id);};});
}
async function toggleItem(method,p,id){
 try{var r=await db().rpc(method,p);if(r.error)throw r.error;textStatus('تم تعديل الحالة.');await loadSaved(id);}
 catch(e){textStatus('تعذر التعديل: '+(e.message||e));}
}
async function showThread(id){
 active=id;showCreate=false;var p=panel();if(!p)return;
 p.querySelector('[data-chat-create-panel]').hidden=true;p.querySelector('[data-chat-compose]').hidden=false;
 p.querySelector('[data-chat-title]').textContent=(people[id]||[]).map(name).join('، ')||threads.find(function(t){return t.id===id;})?.title||'محادثة';
 renderThreads();
 await Promise.all([loadMessages(id,true),loadSaved(id)]).catch(function(e){textStatus('تعذر تحميل المحادثة: '+(e.message||e));});
}
function onRender(){make();}
w.addEventListener('ssmpd-digital-team-rendered',onRender);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',onRender);else onRender();
w.SSMPDDigitalChat={openDirect:openDirect,openGroup:newGroup,open:openWindow};
})(window);