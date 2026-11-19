/* SWNW «اعرف دورك»: the patient's own turn from the signed check-in link. Ticket number, how many are ahead, the number inside now,
   room and doctor. Numbers and status only. Refreshes every 8 seconds; stops when the visit is over or the link is invalid. */
(function(w,d){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var TEXT={not_arrived:'لسه ماسجلتش وصولك',waiting:'في الانتظار',called:'اتنادى عليك: اتفضل',in_service:'جوه الكشف دلوقتي',done:'خلص كشفك، سلامتك',cancelled:'الحجز ده اتلغى',no_show:'اتسجل إنك مجيتش'};
function cell(v,cap){return '<div class="cell"><b>'+esc(v==null?'—':v)+'</b><span>'+cap+'</span></div>';}
function view(r){
 if(!r||!r.ok)return {cls:'bad',html:'<p class="state">الرابط ده مش شغال أو انتهت صلاحيته</p><p class="cap">اطلب رابط جديد من الاستقبال.</p>',stop:true};
 var st=r.state,cls=st==='called'?'called':st==='done'?'done':(st==='cancelled'||st==='no_show')?'bad':'';
 var h='<p class="state">'+esc(TEXT[st]||'')+'</p>';
 if(r.doctor_name)h+='<p class="cap">مع '+esc(r.doctor_name)+(r.booked_time&&st==='not_arrived'?' · ميعادك '+esc(r.booked_time):'')+'</p>';
 if(r.order_no!=null&&(st==='waiting'||st==='called'||st==='in_service')){
  h+='<div class="cap">رقمك</div><div class="num">'+esc(r.order_no)+'</div>';
  if(st==='waiting')h+='<div class="grid">'+cell(r.ahead_count,'قدامك')+cell(r.current_no,'الرقم اللي جوه')+'</div>';
  if(r.room_label)h+='<div class="room">'+(st==='called'?'اتفضل على ':'غرفتك: ')+esc(r.room_label)+'</div>';
 }else if(st==='not_arrived'){h+='<p class="cap">سجّل وصولك من اللينك اللي وصلك عشان يتحدد رقمك.</p>';}
 return {cls:cls,html:h,stop:st==='done'||st==='cancelled'||st==='no_show'};
}
function init(o){
 var rpc=o.rpc,token=o.token,root=o.root||d,box=root.getElementById?root.getElementById('turn'):root.querySelector('#turn'),foot=root.querySelector('[data-foot]'),timer=null,last='';
 function paint(r){var v=view(r);box.innerHTML='<div class="card '+v.cls+'">'+v.html+'</div>';if(foot)foot.textContent=v.stop?'':'بتتحدث الصفحة لوحدها كل ٨ ثواني';if(v.stop&&timer){clearInterval(timer);timer=null;}last=r&&r.state||'';}
 function poll(){return rpc('clinic_reception_my_turn',{p_token:token}).then(paint).catch(function(){if(foot)foot.textContent='تعذر التحديث، هنحاول تاني…';});}
 if(!token){paint({ok:false});return {poll:poll,stop:function(){}};}
 poll();timer=setInterval(poll,o.everyMs||8000);
 return {poll:poll,stop:function(){if(timer){clearInterval(timer);timer=null;}}};
}
w.SWNWMyTurn={init:init,view:view};
})(window,document);
