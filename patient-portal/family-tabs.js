(function(){
"use strict";

var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root||!window.supabase)return;

var client=window.supabase.createClient(cfg.url,cfg.anonKey,{
  auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}
});
var busy=false;

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function content(){return root.querySelector(".profile-content");}
function icon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';}
function fmtDate(v){
  if(!v)return "";
  var d=new Date(v);if(isNaN(d.getTime()))return "";
  return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);
}
function setActive(){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  tabs.querySelectorAll("button").forEach(function(b){b.classList.remove("active");});
  var me=tabs.querySelector('[data-family-tab="family"]');if(me)me.classList.add("active");
}
function loading(){
  var c=content();if(!c)return;
  c.innerHTML='<div class="family-view family-loading"><span class="family-spinner"></span><p>جاري تحميل ملفات العائلة…</p></div>';
}
function notice(text,type){
  var el=document.getElementById("family-notice");
  if(!el)return;
  el.className="family-notice "+(type||"");
  el.textContent=text||"";
  el.hidden=!text;
}
function callFamily(body){
  return client.functions.invoke("patient-family",{body:body}).then(function(r){
    if(r.error){
      var ctx=r.error&&r.error.context;
      if(ctx&&typeof ctx.clone==="function"){
        return ctx.clone().json().then(function(x){throw new Error(x&&x.error?x.error:(r.error.message||"FAMILY_OPERATION_FAILED"));});
      }
      throw r.error;
    }
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{};
  });
}
function friendlyError(e){
  var m=String(e&&e.message||e||"");
  if(m.indexOf("RATE_LIMITED")>=0)return "تم إرسال محاولات كثيرة خلال وقت قصير. حاول مرة أخرى بعد قليل.";
  if(m.indexOf("REQUEST_EXPIRED")>=0)return "انتهت صلاحية الطلب. يمكن إرسال طلب جديد.";
  if(m.indexOf("REQUEST_NOT_PENDING")>=0)return "تم التعامل مع هذا الطلب بالفعل.";
  if(m.indexOf("PATIENT_ACCOUNT_NOT_ACTIVATED")>=0)return "الحساب غير مفعّل بالكامل.";
  return "تعذر تنفيذ العملية الآن. حاول مرة أخرى.";
}

function memberCard(x){
  var n=x.member||{};
  return '<div class="family-member-card">'+
    '<div class="family-avatar">'+esc((n.display_name||"م").trim().charAt(0)||"م")+'</div>'+
    '<div class="family-member-copy"><b>'+esc(n.display_name||"مستخدم SwnW")+'</b>'+
    (n.login_email?'<small>'+esc(n.login_email)+'</small>':'')+
    '<span>عضو بالعائلة</span></div>'+
    '<button class="family-link danger" data-remove-link="'+esc(x.link_id)+'">إزالة</button>'+
  '</div>';
}
function incomingCard(x){
  var from=x.from||{};
  return '<div class="family-request-card"><div><b>'+esc(from.display_name||"مستخدم SwnW")+'</b><small>يريد إضافتك إلى العائلة'+(x.created_at?' • '+esc(fmtDate(x.created_at)):'')+'</small></div><div class="family-request-actions"><button class="family-btn accept" data-family-accept="'+esc(x.id)+'">قبول</button><button class="family-btn reject" data-family-reject="'+esc(x.id)+'">رفض</button></div></div>';
}
function outgoingCard(x){
  var to=x.to||{};
  return '<div class="family-request-card outgoing"><div><b>'+esc(to.display_name||"مستخدم SwnW")+'</b><small>في انتظار الرد'+(x.created_at?' • '+esc(fmtDate(x.created_at)):'')+'</small></div><button class="family-link" data-family-cancel="'+esc(x.id)+'">إلغاء الطلب</button></div>';
}

