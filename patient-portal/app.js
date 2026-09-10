(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey){root.innerHTML='<div class="notice error">تعذر تحميل إعدادات بوابة Swnw.</div>';return;}
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});

function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function arStatus(s){return({pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض",revoked:"ملغي",expired:"منتهي"}[s]||s);}
function errText(e){
  var m=String(e&&e.message||e||"");
  var map={
    DETAILS_NOT_MATCHED:"رقم الملف والبريد الإلكتروني غير متطابقين مع البيانات المسجلة بالمركز. راجع البيانات أو تواصل مع Swnw.",
    PENDING_REQUEST_EXISTS:"فيه طلب قيد المراجعة بالفعل لنفس الملف.",
    STAFF_EMAIL_NOT_ALLOWED:"بريد الموظفين لا يُستخدم كحساب مريض.",
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
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{};
  });
}
function nav(){
  return '<div class="portal-nav">'+
    '<button class="btn secondary sm" data-view="login">تسجيل الدخول</button>'+
    '<button class="btn secondary sm" data-view="request">طلب تفعيل حساب</button>'+
    '<button class="btn secondary sm" data-view="activate">عندي كود تفعيل</button>'+
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
  root.innerHTML='<div class="hero"><h1>دخول بوابة المريض</h1><p>بعد اعتماد الهوية وتفعيل الحساب، الدخول بيكون بالبريد الإلكتروني وكلمة السر بدون رسائل SMS.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    '<div class="field"><label>البريد الإلكتروني</label><input id="login-email" type="email" autocomplete="email"></div>'+
    '<div class="field"><label>كلمة السر</label><input id="login-password" type="password" autocomplete="current-password"></div>'+
    '<button class="btn" id="login-btn">دخول</button>';
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
  root.innerHTML='<div class="hero"><h1>طلب تفعيل حساب Swnw</h1><p>استخدم البريد المسجل بالفعل داخل ملف المريض. بعد مراجعة المستندات، لو الطلب اتعتمد هيوصلك كود تفعيل على نفس البريد.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    requestFormHtml()+
    '<button class="btn" id="submit-request">إرسال الطلب والمستندات</button><div id="request-msg"></div>';
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
  root.innerHTML='<div class="hero"><h1>تفعيل الحساب</h1><p>اكتب كود الـ8 أرقام اللي وصلك من Swnw بعد اعتماد المستندات، وحدد كلمة سر جديدة.</p></div>'+
    nav()+
    (message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
    '<div class="field"><label>البريد الإلكتروني</label><input id="activation-email" type="email" autocomplete="email" value="'+esc(prefillEmail||"")+'"></div>'+
    '<div class="field"><label>كود التفعيل</label><input id="activation-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="00000000"></div>'+
    '<div class="field"><label>كلمة السر الجديدة</label><input id="new-password" type="password" autocomplete="new-password" placeholder="10 أحرف على الأقل"></div>'+
    '<div class="field"><label>تأكيد كلمة السر</label><input id="confirm-password" type="password" autocomplete="new-password"></div>'+
    '<button class="btn" id="activate-btn">تفعيل الحساب</button>';
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
function renderStatus(data){
  var access=data.access||[],ver=data.verifications||[];
  var effective=access.filter(function(a){return a.effective;});
  var html='<div class="hero"><h1>بوابة المريض — Swnw</h1><p>الحساب متفعل بالبريد الإلكتروني. عرض البيانات الطبية بيخضع لصلاحية كل ملف على حدة.</p></div>';
  html+='<div class="notice ok">الحساب: '+esc(data.account&&data.account.login_email||"")+'</div>';
  if(effective.length){
    html+='<div class="notice ok">عندك وصول معتمد إلى '+effective.length+' ملف طبي. عرض الزيارات والوصفات والتقارير هي المرحلة التالية.</div>';
    html+='<div class="status-list">'+effective.map(function(a){
      var p=a.patient||{};
      return '<div class="status-card"><b>'+esc(p.full_name||"ملف طبي")+'</b><div class="meta">رقم الملف: '+esc(p.patient_code||"—")+' · الوصول: '+esc(a.relationship||a.access_type||"—")+'</div></div>';
    }).join("")+'</div>';
  }
  if(ver.length){
    html+='<hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><h3>طلبات التحقق</h3><div class="status-list">';
    ver.forEach(function(v){
      html+='<div class="status-card"><div><b>طلب '+esc(v.patient_code||"ملف طبي")+'</b> <span class="pill '+esc(v.status)+'">'+esc(arStatus(v.status))+'</span></div><div class="meta">تاريخ الطلب: '+new Date(v.submitted_at).toLocaleString("ar-EG")+(v.rejection_reason?" — السبب: "+esc(v.rejection_reason):"")+'</div></div>';
    });
    html+='</div>';
  }
  html+='<div class="actions"><button class="btn secondary" id="add-access">طلب إضافة ملف آخر</button><button class="btn secondary" id="refresh-status">تحديث</button><button class="btn danger" id="logout">خروج</button></div>';
  root.innerHTML=html;
  document.getElementById("add-access").onclick=function(){requestView();};
  document.getElementById("refresh-status").onclick=loadPortal;
  document.getElementById("logout").onclick=function(){client.auth.signOut().then(function(){loginView();});};
}
function loadPortal(){
  root.innerHTML='<div class="notice">جاري تحميل حساب Swnw…</div>';
  return invoke("patient-portal-self-service",{op:"status"}).then(renderStatus).catch(function(e){
    client.auth.signOut().finally(function(){loginView({type:"error",text:errText(e)});});
  });
}
client.auth.getSession().then(function(r){
  if(r.data&&r.data.session)loadPortal();
  else loginView();
});
})();