(function(){
 'use strict';
 var days=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
 function canonical(s){return String(s||'').replace(/ـ/g,'').replace(/[إأآ]/g,'ا').replace(/\s/g,'');}
 function parse(value){if(Array.isArray(value))value=value.join(' - ');var text=canonical(value);return days.filter(function(d){return text.includes(canonical(d));});}
 function normalise(rows,mode,excluded){
  rows=(rows||[]).filter(function(r){return r&&(r.days||r.time_from||r.time_to);});mode=mode||(rows.length>1?'different':'shared');
  var issues=[],expanded=[],seen=new Set();
  rows.forEach(function(r){var named=parse(r.days);if(!named.length&&mode!=='except')issues.push('اختر يوم العمل.');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time_from||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time_to||''))issues.push('أكمل موعد البداية والنهاية.');named.forEach(function(day){if(seen.has(day))issues.push('اليوم '+day+' مكرر.');seen.add(day);expanded.push({days:day,time_from:r.time_from,time_to:r.time_to});});});
  var excludedDays=parse(excluded),first=rows[0]||{};
  if(mode==='except'){expanded=days.filter(function(d){return !excludedDays.includes(d);}).map(function(d){return {days:d,time_from:first.time_from,time_to:first.time_to};});if(!expanded.length)issues.push('لا يمكن استثناء كل أيام الأسبوع.');}
  if(!rows.length)issues.push('حدد أيام العمل وموعد البداية والنهاية.');
  if(mode!=='different'&&expanded.some(function(r){return r.time_from!==first.time_from||r.time_to!==first.time_to;}))issues.push('اختر مواعيد مختلفة لكل يوم.');
  expanded.sort(function(a,b){return days.indexOf(a.days)-days.indexOf(b.days);});
  var selected=expanded.map(function(r){return r.days;}),variant=mode==='different'&&expanded.length>1?12-expanded.length:mode==='except'||selected.length>4?4:Math.max(1,selected.length-1);
  if(!['shared','different','except'].includes(mode))issues.push('اختر حالة المواعيد.');
  return {mode:mode,rows:expanded,days:selected,excluded:mode==='except'?excludedDays:days.filter(function(d){return !selected.includes(d);}),variant:variant,issues:Array.from(new Set(issues))};
 }
 window.SSMPDDoctorSchedule={days:days,parse:parse,normalise:normalise};
})();
