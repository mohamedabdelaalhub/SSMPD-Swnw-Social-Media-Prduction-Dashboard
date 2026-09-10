(function(){
"use strict";

var root=document.getElementById("portal-root");
var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
if(!root||!cfg||!cfg.url||!cfg.anonKey||!window.supabase)return;

var client=window.supabase.createClient(cfg.url,cfg.anonKey,{
  auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}
});
var docsCache=null,docsCacheAt=0,docsLoading=null;

var CATEGORIES=[
  {id:"all",label:"الكل"},
  {id:"medical_report",label:"التقارير الطبية",match:["تقرير طبي"]},
  {id:"prescription",label:"الروشتات",match:["وصفة طبية","روشتة"]},
  {id:"lab_result",label:"التحاليل",match:["تحاليل","طلب تحاليل"]},
  {id:"radiology",label:"الأشعة",match:["أشعة","طلب أشعة"]},
  {id:"echo",label:"الإيكو",match:["Echocardiography","Echo"]},
  {id:"dental",label:"الأسنان",match:["أسنان"]},
  {id:"eeg",label:"رسم المخ",match:["رسم مخ"]},
  {id:"physical_therapy",label:"العلاج الطبيعي",match:["علاج طبيعي"]},
  {id:"insurance",label:"التأمين",match:["تأمين"]},
  {id:"invoice",label:"الفواتير",match:["فاتورة / إيصال","فاتورة"]},
  {id:"other",label:"أخرى",match:["ملف آخر","أخرى"]}
];

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmtDate(v){
  if(!v)return "—";
  var d=new Date(String(v).length===10?v+"T00:00:00":v);
  if(isNaN(d.getTime()))return esc(v);
  return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"short",day:"numeric"}).format(d);
}
function labelForCategory(id){
  var c=CATEGORIES.find(function(x){return x.id===id;});
  return c?c.label:"مستند";
}
function categoryForRow(row){
  var explicit=row.getAttribute("data-file-category");
  if(explicit)return explicit;
  var meta=row.querySelector(".document-main span");
  var text=(meta&&meta.textContent||"").trim();
  for(var i=1;i<CATEGORIES.length;i++){
    var c=CATEGORIES[i];
    if((c.match||[]).some(function(m){return text.indexOf(m)>=0;}))return c.id;
  }
  return "other";
}

function getGeneratedDocuments(force){
  if(!force&&docsCache&&Date.now()-docsCacheAt<30000)return Promise.resolve(docsCache);
  if(docsLoading)return docsLoading;
  docsLoading=client.functions.invoke("patient-portal-documents",{body:{op:"list"}}).then(function(r){
    if(r.error)throw r.error;
    if(r.data&&r.data.error)throw new Error(r.data.error);
    docsCache=(r.data&&r.data.documents)||[];
    docsCacheAt=Date.now();
    return docsCache;
  }).finally(function(){docsLoading=null;});
  return docsLoading;
}

function detailModal(doc){
  var old=document.querySelector(".portal-document-modal-backdrop");if(old)old.remove();
  var backdrop=document.createElement("div");
  backdrop.className="portal-document-modal-backdrop";
  var details=(doc.details||[]).map(function(d){return '<div class="portal-document-detail"><label>'+esc(d.label)+'</label><p>'+esc(d.value)+'</p></div>';}).join("");
  backdrop.innerHTML='<div class="portal-document-modal" role="dialog" aria-modal="true">'+
    '<div class="portal-document-modal-head"><div><span>'+esc(labelForCategory(doc.category))+'</span><h2>'+esc(doc.title||"مستند طبي")+'</h2></div><button type="button" aria-label="إغلاق">×</button></div>'+
    '<div class="portal-document-summary-grid">'+
      '<div><small>التاريخ</small><b>'+fmtDate(doc.date)+'</b></div>'+
      (doc.doctor_name?'<div><small>الطبيب / مقدم الخدمة</small><b>'+esc(doc.doctor_name)+'</b></div>':'')+
      (doc.specialty?'<div><small>التخصص</small><b>'+esc(doc.specialty)+'</b></div>':'')+
      (doc.patient&&doc.patient.patient_code?'<div><small>رقم الملف</small><b class="ltr">'+esc(doc.patient.patient_code)+'</b></div>':'')+
    '</div>'+
    (details||'<div class="portal-document-no-details">المستند مسجل في ملفك الطبي ولا توجد تفاصيل نصية إضافية للعرض هنا.</div>')+
  '</div>';
  document.body.appendChild(backdrop);
  var close=function(){backdrop.remove();};
  backdrop.querySelector("button").onclick=close;
  backdrop.onclick=function(e){if(e.target===backdrop)close();};
}

