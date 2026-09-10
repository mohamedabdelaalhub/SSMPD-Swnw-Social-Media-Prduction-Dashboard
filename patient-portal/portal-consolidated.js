(function(){
"use strict";

var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root||!window.supabase)return;

var client=window.supabase.createClient(cfg.url,cfg.anonKey,{
  auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}
});
var medicalCache=null,medicalCacheAt=0,renderToken=0;

var encounterTypes=[
  {id:"checkup",label:"كشف",icon:"🩺"},
  {id:"follow_up",label:"متابعة",icon:"↻"},
  {id:"emergency",label:"طوارئ",icon:"+"},
  {id:"session",label:"جلسة",icon:"◷"},
  {id:"lab",label:"تحليل",icon:"⌁"},
  {id:"radiology",label:"أشعة",icon:"◉"},
  {id:"home_visit",label:"زيارة منزلية",icon:"⌂"}
];

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function val(v){return v===null||typeof v==="undefined"||String(v).trim()===""?"—":esc(v);}
function fmtDate(v){if(!v)return "—";var d=new Date(String(v).length===10?v+"T00:00:00":v);if(isNaN(d.getTime()))return esc(v);return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);}
function gender(v){return v==="male"?"ذكر":v==="female"?"أنثى":"—";}
function relation(v){return({self:"نفسي",father:"أب",mother:"أم",legal_guardian:"وصي قانوني",spouse:"زوج/زوجة",other:"أخرى",guardian:"وصاية",authorized:"ممثل معتمد"}[v]||v||"—");}
function chronicLabel(v){return({smoking:"التدخين",blood_pressure:"الضغط",diabetes:"السكر",thyroid:"الغدة الدرقية",kidney_disease:"أمراض الكلى",tumors:"أورام",drug_allergies:"حساسية أدوية"}[v]||v||"حالة مزمنة");}
function encounter(id){return encounterTypes.find(function(x){return x.id===id;})||{id:"checkup",label:"كشف",icon:"🩺"};}
function content(){return root.querySelector(".profile-content");}
function icon(name){var p={user:'<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/>',family:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',back:'<path d="m15 18-6-6 6-6"/><path d="M9 12h11"/>',doctor:'<path d="M9 3v4a3 3 0 0 0 6 0V3"/><path d="M6 4h3M15 4h3"/><path d="M12 10v2a5 5 0 0 0 5 5h1"/><circle cx="19" cy="17" r="2"/>'};return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[name]||p.user)+'</svg>';}

function invokeMedical(force){
  if(!force&&medicalCache&&Date.now()-medicalCacheAt<30000)return Promise.resolve(medicalCache);
  return client.functions.invoke("patient-portal-medical-data",{body:{op:"overview"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    medicalCache=r.data||{records:[]};medicalCacheAt=Date.now();return medicalCache;
  });
}
function setActiveMain(key){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  tabs.querySelectorAll("button").forEach(function(b){b.classList.remove("active");});
  var selector=key==="data"?'[data-profile-tab="data"]':key==="files"?'[data-profile-tab="files"]':key==="visits"?'[data-extra-tab="visits"]':'[data-medical-tab="prescriptions"]';
  var b=tabs.querySelector(selector);if(b)b.classList.add("active");
}
function loading(key,text){setActiveMain(key);var c=content();if(c)c.innerHTML='<div class="portal-medical-view medical-loading"><div><span class="spinner"></span><p>'+esc(text||"جاري التحميل…")+'</p></div></div>';}
function errorView(key,text){setActiveMain(key);var c=content();if(c)c.innerHTML='<div class="portal-medical-view"><div class="notice error">'+esc(text||"تعذر تحميل البيانات الآن.")+'</div></div>';}
function item(label,value,highlight){return '<div class="health-item'+(highlight?' highlight':'')+'"><label>'+esc(label)+'</label><b>'+val(value)+'</b></div>';}
function chips(items,kind){
  if(!items||!items.length)return '<div class="medical-empty">لا توجد بيانات مسجلة.</div>';
  return '<div class="medical-chip-list">'+items.map(function(x){
    if(kind==="chronic")return '<span class="medical-chip"><strong>'+esc(chronicLabel(x.name))+'</strong>'+(x.medication?' — '+esc(x.medication):'')+'</span>';
    if(kind==="surgery")return '<span class="medical-chip"><strong>'+esc(x.name||"عملية")+'</strong>'+(x.notes?' — '+esc(x.notes):'')+'</span>';
    return '<span class="medical-chip"><strong>'+esc(x.disease||"تاريخ عائلي")+'</strong></span>';
  }).join("")+'</div>';
}

function renderUnifiedData(data){
  var c=content();if(!c)return;
  var recs=data.records||[];
  if(!recs.length){c.innerHTML='<div class="portal-medical-view medical-empty">لا توجد سجلات طبية معتمدة على الحساب.</div>';return;}
  c.innerHTML='<div class="portal-medical-view unified-data-view"><div class="unified-page-head"><div><span>ملفك الصحي</span><h2>البيانات</h2><p>بياناتك الأساسية والصحية في مكان واحد.</p></div></div>'+recs.map(function(r){
    var p=r.patient||{},m=r.medical_profile||{},a=r.access||{};
    return '<article class="medical-record-card unified-record">'+
      '<div class="medical-record-head"><div class="medical-record-title"><h2>'+val(p.full_name)+'</h2><p>'+val(p.patient_code)+'</p></div><span class="medical-record-badge">ملف معتمد</span></div>'+
      '<section class="medical-section"><h3>البيانات الأساسية</h3><div class="health-grid">'+
        item("الاسم الكامل",p.full_name,true)+item("رقم الملف",p.patient_code)+item("رقم الهاتف",p.phone)+item("البريد الإلكتروني",p.email)+item("السن",p.age)+item("النوع",gender(p.gender))+item("نوع الوصول",relation(a.relationship||a.access_type))+item("حالة الوصول","معتمد",true)+
      '</div></section>'+
      '<section class="medical-section"><h3>المؤشرات الصحية</h3><p class="medical-section-note">تظهر أحدث قيمة مسجلة في الملف الطبي.</p><div class="health-grid">'+
        item("الطول",m.height)+item("الوزن",m.weight)+item("ضغط الدم",m.blood_pressure,true)+item("سكر الدم",m.blood_sugar,true)+item("النبض",m.pulse)+item("نسبة الأكسجين",m.oxygen_percent)+
      '</div></section>'+
      '<section class="medical-section"><h3>التاريخ الصحي</h3><div class="history-grid"><div><h4>الأمراض المزمنة والأدوية المرتبطة</h4>'+chips(m.chronic_conditions,"chronic")+'</div><div><h4>العمليات الجراحية</h4>'+chips(m.surgeries,"surgery")+'</div><div><h4>التاريخ المرضي بالعائلة</h4>'+chips(m.family_history,"family")+'</div></div></section>'+
    '</article>';
  }).join("")+'</div>';
}
function openData(){var token=++renderToken;loading("data","جاري تحميل بياناتك…");invokeMedical().then(function(d){if(token!==renderToken)return;setActiveMain("data");renderUnifiedData(d);}).catch(function(){if(token===renderToken)errorView("data","تعذر تحميل البيانات الآن.");});}

function visitVital(label,value){if(value===null||typeof value==="undefined"||String(value).trim()==="")return "";return '<span class="visit-vital"><small>'+esc(label)+'</small><b>'+esc(value)+'</b></span>';}
function visitBlock(label,value){if(value===null||typeof value==="undefined"||String(value).trim()==="")return "";return '<div class="visit-block"><label>'+esc(label)+'</label><p>'+esc(value)+'</p></div>';}
function visitCard(v){
  var type=encounter(v.encounter_type||"checkup"),doctor=v.doctor_name||"الطبيب غير مسجل",specialty=v.specialty||"التخصص غير مسجل";
  var vitals=[visitVital("الضغط",v.blood_pressure),visitVital("السكر",v.blood_sugar),visitVital("النبض",v.pulse)].join("");
  return '<section class="visit-card unified-visit-card" data-encounter="'+esc(type.id)+'">'+
    '<div class="visit-card-top"><div><div class="visit-title-row"><span class="encounter-badge type-'+esc(type.id)+'">'+esc(type.label)+'</span><span class="visit-date">'+fmtDate(v.visit_date)+'</span></div><h3>'+esc(doctor)+'</h3><p>'+esc(specialty)+(v.visit_number?' • زيارة رقم '+esc(v.visit_number):'')+'</p></div><span class="visit-doctor-icon">'+icon("doctor")+'</span></div>'+
    (vitals?'<div class="visit-vitals">'+vitals+'</div>':'')+
    visitBlock("الشكوى",v.complaint)+visitBlock("الأدوية",v.medications)+visitBlock("الأشعة المطلوبة",v.xrays)+visitBlock("التحاليل المطلوبة",v.labs)+visitBlock("توصيات أخرى",v.other_recommendations)+
    (v.follow_up_date?'<div class="visit-followup"><b>المتابعة القادمة</b><span>'+fmtDate(v.follow_up_date)+'</span></div>':'')+
  '</section>';
}
function followupSummary(recs){
  var items=[];
  recs.forEach(function(r){if(r.next_follow_up)items.push({p:r.patient||{},v:r.next_follow_up});});
  if(!items.length)return '<div class="visits-followup-empty"><b>المتابعة</b><span>لا توجد متابعة قادمة محددة حاليًا.</span></div>';
  return '<div class="visits-followup-panel"><div><span>المتابعة</span><h3>المتابعات القادمة</h3></div><div class="followup-mini-list">'+items.map(function(x){return '<div><b>'+fmtDate(x.v.follow_up_date)+'</b><span>'+esc(x.p.full_name||"")+(x.v.doctor_name?' • د/ '+esc(x.v.doctor_name):'')+'</span></div>';}).join("")+'</div></div>';
}
function renderUnifiedVisits(data,filter){
  var c=content();if(!c)return;
  var recs=data.records||[],active=filter||"all";
  var total=0;recs.forEach(function(r){total+=(r.visits||[]).length;});
  var filters=[{id:"all",label:"الكل"}].concat(encounterTypes);
  c.innerHTML='<div class="portal-medical-view unified-visits-view">'+
    '<div class="unified-page-head visits-page-head"><div><span>السجل الطبي</span><h2>الزيارات</h2><p>كل زياراتك ومتابعاتك والخدمات المرتبطة بها.</p></div><button class="btn visit-new-btn" id="unified-new-booking">'+icon("calendar")+'<span>حجز زيارة جديدة</span></button></div>'+
    followupSummary(recs)+
    '<div class="encounter-filters" role="tablist">'+filters.map(function(f){return '<button data-visit-filter="'+esc(f.id)+'" class="'+(active===f.id?'active':'')+'">'+esc(f.label)+'</button>';}).join("")+'</div>'+
    (recs.length?recs.map(function(r){var p=r.patient||{},visits=(r.visits||[]).filter(function(v){return active==="all"||(v.encounter_type||"checkup")===active;});return '<article class="medical-record-card unified-record"><div class="medical-record-head"><div class="medical-record-title"><h2>'+val(p.full_name)+'</h2><p>'+val(p.patient_code)+'</p></div><span class="medical-record-badge">'+visits.length+' من '+(r.visits||[]).length+'</span></div><div class="medical-section">'+(visits.length?'<div class="visits-list">'+visits.map(visitCard).join("")+'</div>':'<div class="medical-empty">لا توجد زيارات من هذا النوع.</div>')+'</div></article>';}).join(""):'<div class="medical-empty">لا توجد زيارات مسجلة حتى الآن.</div>')+
  '</div>';
  var book=document.getElementById("unified-new-booking");if(book)book.onclick=openBookingChooser;
  root.querySelectorAll("[data-visit-filter]").forEach(function(b){b.onclick=function(){renderUnifiedVisits(data,b.getAttribute("data-visit-filter"));};});
}
function openVisits(){var token=++renderToken;loading("visits","جاري تحميل سجل الزيارات…");invokeMedical().then(function(d){if(token!==renderToken)return;setActiveMain("visits");renderUnifiedVisits(d,"all");}).catch(function(){if(token===renderToken)errorView("visits","تعذر تحميل سجل الزيارات الآن.");});}

function openBookingChooser(){
  ++renderToken;setActiveMain("visits");var c=content();if(!c)return;
  c.innerHTML='<div class="portal-medical-view encounter-booking-view"><div class="unified-page-head"><div><span>حجز جديد</span><h2>اختر نوع الزيارة</h2><p>هنعرض لك الخطوات المناسبة حسب نوع الزيارة أو الخدمة.</p></div><button class="booking-back" id="back-to-unified-visits">'+icon("back")+'<span>الرجوع للزيارات</span></button></div><div class="encounter-type-grid">'+encounterTypes.map(function(t){return '<button class="encounter-type-card" data-book-encounter="'+esc(t.id)+'"><span class="encounter-type-icon">'+esc(t.icon)+'</span><b>'+esc(t.label)+'</b><small>'+encounterHelp(t.id)+'</small></button>';}).join("")+'</div></div>';
  document.getElementById("back-to-unified-visits").onclick=openVisits;
  root.querySelectorAll("[data-book-encounter]").forEach(function(b){b.onclick=function(){selectBookingType(b.getAttribute("data-book-encounter"));};});
}
function encounterHelp(id){return({checkup:"اختيار التخصص والطبيب والموعد",follow_up:"متابعة مع الطبيب حسب الخطة العلاجية",emergency:"طلب زيارة طوارئ",session:"جلسة علاج أو إجراء",lab:"خدمة معمل وتحاليل",radiology:"خدمة أشعة",home_visit:"زيارة إلى المنزل حسب التغطية المتاحة"}[id]||"");}
function selectBookingType(typeId){
  var t=encounter(typeId);sessionStorage.setItem("swnw-booking-encounter-type",typeId);
  if(typeId==="checkup"||typeId==="follow_up"){
    var oldBooking=root.querySelector('[data-extra-tab="booking"]');
    if(oldBooking){oldBooking.click();return;}
  }
  setActiveMain("visits");var c=content();if(!c)return;
  c.innerHTML='<div class="portal-medical-view encounter-booking-view"><div class="unified-page-head"><div><span>نوع الزيارة</span><h2>'+esc(t.label)+'</h2><p>تم تجهيز النوع داخل مسار الحجز الجديد.</p></div><button class="booking-back" id="back-to-booking-types">'+icon("back")+'<span>تغيير نوع الزيارة</span></button></div><div class="booking-panel deferred-booking"><div class="encounter-selected"><span>'+esc(t.icon)+'</span><div><small>النوع المختار</small><b>'+esc(t.label)+'</b></div></div><div class="booking-note">الحجز الفعلي لهذا النوع هيتفعل مع الربط المباشر بنظام المركز، بحيث نستخدم خطواته الصحيحة بدل فرض مسار الكشف العادي عليه.</div></div></div>';
  document.getElementById("back-to-booking-types").onclick=openBookingChooser;
}

function ensureBookingContext(){
  var view=root.querySelector(".booking-view");if(!view)return;
  setActiveMain("visits");
  if(view.querySelector("#unified-booking-context"))return;
  var type=encounter(sessionStorage.getItem("swnw-booking-encounter-type")||"checkup");
  var bar=document.createElement("div");bar.id="unified-booking-context";bar.className="unified-booking-context";
  bar.innerHTML='<button class="booking-back" id="unified-booking-back">'+icon("back")+'<span>الرجوع للزيارات</span></button><span class="encounter-badge type-'+esc(type.id)+'">'+esc(type.label)+'</span>';
  view.insertBefore(bar,view.firstChild);
  bar.querySelector("#unified-booking-back").onclick=openVisits;
}

function ensureFourTabs(){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  var labels={data:"البيانات",files:"الملفات"};
  Object.keys(labels).forEach(function(k){var b=tabs.querySelector('[data-profile-tab="'+k+'"] span');if(b)b.textContent=labels[k];});
  var v=tabs.querySelector('[data-extra-tab="visits"] span');if(v)v.textContent="الزيارات";
  var r=tabs.querySelector('[data-medical-tab="prescriptions"] span');if(r)r.textContent="الوصفات والأدوية";
}
function ensureFamilyMenu(){
  var menu=root.querySelector("#profile-menu");if(!menu||menu.querySelector("#menu-family"))return;
  var add=menu.querySelector("#menu-add-access");
  var b=document.createElement("button");b.id="menu-family";b.innerHTML=icon("family")+'<span>ملفات العائلة</span>';
  b.onclick=function(e){e.preventDefault();e.stopPropagation();menu.classList.remove("open");var old=root.querySelector('[data-family-tab="family"]');if(old)old.click();};
  if(add)menu.insertBefore(b,add);else menu.appendChild(b);
  var details=menu.querySelector('[data-profile-tab="data"] span');if(details)details.textContent="البيانات";
}

root.addEventListener("click",function(e){
  var dataBtn=e.target.closest('.profile-tabs [data-profile-tab="data"], #profile-menu [data-profile-tab="data"]');
  if(dataBtn){e.preventDefault();e.stopImmediatePropagation();var m=root.querySelector("#profile-menu");if(m)m.classList.remove("open");openData();return;}
  var visitsBtn=e.target.closest('.profile-tabs [data-extra-tab="visits"]');
  if(visitsBtn){e.preventDefault();e.stopImmediatePropagation();openVisits();}
},true);

function apply(){ensureFourTabs();ensureFamilyMenu();ensureBookingContext();}
apply();
new MutationObserver(function(){window.requestAnimationFrame(apply);}).observe(root,{childList:true,subtree:true});
window.SwnwPortal={openData:openData,openVisits:openVisits,openBooking:openBookingChooser};
})();
