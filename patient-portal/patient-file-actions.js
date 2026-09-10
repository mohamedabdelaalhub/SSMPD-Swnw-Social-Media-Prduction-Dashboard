(function(){
"use strict";
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
if(!cfg||!cfg.url||!cfg.anonKey||!window.supabase)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});

function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function icon(name){
  var p={
    eye:'<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    download:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[name]||p.eye)+'</svg>';
}
function toast(message,type){
  var old=document.querySelector(".portal-file-toast");if(old)old.remove();
  var el=document.createElement("div");
  el.className="portal-file-toast "+(type||"");
  el.textContent=message;
  document.body.appendChild(el);
  requestAnimationFrame(function(){el.classList.add("show");});
  setTimeout(function(){el.classList.remove("show");setTimeout(function(){el.remove();},180);},3200);
}
function getFiles(){
  return client.functions.invoke("patient-portal-self-service",{body:{op:"files"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data&&r.data.files||[];
  });
}
function fetchFile(file,mode,previewWindow){
  return client.auth.getSession().then(function(r){
    var session=r.data&&r.data.session;
    if(!session)throw new Error("انتهت جلسة الدخول. سجّل دخولك من جديد.");
    var url=cfg.url.replace(/\/$/,"")+"/functions/v1/patient-files-download?file_id="+encodeURIComponent(file.id)+"&mode="+(mode==="preview"?"preview":"download");
    return fetch(url,{headers:{Authorization:"Bearer "+session.access_token,apikey:cfg.anonKey}});
  }).then(function(res){
    if(!res.ok){
      return res.text().then(function(text){
        try{var j=JSON.parse(text);throw new Error(j.error||text);}catch(e){if(e&&e.message&&e.message!==text)throw e;throw new Error(text||"تعذر فتح الملف.");}
      });
    }
    return res.blob();
  }).then(function(blob){
    var objectUrl=URL.createObjectURL(blob);
    if(mode==="preview"){
      if(previewWindow){previewWindow.location.replace(objectUrl);}else{window.open(objectUrl,"_blank");}
      setTimeout(function(){URL.revokeObjectURL(objectUrl);},60000);
    }else{
      var a=document.createElement("a");a.href=objectUrl;a.download=file.file_name||"file";document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(objectUrl);},5000);
    }
  }).catch(function(e){
    if(previewWindow&&!previewWindow.closed)previewWindow.close();
    throw e;
  });
}
function wireButton(btn,file,mode){
  btn.onclick=function(){
    if(btn.disabled)return;
    var previewWindow=null;
    if(mode==="preview"){
      previewWindow=window.open("about:blank","_blank");
      if(previewWindow){previewWindow.document.title="جاري فتح الملف…";previewWindow.document.body.innerHTML='<div style="font-family:system-ui;padding:30px;text-align:center">جاري فتح الملف…</div>';}
    }
    btn.disabled=true;btn.classList.add("loading");
    fetchFile(file,mode,previewWindow).catch(function(e){toast(String(e&&e.message||e||"تعذر فتح الملف."),"error");}).finally(function(){btn.disabled=false;btn.classList.remove("loading");});
  };
}
function enhanceDocumentList(list){
  if(!list||list.dataset.fileActions==="loading"||list.dataset.fileActions==="ready")return;
  list.dataset.fileActions="loading";
  getFiles().then(function(files){
    var rows=Array.prototype.slice.call(list.querySelectorAll(".document-row"));
    rows.forEach(function(row,i){
      var file=files[i];if(!file)return;
      if(row.querySelector(".document-actions"))return;
      var actions=document.createElement("div");
      actions.className="document-actions";
      actions.innerHTML='<button type="button" class="file-action preview">'+icon("eye")+'<span>معاينة</span></button><button type="button" class="file-action download">'+icon("download")+'<span>تحميل</span></button>';
      row.appendChild(actions);
      wireButton(actions.querySelector(".preview"),file,"preview");
      wireButton(actions.querySelector(".download"),file,"download");
    });
    list.dataset.fileActions="ready";
  }).catch(function(e){list.dataset.fileActions="";toast("تعذر تجهيز فتح الملفات: "+String(e&&e.message||e),"error");});
}
function enhance(){document.querySelectorAll(".document-list").forEach(enhanceDocumentList);}
enhance();
var root=document.getElementById("portal-root");if(root)new MutationObserver(function(){enhance();}).observe(root,{childList:true,subtree:true});
})();
