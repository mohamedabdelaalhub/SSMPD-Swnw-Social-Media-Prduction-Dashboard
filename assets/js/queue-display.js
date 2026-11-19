/* SWNW waiting-screen board: per doctor and per department room, current number and waiting numbers.
   New calls pop up with the number and room and a chime. Numbers and rooms only: no patient data.
   Reads clinic_reception_queue_display(p_display_token) every 5 seconds. */
(function(w,d){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return String(v==null?'':v).replace(/\d/g,function(x){return '٠١٢٣٤٥٦٧٨٩'[x];});}
function waitingChips(list,prefix,max){
 list=list||[];var shown=list.slice(0,max||8),more=list.length-shown.length;
 return shown.map(function(n){return '<span class="chip">'+esc((prefix||'')+n)+'</span>';}).join('')+(more>0?'<span class="chip more">+'+more+'</span>':'');
}
function card(kind,title,sub,room,cur,waiting,prefix){
 return '<article class="card '+kind+(cur?' live':'')+'"><header><h2>'+esc(title)+'</h2>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</header>'+
  '<div class="room">'+(room?esc(room):'<em>بدون غرفة محددة</em>')+'</div>'+
  '<div class="cur" data-cur>'+(cur?esc(cur):'—')+'</div><div class="cap">الرقم الحالي</div>'+
  '<div class="wait">'+(waiting&&waiting.length?waitingChips(waiting,prefix,8):'<em>لا يوجد منتظرين</em>')+'</div></article>';
}
function renderBoard(data){
 var cards=[];
 (data.doctors||[]).forEach(function(x){cards.push(card('doctor',x.name,x.specialty,x.room_label,x.current_no,x.waiting_nos,''));});
 (data.departments||[]).forEach(function(x){cards.push(card('dept',x.name,'',x.room_label,x.current_no,x.waiting_nos,''));});
 return cards.length?cards.join(''):'<p class="empty">لا توجد أرقام اليوم بعد</p>';
}
function renderRecent(calls){
 return (calls||[]).slice(0,6).map(function(c){return '<span class="rc"><strong>'+esc(c.ticket_no)+'</strong> '+esc(c.room_label||'')+'</span>';}).join('');
}
var ctx=null;
function chime(){
 try{
  var C=w.AudioContext||w.webkitAudioContext;if(!C)return;if(!ctx)ctx=new C();if(ctx.state==='suspended'&&ctx.resume)ctx.resume();
  [[880,0],[1320,0.18],[880,0.62],[1320,0.8]].forEach(function(n){
   var t=ctx.currentTime+n[1],o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(n[0],t);
   g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.2,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+0.34);
   o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.36);
  });
 }catch(e){}
}
function init(opts){
 var rpc=opts.rpc,token=opts.token,root=opts.root||d.body,sound=false,seen=null,queue=[],showing=false,timer=null;
 var board=root.querySelector('[data-board]'),recent=root.querySelector('[data-recent]'),banner=root.querySelector('[data-banner]'),status=root.querySelector('[data-status]');
 function setStatus(text,bad){if(status){status.textContent=text;status.className='status'+(bad?' bad':'');}}
 function next(){
  if(showing||!queue.length)return;
  var c=queue.shift();showing=true;
  banner.innerHTML='<div><span>رقم</span><strong>'+esc(c.ticket_no)+'</strong><span>تفضل إلى</span><b>'+esc(c.room_label||'الاستقبال')+'</b></div>';
  banner.hidden=false;banner.classList.add('on');if(sound)chime();
  setTimeout(function(){banner.classList.remove('on');banner.hidden=true;showing=false;next();},opts.bannerMs||12000);
 }
 function apply(data){
  board.innerHTML=renderBoard(data);if(recent)recent.innerHTML=renderRecent(data.calls);
  var ids=(data.calls||[]).map(function(c){return c.call_id;});
  if(seen===null){seen={};ids.forEach(function(i){seen[i]=1;});}else{
   (data.calls||[]).slice().reverse().forEach(function(c){if(!seen[c.call_id]){seen[c.call_id]=1;queue.push(c);}});next();}
 }
 function poll(){
  rpc('clinic_reception_queue_display',{p_display_token:token}).then(function(data){setStatus('الشاشة متصلة وتتحدث تلقائيًا',false);apply(data||{});})
   .catch(function(e){setStatus((e&&e.message)||'تعذر تحديث الشاشة',true);});
 }
 var btn=root.querySelector('[data-sound]');
 if(btn)btn.onclick=function(){sound=!sound;btn.textContent=sound?'إيقاف الصوت':'تشغيل الصوت';if(sound)chime();};
 if(!token){setStatus('رابط الشاشة غير مكتمل — افتحها من تشغيل اليوم',true);return {poll:function(){}};}
 poll();timer=setInterval(poll,opts.everyMs||5000);
 return {poll:poll,setSound:function(v){sound=!!v;},stop:function(){clearInterval(timer);}};
}
w.SWNWQueueDisplay={init:init,renderBoard:renderBoard,renderRecent:renderRecent};
})(window,document);
