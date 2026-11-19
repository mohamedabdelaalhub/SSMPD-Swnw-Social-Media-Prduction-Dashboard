// حجز نفس المريض مرتين (المالك 2026-11-19، التصور docs/ui-references/mockups/same-patient-guard.html):
//  • المريض عنده حجز تاني في نفس اليوم → تنبيه بالحجز الموجود (الساعة/الخدمة/الطبيب) قبل الحفظ:
//    «أيوه نفس المريض — كمّل الحجز» يبعت الحجز تاني بـ same_day_ok، و«ارجع وشوف الحجز الأساسي» يلغي الحجز الجديد ويفتح تفاصيل الأساسي.
//  • نفس الوقت → القاعدة ترفض برسالة واضحة (مفيش تأكيد).
//  • زرار «التفاصيل» على كل موعد في تشغيل اليوم بيفتح نافذة بتفاصيل الحجز.
(function(){
  var STATUS={booked:'محجوز',arrived:'وصل',completed:'خلص',cancelled:'ملغي',no_show:'محضرش'};
  var SOURCE={unknown:'غير معروف',whatsapp:'واتساب',facebook:'فيسبوك',instagram:'إنستجرام',phone:'تليفون',walk_in:'حضور مباشر',website:'الموقع',referral:'ترشيح'};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function hm(iso){try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));}catch(e){return '';}}
  function day(iso){try{return new Date(iso).toLocaleDateString('ar-EG',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'numeric'});}catch(e){return '';}}
  function stamp(iso){try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replace(',','');}catch(e){return '';}}
  function isSameDay(e){return !!(e&&e.hint==='same_patient_same_day');}
  function list(e){try{var v=JSON.parse(e.details||e.detail||'[]');return Array.isArray(v)?v:[];}catch(x){return [];}}
  function overlay(html){var b=document.createElement('div');b.className='modal-backdrop rx-sp-backdrop';b.setAttribute('role','dialog');b.setAttribute('aria-modal','true');b.innerHTML='<section class="modal rx-sp">'+html+'</section>';document.body.appendChild(b);
    var f=b.querySelector('button');if(f&&f.focus)f.focus();return b;}
  function row(a,i){return '<div class="rx-sp-bk"><span class="rx-sp-t" dir="ltr">'+esc(hm(a.starts_at))+'</span><div><b>'+esc(a.service||'موعد')+'</b>'+(a.confirmed?' <span class="rx-sp-tag">متأكد</span>':'')+
    '<div class="rx-sp-s">'+esc(a.doctor?'د. '+a.doctor:'')+(a.source&&a.source!=='unknown'?' · '+esc(SOURCE[a.source]||a.source):'')+' · '+esc(STATUS[a.status]||a.status)+'</div></div><button type="button" class="rx-sp-d" data-sp-detail="'+i+'">التفاصيل</button></div>';}
  function details(a){var kv=[['المريض',[a.patient,a.file_no].filter(Boolean).join(' · ')],['الخدمة',a.service],['الطبيب',a.doctor?'د. '+a.doctor:''],
      ['الميعاد',day(a.starts_at)+' · '+hm(a.starts_at)+(a.ends_at?' – '+hm(a.ends_at):'')],['الحالة',(STATUS[a.status]||a.status||'')+(a.confirmed?' · متأكد':'')],
      ['المصدر',SOURCE[a.source]||a.source],['سجّله',[a.booked_by,a.booked_at?stamp(a.booked_at):''].filter(Boolean).join(' · ')],['ملاحظة',a.note]]
      .filter(function(x){return x[1];});
    var b=overlay('<header class="modal-head"><h3>تفاصيل الحجز</h3></header><div class="rx-sp-kv">'+kv.map(function(x){return '<b>'+esc(x[0])+'</b><span>'+(x[0]==='الميعاد'?'<bdi dir="ltr">':'')+esc(x[1])+(x[0]==='الميعاد'?'</bdi>':'')+'</span>';}).join('')+
      '</div><footer class="rx-sp-act"><button type="button" class="btn" data-sp-close>إغلاق</button></footer>');
    return new Promise(function(ok){function close(){b.remove();document.removeEventListener('keydown',key);ok();}function key(ev){if(ev.key==='Escape')close();}
      b.querySelector('[data-sp-close]').onclick=close;b.addEventListener('click',function(ev){if(ev.target===b)close();});document.addEventListener('keydown',key);});}
  function ask(e,payload,opt){var items=list(e);opt=opt||{};
    var nw=[opt.service,opt.doctor?'د. '+opt.doctor:'',opt.time?'الساعة '+opt.time:''].filter(Boolean).join(' · ');
    var b=overlay('<header class="modal-head"><h3>⚠️ المريض ده عنده حجز تاني '+(opt.today?'النهارده':'في نفس اليوم')+'</h3></header><p class="rx-sp-p">اتأكد إن ده نفس المريض وإنها خدمة تانية قبل ما تكمّل.</p>'+
      items.map(row).join('')+(nw?'<p class="rx-sp-new">الحجز الجديد: <b>'+esc(nw)+'</b></p>':'')+
      '<footer class="rx-sp-act"><button type="button" class="btn btn-primary" data-sp-yes>أيوه نفس المريض — كمّل الحجز</button><button type="button" class="btn" data-sp-no>ارجع وشوف الحجز الأساسي</button></footer>');
    return new Promise(function(ok){var done=false;function end(v){if(done)return;done=true;b.remove();document.removeEventListener('keydown',key);
        if(!v&&items[0])details(items[0]);ok(v);}
      function key(ev){if(ev.key==='Escape')end(false);}
      b.querySelector('[data-sp-yes]').onclick=function(){end(true);};b.querySelector('[data-sp-no]').onclick=function(){end(false);};
      b.querySelectorAll('[data-sp-detail]').forEach(function(x){x.onclick=function(){details(items[+x.getAttribute('data-sp-detail')]);};});
      document.addEventListener('keydown',key);});}
  // «التفاصيل» on every appointment card of تشغيل اليوم
  function decorate(c,section){if(section!=='appointments'||!c||!c.host)return;
    c.host.querySelectorAll('[data-tl-card]').forEach(function(card){var bar=card.querySelector('footer .rx-actions');if(!bar||bar.querySelector('[data-sp-open]'))return;
      var btn=document.createElement('button');btn.type='button';btn.className='btn';btn.setAttribute('data-sp-open','');btn.textContent='التفاصيل';
      btn.onclick=function(){var cl=window.SSMPDDb&&window.SSMPDDb.client;if(!cl)return;btn.disabled=true;
        Promise.resolve(cl.rpc('clinic_reception_appointment_details',{p_workspace:c.workspace,p_id:card.getAttribute('data-tl-card')})).then(function(r){btn.disabled=false;if(r&&r.error)throw r.error;return details(r.data||{});})
          .catch(function(e){btn.disabled=false;if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(e&&e.message||'تعذر فتح التفاصيل','error');});};
      bar.insertBefore(btn,bar.firstChild);});}
  window.SSMPDReceptionSamePatient={isSameDay:isSameDay,ask:ask,details:details,decorate:decorate};
})();
