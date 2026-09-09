(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey){root.innerHTML='<div class="notice error">تعذر تحميل إعدادات بوابة Swnw.</div>';return;}
var client=window.supabase.createClient(cfg.url,cfg.anonKey);
var activePhone="";
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function arStatus(s){return({pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض",revoked:"ملغي",expired:"منتهي"}[s]||s);}
function errText(e){var m=String(e&&e.message||e||"");var map={PHONE_NOT_VERIFIED:"رقم الموبايل لسه مش متحقق.",PATIENT_CODE_REQUIRED:"اكتب رقم الملف الطبي.",PATIENT_NOT_FOUND:"رقم الملف غير موجود. راجع الرقم أو تواصل مع المركز.",PENDING_REQUEST_EXISTS:"فيه طلب قيد المراجعة بالفعل لنفس الملف.",STAFF_ACCOUNT_NOT_ALLOWED:"حساب الموظف لا يُستخدم كبوابة مريض. استخدم حساب مريض منفصل.",PATIENT_ACCOUNT_DISABLED:"حساب بوابة المريض موقوف.",UNSUPPORTED_FILE_TYPE:"المسموح PDF أو JPG أو PNG أو WEBP.",INVALID_FILE_SIZE:"حجم كل ملف لازم يكون أقل من 10 MB."};return map[m]||m||"حصل خطأ غير متوقع.";}
function invoke(name,body){return client.functions.invoke(name,{body:body}).then(function(r){if(r.error)throw r.error;if(r.data&&r.data.error)throw new Error(r.data.error);return r.data;});}
function normalizePhone(v){var s=String(v||"").replace(/[\s\-()]/g,"");if(/^01[0125]\d{8}$/.test(s))return "+2"+s;if(/^1[0125]\d{8}$/.test(s))return "+20"+s;if(/^0020/.test(s))return "+"+s.slice(2);return s.charAt(0)==="+"?s:"+"+s.replace(/^0+/,"");}
function authView(message){
root.innerHTML='<div class="hero"><h1>ملفك الطبي معاك في Swnw</h1><p>ادخل برقم الموبايل. كود OTP يثبت ملكية الرقم فقط، وبعده لازم تحقق رسمي قبل فتح أي ملف طبي.</p></div>'+
(message?'<div class="notice '+(message.type||"")+'">'+esc(message.text)+'</div>':"")+
'<div class="field"><label>رقم الموبايل</label><input id="phone" inputmode="tel" placeholder="+20 10xxxxxxxx"></div>'+
'<button class="btn" id="send-otp">إرسال كود التحقق</button>';
document.getElementById("send-otp").onclick=function(){
var phone=normalizePhone(document.getElementById("phone").value);
if(phone.length<8){authView({type:"error",text:"اكتب رقم موبايل صحيح."});return;}
activePhone=phone;
client.auth.signInWithOtp({phone:phone,options:{shouldCreateUser:true}}).then(function(r){
if(r.error)throw r.error;otpView(phone);
}).catch(function(e){authView({type:"error",text:errText(e)});});
};
}
function otpView(phone,message){
root.innerHTML='<div class="hero"><h1>اكتب كود OTP</h1><p>بعتنا الكود للرقم '+esc(phone)+'.</p></div>'+
(message?'<div class="notice error">'+esc(message)+'</div>':"")+
'<div class="field"><label>كود التحقق</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></div>'+
'<div class="actions"><button class="btn" id="verify-otp">تأكيد</button><button class="btn secondary" id="back-phone">تغيير الرقم</button></div>';
document.getElementById("back-phone").onclick=function(){authView();};
document.getElementById("verify-otp").onclick=function(){
var token=document.getElementById("otp").value.trim();
client.auth.verifyOtp({phone:phone,token:token,type:"sms"}).then(function(r){if(r.error)throw r.error;return loadPortal();}).catch(function(e){otpView(phone,errText(e));});
};
}
function requestHtml(){
return '<div class="hero"><h1>طلب الوصول لملف طبي</h1><p>الوصول لا يتم بمجرد تطابق رقم الموبايل. ارفع مستندًا رسميًا يثبت هويتك أو صفتك، والطلب يراجعه موظف مخول.</p></div>'+
'<div class="grid">'+
'<div class="field"><label>رقم الملف الطبي</label><input id="patient-code" placeholder="P-YYYY-000001"></div>'+
'<div class="field"><label>نوع الوصول</label><select id="verification-type"><option value="self_identity">ملفي الشخصي</option><option value="guardian_relationship">ابن/تابع تحت الوصاية</option><option value="authorized_representative">ممثل معتمد</option></select></div>'+
'<div class="field"><label>الصفة</label><select id="relationship"><option value="self">نفسي</option><option value="father">أب</option><option value="mother">أم</option><option value="legal_guardian">وصي قانوني</option><option value="spouse">زوج/زوجة</option><option value="other">أخرى</option></select></div>'+
'<div class="field"><label>نوع المستند</label><input id="document-type" placeholder="بطاقة هوية / شهادة ميلاد / مستند وصاية..."></div>'+
'<div class="field full"><label>المستندات الرسمية</label><input id="documents" type="file" accept=".pdf,image/jpeg,image/png,image/webp" multiple></div>'+
'</div><div class="actions"><button class="btn" id="submit-request">إرسال للمراجعة</button></div><div id="request-msg"></div>';
}
function renderStatus(data){
var access=(data.access||[]),ver=(data.verifications||[]);
var effective=access.filter(function(a){return a.effective;});
var html='<div class="hero"><h1>بوابة المريض — Swnw</h1><p>حسابك متحقق برقم الموبايل. الملفات الطبية لا تُفتح إلا بعد الاعتماد الرسمي.</p></div>';
if(effective.length){
html+='<div class="notice ok">تم اعتماد الوصول إلى '+effective.length+' ملف طبي. عرض الزيارات والوصفات والتقارير هي المرحلة التالية.</div>';
}
html+='<div class="status-list">';
ver.forEach(function(v){html+='<div class="status-card"><div><b>طلب '+esc(v.patient_code||"ملف طبي")+'</b> <span class="pill '+esc(v.status)+'">'+esc(arStatus(v.status))+'</span></div><div class="meta">تاريخ الطلب: '+new Date(v.submitted_at).toLocaleString("ar-EG")+(v.rejection_reason?" — السبب: "+esc(v.rejection_reason):"")+'</div></div>';});
html+='</div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0">'+requestHtml()+'<div class="actions"><button class="btn secondary" id="refresh-status">تحديث الحالة</button><button class="btn secondary" id="logout">خروج</button></div>';
root.innerHTML=html;
wireRequest();
document.getElementById("refresh-status").onclick=loadPortal;
document.getElementById("logout").onclick=function(){client.auth.signOut().then(function(){authView();});};
}
function wireRequest(){
var t=document.getElementById("verification-type"),rel=document.getElementById("relationship");
function sync(){if(t.value==="self_identity"){rel.value="self";rel.disabled=true;}else{rel.disabled=false;if(rel.value==="self")rel.value=t.value==="guardian_relationship"?"father":"other";}}
t.onchange=sync;sync();
document.getElementById("submit-request").onclick=function(){
var btn=this,msg=document.getElementById("request-msg"),files=Array.prototype.slice.call(document.getElementById("documents").files||[]);
var code=document.getElementById("patient-code").value.trim(),docType=document.getElementById("document-type").value.trim();
if(!code||!docType||!files.length){msg.innerHTML='<div class="notice error">رقم الملف ونوع المستند وملف واحد على الأقل مطلوبين.</div>';return;}
btn.disabled=true;btn.textContent="بيتم الإرسال…";
invoke("patient-portal-self-service",{op:"submit_verification",patient_code:code,verification_type:t.value,relationship:rel.value}).then(function(res){
var id=res.verification.id;
return files.reduce(function(p,file){return p.then(function(){var fd=new FormData();fd.append("verification_id",id);fd.append("document_type",docType);fd.append("file",file);return invoke("patient-verification-upload",fd);});},Promise.resolve());
}).then(function(){msg.innerHTML='<div class="notice ok">تم إرسال الطلب والمستندات للمراجعة.</div>';setTimeout(loadPortal,700);}).catch(function(e){msg.innerHTML='<div class="notice error">'+esc(errText(e))+'</div>';}).finally(function(){btn.disabled=false;btn.textContent="إرسال للمراجعة";});
};
}
function loadPortal(){root.innerHTML='<div class="notice">جاري تحميل حساب Swnw…</div>';return invoke("patient-portal-self-service",{op:"status"}).then(renderStatus).catch(function(e){root.innerHTML='<div class="notice error">'+esc(errText(e))+'</div><button class="btn secondary" id="logout-error">خروج</button>';var b=document.getElementById("logout-error");if(b)b.onclick=function(){client.auth.signOut().then(function(){authView();});};});}
client.auth.getSession().then(function(r){if(r.data&&r.data.session)loadPortal();else authView();});
})();