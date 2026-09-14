(function(){
"use strict";
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function cairoDay(v){var d=v instanceof Date?v:new Date(v);if(isNaN(d))return '';var parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),out={};parts.forEach(function(p){out[p.type]=p.value;});return out.year+'-'+out.month+'-'+out.day;}
function today(){return cairoDay(new Date());}
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return 'تاريخ غير مسجل';return new Intl.DateTimeFormat('ar-EG',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));}
function dayDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return 'تاريخ غير مسجل';return new Intl.DateTimeFormat('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));}
function shiftDay(v,amount){var d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
function confirmed(v){if(!v||isNaN(Date.parse(v)))return '';return new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v));}
function status(meals,rows){
 meals=Array.isArray(meals)?meals:[];
 if(!meals.length)return '<p class="nutrition-empty">لم تُضف وجبات لهذه الزيارة.</p>';
 var map=new Map((rows||[]).map(function(r){return [r.meal_id,r];}));
 var done=meals.filter(function(m){return map.get(m.id)&&map.get(m.id).completed;}).length;
 return '<div class="nutrition-progress"><b>تم تأكيد '+done+' من '+meals.length+' وجبات</b><progress max="'+meals.length+'" value="'+done+'" aria-label="الوجبات المؤكدة"></progress></div>'+meals.map(function(m){var r=map.get(m.id),ok=r&&r.completed;return '<div class="nutrition-status-row"><b>'+esc(m.name||'وجبة')+'</b><div><span class="nutrition-badge '+(ok?'done':'pending')+'">'+(ok?'تم تأكيد تناولها':'لم يتم التأكيد')+'</span>'+(ok&&r.completed_at?'<small>وقت التأكيد · '+esc(confirmed(r.completed_at))+'</small>':'')+'</div></div>';}).join('');
}
function history(meals,rows,fromDay,toDay){
 meals=Array.isArray(meals)?meals.filter(function(m){return m&&m.id;}):[];rows=Array.isArray(rows)?rows:[];
 var columns=[],seen=new Set(),names=new Map();
 meals.forEach(function(m){if(!seen.has(m.id)){seen.add(m.id);columns.push(m.id);}names.set(m.id,m.name||'وجبة');});
 rows.slice().sort(function(a,b){return String(b.tracking_date).localeCompare(String(a.tracking_date));}).forEach(function(r){
  if(!seen.has(r.meal_id)){seen.add(r.meal_id);columns.push(r.meal_id);}
  if(!names.has(r.meal_id))names.set(r.meal_id,r.meal_name_snapshot||'وجبة');
 });
 if(!columns.length)return '<p class="nutrition-empty">لم تُضف وجبات لهذه الزيارة.</p>';
 var byDay=new Map();rows.forEach(function(r){if(!byDay.has(r.tracking_date))byDay.set(r.tracking_date,new Map());byDay.get(r.tracking_date).set(r.meal_id,r);});
 var days=[];for(var cursor=toDay;cursor>=fromDay;cursor=shiftDay(cursor,-1)){days.push(cursor);if(days.length>370)break;}
 var head='<th scope="col">اليوم</th>'+columns.map(function(id){return '<th scope="col">'+esc(names.get(id)||'وجبة')+'</th>';}).join('')+'<th scope="col">النتيجة</th>';
 var body=days.map(function(day){
  var dayRows=byDay.get(day)||new Map(),done=0,hasAny=dayRows.size>0;
  var cells=columns.map(function(id){var r=dayRows.get(id),ok=r&&r.completed;if(ok)done++;
   if(!ok)return '<td><span class="nutrition-badge pending">لم يؤكد</span></td>';
   var actor=r.recorded_by_account_id?'المريض':(r.recorded_by_admin_id?'الموظف':'غير محدد');
   var snapshot=r.meal_name_snapshot&&r.meal_name_snapshot!==names.get(id)?'<br>اسم الوجبة وقت التسجيل · '+esc(r.meal_name_snapshot):'';
   return '<td><details class="nutrition-history-detail"><summary class="nutrition-badge done">تم</summary><small>وقت التأكيد · '+esc(confirmed(r.completed_at))+'<br>بواسطة · '+actor+(r.legacy?'<br>نوع التسجيل · تأكيد سابق':'')+snapshot+'</small></details></td>';
  }).join('');
  return '<tr><th scope="row"><b>'+esc(dayDate(day))+'</b><small>'+esc(day)+'</small></th>'+cells+'<td><b>'+done+' من '+columns.length+'</b>'+(hasAny?'':'<small class="nutrition-no-records">لا توجد تأكيدات</small>')+'</td></tr>';
 }).join('');
 return '<div class="nutrition-history-scroll"><table class="nutrition-history-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
window.SwnwNutritionView={esc:esc,today:today,cairoDay:cairoDay,date:date,dayDate:dayDate,shiftDay:shiftDay,confirmed:confirmed,status:status,history:history};
})();
