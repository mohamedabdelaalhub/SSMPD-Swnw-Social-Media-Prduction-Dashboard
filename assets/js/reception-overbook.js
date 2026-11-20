/* «تسجيل موعد يدوي» (owner 2026-11-20, mockup docs/ui-references/mockups/manual-overbook.html approved):
   an extra appointment on top of a doctor's full schedule. Server: clinic_reception_command('overbook')
   (20261120210000) — reason required, inside the doctor's hours, 2/hour and 6/day per doctor (more needs the
   reception manager), 5 minutes long so it never takes the next free slot. */
(function(w){'use strict';
var REASONS=['طلب الدكتور','حالة طارئة','متابعة سريعة','مريض جه من غير ميعاد والجدول مليان','سبب تاني'];
function cairoDay(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());}catch(_){return new Date().toISOString().slice(0,10);}}
function hm(iso){try{return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}}
function open(c){var d=c.data||{},esc=c.esc;
 var pats=(d.patients||[]).map(function(p){return [p.id,(p.name||'')+(p.file_no?' — '+p.file_no:'')];});
 var provs=(d.providers||[]).filter(function(p){return p.active!==false;}).map(function(p){return [p.id,p.name+(p.department?' — '+p.department:'')];});
 var svcs=(d.services||[]).filter(function(s){return s.active!==false;}).map(function(s){return [s.id,s.name+(s.department?' — '+s.department:'')];});
 var body='<p class="rob-intro">موعد <b>إضافي</b> فوق جدول الدكتور حتى لو المواعيد مليانة. بيتسجل مين عمله وإمتى والسبب.</p>'+
  c.select('patient_id','المريض',pats)+c.select('provider_id','الطبيب',provs)+c.select('service_id','الخدمة',svcs)+
  c.field('day','التاريخ (بتوقيت القاهرة)','date',cairoDay())+c.field('time','الوقت (بتوقيت القاهرة)','time','','required step="300"')+
  '<p class="rob-warn" data-rob-warn role="status" hidden></p>'+
  '<fieldset class="rob-reasons" data-wide><legend>سبب الحجز الإضافي (إجباري)</legend>'+REASONS.map(function(r,i){return '<label class="rob-chip"><input type="radio" name="reason_kind" value="'+esc(r)+'"'+(i===0?' required':'')+'> '+esc(r)+'</label>';}).join('')+'</fieldset>'+
  '<label data-wide>تفاصيل السبب <small>(إجباري لو «سبب تاني»)</small><input name="reason" maxlength="200" data-rob-reason></label>'+
  '<p class="rob-note" data-wide>حد أقصى للدكتور: ٢ إضافي في الساعة و٦ في اليوم — بعدها محتاج مدير الاستقبال. لازم يكون جوه مواعيد تواجد الدكتور. الموعد الإضافي مدته ٥ دقايق في الجدول، فالحجز اللي بعده ما بيتزحزحش.</p>';
 var root=c.modal('✍ تسجيل موعد يدوي (حجز إضافي)',body,function(v,key){
  if(v.reason_kind==='سبب تاني'&&String(v.reason||'').trim().length<3)throw new Error('اكتب السبب');
  var st=c.cairoISO(v.day+'T'+String(v.time).slice(0,5));
  return c.command('overbook',{patient_id:v.patient_id,provider_id:v.provider_id,service_id:v.service_id,starts_at:st,reason_kind:v.reason_kind,reason:String(v.reason||'').trim()},key);});
 if(!root)return null;root.classList.add('rob-modal');var f=root.querySelector('form'),warn=root.querySelector('[data-rob-warn]');
 function check(){var prov=f.elements.provider_id.value,day=f.elements.day.value,tm=f.elements.time.value;warn.hidden=true;if(!prov||!day||!tm)return;
  var t;try{t=Date.parse(c.cairoISO(day+'T'+tm.slice(0,5)));}catch(_){return;}
  var hit=(d.appointments||[]).filter(function(a){return a.provider_id===prov&&['cancelled','no_show'].indexOf(a.status)<0&&Date.parse(a.starts_at)<=t&&Date.parse(a.ends_at)>t;});
  var same=(d.appointments||[]).filter(function(a){return a.provider_id===prov&&a.overbook&&['cancelled','no_show'].indexOf(a.status)<0&&String(a.starts_at).slice(0,10)===day;}).length;
  if(hit.length){var a=hit[0];warn.hidden=false;warn.innerHTML='⚠ الدكتور عنده حجز في نفس الوقت: <b>'+esc(hm(a.starts_at))+' – '+esc(hm(a.ends_at))+'</b> '+esc(a.service_name||c.lookup('services',a.service_id))+' ('+esc(c.lookup('patients',a.patient_id))+'). الموعد ده هيتسجل <b>إضافي</b> فوق الجدول.';}
  else{warn.hidden=false;warn.innerHTML='الوقت ده فاضي في جدول الدكتور — الأفضل تستخدم «حجز موعد» العادي.';}
  if(same)warn.innerHTML+='<br><small>الدكتور عنده '+same+' موعد إضافي في اليوم ده.</small>';}
 ['provider_id','day','time'].forEach(function(n){f.elements[n].addEventListener('change',check);f.elements[n].addEventListener('input',check);});
 var why=f.querySelector('[data-rob-reason]');f.querySelectorAll('[name="reason_kind"]').forEach(function(r){r.addEventListener('change',function(){why.required=r.checked&&r.value==='سبب تاني';});});
 return root;}
function tag(a){if(!a||!a.overbook)return '';return ' <span class="rob-tag" title="'+String(a.overbook_reason||'').replace(/"/g,'&quot;')+'">إضافي ✍</span>';}
w.SSMPDReceptionOverbook={open:open,tag:tag,REASONS:REASONS};
})(window);
