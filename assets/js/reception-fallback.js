// الحجوزات الاحتياطية (المالك 2026-11-16): لما ماسا يقف، الواتساب (وبعدين الموقع) بيحجز من مواعيد الداشبورد.
// الاستقبال بيشوفها هنا في قسم المواعيد: تأكيد بالتليفون، فكّ الحجز المؤقت لو اتسجل كموعد عادي، أو إلغاء بسبب.
// الوكيل هو اللي بيسجلها على ماسا لما يرجع؛ لو ماسا رفض الميعاد تظهر «كلّم المريض».
// (2026-11-18) المقارنة مع ماسا كل ربع ساعة: تنبيهات (ناقص في ماسا / محجوز مرتين / اتلغى من ماسا) + حجوزات اتعملت على ماسا مباشرة.
(function(){
  var LABELS={pending:'مستني يتسجل على ماسا',replayed:'اتسجل على ماسا ✓',conflict:'⚠ ماسا رفض الميعاد — راجع ماسا الأول (ممكن يكون اتسجل فعلاً)، وبعدين كلّم المريض',cancel_pending:'اتلغى — مستني يتلغي من ماسا',cancelled:'ملغي'};
  var SOURCES={whatsapp:'واتساب',website:'الموقع'};
  var ALERTS={missing_in_masa:'حجز مش موجود في ماسا — راجعه',double_booked:'ميعاد محجوز مرتين — راجع ماسا',cancelled_in_masa:'الحجز اتلغى من ماسا — بلّغ المريض لو محتاج',stale_sync:'المواعيد الاحتياطية قديمة — المزامنة مع ماسا متأخرة'};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function rpc(ws,action,payload){var c=window.SSMPDDb&&window.SSMPDDb.client;if(!c||typeof c.rpc!=='function')return Promise.reject(new Error('تعذر الاتصال'));
    return Promise.resolve(c.rpc('clinic_reception_fallback',{p_workspace:ws,p_action:action,p_payload:payload||{}})).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
  function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
  function row(b){var actions='';if(b.status==='pending'||b.status==='replayed'||b.status==='conflict'){
      if(!b.reception_confirmed&&b.status!=='conflict')actions+='<button type="button" class="btn" data-fb-act="confirm" data-id="'+esc(b.fallback_booking_id)+'">اتأكدت مع المريض</button>';
      if(!b.slot_released)actions+='<button type="button" class="btn" data-fb-act="release" data-id="'+esc(b.fallback_booking_id)+'">سجّلته كموعد عادي — فكّ الحجز</button>';
      actions+='<button type="button" class="btn danger" data-fb-act="cancel" data-id="'+esc(b.fallback_booking_id)+'">إلغاء</button>';}
    return '<article class="rx-fb-row rx-fb-'+esc(b.status)+'"><div><strong>'+esc(b.customer_name)+'</strong> — <span dir="ltr">'+esc(b.phone)+'</span>'+(b.customer_age!=null?' — '+esc(b.customer_age)+' سنة':'')+
      '<br>'+esc(b.doctor_name)+' ('+esc(b.department)+') — '+esc(b.appointment_date)+' الساعة '+esc(b.appointment_time)+' — '+esc(b.needed_service)+
      '<br><small>من '+esc(SOURCES[b.source]||b.source)+' — '+esc(LABELS[b.status]||b.status)+(b.reception_confirmed?' — اتأكد مع المريض':'')+(b.slot_released?' — الحجز المؤقت اتفك':'')+'</small></div>'+
      (actions?'<div class="rx-actions">'+actions+'</div>':'')+'</article>';}
  /* Owner 2026-11-22: one compact row per alert — patient · doctor · date/time + «افتح الحجز» + «راجعته» */
  function alertWhen(a){var t=[];if(a.customer_name)t.push(esc(a.customer_name));if(a.doctor_name)t.push(esc(a.doctor_name));if(a.appointment_date)t.push('<bdi dir="ltr">'+esc(a.appointment_date)+'</bdi>'+(a.appointment_time?' الساعة <bdi dir="ltr">'+esc(a.appointment_time)+'</bdi>':''));
    if(!t.length&&a.detail)t.push(esc(a.detail));return t.join(' · ');}
  function alertRow(a){var when=alertWhen(a);return '<article class="rx-fb-alert"><b>'+esc(ALERTS[a.kind]||a.kind)+'</b>'+(a.kind==='stale_sync'&&a.detail?'<small>'+esc(a.detail)+'</small>':when?'<small>'+when+'</small>':'')+'<div class="rx-actions">'+(a.customer_name?'<button type="button" class="btn btn-primary" data-fb-act="open_booking" data-q="'+esc(a.customer_name)+'">افتح الحجز</button>':'')+'<button type="button" class="btn" data-fb-act="alert_resolve" data-id="'+esc(a.id)+'">راجعته ✓</button></div></article>';}
  function alertsCard(alerts){var shown=alerts.slice(0,3);return '<section class="rx-fb-alerts"><div class="rx-fb-ah"><h4>⚠ تنبيهات المقارنة مع ماسا</h4><span class="rx-fb-n">'+alerts.length+'</span></div>'+shown.map(alertRow).join('')+(alerts.length>3?'<button type="button" class="btn rx-fb-all" data-fb-act="all_alerts">عرض كل التنبيهات ('+alerts.length+')</button>':'')+'</section>';}
  var sheet=null;
  function closeSheet(){if(sheet){sheet.remove();sheet=null;}}
  function openSheet(box,ws,alerts){closeSheet();sheet=document.createElement('div');sheet.className='rx-fb-backdrop';sheet.innerHTML='<div class="rx-fb-sheet" role="dialog" aria-modal="true" aria-label="كل تنبيهات ماسا"><div class="rx-fb-ah"><h4>كل التنبيهات ('+alerts.length+')</h4><button type="button" class="btn" data-fb-close>إغلاق</button></div>'+alerts.map(alertRow).join('')+'</div>';
    sheet.addEventListener('click',function(e){if(e.target===sheet||e.target.closest('[data-fb-close]'))closeSheet();});document.body.appendChild(sheet);wireActs(sheet,box,ws,alerts);}
  function importRow(m){return '<article class="rx-fb-row"><div><strong>'+esc(m.patient_name||'مريض')+'</strong>'+(m.phone?' — <span dir="ltr">'+esc(m.phone)+'</span>':'')+'<br>'+esc(m.doctor_name)+' — '+esc(m.appointment_date)+(m.day_only?' — بدون ميعاد':' الساعة '+esc(m.appointment_time))+(m.needed_service?' — '+esc(m.needed_service):'')+'</div></article>';}
  function paint(box,ws,d){var list=(d&&d.bookings)||[],alerts=(d&&d.alerts)||[],imports=(d&&d.masa_imports)||[];
    if(!list.length&&!alerts.length&&!imports.length){box.innerHTML='';box.hidden=true;return;}box.hidden=false;
    var open=list.filter(function(b){return b.status==='conflict';}).length,html='';
    if(alerts.length)html+=alertsCard(alerts);
    if(list.length)html+='<section class="rx-mode-card rx-fallback"><h4>حجوزات احتياطية ('+list.length+')'+(open?' — ⚠ '+open+' محتاجين مراجعة على ماسا':'')+'</h4><p>دي حجوزات اتعملت من الواتساب أو الموقع وماسا كان واقف. الميعاد محجوز للمريض هنا لحد ما تتلغي أو تفكّها.</p>'+list.map(row).join('')+'</section>';
    if(imports.length)html+='<details class="rx-mode-card rx-fb-imports"><summary>حجوزات اتعملت على ماسا مباشرة — الأيام الجاية ('+imports.length+')</summary><p>دي اتسجلت على ماسا بإيد الاستقبال. سجّل المريض هنا لما ييجي.</p>'+imports.map(importRow).join('')+'</details>';
    box.innerHTML=html;wireActs(box,box,ws,alerts);}
  function wireActs(scope,box,ws,alerts){
    scope.querySelectorAll('[data-fb-act]').forEach(function(btn){btn.onclick=function(){var a=btn.getAttribute('data-fb-act'),id=btn.getAttribute('data-id'),p={id:id};
      if(a==='all_alerts'){openSheet(box,ws,alerts);return;}
      if(a==='open_booking'){closeSheet();var q=document.querySelector('[data-tl-q]');if(q){q.value=btn.getAttribute('data-q')||'';q.dispatchEvent(new Event('input',{bubbles:true}));q.scrollIntoView({block:'center'});}else toast('افتح قسم المواعيد وابحث باسم المريض','error');return;}
      if(a==='cancel'){var reason=window.prompt('سبب الإلغاء؟');if(!reason||!reason.trim())return;p.reason=reason.trim();}
      if(a==='release'&&!window.confirm('هتفك الحجز المؤقت عشان تسجّل المريض كموعد عادي في نفس الوقت؟'))return;
      btn.disabled=true;rpc(ws,a,p).then(function(){toast(a==='cancel'?'اتلغى الحجز':a==='release'?'اتفك الحجز المؤقت — سجّل الموعد دلوقتي':a==='alert_resolve'?'اتسجل إنك راجعته':'اتسجل التأكيد');closeSheet();return load(box,ws);})
        .catch(function(e){btn.disabled=false;toast(e&&e.message||'تعذر الحفظ','error');});};});}
  function load(box,ws){return rpc(ws,'list').then(function(d){paint(box,ws,d||{});}).catch(function(){box.innerHTML='';box.hidden=true;});}
  function decorate(c,section){if(section!=='appointments'||!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;
    var box=c.host.querySelector('[data-rx-fallback]');if(!box){box=document.createElement('div');box.setAttribute('data-rx-fallback','');box.hidden=true;
      var anchor=Array.prototype.find.call(c.host.querySelectorAll('.rx-actions'),function(x){return !x.closest('.rx-header');});if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);else c.host.appendChild(box);}
    return load(box,c.workspace);}
  window.SSMPDReceptionFallback={decorate:decorate,labels:LABELS,alerts:ALERTS};
})();
