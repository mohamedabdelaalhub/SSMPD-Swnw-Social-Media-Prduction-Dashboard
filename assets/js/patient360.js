(function(w){
  'use strict';
  if(w.__SSMPD_PATIENT360_LOADED__)return;
  w.__SSMPD_PATIENT360_LOADED__=true;
  var db=null,records=[],selected=null,details=null,navObserver=null,seq=0;
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
  var roles=function(a){var r=Array.isArray(a&&a.roles)?a.roles.slice():[];if(a&&a.role&&r.indexOf(a.role)<0)r.push(a.role);return r;};
  var admin=function(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;};
  var manager=function(){return roles(admin()).some(function(r){return r==='super_admin'||r==='general_manager';});};
  var client=function(){if(db)return db;var c=w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase;if(!c||!w.supabase)return null;db=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return db;};
  var textDate=function(v){return v?new Date(v).toLocaleString('ar-EG',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'غير مسجل';};
  var categoryLabels={wait_time:'تأخير',communication:'تواصل',service:'خدمة',billing:'حسابات',clinical:'مخاوف صحية',other:'أخرى'};
  var typeLabels={interest:'اهتمام',unanswered_question:'سؤال دون إجابة',possible_blocker:'سبب محتمل',preference:'تفضيل',confirmed_fact:'معلومة مؤكدة',service_feedback:'ملاحظة عن الخدمة'};
  function currentView(){var v=document.getElementById('view-container');return v&&v.querySelector('[data-p360-root]')?v:null;}
  function status(v){var e=document.querySelector('[data-p360-status]');if(e)e.textContent=v||'';}
  function phoneShort(c){var s=String(c.external_key||'');return s.length>4?'••••'+s.slice(-4):'••••';}
  function heading(){return '<header class="p360-head"><div><p class="p360-eyebrow">Swnw Patient 360</p><h1>علاقة المريض بالمركز</h1><p>سجل المحادثات والملاحظات والشكاوى والمتابعات. لا يوجد إرسال تلقائي.</p></div><button type="button" class="btn ghost sm" data-p360-reload>تحديث</button></header>';}
  function contactCard(c){var active=c.id===selected?' selected':'';return '<button type="button" class="p360-contact'+active+'" data-p360-contact="'+esc(c.id)+'"><span class="p360-contact-name">'+esc(c.display_name||'عميل')+'</span><span>'+esc(c.channel)+' · '+esc(phoneShort(c))+'</span><small>'+esc(textDate(c.last_message_at))+'</small></button>';}
  function messageCard(m){return '<article class="p360-message '+esc(m.direction)+'"><div class="p360-message-label">'+(m.direction==='inbound'?'العميل':'المركز')+' · '+esc(textDate(m.sent_at))+'</div><div class="p360-message-body">'+esc(m.body||'(رسالة بدون نص)')+'</div></article>';}
  function insightCard(i){return '<article class="p360-line"><b>'+esc(typeLabels[i.insight_type]||i.insight_type)+'</b><p>'+esc(i.statement)+'</p><small>'+(i.status==='confirmed'?'معلومة أكدتها الإدارة':i.status==='hypothesis'?'فرضية لم يتم التحقق منها':esc(i.status))+'</small>'+(i.status==='hypothesis'?'<button type="button" data-p360-confirm="'+esc(i.id)+'" class="btn ghost sm">تأكيد بعد التحقق</button>':'')+'</article>';}
  function caseCard(c){return '<article class="p360-line"><b>'+esc(categoryLabels[c.category]||c.category)+' · '+esc(c.severity==='critical'?'حرج':c.severity==='urgent'?'عاجل':'عادي')+'</b><p>'+esc(c.description)+'</p><small>الحالة '+esc(c.status)+' · '+esc(textDate(c.created_at))+'</small>'+(c.clinical_review_required?'<div class="p360-urgent">تحتاج تقييمًا بشريًا من الفريق الطبي</div>':'')+'</article>';}
  function followCard(f){return '<article class="p360-line"><b>متابعة '+esc(f.status)+'</b><p>'+esc(f.draft_body)+'</p><small>'+esc(f.reason)+' · '+esc(textDate(f.due_at))+'</small></article>';}
  function detailsHtml(){
    if(!selected)return '<div class="p360-placeholder">اختر محادثة لعرض تاريخ العلاقة بالعميل.</div>';
    if(!details)return '<div class="p360-placeholder">جارٍ تحميل المحادثة…</div>';
    var c=records.find(function(x){return x.id===selected;})||{},msgs=details.messages||[],ins=details.insights||[],cases=details.cases||[],follow=details.followups||[];
    var evidence=msgs.slice(-15).map(function(m){return '<option value="'+esc(m.id)+'">'+esc((m.direction==='inbound'?'العميل: ':'المركز: ')+(m.body||'').slice(0,80))+'</option>';}).join('');
    return '<div class="p360-detail-head"><h2>'+esc(c.display_name||'عميل')+'</h2><span>'+esc(c.channel)+' · '+esc(phoneShort(c))+'</span><small>إذن التسويق: '+(c.contact_consent==='opt_in'?'مسجل':c.contact_consent==='opt_out'?'مرفوض':'غير موثق')+(c.do_not_contact?' · ممنوع التواصل':'')+'</small></div>'+
     '<div class="p360-hint">الرقم أو حساب واتساب وحده لا يثبت هوية المريض. لا تُعرض ملفات طبية هنا. أي ربط بزيارة يستلزم التحقق.</div>'+
     '<section class="p360-section"><h3>المحادثات <small>'+msgs.length+' رسالة معروضة</small></h3><div class="p360-messages">'+(msgs.length?msgs.map(messageCard).join(''):'لا توجد رسائل محفوظة لهذه الهوية.')+'</div></section>'+
     '<section class="p360-section"><h3>ذاكرة العلاقة <small>فرضيات ومعلومات موثقة</small></h3><div class="p360-cards">'+(ins.map(insightCard).join('')||'<p class="p360-muted">لا توجد ملاحظات بعد.</p>')+'</div>'+
     '<form data-p360-insight-form class="p360-form"><select name="insight_type" required><option value="interest">اهتمام</option><option value="unanswered_question">سؤال دون إجابة</option><option value="possible_blocker">سبب محتمل لعدم الحجز</option><option value="preference">تفضيل</option><option value="service_feedback">ملاحظة عن الخدمة</option></select><textarea name="statement" placeholder="اكتب المعلومة، ولا تفترض سببًا غير مؤكد." required minlength="3" maxlength="1200"></textarea><select name="evidence_message_id"><option value="">لا يوجد دليل محدد بعد</option>'+evidence+'</select><button class="btn sm" type="submit">حفظ كفرضية للمراجعة</button></form></section>'+
     '<section class="p360-section"><h3>الشكاوى والإجراءات <small>'+cases.length+' حالة</small></h3><div class="p360-cards">'+(cases.map(caseCard).join('')||'<p class="p360-muted">لا توجد شكاوى مسجلة.</p>')+'</div>'+
     '<form data-p360-case-form class="p360-form"><div class="p360-form-row"><select name="category"><option value="service">الخدمة</option><option value="wait_time">تأخير الطبيب أو الانتظار</option><option value="communication">التواصل</option><option value="billing">الحسابات</option><option value="clinical">مخاوف صحية تحتاج مختصًا</option><option value="other">أخرى</option></select><select name="severity"><option value="normal">عادي</option><option value="urgent">عاجل</option><option value="critical">حرج</option></select></div><textarea name="description" placeholder="اكتب الشكوى والمطلوب مراجعته دون استنتاج مسؤولية أو تشخيص." required minlength="4" maxlength="4000"></textarea><button class="btn sm" type="submit">فتح حالة للمراجعة الداخلية</button></form></section>'+
     '<section class="p360-section"><h3>مسودات المتابعة <small>بدون إرسال تلقائي</small></h3><div class="p360-cards">'+(follow.map(followCard).join('')||'<p class="p360-muted">لا توجد متابعات مسجلة.</p>')+'</div>'+
     '<form data-p360-follow-form class="p360-form"><input name="reason" placeholder="سبب المتابعة" minlength="4" maxlength="1500" required><textarea name="draft_body" placeholder="مسودة رسالة بدون ضغط على العميل" minlength="4" maxlength="4000" required></textarea><label class="p360-date-label">موعد مقترح <input name="due_at" type="datetime-local"></label><button class="btn sm" type="submit">حفظ مسودة فقط</button></form></section>';
  }
  function render(){
    var v=currentView();if(!v)return;
    var q=(document.querySelector('[data-p360-search]')||{}).value||'',filtered=records.filter(function(c){return (c.display_name+' '+c.external_key+' '+c.channel).toLocaleLowerCase().includes(q.toLocaleLowerCase());});
    var rail=v.querySelector('[data-p360-list]');if(rail)rail.innerHTML=filtered.map(contactCard).join('')||'<p class="p360-muted">لا توجد محادثات مطابقة.</p>';
    var target=v.querySelector('[data-p360-details]');if(target)target.innerHTML=detailsHtml();
    wire(v);
  }
  function wire(v){
    v.querySelectorAll('[data-p360-contact]').forEach(function(b){b.onclick=function(){selected=b.getAttribute('data-p360-contact');details=null;render();loadDetails();};});
    var rf=v.querySelector('[data-p360-reload]');if(rf)rf.onclick=load;
    var search=v.querySelector('[data-p360-search]');if(search)search.oninput=render;
    var ins=v.querySelector('[data-p360-insight-form]');if(ins)ins.onsubmit=function(e){e.preventDefault();submitInsight(ins);};
    var cf=v.querySelector('[data-p360-case-form]');if(cf)cf.onsubmit=function(e){e.preventDefault();submitCase(cf);};
    var ff=v.querySelector('[data-p360-follow-form]');if(ff)ff.onsubmit=function(e){e.preventDefault();submitFollowup(ff);};
    v.querySelectorAll('[data-p360-confirm]').forEach(function(b){b.onclick=function(){confirmInsight(b.getAttribute('data-p360-confirm'));};});
  }
  async function loadDetails(){
    if(!selected||!currentView())return;var id=selected,stamp=++seq;
    try{var [m,i,c,f]=await Promise.all([
      client().from('patient360_messages').select('id,direction,body,sent_at').eq('contact_id',id).order('sent_at',{ascending:false}).limit(100),
      client().from('patient360_insights').select('id,insight_type,statement,status,created_at').eq('contact_id',id).order('created_at',{ascending:false}).limit(30),
      client().from('patient360_cases').select('id,category,severity,description,status,clinical_review_required,created_at').eq('contact_id',id).order('created_at',{ascending:false}).limit(30),
      client().from('patient360_followups').select('id,reason,draft_body,status,due_at,created_at').eq('contact_id',id).order('created_at',{ascending:false}).limit(30)
    ]);
    var err=m.error||i.error||c.error||f.error;if(err)throw err;
    if(stamp!==seq||selected!==id||!currentView())return;
    details={messages:(m.data||[]).reverse(),insights:i.data||[],cases:c.data||[],followups:f.data||[]};render();
    }catch(e){status('تعذر قراءة السجل: '+(e.message||e));}
  }
  async function load(){
    if(!manager()||!currentView())return;
    status('جارٍ تحميل المحادثات…');
    try{var r=await client().from('patient360_contacts').select('id,channel,external_key,display_name,contact_consent,do_not_contact,last_message_at,last_inbound_at,last_outbound_at').order('last_message_at',{ascending:false,nullsFirst:false}).limit(150);
      if(r.error)throw r.error;if(!currentView())return;records=r.data||[];
      if(!selected&&records.length)selected=records[0].id;
      if(selected&&!records.some(function(c){return c.id===selected;}))selected=records[0]?records[0].id:null;
      status('عدد هويات المحادثات: '+records.length+' · يعرض أرشيف Supabase والبيانات التي ترد إليه.');
      details=null;render();if(selected)await loadDetails();
    }catch(e){status('تعذر تحميل Patient 360: '+(e.message||e));}
  }
  function busy(form,on){var btn=form&&form.querySelector('button[type=submit]');if(btn)btn.disabled=on;}
  async function write(table,row,form){
    if(!selected||!manager())return;busy(form,true);
    try{var r=await client().from(table).insert(row);if(r.error)throw r.error;status('تم حفظ السجل. لم تُرسل أي رسالة للعميل.');await loadDetails();}
    catch(e){status('تعذر الحفظ: '+(e.message||e));}
    finally{busy(form,false);}
  }
  function submitInsight(f){var x=new FormData(f),e=x.get('evidence_message_id');write('patient360_insights',{contact_id:selected,insight_type:x.get('insight_type'),statement:String(x.get('statement')||'').trim(),evidence_message_id:e||null,status:'hypothesis',created_by:admin().id},f);}
  function submitCase(f){var x=new FormData(f),category=x.get('category'),severity=x.get('severity');write('patient360_cases',{contact_id:selected,category:category,severity:severity,description:String(x.get('description')||'').trim(),clinical_review_required:category==='clinical',status:'new',created_by:admin().id},f);}
  function submitFollowup(f){var x=new FormData(f),due=x.get('due_at');write('patient360_followups',{contact_id:selected,reason:String(x.get('reason')||'').trim(),draft_body:String(x.get('draft_body')||'').trim(),due_at:due?new Date(String(due)).toISOString():null,status:'draft',created_by:admin().id},f);}
  async function confirmInsight(id){if(!manager()||!selected)return;if(!w.confirm('هل تحققت من هذه المعلومة من المحادثة أو دليل مناسب؟'))return;var r=await client().from('patient360_insights').update({status:'confirmed',approved_by:admin().id,updated_at:new Date().toISOString()}).eq('id',id).eq('contact_id',selected).eq('status','hypothesis');if(r.error)status('تعذر الاعتماد: '+r.error.message);else{status('تم التأكيد بتفويضك.');loadDetails();}}
  function open(){
    if(!manager())return;
    var v=document.getElementById('view-container');if(!v)return;
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('[data-p360-nav]').forEach(function(b){b.classList.add('active');});
    var tab=document.getElementById('tabs-bar');if(tab)tab.style.display='';
    var mm=document.querySelector('#mobile-menu .mm-tabs');if(mm)mm.style.display='';
    var b=document.getElementById('brand-section-name');if(b)b.textContent='مركز عيادات سونو التخصصية · Patient 360';
    var menu=document.getElementById('mobile-menu');if(menu)menu.classList.remove('open');
    var dropdown=document.getElementById('user-dropdown');if(dropdown)dropdown.classList.remove('open');
    v.innerHTML='<section class="p360-root" data-p360-root dir="rtl">'+heading()+'<div class="p360-status" data-p360-status></div><div class="p360-layout"><aside class="p360-sidebar"><input type="search" data-p360-search placeholder="بحث في المحادثات" aria-label="بحث في المحادثات"><div data-p360-list></div></aside><main class="p360-main" data-p360-details></main></div></section>';
    wire(v);load();
  }
  function nav(parent,cls){
    if(!parent||parent.querySelector('[data-p360-nav]'))return;
    var b=document.createElement('button');b.type='button';b.className=cls;b.textContent='علاقة المريض 360';b.setAttribute('data-p360-nav','1');b.onclick=open;parent.appendChild(b);
  }
  function mount(){
    if(!manager())return;
    nav(document.getElementById('tabs-bar'),'tab-btn p360-tab');
    nav(document.querySelector('#mobile-menu .mm-tabs'),'tab-btn p360-tab');
    nav(document.querySelector('#user-dropdown .ud-items'),'ud-item p360-menu');
  }
  function init(){
    mount();if(navObserver)return;
    var host=document.getElementById('app-root')||document.body;
    navObserver=new MutationObserver(mount);navObserver.observe(host,{childList:true});
  }
  w.SSMPDPatient360={open:open,refresh:load};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
