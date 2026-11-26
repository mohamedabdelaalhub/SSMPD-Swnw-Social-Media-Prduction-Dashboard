/* «لصق رسالة فيزيتا» (owner approved the mockup 2026-11-26, docs/ui-references/mockups/vezeeta-paste-booking.html).
   The receptionist pastes the Vezeeta booking SMS into «حجز موعد»; this reads it and fills the booking form (source فيزيتا, doctor,
   patient by phone, day, time or the first free slot, and for «Shamel» the «فيزيتا شامل» 40% discount with the message as proof).
   Nothing is saved here — the receptionist presses the form's own save. Server: 20261126190000 re-validates the proof.
   Pure helpers (parse / matchDoctors) are exported for tests. */
(function(w){'use strict';
var AR_DIG='٠١٢٣٤٥٦٧٨٩',FA_DIG='۰۱۲۳۴۵۶۷۸۹';
function digits(s){return String(s==null?'':s).replace(/[٠-٩۰-۹]/g,function(c){var i=AR_DIG.indexOf(c);return String(i>=0?i:FA_DIG.indexOf(c));});}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pad(n){return String(n).padStart(2,'0');}
function addDays(iso,n){var d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function phone10(s){var d=digits(s).replace(/\D/g,'');return d.length>=10?d.slice(-10):'';}
/* parse(text, todayISO) → {ok, shamel, doctor, patient, phone, day, dayWord, time, branch, branchOk, errors[]} */
function parse(text,today){var t=digits(String(text||'')).replace(/[‎‏]/g,'').replace(/\s+/g,' ').trim(),out={ok:false,shamel:false,errors:[]};
 if(!t){out.errors.push('empty');return out;}
 var m=t.match(/Dear\s+Doctor\s+(.+?)\s*,\s*You\s+received\s+a\s+new\s+(Shamel\s+)?booking\s+(.+?)\s*-\s*(\+?[\d][\d ]{8,15}\d)\s+(.*)$/i);
 if(!m){out.errors.push('unreadable');return out;}
 out.doctor=m[1].replace(/^(dr\.?|doctor)\s+/i,'').trim();out.shamel=!!m[2]||/shamel/i.test(t);out.patient=m[3].trim();out.phone=digits(m[4]).replace(/\D/g,'');
 if(out.phone.length===12&&out.phone.indexOf('20')===0)out.phone='0'+out.phone.slice(2);
 var rest=m[5].split(/\s+-\s+/).map(function(x){return x.trim();}).filter(Boolean),dayPart=rest.shift()||'',time=null,branch='';
 rest.forEach(function(x){var tm=x.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);if(tm){var h=+tm[1]%12+(/pm/i.test(tm[3])?12:0);time=pad(h)+':'+tm[2];}else branch=x;});
 out.time=time;out.branch=branch;out.branchOk=/hadayek/i.test(branch);
 var word=(dayPart.match(/^(Today|Tomorrow)/i)||[])[1]||'',dm=dayPart.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/),day=null;
 if(dm){var y=dm[3]?(+dm[3]<100?2000+(+dm[3]):+dm[3]):+today.slice(0,4),mo=+dm[2],dd=+dm[1];if(!dm[3]&&mo<+today.slice(5,7)-6)y++;day=y+'-'+pad(mo)+'-'+pad(dd);}
 else if(/^today/i.test(word))day=today;else if(/^tomorrow/i.test(word))day=addDays(today,1);
 out.dayWord=word;out.day=day;
 if(!out.phone||out.phone.length<10)out.errors.push('phone');if(!day)out.errors.push('day');else if(day<today)out.errors.push('past');
 if(!out.branchOk)out.errors.push('branch');if(!out.doctor)out.errors.push('doctor');
 out.ok=!out.errors.length;return out;}
/* Arabic → rough Latin consonant skeleton so «د. دينا حسني» ~ "Dina Hosny" */
var MAP={'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'s','ج':'g','ح':'h','خ':'kh','د':'d','ذ':'z','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'k','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'a','و':'w','ي':'y','ى':'a','ئ':'y','ؤ':'w','ء':''};
function skel(word){var s=String(word).toLowerCase().replace(/[ً-ْ]/g,'').split('').map(function(c){return MAP[c]!=null?MAP[c]:c;}).join('');
 s=s.replace(/q/g,'k').replace(/th/g,'s').replace(/ph/g,'f').replace(/[^a-z]/g,'').replace(/[aeiouwy]/g,'').replace(/(.)\1+/g,'$1');return s;}
function tokens(name){return String(name||'').replace(/^\s*(د\s*\.?|دكتور|دكتورة|dr\.?)\s*/i,'').replace(/[.\-_،,]/g,' ').split(/\s+/).filter(function(x){return x&&!/^(د|dr|el|al|ال)$/i.test(x);}).map(skel).filter(function(x){return x.length>=2;});}
function lev(a,b){var m=a.length,n=b.length,d=[],i,j;for(i=0;i<=m;i++){d[i]=[i];}for(j=1;j<=n;j++)d[0][j]=j;for(i=1;i<=m;i++)for(j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}
/* matchDoctors(name, providers) → [{provider, score}] best first; score = share of the message's name words found */
function matchDoctors(name,providers){var mt=tokens(name);if(!mt.length)return [];
 return (providers||[]).filter(function(p){return p&&p.active!==false&&p.doctor_key;}).map(function(p){var pt=tokens(p.name),hit=0;
   mt.forEach(function(x){if(pt.some(function(y){return y===x||(Math.min(x.length,y.length)>=4&&x[0]===y[0]&&lev(x,y)<=1);}))hit++;});return {provider:p,score:hit/mt.length};})
  .filter(function(r){return r.score>=0.5;}).sort(function(a,b){return b.score-a.score||String(a.provider.name).localeCompare(String(b.provider.name));});}
function sure(list){return list.length&&list[0].score===1&&!(list[1]&&list[1].score===1)?list[0].provider:null;}
function cairoHM(iso){try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));}catch(_){return '';}}
function cairoDay(iso){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(iso?new Date(iso):new Date());}catch(_){return '';}}
function fire(el,type){if(el)el.dispatchEvent(new Event(type||'change',{bubbles:true}));}
function dayAr(iso){try{return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'UTC',weekday:'long'}).format(new Date(iso+'T12:00:00Z'))+' '+iso.slice(8,10)+'/'+iso.slice(5,7);}catch(_){return iso;}}
function time12(hm){if(!hm)return '';var h=+hm.slice(0,2),m=hm.slice(3);return (h%12||12)+':'+m+' '+(h<12?'ص':'م');}
/* wire(form, {data, appointment}) — new bookings only */
function wire(form,ctx){if(!form||(ctx&&ctx.appointment)||form.querySelector('[data-vzp]'))return;var data=(ctx&&ctx.data)||{};
 var box=document.createElement('section');box.className='vzp';box.setAttribute('data-vzp','');box.setAttribute('data-wide','');
 box.innerHTML='<button type="button" class="btn vzp-open" data-vzp-open>لصق رسالة فيزيتا</button><div class="vzp-panel" data-vzp-panel hidden><div class="vzp-hd"><b>لصق رسالة فيزيتا</b><button type="button" class="vzp-x" data-vzp-close aria-label="إغلاق">✕</button></div>'+
  '<label class="vzp-l">الصق رسالة فيزيتا (SMS) هنا<textarea data-vzp-text rows="3" dir="ltr" maxlength="1000" placeholder="Dear Doctor …"></textarea></label><div data-vzp-out role="status" aria-live="polite"></div>'+
  '<div class="vzp-btns"><button type="button" class="btn btn-primary" data-vzp-apply disabled>املا الحجز من الرسالة</button><button type="button" class="btn" data-vzp-cancel>رجوع</button></div></div>';
 form.insertBefore(box,form.firstChild);
 var panel=box.querySelector('[data-vzp-panel]'),ta=box.querySelector('[data-vzp-text]'),out=box.querySelector('[data-vzp-out]'),apply=box.querySelector('[data-vzp-apply]'),cur=null,pick=null,dupOk=false;
 function close(){panel.hidden=true;box.querySelector('[data-vzp-open]').hidden=false;}
 box.querySelector('[data-vzp-open]').onclick=function(){panel.hidden=false;this.hidden=true;ta.focus();};
 box.querySelector('[data-vzp-close]').onclick=close;box.querySelector('[data-vzp-cancel]').onclick=close;
 function patientByPhone(ph){var k=phone10(ph);return k?(data.patients||[]).find(function(p){return phone10(p.phone)===k;}):null;}
 function dup(pt,prov,day){if(!pt||!prov||!day)return null;return (data.appointments||[]).find(function(a){return a.patient_id===pt.id&&a.provider_id===prov.id&&cairoDay(a.starts_at)===day&&a.status!=='cancelled'&&a.status!=='no_show';});}
 function render(){var r=cur;if(!r){out.innerHTML='';apply.disabled=true;return;}
  if(r.errors.indexOf('unreadable')>=0||r.errors.indexOf('empty')>=0){out.innerHTML='<p class="vzp-err">مش قادر أقرأ الرسالة — كمّل الحجز يدوي.</p>';apply.disabled=true;return;}
  var cands=matchDoctors(r.doctor,data.providers),doc=pick||sure(cands),pt=patientByPhone(r.phone),d=doc&&dup(pt,doc,r.day),rows=[];
  rows.push(['المصدر','<span class="vzp-pill on">فيزيتا</span>'+(r.shamel?' <span class="vzp-pill orange">شامل</span>':'')]);
  rows.push(['الدكتور',doc?'<span class="vzp-ok">✓ '+esc(doc.name)+'</span>':cands.length?'<span class="vzp-warn">«'+esc(r.doctor)+'» ينفع أكتر من دكتور — اختار:</span>':'<span class="vzp-warn">مش لاقي «'+esc(r.doctor)+'» — اختار الدكتور من الحجز تحت</span>']);
  rows.push(['المريض',pt?'<span class="vzp-ok">✓ ملف موجود</span> '+esc(pt.name)+(pt.file_no?' — '+esc(pt.file_no):''):'<span class="vzp-warn">مفيش ملف بالرقم ده</span> '+esc(r.patient)+' — <span dir="ltr">'+esc(r.phone)+'</span>']);
  rows.push(['اليوم',r.day?(r.dayWord?'«'+esc(r.dayWord)+'» ← ':'')+'<b>'+esc(dayAr(r.day))+'</b>':'—']);
  rows.push(['الساعة',r.time?'<b>'+esc(time12(r.time))+'</b>':'<span class="vzp-warn">'+(r.shamel?'رسالة الشامل مفيهاش ساعة':'مفيش ساعة')+'</span>']);
  rows.push(['الفرع',r.branchOk?'<span class="vzp-ok">✓ حدائق الأهرام</span>':'<span class="vzp-bad">'+esc(r.branch||'—')+'</span>']);
  var html='<dl class="vzp-rows">'+rows.map(function(x){return '<dt>'+x[0]+'</dt><dd>'+x[1]+'</dd>';}).join('')+'</dl>';
  if(!doc&&cands.length)html+='<div class="vzp-opt" data-vzp-cands>'+cands.slice(0,5).map(function(c){return '<label><input type="radio" name="vzp_doc" value="'+esc(c.provider.id)+'"> '+esc(c.provider.name)+(c.provider.department?' — '+esc(c.provider.department):'')+'</label>';}).join('')+'</div>';
  if(!r.time&&r.day)html+='<div class="vzp-opt" data-vzp-when><label><input type="radio" name="vzp_when" value="first" checked> أول معاد فاضي مع الدكتور</label>'+(r.day===cairoDay()?'<label><input type="radio" name="vzp_when" value="queue"> بدون معاد — بالدور</label>':'')+'<label><input type="radio" name="vzp_when" value="manual"> أختار الساعة بنفسي</label></div>';
  if(r.shamel)html+='<p class="vzp-note">«فيزيتا شامل» ← خصم 40٪ تلقائي، والإثبات هو الرسالة نفسها (بتتحفظ مع الحجز).</p>';else html+='<p class="vzp-note">فيزيتا عادي ← المريض بيدفع السعر كامل.</p>';
  if(!pt)html+='<p class="vzp-note">مفيش ملف في الاستقبال بالرقم ده — بعد «املا الحجز» دوّر في الأرشيف بالرقم تحت أو اعمل ملف جديد بالاسم «'+esc(r.patient)+'».</p>';
  var errs=[];if(r.errors.indexOf('branch')>=0)errs.push('الرسالة دي لفرع تاني — مش بتتحجز هنا.');if(r.errors.indexOf('past')>=0)errs.push('الحجز ده يومه عدّى — اتأكد من الرسالة.');if(r.errors.indexOf('day')>=0)errs.push('مش لاقي يوم الحجز في الرسالة.');if(r.errors.indexOf('phone')>=0)errs.push('مش لاقي رقم موبايل المريض في الرسالة.');
  if(errs.length)html+='<p class="vzp-err">'+errs.map(esc).join('<br>')+'</p>';
  if(d&&!dupOk)html+='<p class="vzp-err" data-vzp-dup>نفس الرقم محجوز مع '+esc(doc.name)+' يوم '+esc(dayAr(r.day))+' — '+esc(time12(cairoHM(d.starts_at)))+'.</p><div class="vzp-btns"><button type="button" class="btn btn-primary" data-vzp-open-existing="'+esc(d.id)+'">افتح الحجز الموجود</button><button type="button" class="btn" data-vzp-dup-ok>احجز تاني برضه</button></div>';
  out.innerHTML=html;apply.disabled=!!errs.length||!doc||!!(d&&!dupOk);
  out.querySelectorAll('input[name="vzp_doc"]').forEach(function(i){i.onchange=function(){pick=(data.providers||[]).find(function(p){return p.id===i.value;})||null;render();};});
  var dk=out.querySelector('[data-vzp-dup-ok]');if(dk)dk.onclick=function(){if(w.confirm('فيه حجز لنفس المريض مع نفس الدكتور في نفس اليوم. تحجز تاني برضه؟')){dupOk=true;render();}};
  var oe=out.querySelector('[data-vzp-open-existing]');if(oe)oe.onclick=function(){var id=oe.getAttribute('data-vzp-open-existing'),cancel=form.closest('.rx-modal')&&form.closest('.rx-modal').querySelector('[data-rx-cancel]');if(cancel)cancel.click();setTimeout(function(){var b=document.querySelector('[data-tl-open="'+id+'"]');if(b)b.click();},50);};}
 ta.addEventListener('input',function(){pick=null;dupOk=false;cur=ta.value.trim()?parse(ta.value,cairoDay()):null;render();});
 apply.onclick=function(){var r=cur;if(!r)return;var doc=pick||sure(matchDoctors(r.doctor,data.providers));if(!doc)return;var el=form.elements,pt=patientByPhone(r.phone);
  if(el.source){el.source.value='vezeeta';fire(el.source);var det=el.source.closest('details');if(det)det.open=true;}
  if(pt&&el.patient_id){el.patient_id.value=pt.id;fire(el.patient_id);}
  else{var s=form.querySelector('[data-archive-search]');if(s){s.value=r.phone;fire(s,'input');}}
  var dept=form.querySelector('select[name="department"],[data-rx-dept]');if(dept&&doc.department){dept.value=doc.department;fire(dept);}
  if(el.day){el.day.value=r.day;fire(el.day);}
  if(el.provider_id){if(![].some.call(el.provider_id.options,function(o){return o.value===doc.id;})){var o=document.createElement('option');o.value=doc.id;o.textContent=doc.name;el.provider_id.appendChild(o);}el.provider_id.value=doc.id;fire(el.provider_id);}
  var when=(out.querySelector('input[name="vzp_when"]:checked')||{}).value||'first';
  setTimeout(function(){var st=el.starts_at;if(when==='queue'&&el.walk_in){el.walk_in.checked=true;fire(el.walk_in);}
   else if(st&&r.time){var opt=[].find.call(st.options,function(o){return o.value&&o.value!=='__custom__'&&cairoHM(o.value)===r.time;});if(opt)st.value=opt.value;else if([].some.call(st.options,function(o){return o.value==='__custom__';})){st.value='__custom__';fire(st);if(el.custom_time)el.custom_time.value=r.time;}fire(st);}
   else if(st&&when==='first'){var f=[].find.call(st.options,function(o){return o.value&&o.value!=='__custom__';});if(f){st.value=f.value;fire(st);}}
   var on=form.querySelector('[data-rbd-on]');
   if(r.shamel&&on){if(!on.checked){on.checked=true;fire(on);}var k=form.querySelector('input[name="discount_kind"][value="vezeeta"]');if(k){k.checked=true;fire(k);}if(el.discount_proof_text){el.discount_proof_text.value=ta.value.trim();fire(el.discount_proof_text);}}
   form.dataset.vzpFilled='1';if(w.SSMPDToast)w.SSMPDToast.show('اتملا الحجز من رسالة فيزيتا — راجع الخدمة والساعة ودوس حفظ');},120);
  close();};}
w.SSMPDVezeetaPaste={parse:parse,matchDoctors:matchDoctors,sure:sure,skel:skel,wire:wire};
})(window);
