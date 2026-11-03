(function(w){
  'use strict';
  if(w.__SSMPD_DIGITAL_TEAM_LOADED__)return;
  w.__SSMPD_DIGITAL_TEAM_LOADED__=true;
  var client=null,navObserver=null;
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
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3z"></path><path d="M18.5 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"></path></svg>';
  }
  function stat(label,value){return '<div class="dt-stat"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>';}
  function chip(text,kind){return '<span class="dt-chip '+(kind||'')+'">'+esc(text)+'</span>';}
  function memberCard(m){
    var x=m.metrics||{},head='<div class="dt-member-head"><div class="dt-avatar '+esc(m.code)+'">'+icon(m.code)+'</div><div class="dt-id"><div class="dt-name-row"><h2>'+esc(m.display_name)+'</h2>'+chip(m.active?'نشط':'متوقف',m.active?'ok':'off')+'</div><p>'+esc(m.title_ar)+'</p><div class="dt-chips">'+chip(m.member_kind==='external_agent'?'وكيل خارجي':m.member_kind==='system_identity'?'هوية نظام':'حساب قائم','type')+(m.code==='claude_creative'?chip('الحساب الحالي محفوظ','safe'):'')+'</div></div></div>';
    var body='';
    if(m.code==='sia'){
      body='<div class="dt-stats">'+stat('راجع',n(x.reviewed))+stat('اعتمد',n(x.approved))+stat('رجع',n(x.returned))+stat('رفع لك',n(x.needs_owner))+stat('متابعات تأخير',n(x.overdue_nudges))+stat('مهام مسندة مفتوحة',n(x.assigned_tasks_open))+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>'+n(x.open_owner_requests)+' قرار ينتظر المالك</span></div>';
    }else if(m.code==='claude_creative'){
      var caps=Array.isArray(x.capabilities)?x.capabilities:[];
      var rs=Array.isArray(x.roles)?x.roles:[];
      body='<div class="dt-role-line">'+rs.map(function(r){return chip(roleLabel(r),'role');}).join('')+'</div><div class="dt-stats">'+stat('إجراءات 30 يوم',n(x.actions_30d))+stat('طلبات مهام معلقة',n(x.task_requests_pending))+stat('طلبات تصميم 30 يوم',n(x.design_requests_30d))+stat('تصميمات معلقة',n(x.design_requests_pending))+stat('مهام مفتوحة',n(x.assigned_tasks_open))+stat('مهام مكتملة 30 يوم',n(x.assigned_tasks_done_30d))+'</div><div class="dt-capabilities"><h3>صلاحيات Claude الحالية</h3>'+caps.map(function(c){return '<div class="dt-cap"><span>'+esc(c.label||c.key)+'</span><b>'+esc(c.enabled?'مفعلة':'متوقفة')+'</b><small>الحد اليومي '+n(c.daily_limit)+'</small></div>';}).join('')+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>عرض فقط · لا تعديل على الصلاحيات من هنا</span></div>';
    }else{
      var live=x.live_enabled===true,comms=x.communications_enabled===true;
      body='<div class="dt-stats">'+stat('التشغيل',live?'مفعل':'غير مفعل')+stat('التواصل',comms?'مفعل':'غير مفعل')+stat('رسائل معلقة',n(x.pending_messages))+stat('رسائل فشلت',n(x.failed_messages))+stat('طلبات مساعدة',n(x.open_help_requests))+stat('مكالمات غير محلولة',n(x.unresolved_missed_calls))+'</div><div class="dt-foot"><span>وكيل خدمة العملاء والحجز</span><span>بدون حساب دخول للداشبورد</span></div>';
    }
    return '<article class="dt-member">'+head+'<p class="dt-authority">'+esc(m.authority_note||'')+'</p>'+body+'</article>';
  }
  function render(data){
    var view=document.getElementById('view-container');if(!view)return;
    var members=Array.isArray(data&&data.members)?data.members:[];
    view.innerHTML='<section class="digital-team" dir="rtl"><header class="dt-hero"><div><p class="dt-eyebrow">Swnw Digital Team</p><h1>الفريق الرقمي</h1><p>هويات تشغيلية واضحة، صلاحيات منفصلة، ومؤشرات خاصة بكل وكيل.</p></div><div class="dt-hero-actions"><button class="btn ghost sm" data-dt-refresh type="button">تحديث</button></div></header><div class="dt-principles"><span>Claude Creative مرتبط بحسابه الحالي بدون تغيير</span><span>الوكلاء الرقميون خارج الحضور والرواتب البشرية</span><span>كل إجراء له مصدر صلاحية واضح</span></div><div class="dt-grid">'+members.map(memberCard).join('')+'</div></section>';
    var b=view.querySelector('[data-dt-refresh]');if(b)b.onclick=load;
  }
  async function load(){var db=initClient(),view=document.getElementById('view-container');if(!db||!view)return;view.innerHTML='<div class="dt-loading">جارٍ تحميل الفريق الرقمي…</div>';try{var r=await db.rpc('digital_team_dashboard');if(r.error)throw r.error;render(r.data||{});}catch(e){view.innerHTML='<div class="dt-loading">تعذر تحميل الفريق الرقمي: '+esc(e.message||e)+'</div>';}}
  function open(){
    var a=currentAdmin();if(!a||!isManager(a))return;
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('[data-digital-team-tab]').forEach(function(b){b.classList.add('active');});
    var bar=document.getElementById('tabs-bar');if(bar)bar.style.display='';
    var mobileTabs=document.querySelector('#mobile-menu .mm-tabs');if(mobileTabs)mobileTabs.style.display='';
    var brand=document.getElementById('brand-section-name');
    if(brand)brand.innerHTML=w.SSMPDUITitles&&w.SSMPDI18n?w.SSMPDUITitles.brand('digital_team',a):'مركز عيادات سونو التخصصية · الفريق الرقمي';
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
    navObserver.observe(host,{childList:true,subtree:true});
  }
  w.SSMPDDigitalTeam={open:open,refresh:load};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
