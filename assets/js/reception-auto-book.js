// الحجوزات التلقائية (المالك 2026-11-19 «موافق، ابدأ المرحلة الأولى»): أي حجز على ماسا أو من الواتساب أو بوابة المرضى
// بيتسجّل موعد في الاستقبال لوحده ومربوط بملف المريض. هنا في قسم المواعيد:
//   شريط المزامنة + علامة المصدر على كل موعد اتعمل لوحده + «حجوزات من غير ساعة» + «حجوزات تحتاج استكمال» (المريض/السن/الخدمة/ميعاد تاني».
// كل اختيار بيتنفّذ باسم الموظف اللي ضغط (public.clinic_reception_auto_book). مفيش هنا أي اتصال بماسا ولا رسايل.
(function(){
  var SRC={masa:'من ماسا',whatsapp:'من الواتساب',website:'من الموقع',social:'من السوشيال',portal:'من البوابة'};
  var SRC_SHORT={masa:'ماسا',whatsapp:'واتساب',website:'الموقع',social:'سوشيال',portal:'البوابة'};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function client(){return window.SSMPDDb&&window.SSMPDDb.client;}
  function rpc(ws,action,payload){var c=client();if(!c||typeof c.rpc!=='function')return Promise.reject(new Error('تعذر الاتصال'));
    return Promise.resolve(c.rpc('clinic_reception_auto_book',{p_workspace:ws,p_action:action,p_payload:payload||{}})).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
  function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
  function hm(iso){try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));}catch(e){return '';}}
  function dayText(d){try{return new Date(d+'T12:00:00Z').toLocaleDateString('ar-EG-u-nu-latn',{weekday:'long',day:'numeric',month:'numeric',timeZone:'UTC'});}catch(e){return d;}}
  function ago(iso){if(!iso)return '';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));return m<1?'دلوقتي':m<60?'من '+m+' دقيقة':'من '+Math.round(m/60)+' ساعة';}
  function today(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());}catch(e){return new Date().toISOString().slice(0,10);}}
  // Cairo wall time -> ISO with the right offset (Egypt has summer time)
  function cairoISO(day,time){var m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(day),t=/^(\d\d):(\d\d)$/.exec(time);if(!m||!t)throw new Error('اختار الساعة');
    var want=Date.UTC(+m[1],+m[2]-1,+m[3],+t[1],+t[2]),v=want;
    for(var i=0;i<3;i++){var p={};new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(v)).forEach(function(x){p[x.type]=x.value;});
      v+=want-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}
    return new Date(v).toISOString();}
  function who(r){return '<strong>'+esc(r.customer_name||'مريض')+'</strong>'+(r.phone?' · <bdi dir="ltr">'+esc(r.phone)+'</bdi>':'')+(r.age!=null?' · '+esc(r.age)+' سنة':'');}
  function when(r){return esc(r.doctor_name||'دكتور مش مربوط')+' · '+esc(dayText(r.day))+(r.starts_at&&!r.day_only?' · الساعة <bdi dir="ltr">'+esc(hm(r.starts_at))+'</bdi>':' · بدون ميعاد');}
  /* Owner 2026-11-22: old patients = Masa service «استكمال» (no old date is typed in Masa); everything else is new. */
  function isOld(r){return /استكمال/.test(String(r.needed_service||''));}
  function dayLabel(d){var t=today(),n=function(x){return Math.round((Date.parse(x+'T12:00:00Z')-Date.parse(t+'T12:00:00Z'))/86400000);},k=n(d);
    var rel=k===0?'النهارده':k===1?'بكرة':k===2?'بعد بكرة':k===-1?'امبارح':'';return {rel:rel||dayText(d),sub:rel?dayText(d):''};}
  function kindTag(r){return isOld(r)?'<span class="rx-ab-kind rx-ab-ko">قديم · استكمال</span>':'<span class="rx-ab-kind rx-ab-kn">جديد</span>';}
  function whenNoDay(r){return esc(r.doctor_name||'دكتور مش مربوط')+' · بدون ميعاد';}
  function tag(r){return '<span class="rx-ab-tag rx-ab-'+esc(r.source)+'">'+esc(SRC[r.source]||r.source)+'</span>';}
  function services(d,sel){return '<select data-ab-svc>'+'<option value="">اختار الخدمة…</option>'+(d.services||[]).map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.department+' — '+s.name)+'</option>';}).join('')+'</select>';}
  /* owner 2026-11-23 «طبق حل الحجوزات»: free-time chips instead of a blind time box, «حجز إضافي فوق الجدول», «ميعاد يدوي», capacity */
  var xtra={};
  function capLine(x){if(!x||!x.capacity||!x.capacity.capacity)return '';var c=x.capacity;return '<span class="rx-ab-cap'+(c.booked>=c.capacity?' is-full':'')+'">المحجوز '+c.booked+' من '+c.capacity+(c.booked>=c.capacity?' · مليان':'')+'</span>';}
  function pickBox(r,opts){opts=opts||{};var x=xtra[r.id];
    var free=x?(x.free||[]).map(function(t){return '<button type="button" class="rx-ab-slot" data-ab="slot" data-t="'+esc(t)+'">'+esc(hm(t))+'</button>';}).join(''):'';
    var sug=x?(x.suggest||[]).map(function(t){return '<button type="button" class="rx-ab-slot rx-ab-slot-d" data-ab="slot" data-t="'+esc(t)+'">'+esc(dayText(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(t))))+' · <bdi dir="ltr">'+esc(hm(t))+'</bdi></button>';}).join(''):'';
    return '<div class="rx-ab-pick" data-ab-pick>'+(x?'':'<p class="rx-ab-sub">جاري تحميل الأوقات الفاضية…</p>')+
      (x?'<div class="rx-ab-pl">'+(free?'الأوقات الفاضية في اليوم ده:':'مفيش وقت فاضي في اليوم ده.')+' '+capLine(x)+'</div>'+(free?'<div class="rx-ab-slots">'+free+'</div>':''):'')+
      (sug?'<div class="rx-ab-pl">أقرب أوقات فاضية في الأيام اللي جنبه:</div><div class="rx-ab-slots">'+sug+'</div>':'')+
      '<div class="rx-actions"><label class="rx-ab-age">وقت تاني في نفس اليوم <input type="time" step="300" data-ab-time></label>'+
      '<button type="button" class="btn btn-primary" data-ab="pick" data-id="'+esc(r.id)+'" data-day="'+esc(r.day)+'">سجّل في الوقت ده</button>'+
      '<button type="button" class="btn" data-ab="overbook" data-id="'+esc(r.id)+'" data-day="'+esc(r.day)+'">حجز إضافي فوق الجدول</button>'+
      '<button type="button" class="btn" data-ab="manual" data-id="'+esc(r.id)+'" data-day="'+esc(r.day)+'">ميعاد يدوي</button>'+
      (r.phone&&opts.call!==false?'<a class="btn rx-ab-call" href="tel:'+esc(String(r.phone).replace(/[^0-9+]/g,''))+'">تواصل مع المريض للتأجيل</a>':'')+'</div></div>';}
  function toldRow(r){var open=modal.change===r.id;return '<article class="rx-ab-item rx-ab-told"><div class="rx-ab-head"><div class="rx-ab-nm"><strong>'+esc(r.customer_name||'مريض')+'</strong> '+tag(r)+' <span class="rx-ab-kind rx-ab-kn">اتحط ميعاد لوحده</span></div>'+
      '<div class="rx-ab-sub">'+(r.phone?'<bdi dir="ltr">'+esc(r.phone)+'</bdi>':'')+(r.patient_code?' · <bdi dir="ltr">'+esc(r.patient_code)+'</bdi>':'')+'</div>'+
      '<div class="rx-ab-meta"><b class="rx-ab-tm"><bdi dir="ltr">'+esc(hm(r.starts_at))+'</bdi></b> · '+esc(r.doctor_name||'')+' · '+esc(dayText(r.day))+(r.needed_service?' · '+esc(r.needed_service):'')+'</div></div>'+
      '<p class="rx-ab-why">الحجز اتعمل على ماسا من غير ساعة، فاتحط في أقرب ميعاد فاضي عند الدكتور. بلّغ المريض بالساعة.</p>'+
      '<div class="rx-actions"><button type="button" class="btn btn-primary" data-ab="told" data-id="'+esc(r.id)+'">اتبلّغ المريض ✓</button><button type="button" class="btn" data-ab="change" data-id="'+esc(r.id)+'" aria-expanded="'+open+'">غيّر الساعة</button></div>'+(open?pickBox(r,{call:false}):'')+'</article>';}
  function reviewRow(r,d){var a='',body='';
    if(r.review_kind==='patient'&&r.candidate){
      body='<div class="rx-ab-vs"><div><b>الاسم في الحجز</b>'+who(r)+'</div><div><b>الملف الموجود بنفس الرقم</b>'+esc(r.candidate.full_name)+' · <bdi dir="ltr">'+esc(r.candidate.patient_code)+'</bdi>'+(r.candidate.last_visit_date?' · آخر زيارة '+esc(r.candidate.last_visit_date):'')+'</div></div>';
      a='<div class="rx-ab-po" data-ab-po><b>صاحب الرقم للملف الجديد</b><div class="po-chips">'+[['husband','الزوج'],['wife','الزوجة'],['mother','الأم'],['father','الأب'],['self','نفس المريض'],['other','أخرى']].map(function(o){return '<button type="button" class="po-chip" data-po="'+o[0]+'" aria-pressed="false">'+o[1]+'</button>';}).join('')+'</div><input class="po-note" data-po-note maxlength="60" placeholder="مثلاً: الأخ، الجدة" hidden></div>'+'<label class="rx-ab-age">السن <input type="number" min="0" max="130" inputmode="numeric" data-ab-age></label><button type="button" class="btn btn-primary" data-ab="new" data-id="'+esc(r.id)+'">افتح ملف جديد باسم «'+esc((r.customer_name||'').split(/\s+/)[0])+'»</button><button type="button" class="btn" data-ab="existing" data-id="'+esc(r.id)+'">نفس المريض — اربطه بالملف الموجود</button>';
    }else if(r.review_kind==='patient'||r.review_kind==='age'){
      a='<label class="rx-ab-age">السن <input type="number" min="0" max="130" inputmode="numeric" data-ab-age></label><button type="button" class="btn btn-primary" data-ab="new" data-id="'+esc(r.id)+'">افتح الملف وسجّل الموعد</button>';
    }else if(r.review_kind==='service'){
      a=services(d)+'<button type="button" class="btn btn-primary" data-ab="service" data-id="'+esc(r.id)+'">احفظها للدكتور ده وسجّل</button>';
    }else if(r.review_kind==='slot'||r.review_kind==='full_day'){
      body=pickBox(r);a=r.review_kind==='slot'?'<button type="button" class="btn" data-ab="retry" data-id="'+esc(r.id)+'">جرّب تاني</button>':'';
    }else{
      a='<label class="rx-ab-age">ساعة تانية <input type="time" step="300" data-ab-time></label><button type="button" class="btn" data-ab="time" data-id="'+esc(r.id)+'" data-day="'+esc(r.day)+'">سجّل في الساعة دي</button><button type="button" class="btn" data-ab="retry" data-id="'+esc(r.id)+'">جرّب تاني</button>';
    }
    return '<article class="rx-ab-item'+(r.review_kind==='full_day'?' rx-ab-full':'')+'"><div class="rx-ab-head">'+tag(r)+' '+(r.review_kind==='full_day'?'<span class="rx-ab-kind rx-ab-kfull">يوم الدكتور مليان</span> ':'')+(r.review_kind==='patient'&&r.candidate?'':who(r))+'<div class="rx-ab-meta">'+when(r)+'</div></div>'+body+
      '<p class="rx-ab-why">'+esc(r.reason||'')+'</p><div class="rx-actions">'+a+'<button type="button" class="btn rx-ab-dismiss" data-ab="dismiss" data-id="'+esc(r.id)+'">تجاهل الحجز ده</button></div></article>';}
  function timeRow(r){return '<article class="rx-ab-item rx-ab-time"><div class="rx-ab-head"><div class="rx-ab-nm"><strong>'+esc(r.customer_name||'مريض')+'</strong> '+tag(r)+' '+kindTag(r)+'</div><div class="rx-ab-sub">'+(r.phone?'<bdi dir="ltr">'+esc(r.phone)+'</bdi>':'')+(r.age!=null?' · '+esc(r.age)+' سنة':'')+(r.patient_code?' · <bdi dir="ltr">'+esc(r.patient_code)+'</bdi>':'')+'</div><div class="rx-ab-meta">'+whenNoDay(r)+(r.needed_service?' · '+esc(r.needed_service):'')+'</div></div>'+
      (isOld(r)?'<div class="rx-actions"><button type="button" class="btn btn-primary" data-ab="complete" data-id="'+esc(r.id)+'" data-q="'+esc(r.patient_code||r.phone||'')+'">استكمال البيانات</button><button type="button" class="btn" data-ab="archive" data-id="'+esc(r.id)+'">نقل للأرشيف</button></div></article>':pickBox(r)+'<div class="rx-actions"><button type="button" class="btn rx-ab-dismiss" data-ab="dismiss" data-id="'+esc(r.id)+'">تجاهل</button></div></article>');}
  function chips(host,rows){
    rows.forEach(function(r){if(!r.appointment_id||(r.state!=='booked'&&r.state!=='merged'))return;
      var label=(SRC[r.source]||r.source),file=r.state==='merged'?'اتربط بحجز موجود — مااتكررش':r.patient_created?'ملف جديد':'ملف موجود';
      host.querySelectorAll('[data-tl-card="'+r.appointment_id+'"] h4,[data-tl-open="'+r.appointment_id+'"]').forEach(function(el){
        if(el.querySelector('.rx-ab-tag'))return;var s=document.createElement('span');s.className='rx-ab-tag rx-ab-'+r.source;s.textContent=label;s.title=file;el.appendChild(document.createTextNode(' '));el.appendChild(s);
        if(r.patient_created&&el.tagName==='H4'){var n=document.createElement('span');n.className='rx-ab-tag rx-ab-new';n.textContent='ملف جديد';el.appendChild(document.createTextNode(' '));el.appendChild(n);}});});}
  function paint(box,c,d){var rows=(d&&d.rows)||[];if(!d||!d.enabled){box.hidden=true;box.innerHTML='';c.host.classList.remove('rx-ab-on');return;}
    var t=today(),todays=rows.filter(function(r){return r.day===t&&(r.state==='booked'||r.state==='merged');}),by={};
    todays.forEach(function(r){by[r.source]=(by[r.source]||0)+1;});
    var review=rows.filter(function(r){return r.state==='review'||r.state==='failed';}),times=(d.wide||rows).filter(function(r){return r.state==='needs_time';}).sort(function(x,y){return String(x.day).localeCompare(String(y.day));});
    var html='<div class="rx-ab-sync"><span class="rx-ab-dot"></span> الحجز التلقائي شغال'+(d.synced_at?' — <b>آخر مزامنة مع ماسا '+esc(ago(d.synced_at))+'</b>':'')+' · اتضاف النهارده '+todays.length+' موعد لوحده'+
      '<span class="rx-ab-src">'+Object.keys(by).map(function(k){return '<span class="rx-ab-tag rx-ab-'+esc(k)+'">'+esc(SRC_SHORT[k]||k)+' '+by[k]+'</span>';}).join('')+'</span></div>';
    var tile=function(type,n,title,sub,cls){return '<button type="button" class="btn rx-ab-tile'+(cls?' '+cls:'')+'" data-ab-open="'+type+'"><span class="rx-ab-n">'+n+'</span><span class="rx-ab-t"><b>'+title+'</b><small>'+sub+'</small></span><span class="rx-ab-go">افتح القايمة ›</span></button>';};
    var nNew=times.filter(function(r){return !isOld(r);}).length,nOld=times.length-nNew;
    var told=(d.wide||rows).filter(function(r){return r.state==='booked'&&r.auto_timed&&!r.time_told_at&&r.day>=t;}).sort(function(x,y){return String(x.starts_at).localeCompare(String(y.starts_at));});
    var nFull=review.filter(function(r){return r.review_kind==='full_day';}).length;
    var tiles=(told.length?tile('told',told.length,'بلّغ المريض بالميعاد','حجوزات ماسا اتحطلها ساعة لوحدها','rx-ab-tn'):'')+(nNew?tile('times-new',nNew,'جديد — حجوزات من غير ساعة','كشف أو استشارة · محتاج ساعة','rx-ab-tn'):'')+(nOld?tile('times-old',nOld,'قديم — استكمال','استكمال · كمّل أو انقل للأرشيف','rx-ab-to'):'')+(review.length?tile('review',review.length,'حجوزات تحتاج استكمال',nFull?nFull+' منهم يوم الدكتور مليان':'مقدرتش تتسجّل لوحدها — اختار المطلوب','warn'):'');
    if(tiles)html+='<div class="rx-ab-sum">'+tiles+'</div>';
    cur={box:box,c:c,d:d,times:times,review:review,told:told};
    box.innerHTML=html;box.hidden=false;c.host.classList.add('rx-ab-on');chips(c.host,rows);
    box.querySelectorAll('[data-ab-open]').forEach(function(b){b.onclick=function(){openList(b.getAttribute('data-ab-open'));};});
    if(modal.el){if(!pool().length)closeList();else renderList();}}
  /* ---- القوائم الطويلة في نافذة: بحث + فلتر المصدر + صفحات (المالك 2026-11-22) ---- */
  var cur=null,modal={el:null,type:'times',kind:'all',q:'',src:'',page:0,focus:null,change:null},PER={times:15,review:8,told:10};
  function pool(){return !cur?[]:modal.type==='times'?cur.times:modal.type==='told'?cur.told:cur.review;}
  function titleOf(t){return t==='times'?'حجوزات من غير ساعة':t==='told'?'بلّغ المريض بالميعاد':'حجوزات تحتاج استكمال';}
  function norm(x){return String(x==null?'':x).toLowerCase().replace(/[٠-٩]/g,function(d){return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));}).replace(/\s+/g,' ').trim();}
  function listRows(){var all=pool(),q=norm(modal.q);return all.filter(function(r){return (!modal.src||r.source===modal.src)&&(modal.type!=='times'||modal.kind==='all'||(modal.kind==='old')===isOld(r))&&(!q||norm([r.customer_name,r.phone,r.doctor_name,r.patient_code].join(' ')).indexOf(q)>=0);});}
  function openList(type){if(!cur)return;closeList();var kind='all';if(type==='times-new'){type='times';kind='new';}else if(type==='times-old'){type='times';kind='old';}modal.type=type;modal.kind=kind;modal.q='';modal.src='';modal.page=0;modal.focus=document.activeElement;
    var el=document.createElement('div');el.className='rx-ab-backdrop';var title=titleOf(type);modal.change=null;
    el.innerHTML='<div class="rx-ab-modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="rx-ab-mh"><h3 data-ab-title></h3><button type="button" class="btn rx-ab-x" data-ab-close aria-label="إغلاق">✕</button></div>'+
      '<div class="rx-ab-tools"><label class="rx-ab-inp"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg><input type="search" data-ab-q placeholder="ابحث بالاسم أو التليفون أو الدكتور…" aria-label="بحث"></label><div class="rx-ab-seg" data-ab-srcs role="group" aria-label="المصدر"></div></div>'+(type==='times'?'<div class="rx-ab-seg" data-ab-kinds role="group" aria-label="جديد أو قديم"></div>':'')+
      (type==='review'?'<p class="rx-ab-note">الحجوزات دي جت من ماسا أو الواتساب أو البوابة ومقدرتش تتسجّل لوحدها. اختار المطلوب وهتتسجّل على طول.</p>':'')+'<div class="rx-ab-list" data-ab-list></div><div class="rx-ab-pg" data-ab-pg></div></div>';
    el.addEventListener('click',function(e){if(e.target===el||e.target.closest('[data-ab-close]'))closeList();});
    el.querySelector('[data-ab-q]').addEventListener('input',function(e){modal.q=e.target.value;modal.page=0;renderList(true);});
    document.body.appendChild(el);modal.el=el;renderList();var qi=el.querySelector('[data-ab-q]');if(qi)qi.focus();}
  function closeList(){if(!modal.el)return;modal.el.remove();modal.el=null;var f=modal.focus;modal.focus=null;if(f&&f.focus&&f.isConnected)f.focus();}
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.el)closeList();});
  function renderList(keepFocus){var el=modal.el;if(!el||!cur)return;var all=pool();
    var srcs=[];all.forEach(function(r){if(srcs.indexOf(r.source)<0)srcs.push(r.source);});
    el.querySelector('[data-ab-srcs]').innerHTML=srcs.length>1?[''].concat(srcs).map(function(k){return '<button type="button" class="btn'+(modal.src===k?' on':'')+'" data-ab-src="'+esc(k)+'">'+(k?esc(SRC_SHORT[k]||k):'الكل')+'</button>';}).join(''):'';
    var kb=el.querySelector('[data-ab-kinds]');if(kb){var nn=all.filter(function(r){return !isOld(r);}).length,no=all.length-nn;
      kb.innerHTML=[['all','الكل',all.length],['new','جديد',nn],['old','قديم',no]].map(function(k){return '<button type="button" class="btn'+(modal.kind===k[0]?' on':'')+(k[0]==='old'?' rx-ab-kold':'')+'" data-ab-kind="'+k[0]+'">'+k[1]+' '+k[2]+'</button>';}).join('');
      kb.querySelectorAll('[data-ab-kind]').forEach(function(b){b.onclick=function(){modal.kind=b.getAttribute('data-ab-kind');modal.page=0;renderList();};});}
    var rows=listRows(),per=PER[modal.type],pages=Math.max(1,Math.ceil(rows.length/per));if(modal.page>=pages)modal.page=pages-1;
    el.querySelector('[data-ab-title]').textContent=titleOf(modal.type)+' ('+all.length+')';
    var from=modal.page*per,slice=rows.slice(from,from+per),list=el.querySelector('[data-ab-list]');
    var lastDay=null;
    list.innerHTML=slice.length?slice.map(function(r){var h='';if(modal.type==='times'&&r.day!==lastDay){lastDay=r.day;var dl=dayLabel(r.day);h='<div class="rx-ab-day"><b>'+esc(dl.rel)+'</b>'+(dl.sub?'<small>'+esc(dl.sub)+'</small>':'')+'</div>';}return h+(modal.type==='times'?timeRow(r):modal.type==='told'?toldRow(r):reviewRow(r,cur.d));}).join(''):'<p class="rx-ab-empty">مفيش حجوزات مطابقة.</p>';
    var pg=el.querySelector('[data-ab-pg]');
    if(rows.length>per){var nums=[];for(var n=0;n<pages;n++){if(n===0||n===pages-1||Math.abs(n-modal.page)<=1)nums.push(n);else if(nums[nums.length-1]!=='…')nums.push('…');}
      pg.innerHTML='<span class="rx-ab-cnt">'+(from+1)+'–'+(from+slice.length)+' من '+rows.length+'</span><div class="rx-ab-pn"><button type="button" class="btn" data-ab-page="'+(modal.page-1)+'"'+(modal.page===0?' disabled':'')+' aria-label="السابق">›</button>'+nums.map(function(n){return n==='…'?'<span>…</span>':'<button type="button" class="btn'+(n===modal.page?' on':'')+'" data-ab-page="'+n+'">'+(n+1)+'</button>';}).join('')+'<button type="button" class="btn" data-ab-page="'+(modal.page+1)+'"'+(modal.page>=pages-1?' disabled':'')+' aria-label="التالي">‹</button></div>';}
    else pg.innerHTML=rows.length?'<span class="rx-ab-cnt">'+rows.length+' حجز</span>':'';
    el.querySelectorAll('[data-ab-src]').forEach(function(b){b.onclick=function(){modal.src=b.getAttribute('data-ab-src');modal.page=0;renderList();};});
    el.querySelectorAll('[data-ab-page]').forEach(function(b){b.onclick=function(){modal.page=+b.getAttribute('data-ab-page');renderList();list.scrollTop=0;};});
    wire(el,cur.box,cur.c);
    var need=slice.filter(function(r){return !xtra[r.id]&&r.provider_id&&(modal.type!=='times'||!isOld(r))&&(modal.type!=='review'||r.review_kind==='slot'||r.review_kind==='full_day')&&(modal.type!=='told'||modal.change===r.id);}).map(function(r){return r.id;});
    if(need.length&&!modal.xbusy){modal.xbusy=true;rpc(cur.c.workspace,'extras',{ids:need}).then(function(x){((x&&x.rows)||[]).forEach(function(y){xtra[y.id]=y;});need.forEach(function(i){if(!xtra[i])xtra[i]={free:[],suggest:[]};});}).catch(function(){need.forEach(function(i){xtra[i]={free:[],suggest:[]};});}).then(function(){modal.xbusy=false;if(modal.el)renderList();});}}
  function wire(scope,box,c){
    scope.querySelectorAll('[data-ab-po]').forEach(function(pb){pb.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('[data-po]');if(!c)return;pb.querySelectorAll('[data-po]').forEach(function(x){x.classList.toggle('on',x===c);x.setAttribute('aria-pressed',String(x===c));});pb.querySelector('[data-po-note]').hidden=c.getAttribute('data-po')!=='other';});});
    scope.querySelectorAll('[data-ab]').forEach(function(b){b.onclick=function(){var a=b.getAttribute('data-ab'),item=b.closest('.rx-ab-item'),p={id:b.getAttribute('data-id')},act;
      try{
        if(a==='existing'){act='resolve_patient';p.choice='existing';}
        else if(a==='new'){act='resolve_patient';p.choice='new';var ag=item.querySelector('[data-ab-age]');if(!ag||ag.value==='')throw new Error('اكتب سن المريض الأول');p.age=+ag.value;var pob=item.querySelector('[data-ab-po]');if(pob){var po=pob.querySelector('[data-po].on');if(!po)throw new Error('الرقم ده عليه ملف تاني — اختار صاحب الرقم للملف الجديد');p.phone_owner=po.getAttribute('data-po');if(p.phone_owner==='other'){p.phone_owner_note=(pob.querySelector('[data-po-note]').value||'').trim();if(!p.phone_owner_note)throw new Error('اكتب صاحب الرقم مين (مثلاً: الأخ)');}}}
        else if(a==='service'){act='set_service';p.service_id=item.querySelector('[data-ab-svc]').value;if(!p.service_id)throw new Error('اختار الخدمة');}
        else if(a==='time'){act='set_time';p.starts_at=cairoISO(b.getAttribute('data-day'),item.querySelector('[data-ab-time]').value);}
        else if(a==='slot'){item.querySelectorAll('[data-ab="slot"]').forEach(function(x){x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});item.dataset.sel=b.getAttribute('data-t');var ti=item.querySelector('[data-ab-time]');if(ti)ti.value='';return;}
        else if(a==='change'){modal.change=modal.change===p.id?null:p.id;renderList();return;}
        else if(a==='told'){act='told';}
        else if(a==='pick'||a==='overbook'||a==='manual'){act='set_time';var ti2=item.querySelector('[data-ab-time]');p.starts_at=ti2&&ti2.value?cairoISO(b.getAttribute('data-day'),ti2.value):item.dataset.sel;if(!p.starts_at)throw new Error('اختار وقت من الأوقات الفاضية أو اكتب الساعة');
          if(a==='overbook'){if(!window.confirm('حجز إضافي فوق الجدول للدكتور ده؟ (2 في الساعة و6 في اليوم بحد أقصى)'))return;p.mode='overbook';p.reason_kind='حجز ماسا واليوم مليان';}
          else if(a==='manual'){if(!window.confirm('ميعاد يدوي متفق عليه مع الدكتور؟ الوقت ده هيتضاف لمواعيد الدكتور في اليوم ده بس.'))return;p.mode='manual';p.reason_kind='doctor_agreement';}
          else p.mode='normal';}
        else if(a==='retry'){act='retry';}
        else if(a==='complete'){var q=b.getAttribute('data-q')||'';closeList();var sb=c.host.querySelector('[data-rx-section="patients"]');if(sb){sb.click();setTimeout(function(){var inp=c.host.querySelector('input[type=search]');if(inp&&q){inp.value=q;inp.dispatchEvent(new Event('input',{bubbles:true}));}},120);}else toast('قسم المرضى غير متاح حسب صلاحيتك','error');return;}
        else if(a==='archive'){if(!window.confirm('نقل الحالة القديمة دي للأرشيف وشيلها من القايمة؟ ملف المريض هيفضل موجود.'))return;act='dismiss';p.reason='مريض قديم — استكمال — اتنقل للأرشيف';}
        else if(a==='dismiss'){act='dismiss';var why=window.prompt('ليه هتتجاهل الحجز ده؟ (مثلاً: المريض لغى بالتليفون)');if(!why||why.trim().length<3)return;p.reason=why.trim();}
      }catch(e){toast(e.message,'error');return;}
      b.disabled=true;rpc(c.workspace,act,p).then(function(res){var s=res&&res.state;
        if(act==='told'){toast('اتسجّل إن المريض اتبلّغ ✓');delete xtra[p.id];return c.load?c.load():load(box,c);}
        delete xtra[p.id];modal.change=null;
        toast(s==='booked'||s==='merged'||s==='rescheduled'||s==='unchanged'?'اتسجّل الموعد ✓':s==='skipped'?(a==='archive'?'اتنقلت للأرشيف':'اتشال من القايمة'):s==='needs_time'?'اتربط بالمريض — حط الساعة':'لسه محتاج مراجعة — شوف السبب', s==='review'?'error':'success');
        return c.load?c.load():load(box,c);}).catch(function(e){b.disabled=false;toast(e&&e.message||'تعذر الحفظ','error');});};});}
  function addDays(d,n){var t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
  /* the no-time list spans past days still waiting and the coming weeks, not just the selected range */
  function load(box,c){var t=today();var soft=function(f,to){return rpc(c.workspace,'list',{from:addDays(t,f),to:addDays(t,to)}).catch(function(){return null;});};
    /* the server caps a list at 31 days, so the wide view is two windows: -14…+16 and +17…+47 */
    return Promise.all([rpc(c.workspace,'list',{from:c.from||t,to:c.to||c.from||t}),soft(-14,16),soft(17,47)]).then(function(r){var d=r[0]||{};if(r[1]&&r[1].rows)var seen={};d.wide=r[1].rows.concat((r[2]&&r[2].rows)||[]).concat(d.rows||[]).filter(function(x){if(seen[x.id])return false;seen[x.id]=1;return true;});paint(box,c,d);}).catch(function(){box.hidden=true;box.innerHTML='';});}
  function decorate(c,section){if(section!=='appointments'||!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;
    var box=c.host.querySelector('[data-rx-auto-book]');if(!box){box=document.createElement('div');box.setAttribute('data-rx-auto-book','');box.hidden=true;
      var anchor=Array.prototype.find.call(c.host.querySelectorAll('.rx-actions'),function(x){return !x.closest('.rx-header');});if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);else c.host.insertBefore(box,c.host.firstChild);}
    return load(box,c);}
  window.SSMPDReceptionAutoBook={decorate:decorate,cairoISO:cairoISO,labels:SRC};
})();
