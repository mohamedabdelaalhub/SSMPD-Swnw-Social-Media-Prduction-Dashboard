/* SWNW queue-room.html — one department room (lab / radiology) for the technician's phone. */
(function(){
'use strict';
var root=document.getElementById('queue-room-root'),params=new URLSearchParams(location.search),W=params.get('w'),ROOM=params.get('room'),client=null,st=null,busy=false,timer=null;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(m,err){var t=document.getElementById('toast');if(!t)return;t.textContent=m;t.className=err?'err':'';t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(function(){t.style.display='none';},3500);}
function getClient(){if(window.SSMPDDb&&window.SSMPDDb.client)return window.SSMPDDb.client;if(client)return client;var c=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;if(!c||!window.supabase)return null;client=window.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return client;}
function q(action,payload){return getClient().rpc('clinic_reception_queue',{p_workspace:W,p_action:action,p_payload:payload||{}}).then(function(r){if(r.error)throw r.error;return r.data;});}
function loginMsg(){root.innerHTML='<p class="msg">لازم تسجّل دخول الأول. <a href="index.html">افتح الداشبورد وسجّل الدخول</a> ثم ارجع لهذا الرابط.</p>';}
function dialog(label,roomLabel){var d=document.createElement('div');d.className='big';d.innerHTML='<div><p>رقم المريض</p><strong>'+esc(label)+'</strong><p>'+esc(roomLabel||'')+'</p><button type="button">تمام</button></div>';d.querySelector('button').onclick=function(){d.remove();};document.body.appendChild(d);}
function tbtns(t){var b='';if(t.status==='called'||t.status==='in_service')b+='<button type="button" data-qa="dept_recall" data-id="'+esc(t.id)+'">نادِ تاني</button>';if(t.status==='called')b+='<button type="button" class="ok" data-qa="dept_start" data-id="'+esc(t.id)+'">بدأ</button>';if(t.status==='called'||t.status==='in_service')b+='<button type="button" class="ok" data-qa="dept_done" data-id="'+esc(t.id)+'">خلص</button><button type="button" class="warn" data-qa="dept_no_show" data-id="'+esc(t.id)+'">مجاش</button>';return b;}
function paint(){if(!st)return;var dep=(st.departments||[]).filter(function(d){return d.room_id===ROOM;})[0],room=(st.rooms||[]).filter(function(r){return r.id===ROOM;})[0];
 if(!dep){root.innerHTML='<p class="msg">الغرفة دي مش متاحة أو مش غرفة أرقام.</p>';return;}
 var nm=document.querySelector('[data-room-name]');if(nm)nm.textContent=dep.name;var dt=document.querySelector('[data-date]');if(dt)dt.textContent=st.date||'';
 var mine=(st.dept_tickets||[]).filter(function(t){return t.room_id===ROOM&&(t.status==='called'||t.status==='in_service');});
 root.innerHTML='<section class="card"><div class="sub">الرقم الحالي</div><div class="cur" data-cur>'+(dep.current_no!=null?esc(dep.current_no):'—')+'</div><div class="sub">المنتظرين ('+esc(dep.waiting_count)+')</div><div class="wait">'+((dep.waiting_nos||[]).length?dep.waiting_nos.map(function(n){return '<span class="chip">'+esc(n)+'</span>';}).join(''):'<span class="sub">لا أحد في الانتظار</span>')+'</div><button type="button" class="main" data-qa="call_next">نادِ التالي</button><button type="button" data-qa="dept_ticket">رقم جديد</button>'+mine.map(function(t){return '<div class="tk"><strong>'+esc(t.label)+'</strong><div class="row">'+tbtns(t)+'</div></div>';}).join('')+'</section>';
 root.querySelectorAll('[data-qa]').forEach(function(b){b.onclick=function(){go(b);};});}
function refresh(){if(!W||!ROOM||!getClient())return Promise.resolve();return q('state').then(function(d){st=d;paint();}).catch(function(e){if(/login|jwt|auth|مصرح|تسجيل/i.test((e&&e.message)||''))loginMsg();else toast((e&&e.message)||'تعذر التحميل',true);});}
function go(b){if(busy)return;var a=b.dataset.qa,p={room_id:ROOM};if(b.dataset.id)p={id:b.dataset.id};busy=true;root.querySelectorAll('button').forEach(function(x){x.disabled=true;});
 q(a,p).then(function(r){if(a==='dept_ticket')dialog(r.label,r.room_label);else if(a==='call_next'){if(r&&r.empty)toast('مفيش حد منتظر',true);else toast('نُودي '+r.label);}else toast('تم');}).catch(function(e){toast((e&&e.message)||'تعذر تنفيذ العملية',true);}).then(function(){busy=false;return refresh();});}
function start(){if(!W||!ROOM){root.innerHTML='<p class="msg">الرابط ناقص. اطلب رابط الفني من المسؤول.</p>';return;}var c=getClient();if(!c){root.innerHTML='<p class="msg">تعذر الاتصال.</p>';return;}
 c.auth.getSession().then(function(r){if(!r||!r.data||!r.data.session){loginMsg();return;}refresh();timer=setInterval(function(){if(!document.hidden&&!busy)refresh();},10000);});}
window.__queueRoomTest={refresh:refresh};
start();
})();
