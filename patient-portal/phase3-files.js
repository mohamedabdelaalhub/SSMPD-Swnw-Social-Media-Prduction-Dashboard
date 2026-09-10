(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
if(!cfg||!cfg.url||!cfg.anonKey||!window.supabase)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});

function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function categoryLabel(v){return({insurance:"تأمين",radiology:"أشعة",lab_result:"تحاليل",prescription:"وصفة طبية",physical_therapy:"علاج طبيعي",medical_report:"تقرير طبي",eeg:"رسم مخ",invoice:"فاتورة / إيصال",other:"ملف آخر"}[v]||"ملف");}
function fmtDate(v){if(!v)return "—";try{return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v));}catch(_){return v;}}
function fmtSize(n){n=Number(n||0);if(!n)return "—";if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";return (n/1048576).toFixed(1)+" MB";}
function fileIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>';}
function invokeFiles(){
  return client.functions.invoke("patient-portal-self-service",{body:{op:"files"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{files:[]};
  });
}
function renderLoading(card){
  card.innerHTML='<div class="files-head"><div class="section-heading"><span class="heading-icon">'+fileIcon()+'</span><div><h2>الملفات الطبية</h2><p>الملفات المعتمدة والمتاحة لحسابك.</p></div></div></div><div class="empty-state"><div class="loading-line"></div><p>جاري تحميل الملفات…</p></div>';
}
function renderFiles(card,files){
  var head='<div class="files-head"><div class="section-heading"><span class="heading-icon">'+fileIcon()+'</span><div><h2>الملفات الطبية</h2><p>يظهر هنا فقط المحتوى المعتمد للعرض في بوابة Swnw.</p></div></div><button class="btn secondary compact" id="phase3-add-access">طلب إضافة ملف</button></div>';
  if(!files.length){
    card.innerHTML=head+'<div class="empty-state">'+fileIcon()+'<h3>لا توجد ملفات متاحة حاليًا</h3><p>أي ملف يتم اعتماده للظهور في البوابة سيظهر هنا تلقائيًا.</p></div>';
  }else{
    var rows=files.map(function(f){
      var p=f.patient||{};
      return '<article class="linked-file">'+
        '<div class="file-icon">'+fileIcon()+'</div>'+
        '<div class="file-copy"><h3>'+esc(f.file_name||categoryLabel(f.category))+'</h3><p>'+esc(categoryLabel(f.category))+' · '+esc(fmtDate(f.uploaded_at))+' · '+esc(fmtSize(f.file_size))+'</p><span>'+esc(p.full_name||"")+(p.patient_code?' · <span class="ltr">'+esc(p.patient_code)+'</span>':'')+'</span></div>'+
        '<span class="access-pill approved">متاح</span>'+
      '</article>';
    }).join("");
    card.innerHTML=head+'<div class="linked-files-grid">'+rows+'</div>';
  }
  var add=document.getElementById("phase3-add-access");
  if(add)add.onclick=function(){var original=document.getElementById("menu-add-access");if(original)original.click();};
}
function loadFiles(){
  var card=document.querySelector(".files-card");
  if(!card)return;
  renderLoading(card);
  invokeFiles().then(function(data){renderFiles(card,Array.isArray(data.files)?data.files:[]);}).catch(function(e){
    card.innerHTML='<div class="notice error">تعذر تحميل الملفات الآن. حاول مرة أخرى.</div>';
    console.error("Swnw portal files:",e);
  });
}

document.addEventListener("click",function(e){
  var target=e.target&&e.target.closest?e.target.closest('[data-profile-tab="files"]'):null;
  if(target)setTimeout(loadFiles,0);
});
})();
