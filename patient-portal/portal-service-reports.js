/* Patient portal: service reports (lab/radiology) uploaded by the center. Shows nothing unless the patient has reports. */
(function(w){"use strict";
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmtDate(v){if(!v)return "—";try{var d=new Date(v);if(isNaN(d.getTime()))return "—";return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);}catch(e){return "—";}}
function cardHtml(rows){
  if(!Array.isArray(rows)||!rows.length)return "";
  return '<div class="files-head"><div class="section-heading"><div><h2>تقارير الخدمات</h2><p>تقارير التحاليل والأشعة التي رفعها المركز لك.</p></div></div></div><div class="files-list">'+
    rows.map(function(r){return '<article class="file-row"><div class="file-copy"><h3>'+esc(r.service||"تقرير")+'</h3><p>'+esc(fmtDate(r.uploaded_at))+' · '+esc(r.file_name||"")+'</p></div><button type="button" class="btn" data-service-report="'+esc(r.path)+'">عرض التقرير</button></article>';}).join("")+'</div><p data-service-report-note role="status"></p>';
}
if(typeof document==="undefined"||!w.supabase)return (w.SSMPDPortalServiceReports={_pure:{cardHtml:cardHtml,esc:esc}});
var cfg=w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase,root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root)return;
var client=w.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});
var loadedFor="",loading=false;
function mount(){
  var shell=root.querySelector(".app-shell");if(!shell||!root.querySelector(".profile-tabs"))return;
  if(shell.querySelector("#service-reports-card")||loading)return;
  loading=true;
  client.rpc("patient_portal_service_reports").then(function(r){
    loading=false;
    if(r.error||!shell.isConnected||shell.querySelector("#service-reports-card"))return;
    var html=cardHtml(r.data);if(!html)return;
    var card=document.createElement("section");card.id="service-reports-card";card.className="card";card.innerHTML=html;shell.appendChild(card);
  }).catch(function(){loading=false;});
}
root.addEventListener("click",function(e){
  var b=e.target.closest("[data-service-report]");if(!b)return;
  var note=root.querySelector("[data-service-report-note]");b.disabled=true;if(note)note.textContent="جاري فتح التقرير…";
  client.storage.from("service-reports").createSignedUrl(b.getAttribute("data-service-report"),300).then(function(r){
    b.disabled=false;if(r.error||!r.data){if(note)note.textContent="تعذر فتح التقرير. حاول مرة أخرى.";return;}
    if(note)note.textContent="";w.open(r.data.signedUrl,"_blank","noopener");
  }).catch(function(){b.disabled=false;if(note)note.textContent="تعذر فتح التقرير. حاول مرة أخرى.";});
});
new MutationObserver(function(){mount();}).observe(root,{childList:true,subtree:false});
mount();
})(typeof window!=="undefined"?window:globalThis);
