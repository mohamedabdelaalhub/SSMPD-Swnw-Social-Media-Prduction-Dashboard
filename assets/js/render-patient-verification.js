/* Swnw — مراجعة تحقق هوية المرضى */
(function(){
"use strict";
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function labelType(v){return({self_identity:"ملف شخصي",guardian_relationship:"وصاية/تابع",authorized_representative:"ممثل معتمد"}[v]||v);}
function labelRel(v){return({self:"نفسه",father:"أب",mother:"أم",legal_guardian:"وصي قانوني",spouse:"زوج/زوجة",other:"أخرى"}[v]||v||"—");}
function labelStatus(v){return({pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض",revoked:"ملغي",expired:"منتهي"}[v]||v);}
function open(){
var old=document.getElementById("patient-verification-review-modal");if(old)old.remove();
var bd=document.createElement("div");bd.id="patient-verification-review-modal";bd.className="modal-backdrop";
bd.innerHTML='<div class="modal" style="width:min(980px,96vw);max-width:980px;max-height:88vh;overflow:auto;">'+
'<div class="modal-head"><h3>مراجعة التحقق من هوية مرضى Swnw</h3><button class="modal-close">×</button></div>'+
'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"><button class="btn sm" data-status="pending">قيد المراجعة</button><button class="btn ghost sm" data-status="approved">المعتمدة</button><button class="btn ghost sm" data-status="rejected">المرفوضة</button><button class="btn ghost sm" data-status="all">الكل</button></div>'+
'<div id="patient-verification-review-list"><div class="loading">بيحمّل…</div></div></div>';
document.body.appendChild(bd);
bd.querySelector(".modal-close").onclick=function(){bd.remove();};
bd.addEventListener("click",function(e){if(e.target===bd)bd.remove();});
bd.querySelectorAll("[data-status]").forEach(function(b){b.onclick=function(){load(bd,b.getAttribute("data-status"));};});
load(bd,"pending");
}
function load(bd,status){
var host=bd.querySelector("#patient-verification-review-list");host.innerHTML='<div class="loading">بيحمّل…</div>';
window.SSMPDDb.listPatientIdentityVerifications(status).then(function(items){
if(!items.length){host.innerHTML='<div style="padding:18px;text-align:center;color:var(--c-muted);">مفيش طلبات في الحالة دي.</div>';return;}
host.innerHTML=items.map(function(x){
var p=x.patient||{},identity=x.account&&x.account.identity||{},docs=x.documents||[],access=x.access;
var buttons=docs.map(function(d){return '<button class="btn ghost sm" data-doc="'+d.id+'">'+esc(d.document_type)+'</button>';}).join(" ");
if(x.status==="pending")buttons+=' <button class="btn sm" data-approve="'+x.id+'">اعتماد</button> <button class="btn danger sm" data-reject="'+x.id+'">رفض</button>';
if(access&&access.verification_status==="approved")buttons+=' <button class="btn danger sm" data-revoke="'+access.id+'">إلغاء الوصول</button>';
return '<div class="section" style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><b>'+esc(p.full_name||"مريض")+'</b> <span class="status-pill '+(x.status==="approved"?"approved":"draft")+'">'+esc(labelStatus(x.status))+'</span><div style="font-size:12px;color:var(--c-muted);margin-top:4px;">رقم الملف: '+esc(p.patient_code||"—")+' · '+esc(labelType(x.verification_type))+' · '+esc(labelRel(x.requested_relationship))+'</div><div style="font-size:11px;color:var(--c-muted);margin-top:3px;">صاحب الحساب: '+esc(identity.phone||identity.email||"—")+' · '+new Date(x.submitted_at).toLocaleString("ar-EG")+'</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'+buttons+'</div></div>'+(x.rejection_reason?'<div style="margin-top:8px;color:#D0402A;font-size:12px;">سبب الرفض: '+esc(x.rejection_reason)+'</div>':"")+'</div>';
}).join("");
host.querySelectorAll("[data-doc]").forEach(function(b){b.onclick=function(){window.SSMPDDb.getPatientVerificationDocumentUrl(b.getAttribute("data-doc")).then(function(url){window.open(url,"_blank","noopener");}).catch(function(e){alert("خطأ: "+e.message);});};});
host.querySelectorAll("[data-approve]").forEach(function(b){b.onclick=function(){if(!confirm("اعتماد الوصول بعد مراجعة المستندات الرسمية؟"))return;b.disabled=true;window.SSMPDDb.approvePatientIdentityVerification(b.getAttribute("data-approve")).then(function(){load(bd,status);}).catch(function(e){alert("خطأ: "+e.message);b.disabled=false;});};});
host.querySelectorAll("[data-reject]").forEach(function(b){b.onclick=function(){var reason=prompt("سبب الرفض:");if(reason===null)return;window.SSMPDDb.rejectPatientIdentityVerification(b.getAttribute("data-reject"),reason).then(function(){load(bd,status);}).catch(function(e){alert("خطأ: "+e.message);});};});
host.querySelectorAll("[data-revoke]").forEach(function(b){b.onclick=function(){var reason=prompt("سبب إلغاء الوصول:");if(reason===null)return;if(!confirm("متأكد من إلغاء الوصول فورًا؟"))return;window.SSMPDDb.revokePatientAccountAccess(b.getAttribute("data-revoke"),reason).then(function(){load(bd,status);}).catch(function(e){alert("خطأ: "+e.message);});};});
}).catch(function(e){host.innerHTML='<div style="color:#D0402A;padding:14px;">تعذر تحميل الطلبات: '+esc(e.message)+'</div>';});
}
window.SSMPDRenderPatientVerification={open:open};
})();