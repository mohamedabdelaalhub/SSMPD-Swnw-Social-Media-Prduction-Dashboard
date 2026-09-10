(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey){root.innerHTML='<div class="notice error">تعذر تحميل إعدادات بوابة Swnw.</div>';return;}
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});

function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function arStatus(s){return({pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض",revoked:"ملغي",expired:"منتهي"}[s]||s);}
function relationLabel(v){return({self:"نفسي",father:"أب",mother:"أم",legal_guardian:"وصي قانوني",spouse:"زوج/زوجة",other:"أخرى",guardian:"وصاية",authorized:"ممثل معتمد"}[v]||v||"—");}
function icon(name){
  var paths={
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    user:'<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/>',
    folder:'<path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"/>',
    shield:'<path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    mail:'<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
    logout:'<path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    refresh:'<path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.user)+'</svg>';
}
function errText(e){
  var m=String(e&&e.message||e||"");
  var map={
    DETAILS_NOT_MATCHED:"رقم الملف والبريد الإلكتروني غير متطابقين مع البيانات المسجلة بالمركز. راجع البيانات أو تواصل مع Swnw.",
    PENDING_REQUEST_EXISTS:"فيه طلب قيد المراجعة بالفعل لنفس الملف.",
    STAFF_EMAIL_NOT_ALLOWED:"بريد الموظفين لا يُستخدم كحساب مستخدم للبوابة.",
    EMAIL_ALREADY_REGISTERED_CONTACT_CENTER:"البريد مسجل في النظام بحساب آخر. تواصل مع المركز.",
    PATIENT_ACCOUNT_DISABLED:"الحساب موقوف. تواصل مع المركز.",
    INVALID_VERIFICATION_TYPE:"نوع طلب التحقق غير صحيح.",
    INVALID_RELATIONSHIP:"صفة صاحب الطلب غير صحيحة.",
    INVALID_GUARDIAN_RELATIONSHIP:"صفة ولي الأمر غير صحيحة.",
    INVALID_AUTHORIZED_RELATIONSHIP:"صفة الممثل المعتمد غير صحيحة.",
    UNSUPPORTED_FILE_TYPE:"المسموح PDF أو JPG أو PNG أو WEBP.",
    INVALID_FILE_SIZE:"حجم كل ملف لازم يكون أقل من 10 MB.",
    UPLOAD_TOKEN_EXPIRED:"انتهت مهلة رفع المستندات. أرسل الطلب من جديد.",
    UPLOAD_TOKEN_INVALID:"تعذر التحقق من جلسة رفع المستندات.",
    INVALID_ACTIVATION_CODE:"كود التفعيل غير صحيح أو انتهت صلاحيته.",
    PASSWORD_TOO_SHORT:"كلمة السر لازم تكون 10 أحرف على الأقل.",
    NO_APPROVED_MEDICAL_ACCESS:"الحساب لم يتم اعتماده بعد.",
    ALREADY_ACTIVATED:"الحساب متفعل بالفعل. ادخل بالبريد وكلمة السر.",
    PATIENT_ACCOUNT_NOT_ACTIVATED:"الحساب لم يكتمل تفعيله بعد.",
    INVALID_LOGIN_CREDENTIALS:"البريد أو كلمة السر غير صحيحة."
  };
  var key=Object.keys(map).find(function(k){return m.indexOf(k)>=0;});
  if(key)return map[key];
  if(/Invalid login credentials/i.test(m))return map.INVALID_LOGIN_CREDENTIALS;
  if(/Email not confirmed/i.test(m))return "الحساب لم يتفعل بعد. استخدم كود التفعيل المرسل بعد اعتماد المستندات.";
  return m||"حصل خطأ غير متوقع.";
}
function invoke(name,body){
  return client.functions.invoke(name,{body:body}).then(function(r){
    if(r.error){
      var ctx=r.error&&r.error.context;
      if(ctx&&typeof ctx.clone==="function"){
        return ctx.clone().json().then(function(payload){
          throw new Error(payload&&payload.error?payload.error:(r.error.message||String(r.error)));
        }).catch(function(parseErr){
          if(parseErr&&parseErr.message&&parseErr.message!=="Unexpected end of JSON input")throw parseErr;
          throw r.error;
        });
      }
      throw r.error;
    }
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{};
  });
}
function authBrand(){
  return '<div class="auth-brand"><img src="../assets/img/logo.svg" alt="Swnw"><div><b>Swnw</b><span>بوابة المستخدم</span></div></div>';
}
function nav(){
  return '<div class="portal-nav">'+
    '<button class="auth-nav-btn" data-view="login">تسجيل الدخول</button>'+
    '<button class="auth-nav-btn" data-view="request">طلب تفعيل حساب</button>'+
    '<button class="auth-nav-btn" data-view="activate">عندي كود تفعيل</button>'+
  '</div>';
}
function wireNav(){
  root.querySelectorAll("[data-view]").forEach(function(b){
    b.onclick=function(){
      var v=b.getAttribute("data-view");
      if(v==="login")loginView();
      else if(v==="request")requestView();
      else activationView();
    };
  });
}
function loginView(message){
  root.innerHTML='<div class="auth-page"><div class="auth-wrap">'+authBrand()+
    '<section class="auth-card"><div class="auth-heading"><h1>دخول بوابة المستخدم</h1><p>بعد اعتماد الهوية وتفعيل الحساب، الدخول بيكون بالبريد الإلكتروني وكلمة السر بدون رسائل SMS.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    '<div class="field"><label>البريد الإلكتروني</label><input id="login-email" type="email" autocomplete="email"></div>'+
    '<div class="field"><label>كلمة السر</label><input id="login-password" type="password" autocomplete="current-password"></div>'+
    '<button class="btn block" id="login-btn">دخول</button></section>'+
    '<div class="auth-footnote">بياناتك لا تظهر إلا بعد التحقق الرسمي واعتماد الوصول.</div></div></div>';
  wireNav();
  document.getElementById("login-btn").onclick=function(){
    var btn=this;
    var email=document.getElementById("login-email").value.trim().toLowerCase();
    var password=document.getElementById("login-password").value;
    if(!email||!password){loginView({type:"error",text:"اكتب البريد وكلمة السر."});return;}
    btn.disabled=true;btn.textContent="جاري الدخول…";
    client.auth.signInWithPassword({email:email,password:password}).then(function(r){
      if(r.error)throw r.error;
      return loadPortal();
    }).catch(function(e){loginView({type:"error",text:errText(e)});});
  };
}
function requestFormHtml(){
  return '<div class="grid">'+
    '<div class="field"><label>رقم الملف الطبي</label><input id="patient-code" placeholder="P-YYYY-000001"></div>'+
    '<div class="field"><label>البريد الإلكتروني المسجل بالمركز</label><input id="request-email" type="email" autocomplete="email" placeholder="name@example.com"></div>'+
    '<div class="field"><label>نوع الوصول</label><select id="verification-type"><option value="self_identity">ملفي الشخصي</option><option value="guardian_relationship">ابن/تابع تحت الوصاية</option><option value="authorized_representative">ممثل معتمد</option></select></div>'+
    '<div class="field"><label>الصفة</label><select id="relationship"><option value="self">نفسي</option><option value="father">أب</option><option value="mother">أم</option><option value="legal_guardian">وصي قانوني</option><option value="spouse">زوج/زوجة</option><option value="other">أخرى</option></select></div>'+
    '<div class="field"><label>نوع المستند</label><input id="document-type" placeholder="بطاقة هوية / شهادة ميلاد / مستند وصاية..."></div>'+
    '<div class="field full"><label>المستندات الرسمية</label><input id="documents" type="file" accept=".pdf,image/jpeg,image/png,image/webp" multiple></div>'+
  '</div>';
}
function requestView(message){
  root.innerHTML='<div class="auth-page"><div class="auth-wrap wide">'+authBrand()+
    '<section class="auth-card"><div class="auth-heading"><h1>طلب تفعيل حساب Swnw</h1><p>استخدم البريد المسجل بالفعل داخل الملف الطبي. بعد مراجعة المستندات واعتماد الطلب، هيوصلك كود التفعيل على نفس البريد.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    requestFormHtml()+
    '<button class="btn block" id="submit-request">إرسال الطلب والمستندات</button><div id="request-msg"></div></section></div></div>';
  wireNav();
  var t=document.getElementById("verification-type"),rel=document.getElementById("relationship");
  function sync(){
    if(t.value==="self_identity"){rel.value="self";rel.disabled=true;}
    else{rel.disabled=false;if(rel.value==="self")rel.value=t.value==="guardian_relationship"?"father":"other";}
  }
  t.onchange=sync;sync();
  document.getElementById("submit-request").onclick=function(){
    var btn=this,msg=document.getElementById("request-msg");
    var code=document.getElementById("patient-code").value.trim();
    var email=document.getElementById("request-email").value.trim().toLowerCase();
    var docType=document.getElementById("document-type").value.trim();
    var files=Array.prototype.slice.call(document.getElementById("documents").files||[]);
    if(!code||!email||!docType||!files.length){
      msg.innerHTML='<div class="notice error">رقم الملف والبريد ونوع المستند وملف واحد على الأقل مطلوبين.</div>';return;
    }
    btn.disabled=true;btn.textContent="جاري إرسال الطلب…";
    invoke("patient-portal-self-service",{
      op:"submit_request",
      patient_code:code,
      email:email,
      verification_type:t.value,
      relationship:rel.value
    }).then(function(res){
      var id=res.verification.id,token=res.upload_token;
      return files.reduce(function(p,file){
        return p.then(function(){
          var fd=new FormData();
          fd.append("verification_id",id);
          fd.append("submission_token",token);
          fd.append("document_type",docType);
          fd.append("file",file);
          return invoke("patient-verification-upload",fd);
        });
      },Promise.resolve());
    }).then(function(){
      requestView({type:"ok",text:"تم إرسال الطلب والمستندات للمراجعة. عند الاعتماد هيوصلك كود تفعيل على البريد المسجل بالمركز."});
    }).catch(function(e){
      msg.innerHTML='<div class="notice error">'+esc(errText(e))+'</div>';
      btn.disabled=false;btn.textContent="إرسال الطلب والمستندات";
    });
  };
}
function activationView(message,prefillEmail){
  root.innerHTML='<div class="auth-page"><div class="auth-wrap">'+authBrand()+
    '<section class="auth-card"><div class="auth-heading"><h1>تفعيل الحساب</h1><p>اكتب كود الـ8 أرقام اللي وصلك من Swnw بعد اعتماد المستندات، وحدد كلمة سر جديدة.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    '<div class="field"><label>البريد الإلكتروني</label><input id="activation-email" type="email" autocomplete="email" value="'+esc(prefillEmail||"")+'"></div>'+
    '<div class="field"><label>كود التفعيل</label><input id="activation-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="00000000"></div>'+
    '<div class="field"><label>كلمة السر الجديدة</label><input id="new-password" type="password" autocomplete="new-password" placeholder="10 أحرف على الأقل"></div>'+
    '<div class="field"><label>تأكيد كلمة السر</label><input id="confirm-password" type="password" autocomplete="new-password"></div>'+
    '<button class="btn block" id="activate-btn">تفعيل الحساب</button></section></div></div>';
  wireNav();
  document.getElementById("activate-btn").onclick=function(){
    var btn=this;
    var email=document.getElementById("activation-email").value.trim().toLowerCase();
    var code=document.getElementById("activation-code").value.replace(/\D/g,"");
    var password=document.getElementById("new-password").value;
    var confirmPassword=document.getElementById("confirm-password").value;
    if(password!==confirmPassword){activationView({type:"error",text:"كلمتا السر غير متطابقتين."},email);return;}
    if(password.length<10){activationView({type:"error",text:"كلمة السر لازم تكون 10 أحرف على الأقل."},email);return;}
    btn.disabled=true;btn.textContent="جاري التفعيل…";
    invoke("patient-portal-self-service",{op:"activate",email:email,code:code,new_password:password})
      .then(function(){return client.auth.signInWithPassword({email:email,password:password});})
      .then(function(r){if(r.error)throw r.error;return loadPortal();})
      .catch(function(e){activationView({type:"error",text:errText(e)},email);});
  };
}

function renderStatus(data,activeTab){
  activeTab=activeTab||"data";
  var access=data.access||[];
  var effective=access.filter(function(a){return a.effective;});
  var primary=effective.filter(function(a){return a.relationship==="self"||a.access_type==="self";})[0]||effective[0]||null;
  var p=primary&&primary.patient||{};
  var displayName=p.full_name||"مستخدم Swnw";
  var email=data.account&&data.account.login_email||"—";
  var patientCode=p.patient_code||"—";
  var rel=primary?relationLabel(primary.relationship||primary.access_type):"—";
  var verified=!!(primary&&primary.effective);

  var html='<div class="app-shell">'+
    '<header class="app-topbar">'+
      '<div class="top-brand"><img src="../assets/img/logo.svg" alt="Swnw"><div><b>بوابة Swnw</b><span>ملف المستخدم</span></div></div>'+
      '<div class="user-area">'+
        '<button class="user-menu-button" id="profile-menu-btn" aria-expanded="false">'+
          '<span class="avatar small">'+icon("user")+'</span>'+
          '<span class="user-copy"><b>'+esc(displayName)+'</b><small>مستخدم</small></span>'+
          '<span class="menu-glyph">'+icon("menu")+'</span>'+
        '</button>'+
        '<div class="profile-menu" id="profile-menu">'+
          '<button data-profile-tab="data">'+icon("user")+'<span>تفاصيل البروفايل</span></button>'+
          '<button data-profile-tab="files">'+icon("folder")+'<span>الملفات</span></button>'+
          '<button id="menu-add-access">'+icon("plus")+'<span>طلب إضافة ملف</span></button>'+
          '<div class="menu-separator"></div>'+
          '<button class="danger-link" id="menu-logout">'+icon("logout")+'<span>خروج</span></button>'+
        '</div>'+
      '</div>'+
      '<button class="top-logout" id="top-logout">'+icon("logout")+'<span>خروج</span></button>'+
    '</header>'+

    '<section class="profile-hero">'+
      '<div class="hero-avatar avatar">'+icon("user")+'</div>'+
      '<div class="hero-copy"><span class="welcome">مرحبًا بك</span><h1>'+esc(displayName)+'</h1><p>في بوابة Swnw للخدمات والملفات الطبية</p></div>'+
      '<div class="hero-message"><strong>رعاية أدق</strong><span>لحياة أفضل</span></div>'+
    '</section>'+

    '<nav class="profile-tabs" aria-label="أقسام الملف">'+
      '<button class="'+(activeTab==="data"?"active":"")+'" data-profile-tab="data">'+icon("user")+'<span>البيانات</span></button>'+
      '<button class="'+(activeTab==="files"?"active":"")+'" data-profile-tab="files">'+icon("folder")+'<span>الملفات</span></button>'+
    '</nav>'+

    '<section class="profile-content" id="profile-content">';

  if(activeTab==="data"){
    html+='<aside class="info-card">'+
      '<span class="info-icon">'+icon("shield")+'</span>'+
      '<h3>معلومات حسابك</h3>'+
      '<p>راجع بيانات الحساب والملفات المرتبطة به من مكان واحد.</p>'+
      '<div class="mini-stat"><b>'+effective.length+'</b><span>ملف معتمد</span></div>'+
    '</aside>'+
    '<div class="details-card">'+
      '<div class="section-heading"><span class="heading-icon">'+icon("user")+'</span><div><h2>البيانات الشخصية</h2><p>معلومات الحساب المسجلة في بوابة Swnw.</p></div></div>'+
      '<div class="details-grid">'+
        '<div class="detail-item"><span class="detail-icon">'+icon("user")+'</span><div><label>الاسم الكامل</label><b>'+esc(displayName)+'</b></div></div>'+
        '<div class="detail-item"><span class="detail-icon">'+icon("mail")+'</span><div><label>البريد الإلكتروني</label><b class="ltr">'+esc(email)+'</b></div></div>'+
        '<div class="detail-item"><span class="detail-icon">'+icon("folder")+'</span><div><label>رقم الملف</label><b class="ltr">'+esc(patientCode)+'</b></div></div>'+
        '<div class="detail-item"><span class="detail-icon">'+icon("shield")+'</span><div><label>نوع الوصول</label><b>'+esc(rel)+'</b></div></div>'+
        '<div class="detail-item wide"><span class="detail-icon">'+icon("check")+'</span><div><label>حالة الوصول</label><span class="access-pill '+(verified?"approved":"pending")+'">'+(verified?"معتمد":"قيد المراجعة")+'</span></div></div>'+
      '</div>'+
    '</div>';
  }else{
    html+='<div class="files-card">'+
      '<div class="files-head"><div class="section-heading"><span class="heading-icon">'+icon("folder")+'</span><div><h2>الملفات المرتبطة</h2><p>الملفات الطبية المعتمدة والمرتبطة بالحساب.</p></div></div><button class="btn secondary compact" id="files-add-access">'+icon("plus")+'<span>طلب إضافة ملف</span></button></div>';

    if(effective.length){
      html+='<div class="linked-files-grid">'+effective.map(function(a){
        var fp=a.patient||{};
        return '<article class="linked-file">'+
          '<div class="file-icon">'+icon("folder")+'</div>'+
          '<div class="file-copy"><h3>'+esc(fp.full_name||"ملف طبي")+'</h3><p class="ltr">'+esc(fp.patient_code||"—")+'</p><span>'+esc(relationLabel(a.relationship||a.access_type))+'</span></div>'+
          '<span class="access-pill approved">معتمد</span>'+
        '</article>';
      }).join("")+'</div>';
    }else{
      html+='<div class="empty-state">'+icon("folder")+'<h3>لا توجد ملفات معتمدة بعد</h3><p>بعد اعتماد طلب الوصول هيظهر الملف هنا تلقائيًا.</p></div>';
    }
    html+='</div>';
  }

  html+='</section></div>';
  root.innerHTML=html;

  var menuBtn=document.getElementById("profile-menu-btn");
  var menu=document.getElementById("profile-menu");
  function closeMenu(){menu.classList.remove("open");menuBtn.setAttribute("aria-expanded","false");}
  menuBtn.onclick=function(e){e.stopPropagation();var open=menu.classList.toggle("open");menuBtn.setAttribute("aria-expanded",open?"true":"false");};
  document.addEventListener("click",closeMenu,{once:true});

  root.querySelectorAll("[data-profile-tab]").forEach(function(b){
    b.onclick=function(e){e.stopPropagation();closeMenu();renderStatus(data,b.getAttribute("data-profile-tab"));};
  });

  function logout(){client.auth.signOut().then(function(){loginView();});}
  document.getElementById("top-logout").onclick=logout;
  document.getElementById("menu-logout").onclick=logout;
  document.getElementById("menu-add-access").onclick=function(){requestView();};
  var addFromFiles=document.getElementById("files-add-access");
  if(addFromFiles)addFromFiles.onclick=function(){requestView();};
}

function loadPortal(){
  root.innerHTML='<div class="loading-page"><div class="loading-logo"><img src="../assets/img/logo.svg" alt="Swnw"></div><div class="loading-line"></div><p>جاري تحميل حسابك…</p></div>';
  return invoke("patient-portal-self-service",{op:"status"}).then(function(data){renderStatus(data,"data");}).catch(function(e){
    client.auth.signOut().finally(function(){loginView({type:"error",text:errText(e)});});
  });
}
client.auth.getSession().then(function(r){
  if(r.data&&r.data.session)loadPortal();
  else loginView();
});
})();