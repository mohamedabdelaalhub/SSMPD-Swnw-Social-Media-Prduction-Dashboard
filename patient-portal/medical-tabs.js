(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});
var cache=null,cacheAt=0,loading=null;

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function val(v){return v===null||typeof v==="undefined"||String(v).trim()===""?"—":esc(v);}
function fmtDate(v){if(!v)return "—";var d=new Date(String(v).length===10?v+"T00:00:00":v);if(isNaN(d.getTime()))return esc(v);return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);}
function gender(v){return v==="male"?"ذكر":v==="female"?"أنثى":"—";}
function chronicLabel(v){return({smoking:"التدخين",blood_pressure:"الضغط",diabetes:"السكر",thyroid:"الغدة الدرقية",kidney_disease:"أمراض الكلى",tumors:"أورام",drug_allergies:"حساسية أدوية"}[v]||v||"حالة مزمنة");}
function icon(name){var p={health:'<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10Z"/><path d="M9 13h2l1-3 2 6 1-3h2"/>',rx:'<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="m11 12 7 8M18 12l-7 8"/>',follow:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'};return '<svg viewBox="0 0 24 24" aria-hidden="true">'+p[name]+'</svg>';}

function invoke(){
  if(cache&&Date.now()-cacheAt<30000)return Promise.resolve(cache);
  if(loading)return loading;
  loading=client.functions.invoke("patient-portal-medical-data",{body:{op:"overview"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    cache=r.data||{records:[]};cacheAt=Date.now();return cache;
  }).finally(function(){loading=null;});
  return loading;
}

function ensureTabs(){
  var tabs=root.querySelector(".profile-tabs");
  if(!tabs)return;
  if(!tabs.querySelector('[data-medical-tab="health"]')){
    tabs.insertAdjacentHTML("beforeend",'<button class="medical-tab" data-medical-tab="health">'+icon("health")+'<span>البيانات الصحية</span></button><button class="medical-tab" data-medical-tab="prescriptions">'+icon("rx")+'<span>الوصفات والأدوية</span></button><button class="medical-tab" data-medical-tab="followup">'+icon("follow")+'<span>المتابعة</span></button>');
  }
  tabs.querySelectorAll("[data-medical-tab]").forEach(function(btn){
    if(btn.dataset.wired==="1")return;btn.dataset.wired="1";
    btn.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();openTab(btn.getAttribute("data-medical-tab"));});
  });
}

function setActive(tab){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  tabs.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-medical-tab")===tab);});
}

function content(){return root.querySelector(".profile-content");}
function loadingView(tab){setActive(tab);var c=content();if(!c)return;c.innerHTML='<div class="portal-medical-view medical-loading"><div><span class="spinner"></span><p>جاري تحميل بياناتك الطبية…</p></div></div>';}
function errorView(tab,e){setActive(tab);var c=content();if(!c)return;c.innerHTML='<div class="portal-medical-view portal-medical-error"><div class="notice error">تعذر تحميل البيانات الطبية الآن. حاول مرة أخرى.</div></div>';console.error("patient portal medical data",e);}

function recordHead(r){var p=r.patient||{};return '<div class="medical-record-head"><div class="medical-record-title"><h2>'+val(p.full_name)+'</h2><p>'+val(p.patient_code)+'</p></div><span class="medical-record-badge">ملف معتمد</span></div>';}
function item(label,value,highlight){return '<div class="health-item'+(highlight?' highlight':'')+'"><label>'+label+'</label><b>'+val(value)+'</b></div>';}
function chips(items,kind){
  if(!items||!items.length)return '<div class="medical-empty">لا توجد بيانات مسجلة.</div>';
  return '<div class="medical-chip-list">'+items.map(function(x){
    if(kind==="chronic")return '<span class="medical-chip"><strong>'+esc(chronicLabel(x.name))+'</strong>'+(x.medication?' — '+esc(x.medication):'')+'</span>';
    if(kind==="surgery")return '<span class="medical-chip"><strong>'+esc(x.name||"عملية")+'</strong>'+(x.notes?' — '+esc(x.notes):'')+'</span>';
    return '<span class="medical-chip"><strong>'+esc(x.disease||"تاريخ عائلي")+'</strong></span>';
  }).join("")+'</div>';
}

function renderHealth(data){
  var recs=data.records||[],c=content();if(!c)return;
  if(!recs.length){c.innerHTML='<div class="portal-medical-view medical-empty">لا توجد سجلات طبية معتمدة على الحساب.</div>';return;}
  c.innerHTML='<div class="portal-medical-view medical-records">'+recs.map(function(r){var p=r.patient||{},m=r.medical_profile||{};return '<article class="medical-record-card">'+recordHead(r)+'<section class="medical-section"><h3>البيانات الأساسية</h3><div class="health-grid">'+item("رقم الهاتف",p.phone,true)+item("البريد الإلكتروني",p.email)+item("السن",p.age)+item("النوع",gender(p.gender))+item("الطول",m.height)+item("الوزن",m.weight)+item("الطبيب المعالج",m.treating_doctor)+item("التخصص",m.specialty)+'</div></section><section class="medical-section"><h3>العلامات الحيوية</h3><p class="medical-section-note">تظهر آخر قيمة مسجلة في الملف الطبي.</p><div class="health-grid">'+item("ضغط الدم",m.blood_pressure,true)+item("سكر الدم",m.blood_sugar,true)+item("النبض",m.pulse)+item("نسبة الأكسجين",m.oxygen_percent)+'</div></section><section class="medical-section"><h3>الأمراض المزمنة والأدوية المرتبطة</h3>'+chips(m.chronic_conditions,"chronic")+'</section><section class="medical-section"><h3>العمليات الجراحية</h3>'+chips(m.surgeries,"surgery")+'</section><section class="medical-section"><h3>التاريخ المرضي بالعائلة</h3>'+chips(m.family_history,"family")+'</section></article>';}).join("")+'</div>';
}

function renderPrescriptions(data){
  var recs=data.records||[],c=content();if(!c)return;
  if(!recs.length){c.innerHTML='<div class="portal-medical-view medical-empty">لا توجد سجلات طبية معتمدة على الحساب.</div>';return;}
  c.innerHTML='<div class="portal-medical-view medical-records">'+recs.map(function(r){var rx=r.prescriptions||[],visits=(r.visits||[]).filter(function(v){return v.medications&&String(v.medications).trim();}),chronic=((r.medical_profile||{}).chronic_conditions||[]).filter(function(x){return x.medication;});var meds=[];chronic.forEach(function(x){meds.push({date:"دواء مسجل بالحالة المزمنة",text:chronicLabel(x.name)+": "+x.medication});});visits.forEach(function(v){meds.push({date:fmtDate(v.visit_date),text:v.medications});});return '<article class="medical-record-card">'+recordHead(r)+'<section class="medical-section"><h3>الروشتات والوصفات الطبية</h3>'+(rx.length?'<div class="rx-list">'+rx.map(function(x){return '<div class="rx-card"><div class="rx-top"><b>'+esc(x.doctor_name||"روشتة طبية")+'</b><span>'+fmtDate(x.report_date)+'</span></div><div class="rx-meta">'+(x.specialty?'<span>التخصص: '+esc(x.specialty)+'</span>':'')+(x.diagnosis?'<span>التشخيص: '+esc(x.diagnosis)+'</span>':'')+'</div><div class="rx-text">'+val(x.rx_text)+'</div></div>';}).join("")+'</div>':'<div class="medical-empty">لا توجد روشتات مسجلة حتى الآن.</div>')+'</section><section class="medical-section"><h3>الأدوية المسجلة</h3>'+(meds.length?'<div class="visit-med-list">'+meds.map(function(x){return '<div class="visit-med"><span class="visit-date">'+esc(x.date)+'</span><p>'+esc(x.text)+'</p></div>';}).join("")+'</div>':'<div class="medical-empty">لا توجد أدوية مسجلة حتى الآن.</div>')+'</section></article>';}).join("")+'</div>';
}

function renderFollowup(data){
  var recs=data.records||[],c=content();if(!c)return;
  if(!recs.length){c.innerHTML='<div class="portal-medical-view medical-empty">لا توجد سجلات طبية معتمدة على الحساب.</div>';return;}
  c.innerHTML='<div class="portal-medical-view medical-records">'+recs.map(function(r){var f=r.next_follow_up,p=r.patient||{},latest=r.latest_visit||{};return '<article class="medical-record-card">'+recordHead(r)+'<section class="medical-section"><h3>موعد المتابعة</h3>'+(f?'<div class="followup-card"><div class="followup-date-box"><strong>'+fmtDate(f.follow_up_date)+'</strong><span>الموعد المسجل</span></div><div class="followup-copy"><h3>متابعة طبية قادمة</h3><p>موعد المتابعة مسجل من آخر خطة علاجية في ملفك.</p>'+(f.complaint?'<p class="complaint">الشكوى المسجلة: '+esc(f.complaint)+'</p>':'')+'</div></div>':'<div class="medical-empty">لا يوجد موعد متابعة محدد حاليًا.</div>')+'</section><section class="medical-section"><h3>آخر زيارة مسجلة</h3><div class="health-grid">'+item("تاريخ آخر زيارة",latest.visit_date||p.last_visit_date,true)+item("رقم الزيارة",latest.visit_number)+item("ضغط الدم",latest.blood_pressure)+item("سكر الدم",latest.blood_sugar)+'</div></section></article>';}).join("")+'</div>';
}

function openTab(tab){loadingView(tab);invoke().then(function(data){setActive(tab);if(tab==="health")renderHealth(data);else if(tab==="prescriptions")renderPrescriptions(data);else renderFollowup(data);}).catch(function(e){errorView(tab,e);});}

function apply(){ensureTabs();}
apply();
new MutationObserver(function(){window.requestAnimationFrame(apply);}).observe(root,{childList:true,subtree:true});
})();