function generatedRow(doc){
  var row=document.createElement("article");
  row.className="document-row generated-document-row";
  row.setAttribute("data-file-category",doc.category||"other");
  row.setAttribute("data-generated-document","1");
  row.innerHTML='<span class="document-icon generated-icon">▤</span>'+
    '<div class="document-main"><b>'+esc(doc.title||labelForCategory(doc.category))+'</b><span>'+esc(labelForCategory(doc.category))+(doc.patient&&doc.patient.patient_code?' • <span class="ltr">'+esc(doc.patient.patient_code)+'</span>':'')+'</span>'+(doc.summary?'<small class="generated-summary">'+esc(doc.summary)+'</small>':'')+'</div>'+
    '<div class="document-meta"><span>'+fmtDate(doc.date)+'</span><small class="generated-source-pill">منشأ بالمركز</small></div>'+
    '<div class="document-actions"><button type="button" class="file-action generated-view">عرض التفاصيل</button></div>';
  row.querySelector(".generated-view").onclick=function(){detailModal(doc);};
  return row;
}

function ensureList(section){
  var list=section.querySelector(".document-list");
  if(list)return list;
  list=document.createElement("div");
  list.className="document-list";
  var empty=section.querySelector(".compact-empty");
  if(empty)empty.insertAdjacentElement("beforebegin",list);else section.appendChild(list);
  return list;
}

function rebuildFilterBar(section){
  var old=section.querySelector(".portal-file-category-bar");if(old)old.remove();
  var rows=Array.prototype.slice.call(section.querySelectorAll(".document-list > .document-row"));
  var counts={};
  rows.forEach(function(row){
    var cat=categoryForRow(row);
    row.setAttribute("data-file-category",cat);
    counts[cat]=(counts[cat]||0)+1;
  });
  if(!rows.length)return;

  var available=CATEGORIES.filter(function(c){return c.id==="all"||counts[c.id];});
  var bar=document.createElement("div");
  bar.className="portal-file-category-bar";
  bar.setAttribute("aria-label","تصنيفات المستندات");
  bar.innerHTML=available.map(function(c){
    var n=c.id==="all"?rows.length:(counts[c.id]||0);
    return '<button type="button" data-file-filter="'+esc(c.id)+'" class="'+(c.id==="all"?"active":"")+'"><span>'+esc(c.label)+'</span><small>'+n+'</small></button>';
  }).join("");
  var heading=section.querySelector("h3");
  if(heading)heading.insertAdjacentElement("afterend",bar);else section.insertBefore(bar,section.firstChild);
  bar.querySelectorAll("button").forEach(function(btn){
    btn.onclick=function(){applyFilter(section,btn.getAttribute("data-file-filter")||"all");};
  });
}

function applyFilter(section,id){
  section.querySelectorAll(".portal-file-category-bar button").forEach(function(b){
    b.classList.toggle("active",b.getAttribute("data-file-filter")===id);
  });
  section.querySelectorAll(".document-list > .document-row").forEach(function(row){
    row.hidden=id!=="all"&&row.getAttribute("data-file-category")!==id;
  });
  var visible=Array.prototype.filter.call(section.querySelectorAll(".document-list > .document-row"),function(r){return !r.hidden;}).length;
  var empty=section.querySelector(".portal-filter-empty");
  if(!visible){
    if(!empty){
      empty=document.createElement("div");empty.className="portal-filter-empty";empty.textContent="لا توجد مستندات في هذا التصنيف.";section.appendChild(empty);
    }
    empty.hidden=false;
  }else if(empty){empty.hidden=true;}
}

function enhanceFiles(){
  var section=root.querySelector(".documents-section");
  if(!section)return false;
  var list=ensureList(section);

  // Classify uploaded files immediately, even if the new documents function is not deployed yet.
  Array.prototype.slice.call(list.querySelectorAll(".document-row:not([data-generated-document])")).forEach(function(row){
    row.setAttribute("data-file-category",categoryForRow(row));
  });
  rebuildFilterBar(section);

  if(section.dataset.generatedDocsLoading==="1"||section.dataset.generatedDocsReady==="1")return true;
  section.dataset.generatedDocsLoading="1";
  getGeneratedDocuments(false).then(function(docs){
    if(!document.body.contains(section))return;
    list=ensureList(section);
    list.querySelectorAll('[data-generated-document="1"]').forEach(function(x){x.remove();});
    (docs||[]).forEach(function(doc){list.appendChild(generatedRow(doc));});
    var empty=section.querySelector(".compact-empty");
    if(empty&&(docs||[]).length)empty.remove();
    section.dataset.generatedDocsReady="1";
    rebuildFilterBar(section);
  }).catch(function(e){
    // Existing uploaded files keep working if the additive function is not deployed yet.
    console.warn("patient portal generated documents unavailable",e);
  }).finally(function(){
    if(document.body.contains(section))section.dataset.generatedDocsLoading="";
  });
  return true;
}

function scheduleFilesEnhance(){
  [80,220,550,1100].forEach(function(ms){setTimeout(enhanceFiles,ms);});
}

document.addEventListener("click",function(e){
  var t=e.target&&e.target.closest?e.target.closest('[data-profile-tab="files"]'):null;
  if(t)scheduleFilesEnhance();
},true);

scheduleFilesEnhance();
})();