function render(data){
  var c=content();if(!c)return;
  var incoming=data.incoming||[],outgoing=data.outgoing||[],family=data.family||[];
  c.innerHTML='<div class="family-view">'+
    '<section class="family-hero"><div><span>العائلة</span><h2>ملفات العائلة</h2><p>أضف أفراد عائلتك، وبعد قبول الإضافة تقدروا تديروا مشاركة الملفات الطبية بشكل منفصل وآمن.</p></div><div class="family-hero-icon">'+icon()+'</div></section>'+
    '<div id="family-notice" class="family-notice" hidden></div>'+
    '<section class="family-panel add"><h3>إضافة فرد للعائلة</h3><p>ابحث باستخدام بيانات دقيقة. حفاظًا على الخصوصية، لن نعرض ما إذا كانت البيانات مسجلة أم لا.</p><div class="family-search-row"><select id="family-match-method"><option value="patient_code">رقم الملف</option><option value="phone">رقم الهاتف</option><option value="email">البريد الإلكتروني</option></select><input id="family-match-value" autocomplete="off" placeholder="اكتب رقم الملف"><button id="family-send-request" class="family-primary">إرسال طلب إضافة</button></div></section>'+
    (incoming.length?'<section class="family-panel"><div class="family-section-head"><h3>طلبات واردة</h3><span>'+incoming.length+'</span></div><div class="family-list">'+incoming.map(incomingCard).join("")+'</div></section>':'')+
    '<section class="family-panel"><div class="family-section-head"><h3>أفراد العائلة</h3><span>'+family.length+'</span></div>'+
      (family.length?'<div class="family-list">'+family.map(memberCard).join("")+'</div>':'<div class="family-empty">لم تضف أي فرد للعائلة حتى الآن.</div>')+
    '</section>'+
    (outgoing.length?'<section class="family-panel"><div class="family-section-head"><h3>طلبات مرسلة</h3><span>'+outgoing.length+'</span></div><div class="family-list">'+outgoing.map(outgoingCard).join("")+'</div></section>':'')+
  '</div>';

  bindActions();
}
function refresh(){
  if(busy)return;
  busy=true;loading();
  callFamily({op:"overview"}).then(render).catch(function(e){
    console.error(e);
    var c=content();if(c)c.innerHTML='<div class="family-view"><div class="family-notice error">'+esc(friendlyError(e))+'</div></div>';
  }).finally(function(){busy=false;});
}
function sendRequest(){
  var method=document.getElementById("family-match-method");
  var input=document.getElementById("family-match-value");
  var btn=document.getElementById("family-send-request");
  if(!method||!input||!btn)return;
  var value=input.value.trim();
  if(!value){notice("اكتب البيانات المطلوبة أولًا.","error");input.focus();return;}
  btn.disabled=true;btn.textContent="جاري الإرسال…";
  callFamily({op:"send_request",match_method:method.value,value:value}).then(function(){
    input.value="";
    return callFamily({op:"overview"});
  }).then(function(data){render(data);notice("تم استلام الطلب. إذا كانت البيانات مطابقة لحساب مسجل فسيظهر الطلب للطرف الآخر.","success");})
  .catch(function(e){notice(friendlyError(e),"error");})
  .finally(function(){var b=document.getElementById("family-send-request");if(b){b.disabled=false;b.textContent="إرسال طلب إضافة";}});
}
function respond(id,decision,button){
  if(!id||!button)return;
  button.disabled=true;
  callFamily({op:"respond_request",request_id:id,decision:decision}).then(function(){return callFamily({op:"overview"});}).then(render).catch(function(e){button.disabled=false;notice(friendlyError(e),"error");});
}
function cancel(id,button){
  if(!id||!button)return;
  button.disabled=true;
  callFamily({op:"cancel_request",request_id:id}).then(function(){return callFamily({op:"overview"});}).then(render).catch(function(e){button.disabled=false;notice(friendlyError(e),"error");});
}
function removeMember(id,button){
  if(!id||!button)return;
  if(!window.confirm("هل تريد إزالة هذا الفرد من العائلة؟"))return;
  button.disabled=true;
  callFamily({op:"remove_member",link_id:id}).then(function(){return callFamily({op:"overview"});}).then(render).catch(function(e){button.disabled=false;notice(friendlyError(e),"error");});
}
function bindActions(){
  var method=document.getElementById("family-match-method");
  var input=document.getElementById("family-match-value");
  var send=document.getElementById("family-send-request");
  if(method&&input){method.onchange=function(){input.value="";input.placeholder=this.value==="patient_code"?"اكتب رقم الملف":this.value==="phone"?"اكتب رقم الهاتف":"اكتب البريد الإلكتروني";input.inputMode=this.value==="phone"?"tel":"text";};}
  if(send)send.onclick=sendRequest;
  if(input)input.onkeydown=function(e){if(e.key==="Enter"){e.preventDefault();sendRequest();}};
  document.querySelectorAll("[data-family-accept]").forEach(function(b){b.onclick=function(){respond(this.getAttribute("data-family-accept"),"accept",this);};});
  document.querySelectorAll("[data-family-reject]").forEach(function(b){b.onclick=function(){respond(this.getAttribute("data-family-reject"),"reject",this);};});
  document.querySelectorAll("[data-family-cancel]").forEach(function(b){b.onclick=function(){cancel(this.getAttribute("data-family-cancel"),this);};});
  document.querySelectorAll("[data-remove-link]").forEach(function(b){b.onclick=function(){removeMember(this.getAttribute("data-remove-link"),this);};});
}
function openFamily(){setActive();refresh();}
function ensureTab(){
  var tabs=root.querySelector(".profile-tabs");if(!tabs)return;
  if(tabs.querySelector('[data-family-tab="family"]'))return;
  var b=document.createElement("button");
  b.className="medical-tab family-tab";
  b.setAttribute("data-family-tab","family");
  b.innerHTML=icon()+'<span>ملفات العائلة</span>';
  b.onclick=function(e){e.preventDefault();e.stopPropagation();openFamily();};
  var booking=tabs.querySelector('[data-extra-tab="booking"]');
  if(booking)tabs.insertBefore(b,booking);else tabs.appendChild(b);
}

var observer=new MutationObserver(function(){ensureTab();});
observer.observe(root,{childList:true,subtree:true});
ensureTab();
})();
