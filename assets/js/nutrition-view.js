(function(){
"use strict";
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return 'تاريخ غير مسجل';return new Intl.DateTimeFormat('ar-EG',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));}
function confirmed(v){if(!v||isNaN(Date.parse(v)))return '';return new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v));}
function status(meals,rows){
 meals=Array.isArray(meals)?meals:[];
 if(!meals.length)return '<p class="nutrition-empty">لم تُضف وجبات لهذه الزيارة.</p>';
 var map=new Map((rows||[]).map(function(r){return [r.meal_id,r];}));
 var done=meals.filter(function(m){return map.get(m.id)&&map.get(m.id).completed;}).length;
 return '<div class="nutrition-progress"><b>تم تأكيد '+done+' من '+meals.length+' وجبات</b><progress max="'+meals.length+'" value="'+done+'" aria-label="الوجبات المؤكدة"></progress></div>'+meals.map(function(m){var r=map.get(m.id),ok=r&&r.completed;return '<div class="nutrition-status-row"><b>'+esc(m.name||'وجبة')+'</b><div><span class="nutrition-badge '+(ok?'done':'pending')+'">'+(ok?'تم تأكيد تناولها':'لم يتم التأكيد')+'</span>'+(ok&&r.completed_at?'<small>وقت التأكيد · '+esc(confirmed(r.completed_at))+'</small>':'')+'</div></div>';}).join('');
}
window.SwnwNutritionView={esc:esc,today:today,date:date,confirmed:confirmed,status:status};
})();
