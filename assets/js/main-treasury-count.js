/* «جرد الخزينة الرئيسية» (owner 2026-11-22 «طبق جرد الخزينة الرئيسية، وخليه زرار او بوكس واضح وسهل الوصول ليه»; server
   20261122200000). A clear box on top of «الخزائن والورديات» (next to the main balance tile) and a task on «شغلي النهارده»:
     * custodian: big «جرد الخزينة الرئيسية» button → counts by denomination → the server closes the open main shift for review and
       opens a new one at once (the main treasury never stops); or «افتح الخزينة الرئيسية» when none is open;
     * everyone allowed to see it: last count (when / by whom / counted vs book / reviewed?), counts waiting for review;
     * reviewer (not the counter): «مراجعة» per waiting count; counts waiting > 24 hours are highlighted (nudge).
   No new money path: count = the existing close; open = the existing open; review = the existing review (maker ≠ checker). */
(function(w,d){
'use strict';
var DEN=['200','100','50','20','10','5','1','0.5','0.25'];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){var n=Number(v||0);return n.toLocaleString('ar-EG-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2});}
function stamp(v){if(!v)return '—';var t=new Date(v);if(isNaN(t))return '—';return t.toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit'})+' '+t.toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'});}
function uuid(){if(w.crypto&&w.crypto.randomUUID)return w.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function rpc(name,args){var db=w.SSMPDDb;if(!db||!db.client)return Promise.reject(Error('تعذر الاتصال'));return Promise.resolve(db.client.rpc(name,args||{})).then(function(r){if(!r||r.error)throw (r&&r.error)||Error('تعذر التحميل');return r.data;});}
function errText(e){var m=e&&(e.message||e.details)||'';return /[؀-ۿ]/.test(m)?m:'حصلت مشكلة ومقدرناش نكمل — جرّب تاني';}

/* the box */
function html(v){
 if(!v||!v.configured)return '';
 var lc=v.last_count,sh=v.open_shift,pend=Number(v.pending_reviews||0),late=Number(v.overdue_reviews||0),diff=lc?Number(lc.difference||0):0,h='';
 h+='<div class="mc-head"><div><b>جرد الخزينة الرئيسية</b><small>'+(sh?'الخزينة مفتوحة من '+esc(stamp(sh.opened_at))+' — المسؤول: '+esc(sh.custodian):'الخزينة الرئيسية مقفولة دلوقتي')+'</small></div>';
 if(v.can_count)h+='<button type="button" class="btn btn-primary mc-big" data-mc-count>جرد الخزينة الرئيسية</button>';
 else if(v.can_open)h+='<button type="button" class="btn btn-primary mc-big" data-mc-open>افتح الخزينة الرئيسية</button>';
 h+='</div><div class="mc-facts">';
 h+='<div class="mc-fact"><span>آخر جرد</span><b>'+(lc?esc(stamp(lc.at)):'لسه مفيش')+'</b>'+(lc?'<small>'+esc(lc.by)+' — معدود '+money(lc.counted)+' · الدفتري '+money(lc.expected)+(diff?' · <span class="mc-diff">فرق '+money(diff)+'</span>':' · مطابق')+'</small>':'')+'</div>';
 h+='<div class="mc-fact'+(pend?' is-wait':'')+(late?' is-late':'')+'"><span>مستني مراجعة</span><b>'+pend+'</b><small>'+(late?late+' من أكتر من 24 ساعة':(pend?'المراجعة على شخص غير اللي عدّ':'كل الجرد اتراجع'))+'</small></div>';
 h+='</div>';
 if(v.can_count)h+='<p class="mc-hint">بتعدّ الفلوس فئة فئة وتدوس حفظ: الوردية القديمة بتتقفل وتروح للمراجعة، ووردية جديدة بتتفتح في نفس اللحظة — الخزينة ما بتقفش.</p>';
 var rev=(v.pending||[]).filter(function(p){return v.can_review&&!p.mine;});
 if(rev.length)h+='<div class="mc-pending"><b>جرد مستني مراجعتك</b>'+rev.map(function(p){var df=Number(p.counted)-Number(p.expected),old=Date.now()-new Date(p.closed_at).getTime()>864e5;
  return '<div class="mc-p'+(old?' is-late':'')+'"><span>'+esc(stamp(p.closed_at))+' — '+esc(p.by)+' — معدود '+money(p.counted)+' · الدفتري '+money(p.expected)+(df?' · فرق '+money(df):' · مطابق')+(old?' · مستني من أكتر من 24 ساعة':'')+'</span><button type="button" class="btn sm" data-mc-review="'+esc(p.id)+'">مراجعة</button></div>';}).join('')+'</div>';
 return h+'<div class="mc-form" data-mc-form hidden></div><p class="mc-status" data-mc-status role="status"></p>';
}
function countForm(){
 return '<form data-mc-count-form><p>عدّ الفلوس اللي في الخزينة الرئيسية واكتب عدد الأوراق أو القطع لكل فئة.</p><div class="mc-den">'+DEN.map(function(c){return '<label>فئة '+c+' جنيه<input type="number" name="c_'+c.replace('.','_')+'" value="0" min="0" max="9999999" step="1" inputmode="numeric"></label>';}).join('')+'</div>'+
  '<p class="mc-total">الإجمالي المعدود: <b data-mc-total>0.00</b> ج.م</p><label>ملاحظة (اختياري)<input name="note" maxlength="1000" placeholder="مثلاً: جرد آخر اليوم"></label>'+
  '<div class="mc-actions"><button type="submit" class="btn btn-primary">حفظ الجرد</button><button type="button" class="btn" data-mc-cancel>إلغاء</button></div></form>';
}
function reviewForm(id){return '<form data-mc-review-form data-id="'+esc(id)+'"><label>نتيجة المراجعة<input name="note" required minlength="3" maxlength="1000" placeholder="مثلاً: مطابقة بدون فرق"></label><div class="mc-actions"><button type="submit" class="btn btn-primary">حفظ المراجعة</button><button type="button" class="btn" data-mc-cancel>إلغاء</button></div></form>';}
function counts(form){var out={},t=0;DEN.forEach(function(c){var n=Math.max(0,Math.floor(Number(form.elements['c_'+c.replace('.','_')].value)||0));out[c]=n;t+=n*Number(c);});return {counts:out,total:Math.round(t*100)/100};}

function mount(box,o){
 o=o||{};if(!box)return Promise.resolve(null);
 return rpc('clinic_finance_main_count_status').then(function(v){
  if(!box.isConnected)return v;if(!v||!v.configured||(!v.is_custodian&&!v.can_review)){box.innerHTML='';box.hidden=true;return v;}
  box.hidden=false;box.innerHTML=html(v);wire(box,v,o);if(M.autoOpen&&v.can_count){M.autoOpen=false;var b=box.querySelector('[data-mc-count]');if(b)b.click();if(box.scrollIntoView)box.scrollIntoView({behavior:'smooth',block:'start'});}return v;
 }).catch(function(){box.innerHTML='';box.hidden=true;return null;});
}
function wire(box,v,o){
 var panel=box.querySelector('[data-mc-form]'),status=box.querySelector('[data-mc-status]');
 function done(msg){status.textContent=msg;panel.hidden=true;panel.innerHTML='';if(o.onDone)o.onDone();else mount(box,o);}
 function cancel(){panel.hidden=true;panel.innerHTML='';}
 var c=box.querySelector('[data-mc-count]');if(c)c.onclick=function(){panel.innerHTML=countForm();panel.hidden=false;var f=panel.querySelector('form'),tot=panel.querySelector('[data-mc-total]'),key=uuid();
  f.addEventListener('input',function(){tot.textContent=money(counts(f).total);});panel.querySelector('[data-mc-cancel]').onclick=cancel;
  var first=f.querySelector('input');if(first&&first.focus)first.focus();
  f.onsubmit=function(e){e.preventDefault();var x=counts(f),btn=f.querySelector('[type=submit]');btn.disabled=true;status.textContent='جاري حفظ الجرد…';
   rpc('clinic_finance_main_count',{p_counts:x.counts,p_note:f.elements.note.value||'',p_token:key}).then(function(r){var df=Number(r.difference||0);
    done('اتحفظ الجرد: معدود '+money(r.counted)+' · الدفتري '+money(r.expected)+(df?' · فرق '+money(df)+' (اتسجّل في فروق الخزينة)':' · مطابق')+'. الوردية القديمة راحت للمراجعة ووردية جديدة اتفتحت.');})
   .catch(function(e){btn.disabled=false;status.textContent=errText(e);});};};
 var op=box.querySelector('[data-mc-open]');if(op)op.onclick=function(){op.disabled=true;status.textContent='جاري فتح الخزينة الرئيسية…';
  rpc('clinic_finance_open_shift',{p_register:v.register_id,p_token:uuid()}).then(function(){done('الخزينة الرئيسية اتفتحت.');}).catch(function(e){op.disabled=false;status.textContent=errText(e);});};
 box.querySelectorAll('[data-mc-review]').forEach(function(b){b.onclick=function(){panel.innerHTML=reviewForm(b.getAttribute('data-mc-review'));panel.hidden=false;var f=panel.querySelector('form');panel.querySelector('[data-mc-cancel]').onclick=cancel;
  f.onsubmit=function(e){e.preventDefault();var btn=f.querySelector('[type=submit]');btn.disabled=true;
   rpc('clinic_finance_review_shift',{p_shift:f.getAttribute('data-id'),p_note:f.elements.note.value}).then(function(){done('اتسجّلت المراجعة.');}).catch(function(e){btn.disabled=false;status.textContent=errText(e);});};};});
}

/* «شغلي النهارده» task(s) from the same status: custodian → the count task; reviewer → counts waiting (hot after 24h) */
function tasks(v){
 var t=[];if(!v||!v.configured)return t;var pend=Number(v.pending_reviews||0),late=Number(v.overdue_reviews||0),lc=v.last_count;
 if(v.can_count||v.can_open)t.push({title:'جرد الخزينة الرئيسية',count:0,sub:(lc?'آخر جرد '+stamp(lc.at):'لسه مفيش جرد')+(pend?' · '+pend+' مستني مراجعة':''),btn:v.can_open?'افتح الخزينة':'اعمل الجرد',attr:'data-ft-main-count'});
 var forMe=(v.pending||[]).filter(function(p){return v.can_review&&!p.mine;}).length;
 if(forMe&&late)t.push({title:'جرد الرئيسية مستني مراجعتك',count:late,sub:'فيه جرد مستني من أكتر من 24 ساعة — راجعه قبل قفل الشهر.',btn:'راجع',attr:'data-ft-main-count'});
 return t;
}
var M={mount:mount,html:html,tasks:tasks,status:function(){return rpc('clinic_finance_main_count_status');},autoOpen:false,DEN:DEN};
w.SSMPDMainCount=M;
})(window,document);
