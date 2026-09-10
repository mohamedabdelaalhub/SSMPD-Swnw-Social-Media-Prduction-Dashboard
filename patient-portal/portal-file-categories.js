(function(){
"use strict";

var root=document.getElementById("portal-root");
if(!root)return;

var CATEGORIES=[
  {id:"all",label:"الكل"},
  {id:"medical_report",label:"التقارير الطبية",match:["تقرير طبي"]},
  {id:"prescription",label:"الروشتات",match:["وصفة طبية"]},
  {id:"lab_result",label:"التحاليل",match:["تحاليل"]},
  {id:"radiology",label:"الأشعة",match:["أشعة"]},
  {id:"eeg",label:"رسم المخ",match:["رسم مخ"]},
  {id:"physical_therapy",label:"العلاج الطبيعي",match:["علاج طبيعي"]},
  {id:"insurance",label:"التأمين",match:["تأمين"]},
  {id:"invoice",label:"الفواتير",match:["فاتورة / إيصال","فاتورة"]},
  {id:"other",label:"أخرى",match:["ملف آخر","أخرى"]}
];

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function categoryForRow(row){
  var meta=row.querySelector(".document-main span");
  var text=(meta&&meta.textContent||"").trim();
  for(var i=1;i<CATEGORIES.length;i++){
    var c=CATEGORIES[i];
    if((c.match||[]).some(function(m){return text.indexOf(m)===0||text.indexOf(m)>=0;}))return c.id;
  }
  return "other";
}

function applyFilter(section,id){
  section.querySelectorAll(".portal-file-category-bar button").forEach(function(b){
    b.classList.toggle("active",b.getAttribute("data-file-filter")===id);
  });
  section.querySelectorAll(".document-row").forEach(function(row){
    row.hidden=id!=="all"&&row.getAttribute("data-file-category")!==id;
  });
  var visible=Array.prototype.filter.call(section.querySelectorAll(".document-row"),function(r){return !r.hidden;}).length;
  var empty=section.querySelector(".portal-filter-empty");
  if(!visible){
    if(!empty){
      empty=document.createElement("div");
      empty.className="portal-filter-empty";
      empty.textContent="لا توجد مستندات في هذا التصنيف.";
      section.appendChild(empty);
    }
    empty.hidden=false;
  }else if(empty){empty.hidden=true;}
}

function enhanceFiles(){
  var section=root.querySelector(".documents-section");
  var list=section&&section.querySelector(".document-list");
  if(!section||!list||section.dataset.categoriesReady==="1")return !!list;

  var rows=Array.prototype.slice.call(list.querySelectorAll(".document-row"));
  if(!rows.length)return false;

  var counts={};
  rows.forEach(function(row){
    var cat=categoryForRow(row);
    row.setAttribute("data-file-category",cat);
    counts[cat]=(counts[cat]||0)+1;
  });

  var available=CATEGORIES.filter(function(c){return c.id==="all"||counts[c.id];});
  var bar=document.createElement("div");
  bar.className="portal-file-category-bar";
  bar.setAttribute("aria-label","تصنيفات المستندات");
  bar.innerHTML=available.map(function(c){
    var n=c.id==="all"?rows.length:(counts[c.id]||0);
    return '<button type="button" data-file-filter="'+esc(c.id)+'" class="'+(c.id==="all"?"active":"")+'"><span>'+esc(c.label)+'</span><small>'+n+'</small></button>';
  }).join("");

  var heading=section.querySelector("h3");
  if(heading)heading.insertAdjacentElement("afterend",bar);else section.insertBefore(bar,list);
  bar.querySelectorAll("button").forEach(function(btn){
    btn.onclick=function(){applyFilter(section,btn.getAttribute("data-file-filter")||"all");};
  });
  section.dataset.categoriesReady="1";
  return true;
}

function scheduleFilesEnhance(){
  [60,180,420,900,1800,3200].forEach(function(ms){setTimeout(function(){enhanceFiles();},ms);});
}

document.addEventListener("click",function(e){
  var t=e.target&&e.target.closest?e.target.closest('[data-profile-tab="files"]'):null;
  if(t)scheduleFilesEnhance();
},true);

scheduleFilesEnhance();
})();
