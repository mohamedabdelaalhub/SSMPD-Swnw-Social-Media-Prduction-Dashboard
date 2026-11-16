// الحجوزات الاحتياطية (المالك 2026-11-16): لما ماسا يقف، الواتساب (وبعدين الموقع) بيحجز من مواعيد الداشبورد.
// الاستقبال بيشوفها هنا في قسم المواعيد: تأكيد بالتليفون، فكّ الحجز المؤقت لو اتسجل كموعد عادي، أو إلغاء بسبب.
// الوكيل هو اللي بيسجلها على ماسا لما يرجع؛ لو ماسا رفض الميعاد تظهر «كلّم المريض».
(function(){
  var LABELS={pending:'مستني يتسجل على ماسا',replayed:'اتسجل على ماسا ✓',conflict:'⚠ ماسا رفض الميعاد — راجع ماسا الأول (ممكن يكون اتسجل فعلاً)، وبعدين كلّم المريض',cancel_pending:'اتلغى — مستني يتلغي من ماسا',cancelled:'ملغي'};
  var SOURCES={whatsapp:'واتساب',website:'الموقع'};
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
  function paint(box,ws,list){if(!list.length){box.innerHTML='';box.hidden=true;return;}box.hidden=false;
    var open=list.filter(function(b){return b.status==='conflict';}).length;
    box.innerHTML='<section class="rx-mode-card rx-fallback"><h4>حجوزات احتياطية ('+list.length+')'+(open?' — ⚠ '+open+' محتاجين مراجعة على ماسا':'')+'</h4><p>دي حجوزات اتعملت من الواتساب أو الموقع وماسا كان واقف. الميعاد محجوز للمريض هنا لحد ما تتلغي أو تفكّها.</p>'+list.map(row).join('')+'</section>';
    box.querySelectorAll('[data-fb-act]').forEach(function(btn){btn.onclick=function(){var a=btn.getAttribute('data-fb-act'),id=btn.getAttribute('data-id'),p={id:id};
      if(a==='cancel'){var reason=window.prompt('سبب الإلغاء؟');if(!reason||!reason.trim())return;p.reason=reason.trim();}
      if(a==='release'&&!window.confirm('هتفك الحجز المؤقت عشان تسجّل المريض كموعد عادي في نفس الوقت؟'))return;
      btn.disabled=true;rpc(ws,a,p).then(function(){toast(a==='cancel'?'اتلغى الحجز':a==='release'?'اتفك الحجز المؤقت — سجّل الموعد دلوقتي':'اتسجل التأكيد');return load(box,ws);})
        .catch(function(e){btn.disabled=false;toast(e&&e.message||'تعذر الحفظ','error');});};});}
  function load(box,ws){return rpc(ws,'list').then(function(d){paint(box,ws,(d&&d.bookings)||[]);}).catch(function(){box.innerHTML='';box.hidden=true;});}
  function decorate(c,section){if(section!=='appointments'||!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;
    var box=c.host.querySelector('[data-rx-fallback]');if(!box){box=document.createElement('div');box.setAttribute('data-rx-fallback','');box.hidden=true;
      var anchor=c.host.querySelector('.rx-actions');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);else c.host.appendChild(box);}
    return load(box,c.workspace);}
  window.SSMPDReceptionFallback={decorate:decorate,labels:LABELS};
})();
