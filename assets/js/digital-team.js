(function(w){
  'use strict';
  if(w.__SSMPD_DIGITAL_TEAM_LOADED__)return;
  w.__SSMPD_DIGITAL_TEAM_LOADED__=true;
  var client=null,navObserver=null,cachedData=null,recentReviews={},isOwner=false;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function roles(a){var r=Array.isArray(a&&a.roles)?a.roles.slice():[];if(a&&a.role&&r.indexOf(a.role)===-1)r.push(a.role);return r;}
  function isManager(a){var r=roles(a);return r.indexOf('super_admin')!==-1||r.indexOf('general_manager')!==-1;}
  function currentAdmin(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;}
  function initClient(){if(client)return client;var c=w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase;if(!c||!w.supabase)return null;client=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return client;}
  function n(v){return Number(v||0).toLocaleString('en-US');}
  function rel(iso){if(!iso)return 'لا يوجد نشاط مسجل';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));if(m<1)return 'الآن';if(m<60)return 'من '+m+' دقيقة';var h=Math.round(m/60);if(h<24)return 'من '+h+' ساعة';return 'من '+Math.round(h/24)+' يوم';}
  function roleLabel(r){return {page_manager:'مسؤول المحتوى',designer:'مصمم جرافيك',approver:'مسؤول اعتماد',digital_agent:'موظف رقمي'}[r]||r||'';}
  function icon(code){
    if(code==='sia')return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4"></rect><path d="M12 7V4m-2 0h4M7 20v2l3-2M9 12h.01M15 12h.01M9.5 16h5"></path></svg>';
    if(code==='hapi')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14z"></path><path d="M8 10h8M8 13h5"></path></svg>';
    if(code==='hor')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"></path><path d="M5 5h14v14H5z" stroke-dasharray="2 4"></path></svg>';
    if(code==='hotep')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6.5c-2-3-6-2.5-8 .2-2-2.7-6-3.2-8-.2-3 4 2 8.5 8 13 6-4.5 11-9 8-13z"></path><path d="M7 12h3l1-2 2 4 1-2h3"></path></svg>';
    if(code==='nefer')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V7m5 12v-5m5 5V9m5 10V4"></path><path d="M4 10l5-3 5 2 5-5"></path></svg>';
    if(code==='maat')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h14M4 19h16M6 7l-3 7h6L6 7zm12 0-3 7h6l-3-7z"></path></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3z"></path><path d="M18.5 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"></path></svg>';
  }
  function stat(label,value){return '<div class="dt-stat"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>';}
  function chip(text,kind){return '<span class="dt-chip '+(kind||'')+'">'+esc(text)+'</span>';}

  var specialistCodes={hor:true,hotep:true,nefer:true,maat:true};
  var metricLabels={
    visits_last30:'زيارات مسجلة في 30 يوم',
    followup_status_to_review:'متابعات تحتاج مراجعة السجل',
    reception_bookings_last30:'حجوزات في سجل الاستقبال',
    reception_arrivals_recorded:'حالات وصول مسجلة',
    open_patient360_cases:'شكاوى مفتوحة',
    open_complaints:'شكاوى قيد المراجعة',
    urgent_or_clinical_complaints:'شكاوى عاجلة أو طبية',
    feedback_total:'تقييمات تجربة المريض',
    feedback_last30:'تقييمات آخر 30 يوم',
    leads_last30:'استفسارات آخر 30 يوم',
    no_response_last30_not_opted_out:'استفسارات حالتها دون رد',
    leads_with_ad_attribution_total:'استفسارات فيها بيانات حملة',
    registered_partner_entities:'جهات تعاقد مسجلة',
    referrals_in_partner_table:'إحالات بجدول الشراكات',
    journal_entries_checked:'قيود فُحص توازنها',
    journal_entries_unbalanced:'قيود بها فرق بين الطرفين',
    invoices_recorded:'فواتير بنظام الحسابات',
    bank_statements_imported:'كشوف بنكية مستوردة',
    pos_settlements_imported:'تسويات نقاط بيع مستوردة'
  };
  function specialistContent(m){
    var r=recentReviews[m.code],metrics=r&&r.metrics||{},findings=r&&Array.isArray(r.findings)?r.findings:[];
    var last=r?'<span>آخر مراجعة '+esc(rel(r.reviewed_at))+'</span>':'<span>لم يتم تشغيل المراجعة بعد</span>';
    var state=r?'<span>'+(r.status==='pending_owner'?'بانتظار قرار المالك':r.status==='accepted_for_planning'?'اعتمد للمناقشة فقط':'تم استبعاد المقترح')+'</span>':'';
    var pairs=Object.keys(metrics).map(function(key){return stat(metricLabels[key]||key,n(metrics[key]));}).join('');
    var findingsHtml=findings.map(function(item){return '<article class="dt-review-finding"><b>'+esc(item.title)+'</b><p>'+esc(item.reason)+'</p><small>المصدر: '+esc(item.source)+'</small><div class="dt-suggestion">المقترح: '+esc(item.recommendation)+'</div></article>';}).join('');
    var controls=isOwner&&r&&r.status==='pending_owner'?
      '<div class="dt-review-decisions"><button type="button" class="btn sm" data-dt-decision="accepted_for_planning" data-dt-review-id="'+esc(r.id)+'">اعتماد للمناقشة فقط</button><button type="button" class="btn ghost sm" data-dt-decision="dismissed" data-dt-review-id="'+esc(r.id)+'">استبعاد</button></div>':'';
    return '<div class="dt-specialist" data-dt-specialist="'+esc(m.code)+'"><div class="dt-review-intro">'+chip('مراجعة فقط · بدون تنفيذ','safe')+'<span>تحليل عند الطلب، لا تشغيل آلي للوكيل</span></div><button type="button" class="btn ghost sm" data-dt-run="'+esc(m.code)+'">افحص مؤشرات '+esc(m.display_name)+'</button><div class="dt-specialist-status" data-dt-agent-status></div>'+
      (r?'<div class="dt-stats">'+pairs+'</div><div class="dt-review-findings">'+findingsHtml+'</div>':'<p class="dt-placeholder">اضغط فحص المؤشرات للحصول على تحليل مجمع واقتراحات للمراجعة البشرية.</p>')+
      '<div class="dt-foot">'+last+state+'</div>'+controls+'</div>';
  }
  function memberCard(m){
    var x=m.metrics||{},special=!!specialistCodes[m.code],head='<div class="dt-member-head"><div class="dt-avatar '+esc(m.code)+'">'+icon(m.code)+'</div><div class="dt-id"><div class="dt-name-row"><h2>'+esc(m.display_name)+'</h2>'+chip(special?'مراجعة عند الطلب':(m.active?'نشط':'متوقف'),special?'safe':(m.active?'ok':'off'))+'</div><p>'+esc(m.title_ar)+'</p><div class="dt-chips">'+chip(special?'محرك تحليل':m.member_kind==='external_agent'?'وكيل خارجي':m.member_kind==='system_identity'?'هوية نظام':'حساب قائم','type')+(m.code==='claude_creative'?chip('الحساب الحالي محفوظ','safe'):'')+'</div></div></div>';
    var body='';
    if(m.code==='sia'){
      body='<div class="dt-stats">'+stat('راجع',n(x.reviewed))+stat('اعتمد',n(x.approved))+stat('رجع',n(x.returned))+stat('رفع لك',n(x.needs_owner))+stat('متابعات تأخير',n(x.overdue_nudges))+stat('مهام مسندة مفتوحة',n(x.assigned_tasks_open))+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>'+n(x.open_owner_requests)+' قرار ينتظر المالك</span></div>';
    }else if(m.code==='claude_creative'){
      var caps=Array.isArray(x.capabilities)?x.capabilities:[];
      var rs=Array.isArray(x.roles)?x.roles:[];
      body='<div class="dt-role-line">'+rs.map(function(r){return chip(roleLabel(r),'role');}).join('')+'</div><div class="dt-stats">'+stat('إجراءات 30 يوم',n(x.actions_30d))+stat('طلبات مهام معلقة',n(x.task_requests_pending))+stat('طلبات تصميم 30 يوم',n(x.design_requests_30d))+stat('تصميمات معلقة',n(x.design_requests_pending))+stat('مهام مفتوحة',n(x.assigned_tasks_open))+stat('مهام مكتملة 30 يوم',n(x.assigned_tasks_done_30d))+'</div><div class="dt-capabilities"><h3>صلاحيات Claude الحالية</h3>'+caps.map(function(c){return '<div class="dt-cap"><span>'+esc(c.label||c.key)+'</span><b>'+esc(c.enabled?'مفعلة':'متوقفة')+'</b><small>الحد اليومي '+n(c.daily_limit)+'</small></div>';}).join('')+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>عرض فقط · لا تعديل على الصلاحيات من هنا</span></div>';
    }else if(specialistCodes[m.code]){
      body=specialistContent(m);
    }else{
      var live=x.live_enabled===true,comms=x.communications_enabled===true;
      body='<div class="dt-stats">'+stat('التشغيل',live?'مفعل':'غير مفعل')+stat('التواصل',comms?'مفعل':'غير مفعل')+stat('رسائل معلقة',n(x.pending_messages))+stat('رسائل فشلت',n(x.failed_messages))+stat('طلبات مساعدة',n(x.open_help_requests))+stat('مكالمات غير محلولة',n(x.unresolved_missed_calls))+'</div><div class="dt-foot"><span>وكيل خدمة العملاء والحجز</span><span>بدون حساب دخول للداشبورد</span></div>';
    }
    return '<article class="dt-member">'+head+'<p class="dt-authority">'+esc(m.authority_note||'')+'</p>'+body+'</article>';
  }
  function render(data){
    var view=document.getElementById('view-container');if(!view)return;
    var members=Array.isArray(data&&data.members)?data.members:[];
    cachedData=data;
    view.innerHTML='<section class="digital-team" dir="rtl"><header class="dt-hero"><div><p class="dt-eyebrow">Swnw Digital Team</p><h1>الفريق الرقمي</h1><p>هويات تشغيلية واضحة، صلاحيات منفصلة، ومؤشرات خاصة بكل وكيل.</p></div><div class="dt-hero-actions"><button class="btn ghost sm" data-dt-refresh type="button">تحديث</button></div></header><div class="dt-principles"><span>Claude Creative مرتبط بحسابه الحالي بدون تغيير</span><span>الوكلاء الرقميون خارج الحضور والرواتب البشرية</span><span>كل إجراء له مصدر صلاحية واضح</span></div><div class="dt-grid">'+members.map(memberCard).join('')+'</div><div class="dt-global-status" data-dt-global-status></div></section>';
    var b=view.querySelector('[data-dt-refresh]');if(b)b.onclick=load;
    view.querySelectorAll('[data-dt-run]').forEach(function(btn){
      btn.onclick=function(){runReview(btn.getAttribute('data-dt-run'),btn);};
    });
    view.querySelectorAll('[data-dt-decision]').forEach(function(btn){
      btn.onclick=function(){decide(btn.getAttribute('data-dt-review-id'),btn.getAttribute('data-dt-decision'),btn);};
    });
  }

  async function latest(){
    var db=initClient();if(!db)return;
    var r=await db.rpc('digital_agent_recent_reviews');if(r.error)throw r.error;
    var d=r.data||{};isOwner=!!d.is_owner;recentReviews={};
    (Array.isArray(d.reviews)?d.reviews:[]).forEach(function(x){if(specialistCodes[x.agent_code])recentReviews[x.agent_code]=x;});
    if(document.querySelector('.digital-team')&&cachedData)render(cachedData);
  }
  function reportError(code,message){
    var el=document.querySelector('[data-dt-specialist="'+code+'"] [data-dt-agent-status]');
    if(el)el.textContent=message;
  }
  async function runReview(code,button){
    if(!specialistCodes[code])return;
    button.disabled=true;reportError(code,'جارٍ تحليل المؤشرات المتاحة…');
    try{
      var r=await initClient().rpc('digital_agent_run_review',{p_code:code});
      if(r.error)throw r.error;
      await latest();
    }catch(e){reportError(code,'تعذر تنفيذ المراجعة: '+(e.message||e));}
    finally{button.disabled=false;}
  }
  async function decide(id,decision,button){
    if(!isOwner||!id||!['accepted_for_planning','dismissed'].includes(decision))return;
    var msg=decision==='accepted_for_planning'?'اعتماد للمناقشة فقط. لن تُنفذ أي توصية تلقائيًا.':'استبعاد هذه المراجعة دون حذف السجل.';
    if(!w.confirm(msg))return;
    button.disabled=true;
    try{
      var r=await initClient().rpc('digital_agent_decide_review',{p_review_id:id,p_decision:decision,p_note:''});
      if(r.error)throw r.error;
      await latest();
    }catch(e){var el=document.querySelector('[data-dt-global-status]');if(el)el.textContent='تعذر حفظ القرار: '+(e.message||e);}
    finally{button.disabled=false;}
  }
  async function load(){
    var db=initClient(),view=document.getElementById('view-container');if(!db||!view)return;
    view.innerHTML='<div class="dt-loading">جارٍ تحميل الفريق الرقمي…</div>';
    try{
      var r=await db.rpc('digital_team_dashboard');if(r.error)throw r.error;
      cachedData=r.data||{};render(cachedData);
      try{await latest();}catch(e){var el=document.querySelector('[data-dt-global-status]');if(el)el.textContent='مراجعات الوكلاء الأربعة غير متاحة مؤقتًا: '+(e.message||e);}
    }catch(e){view.innerHTML='<div class="dt-loading">تعذر تحميل الفريق الرقمي: '+esc(e.message||e)+'</div>';}
  }
  function open(){
    var a=currentAdmin();if(!a||!isManager(a))return;
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('[data-digital-team-tab]').forEach(function(b){b.classList.add('active');});
    var bar=document.getElementById('tabs-bar');if(bar)bar.style.display='';
    var mobileTabs=document.querySelector('#mobile-menu .mm-tabs');if(mobileTabs)mobileTabs.style.display='';
    var brand=document.getElementById('brand-section-name');
    if(brand)brand.innerHTML='<span class="brand-center">مركز عيادات سونو التخصصية</span><span class="brand-section">الفريق الرقمي</span>';
    if(w.SSMPDI18n&&w.SSMPDI18n.setPageTitle)w.SSMPDI18n.setPageTitle('الفريق الرقمي');
    var mobile=document.getElementById('mobile-menu');if(mobile)mobile.classList.remove('open');
    var dropdown=document.getElementById('user-dropdown');if(dropdown)dropdown.classList.remove('open');
    load();
  }
  function addNav(parent,cls,label){
    if(!parent||parent.querySelector('[data-digital-team-tab]'))return;
    var b=document.createElement('button');b.className=cls;b.type='button';
    b.setAttribute('data-digital-team-tab','1');b.textContent=label;b.onclick=open;
    parent.appendChild(b);
  }
  function mount(){
    var a=currentAdmin();if(!a||!isManager(a))return;
    addNav(document.getElementById('tabs-bar'),'tab-btn dt-tab','الفريق الرقمي');
    addNav(document.querySelector('#mobile-menu .mm-tabs'),'tab-btn dt-tab','الفريق الرقمي');
    addNav(document.querySelector('#user-dropdown .ud-items'),'ud-item dt-dropdown-tab','الفريق الرقمي');
  }
  function start(){
    mount();
    if(navObserver)return;
    var host=document.getElementById('app-root')||document.body;
    navObserver=new MutationObserver(mount);
    navObserver.observe(host,{childList:true});
  }
  w.SSMPDDigitalTeam={open:open,refresh:load};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
