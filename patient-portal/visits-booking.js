(function(){
"use strict";

var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root||!window.supabase)return;

var client=window.supabase.createClient(cfg.url,cfg.anonKey,{
  auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}
});
var medicalCache=null,medicalCacheAt=0;
var bookingState={catalog:null,patientId:"",specialtyId:"",doctorId:"",date:"",time:""};

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function val(v){return v===null||typeof v==="undefined"||String(v).trim()===""?"—":esc(v);}
function fmtDate(v){
  if(!v)return "—";
  var d=new Date(String(v).length===10?v+"T00:00:00":v);
  if(isNaN(d.getTime()))return esc(v);
  return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);
}
function icon(name){
  var p={
    visits:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    booking:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M12 13v4M10 15h4"/>',
    doctor:'<path d="M9 3v4a3 3 0 0 0 6 0V3"/><path d="M6 4h3M15 4h3"/><path d="M12 10v2a5 5 0 0 0 5 5h1"/><circle cx="19" cy="17" r="2"/>',
    back:'<path d="m15 18-6-6 6-6"/><path d="M9 12h11"/>',
    check:'<path d="m5 12 4 4L19 6"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[name]||p.visits)+'</svg>';
}
function content(){return root.querySelector(".profile-content");}
function setActive(key){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  tabs.querySelectorAll("button").forEach(function(b){
    b.classList.toggle("active",b.getAttribute("data-extra-tab")===key);
  });
}
function loading(text){
  var c=content();if(!c)return;
  c.innerHTML='<div class="portal-medical-view medical-loading"><div><span class="spinner"></span><p>'+esc(text||"جاري التحميل…")+'</p></div></div>';
}
function errorView(message){
  var c=content();if(!c)return;
  c.innerHTML='<div class="portal-medical-view portal-medical-error"><div class="notice error">'+esc(message||"تعذر تحميل البيانات الآن.")+'</div></div>';
}
function invokeMedical(){
  if(medicalCache&&Date.now()-medicalCacheAt<30000)return Promise.resolve(medicalCache);
  return client.functions.invoke("patient-portal-medical-data",{body:{op:"overview"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    medicalCache=r.data||{records:[]};medicalCacheAt=Date.now();return medicalCache;
  });
}
function invokeBooking(body){
  return client.functions.invoke("patient-portal-booking",{body:body}).then(function(r){
    if(r.error){
      var ctx=r.error&&r.error.context;
      if(ctx&&typeof ctx.clone==="function"){
        return ctx.clone().json().then(function(x){throw new Error(x&&x.error?x.error:(r.error.message||"تعذر تنفيذ الطلب."));});
      }
      throw r.error;
    }
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{};
  });
}

function cleanHealthContext(){
  root.querySelectorAll(".health-item label").forEach(function(label){
    var text=(label.textContent||"").trim();
    if(text==="الطبيب المعالج"||text==="التخصص"){
      var item=label.closest(".health-item");if(item)item.remove();
    }
  });
}

function ensureTabs(){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;

  if(!tabs.querySelector('[data-extra-tab="visits"]')){
    var visits=document.createElement("button");
    visits.className="medical-tab";
    visits.setAttribute("data-extra-tab","visits");
    visits.innerHTML=icon("visits")+'<span>الزيارات</span>';
    var rx=tabs.querySelector('[data-medical-tab="prescriptions"]');
    if(rx)tabs.insertBefore(visits,rx);else tabs.appendChild(visits);
    visits.onclick=function(e){e.preventDefault();e.stopPropagation();openVisits();};
  }

  if(!tabs.querySelector('[data-extra-tab="booking"]')){
    var book=document.createElement("button");
    book.className="medical-tab booking-tab";
    book.setAttribute("data-extra-tab","booking");
    book.innerHTML=icon("booking")+'<span>حجز زيارة جديدة</span>';
    tabs.appendChild(book);
    book.onclick=function(e){e.preventDefault();e.stopPropagation();openBooking();};
  }
}

function visitVital(label,value){
  if(value===null||typeof value==="undefined"||String(value).trim()==="")return "";
  return '<span class="visit-vital"><small>'+esc(label)+'</small><b>'+esc(value)+'</b></span>';
}
function visitBlock(label,value){
  if(value===null||typeof value==="undefined"||String(value).trim()==="")return "";
  return '<div class="visit-block"><label>'+esc(label)+'</label><p>'+esc(value)+'</p></div>';
}
function renderVisits(data){
  var c=content();if(!c)return;
  var recs=data.records||[];
  if(!recs.length){c.innerHTML='<div class="portal-medical-view medical-empty">لا توجد سجلات طبية معتمدة على الحساب.</div>';return;}

  c.innerHTML='<div class="portal-medical-view medical-records">'+recs.map(function(r){
    var p=r.patient||{},visits=r.visits||[];
    var head='<div class="medical-record-head"><div class="medical-record-title"><h2>'+val(p.full_name)+'</h2><p>'+val(p.patient_code)+'</p></div><span class="medical-record-badge">'+visits.length+' زيارة</span></div>';
    if(!visits.length)return '<article class="medical-record-card">'+head+'<div class="medical-section"><div class="medical-empty">لا توجد زيارات طبية مسجلة حتى الآن.</div></div></article>';

    return '<article class="medical-record-card">'+head+'<div class="medical-section"><div class="visits-list">'+visits.map(function(v){
      var doctor=v.doctor_name||"الطبيب غير مسجل";
      var specialty=v.specialty||"التخصص غير مسجل";
      var vitals=[
        visitVital("الضغط",v.blood_pressure),
        visitVital("السكر",v.blood_sugar),
        visitVital("النبض",v.pulse)
      ].join("");
      return '<section class="visit-card">'+
        '<div class="visit-card-top"><div><span class="visit-date">'+fmtDate(v.visit_date)+'</span><h3>'+esc(doctor)+'</h3><p>'+esc(specialty)+(v.visit_number?' • زيارة رقم '+esc(v.visit_number):'')+'</p></div><span class="visit-doctor-icon">'+icon("doctor")+'</span></div>'+
        (vitals?'<div class="visit-vitals">'+vitals+'</div>':'')+
        visitBlock("الشكوى",v.complaint)+
        visitBlock("الأدوية",v.medications)+
        visitBlock("الأشعة المطلوبة",v.xrays)+
        visitBlock("التحاليل المطلوبة",v.labs)+
        visitBlock("توصيات أخرى",v.other_recommendations)+
        (v.follow_up_date?'<div class="visit-followup"><b>موعد المتابعة</b><span>'+fmtDate(v.follow_up_date)+'</span></div>':'')+
      '</section>';
    }).join("")+'</div></div></article>';
  }).join("")+'</div>';
}

function openVisits(){
  setActive("visits");loading("جاري تحميل سجل الزيارات…");
  invokeMedical().then(renderVisits).catch(function(e){console.error(e);errorView("تعذر تحميل سجل الزيارات الآن.");});
}

function getCatalog(force){
  if(bookingState.catalog&&!force)return Promise.resolve(bookingState.catalog);
  return invokeBooking({op:"catalog"}).then(function(data){bookingState.catalog=data;return data;});
}
function resetAfter(level){
  if(level==="patient"){bookingState.specialtyId="";bookingState.doctorId="";bookingState.date="";bookingState.time="";}
  if(level==="specialty"){bookingState.doctorId="";bookingState.date="";bookingState.time="";}
  if(level==="doctor"){bookingState.date="";bookingState.time="";}
  if(level==="date"){bookingState.time="";}
}
function option(value,label,selected){return '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';}
function bookingShell(inner){
  var c=content();if(!c)return;
  c.innerHTML='<div class="portal-medical-view booking-view"><div class="booking-head"><div><span class="booking-kicker">حجز مباشر من نظام المركز</span><h2>حجز زيارة جديدة</h2><p>اختار التخصص والطبيب، وبعدها هنظهر لك الأيام والمواعيد المتاحة فقط.</p></div></div>'+inner+'</div>';
}
function bookingErrorText(e){
  var m=String(e&&e.message||e||"");
  var map={
    BOOKING_BRIDGE_NOT_CONFIGURED:"الربط المباشر مع نظام الحجز الرسمي لسه محتاج تفعيل.",
    NO_APPROVED_MEDICAL_ACCESS:"الحساب لا يملك صلاحية معتمدة لهذا الملف.",
    DOCTOR_NOT_BOOKING_READY:"الطبيب غير متاح للحجز الإلكتروني حاليًا.",
    PATIENT_PHONE_REQUIRED:"رقم الهاتف غير مسجل في الملف. راجع بياناتك مع الاستقبال أولًا.",
    SLOT_NO_LONGER_AVAILABLE:"الموعد اتاخد قبل التأكيد. اختار موعدًا آخر.",
    BOOKING_CONFIRMATION_INVALID:"تعذر تأكيد الحجز من النظام الرسمي.",
    BOOKING_READBACK_MISMATCH:"تعذر التحقق من الحجز بعد إنشائه."
  };
  var key=Object.keys(map).find(function(k){return m.indexOf(k)>=0;});
  return key?map[key]:"تعذر تنفيذ الحجز الآن. حاول مرة أخرى.";
}

function renderBookingStart(cat){
  var patients=cat.patients||[],specs=cat.specialties||[];
  if(!patients.length){bookingShell('<div class="medical-empty">لا يوجد ملف طبي معتمد للحجز.</div>');return;}
  if(!bookingState.patientId)bookingState.patientId=patients[0].id;
  var patientSelect=patients.length>1
    ? '<div class="booking-field"><label>الحجز لـ</label><select id="book-patient">'+patients.map(function(p){return option(p.id,p.full_name+" — "+p.patient_code,p.id===bookingState.patientId);}).join("")+'</select></div>'
    : '<div class="booking-patient-chip"><span>الحجز لـ</span><b>'+esc(patients[0].full_name)+'</b><small>'+esc(patients[0].patient_code)+'</small></div>';

  bookingShell('<div class="booking-panel">'+patientSelect+
    '<div class="booking-field"><label>التخصص</label><select id="book-specialty"><option value="">اختر التخصص</option>'+specs.map(function(s){return option(s.specialty_id,s.specialty_name_ar,s.specialty_id===bookingState.specialtyId);}).join("")+'</select></div>'+
    '<button class="btn block" id="booking-next-specialty"'+(!bookingState.specialtyId?' disabled':'')+'>اختيار الطبيب</button>'+
    (!cat.bridge_ready?'<div class="booking-note">يمكنك تصفح التخصصات والأطباء الآن، والحجز المباشر سيتفعل بعد ربط الـBooking Bridge.</div>':'')+
    '</div>');

  var ps=document.getElementById("book-patient");
  if(ps)ps.onchange=function(){bookingState.patientId=this.value;resetAfter("patient");renderBookingStart(cat);};
  var ss=document.getElementById("book-specialty");
  ss.onchange=function(){bookingState.specialtyId=this.value;resetAfter("specialty");document.getElementById("booking-next-specialty").disabled=!this.value;};
  document.getElementById("booking-next-specialty").onclick=function(){renderDoctors(cat);};
}

function renderDoctors(cat){
  var doctors=(cat.doctors||[]).filter(function(d){return d.specialty_id===bookingState.specialtyId;});
  var spec=(cat.specialties||[]).find(function(s){return s.specialty_id===bookingState.specialtyId;});
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-book-start">'+icon("back")+'<span>رجوع للتخصصات</span></button>'+
    '<div class="booking-step-title"><span>التخصص</span><h3>'+esc(spec?spec.specialty_name_ar:"")+'</h3></div>'+
    '<div class="doctor-grid">'+doctors.map(function(d){
      var price=d.consultation_price!=null?'<span class="doctor-price">'+esc(d.consultation_price)+' '+esc(d.currency||"EGP")+'</span>':"";
      return '<button class="doctor-choice'+(bookingState.doctorId===d.doctor_id?' selected':'')+'" data-doctor="'+esc(d.doctor_id)+'"><span class="doctor-choice-icon">'+icon("doctor")+'</span><span class="doctor-choice-copy"><b>د/ '+esc(d.doctor_name_ar)+'</b><small>'+esc(d.specialty_name_ar)+'</small>'+price+'</span></button>';
    }).join("")+'</div></div>');
  document.getElementById("back-book-start").onclick=function(){renderBookingStart(cat);};
  root.querySelectorAll("[data-doctor]").forEach(function(btn){
    btn.onclick=function(){bookingState.doctorId=btn.getAttribute("data-doctor");resetAfter("doctor");loadDates(cat);};
  });
}

function loadDates(cat){
  var doctor=(cat.doctors||[]).find(function(d){return d.doctor_id===bookingState.doctorId;});
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-doctors">'+icon("back")+'<span>رجوع للأطباء</span></button><div class="booking-step-title"><span>الطبيب</span><h3>د/ '+esc(doctor?doctor.doctor_name_ar:"")+'</h3></div><div class="booking-loading"><span class="spinner"></span><p>جاري تحميل الأيام المتاحة من نظام الحجز…</p></div></div>');
  document.getElementById("back-doctors").onclick=function(){renderDoctors(cat);};
  invokeBooking({op:"availability",patient_id:bookingState.patientId,doctor_id:bookingState.doctorId}).then(function(data){renderDates(cat,data.dates||[]);}).catch(function(e){
    bookingShell('<div class="booking-panel"><button class="booking-back" id="back-doctors">'+icon("back")+'<span>رجوع للأطباء</span></button><div class="notice error">'+esc(bookingErrorText(e))+'</div></div>');
    document.getElementById("back-doctors").onclick=function(){renderDoctors(cat);};
  });
}
function renderDates(cat,dates){
  var doctor=(cat.doctors||[]).find(function(d){return d.doctor_id===bookingState.doctorId;});
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-doctors">'+icon("back")+'<span>رجوع للأطباء</span></button><div class="booking-step-title"><span>اختار اليوم المتاح</span><h3>د/ '+esc(doctor?doctor.doctor_name_ar:"")+'</h3></div>'+
    (dates.length?'<div class="slot-grid dates">'+dates.map(function(d){return '<button class="slot-choice" data-date="'+esc(d)+'"><b>'+fmtDate(d)+'</b></button>';}).join("")+'</div>':'<div class="medical-empty">لا توجد أيام متاحة حاليًا لهذا الطبيب.</div>')+
    '</div>');
  document.getElementById("back-doctors").onclick=function(){renderDoctors(cat);};
  root.querySelectorAll("[data-date]").forEach(function(btn){btn.onclick=function(){bookingState.date=btn.getAttribute("data-date");resetAfter("date");loadTimes(cat);};});
}
function loadTimes(cat){
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-dates">'+icon("back")+'<span>رجوع للأيام</span></button><div class="booking-step-title"><span>اليوم المختار</span><h3>'+fmtDate(bookingState.date)+'</h3></div><div class="booking-loading"><span class="spinner"></span><p>جاري تحميل المواعيد المتاحة فقط…</p></div></div>');
  document.getElementById("back-dates").onclick=function(){loadDates(cat);};
  invokeBooking({op:"availability",patient_id:bookingState.patientId,doctor_id:bookingState.doctorId,date:bookingState.date}).then(function(data){renderTimes(cat,data.times||[]);}).catch(function(e){
    bookingShell('<div class="booking-panel"><button class="booking-back" id="back-dates">'+icon("back")+'<span>رجوع للأيام</span></button><div class="notice error">'+esc(bookingErrorText(e))+'</div></div>');
    document.getElementById("back-dates").onclick=function(){loadDates(cat);};
  });
}
function renderTimes(cat,times){
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-dates">'+icon("back")+'<span>رجوع للأيام</span></button><div class="booking-step-title"><span>المواعيد المتاحة</span><h3>'+fmtDate(bookingState.date)+'</h3></div>'+
    (times.length?'<div class="slot-grid times">'+times.map(function(t){return '<button class="slot-choice" data-time="'+esc(t)+'"><b>'+esc(t)+'</b></button>';}).join("")+'</div>':'<div class="medical-empty">لا توجد مواعيد متاحة في هذا اليوم.</div>')+
    '</div>');
  document.getElementById("back-dates").onclick=function(){loadDates(cat);};
  root.querySelectorAll("[data-time]").forEach(function(btn){btn.onclick=function(){bookingState.time=btn.getAttribute("data-time");renderReview(cat);};});
}
function renderReview(cat){
  var patient=(cat.patients||[]).find(function(x){return x.id===bookingState.patientId;});
  var doctor=(cat.doctors||[]).find(function(x){return x.doctor_id===bookingState.doctorId;});
  bookingShell('<div class="booking-panel"><button class="booking-back" id="back-times">'+icon("back")+'<span>رجوع للمواعيد</span></button><div class="booking-step-title"><span>مراجعة الحجز</span><h3>تأكد من البيانات قبل التأكيد</h3></div>'+
    '<div class="booking-review"><div><label>المستخدم</label><b>'+esc(patient?patient.full_name:"")+'</b></div><div><label>التخصص</label><b>'+esc(doctor?doctor.specialty_name_ar:"")+'</b></div><div><label>الطبيب</label><b>د/ '+esc(doctor?doctor.doctor_name_ar:"")+'</b></div><div><label>اليوم</label><b>'+fmtDate(bookingState.date)+'</b></div><div><label>الوقت</label><b>'+esc(bookingState.time)+'</b></div><div><label>سعر الكشف</label><b>'+(doctor&&doctor.consultation_price!=null?esc(doctor.consultation_price)+" "+esc(doctor.currency||"EGP"):"—")+'</b></div></div>'+
    '<button class="btn block" id="confirm-booking">تأكيد الحجز</button><div id="booking-message"></div></div>');
  document.getElementById("back-times").onclick=function(){loadTimes(cat);};
  document.getElementById("confirm-booking").onclick=function(){
    var btn=this,msg=document.getElementById("booking-message");btn.disabled=true;btn.textContent="جاري تأكيد الحجز…";
    invokeBooking({op:"book",patient_id:bookingState.patientId,doctor_id:bookingState.doctorId,date:bookingState.date,time:bookingState.time}).then(function(res){
      bookingShell('<div class="booking-panel booking-success"><span class="success-icon">'+icon("check")+'</span><h3>تم تأكيد الحجز</h3><p>رقم الحجز الرسمي: <b class="ltr">'+esc(res.official_booking_id||"—")+'</b></p><div class="booking-review compact"><div><label>الطبيب</label><b>د/ '+esc(res.doctor&&res.doctor.doctor_name_ar||"")+'</b></div><div><label>التخصص</label><b>'+esc(res.specialty&&res.specialty.specialty_name_ar||"")+'</b></div><div><label>الموعد</label><b>'+fmtDate(res.date)+' • '+esc(res.time||"")+'</b></div></div><button class="btn block secondary" id="new-booking">حجز زيارة أخرى</button></div>');
      document.getElementById("new-booking").onclick=function(){bookingState.specialtyId="";bookingState.doctorId="";bookingState.date="";bookingState.time="";renderBookingStart(cat);};
    }).catch(function(e){msg.innerHTML='<div class="notice error">'+esc(bookingErrorText(e))+'</div>';btn.disabled=false;btn.textContent="تأكيد الحجز";});
  };
}
function openBooking(){
  setActive("booking");loading("جاري تجهيز شاشة الحجز…");
  getCatalog(false).then(renderBookingStart).catch(function(e){console.error(e);errorView(bookingErrorText(e));});
}

function apply(){ensureTabs();cleanHealthContext();}
apply();
new MutationObserver(function(){window.requestAnimationFrame(apply);}).observe(root,{childList:true,subtree:true});
})();