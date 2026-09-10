(function(){
"use strict";

var DISPLAY_NAME_KEY="swnw-portal-display-name";

function uploadIcon(){
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>';
}

function fileSummary(input){
  var files=Array.prototype.slice.call(input.files||[]);
  if(!files.length)return "اختر الملفات أو اسحبها هنا";
  if(files.length===1)return files[0].name;
  return "تم اختيار "+files.length+" ملفات";
}

function enhanceFilePicker(scope){
  var input=(scope||document).querySelector&&scope.querySelector("#documents");
  if(!input||input.dataset.polished==="1")return;
  input.dataset.polished="1";

  var field=input.closest(".field");
  if(!field)return;
  field.classList.remove("full");
  field.classList.add("upload-field");

  var typeInput=(scope||document).querySelector&&scope.querySelector("#document-type");
  if(typeInput&&typeInput.closest(".field"))typeInput.closest(".field").classList.add("document-type-field");

  input.classList.add("native-file-input");
  input.setAttribute("tabindex","-1");

  var picker=document.createElement("div");
  picker.className="file-picker";
  picker.setAttribute("role","button");
  picker.setAttribute("tabindex","0");
  picker.setAttribute("aria-label","اختيار مستندات للرفع");
  picker.innerHTML='<span class="file-picker-icon">'+uploadIcon()+'</span><span class="file-picker-copy"><b class="file-picker-title">اختر الملفات أو اسحبها هنا</b><small>PDF، JPG، PNG، WEBP</small></span>';
  input.insertAdjacentElement("afterend",picker);

  function refresh(){
    var title=picker.querySelector(".file-picker-title");
    if(title)title.textContent=fileSummary(input);
    picker.classList.toggle("has-files",!!(input.files&&input.files.length));
  }
  function openPicker(){input.click();}

  picker.addEventListener("click",openPicker);
  picker.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();openPicker();}});
  picker.addEventListener("dragover",function(e){e.preventDefault();picker.classList.add("dragging");});
  picker.addEventListener("dragleave",function(){picker.classList.remove("dragging");});
  picker.addEventListener("drop",function(e){
    e.preventDefault();
    picker.classList.remove("dragging");
    var dropped=e.dataTransfer&&e.dataTransfer.files;
    if(!dropped||!dropped.length)return;
    try{
      var dt=new DataTransfer();
      Array.prototype.forEach.call(dropped,function(file){dt.items.add(file);});
      input.files=dt.files;
      input.dispatchEvent(new Event("change",{bubbles:true}));
    }catch(_e){input.click();}
  });
  input.addEventListener("change",refresh);
  refresh();
}

function enhanceBrand(scope){
  var area=scope||document;
  var userNameNode=area.querySelector&&area.querySelector(".user-copy b");
  if(userNameNode&&userNameNode.textContent.trim()){
    sessionStorage.setItem(DISPLAY_NAME_KEY,userNameNode.textContent.trim());
  }
  var displayName=(userNameNode&&userNameNode.textContent.trim())||sessionStorage.getItem(DISPLAY_NAME_KEY)||"مستخدم Swnw";

  var topBrand=area.querySelector&&area.querySelector(".top-brand");
  if(topBrand&&topBrand.dataset.polished!=="1"){
    topBrand.dataset.polished="1";
    var oldLabel=topBrand.querySelector(".brand-label");
    if(oldLabel)oldLabel.remove();
    var img=topBrand.querySelector("img");
    if(img){
      var divider=document.createElement("span");
      divider.className="brand-divider";
      var meta=document.createElement("span");
      meta.className="brand-meta";
      meta.innerHTML='<b>'+escapeHtml(displayName)+'</b><small>ملف المستخدم</small>';
      img.insertAdjacentElement("afterend",divider);
      divider.insertAdjacentElement("afterend",meta);
    }
  }

  var subBrand=area.querySelector&&area.querySelector(".subpage-brand");
  if(subBrand&&subBrand.dataset.polished!=="1"){
    subBrand.dataset.polished="1";
    Array.prototype.slice.call(subBrand.children).forEach(function(el){
      if(el.tagName!=="IMG")el.remove();
    });
    var subImg=subBrand.querySelector("img");
    if(subImg){
      var subDivider=document.createElement("span");
      subDivider.className="brand-divider";
      var subMeta=document.createElement("span");
      subMeta.className="brand-meta";
      subMeta.innerHTML='<b>'+escapeHtml(displayName)+'</b><small>ملف المستخدم</small>';
      subImg.insertAdjacentElement("afterend",subDivider);
      subDivider.insertAdjacentElement("afterend",subMeta);
    }
  }
}

function escapeHtml(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function enhance(){
  var root=document.getElementById("portal-root");
  if(!root)return;
  enhanceBrand(root);
  enhanceFilePicker(root);
}

enhance();
var root=document.getElementById("portal-root");
if(root){
  new MutationObserver(function(){enhance();}).observe(root,{childList:true,subtree:true});
}
})();
