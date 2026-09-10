(function(){
"use strict";
var STORAGE_KEY="swnw-portal-display-name";

function currentName(){
  var el=document.querySelector(".user-copy b")||document.querySelector(".hero-copy h1");
  var name=el&&el.textContent?el.textContent.trim():"";
  if(name&&name!=="مستخدم Swnw"){
    try{sessionStorage.setItem(STORAGE_KEY,name);}catch(_){ }
    return name;
  }
  try{return sessionStorage.getItem(STORAGE_KEY)||"";}catch(_){return "";}
}

function polishBrand(brand){
  if(!brand)return;
  var name=currentName();
  var img=brand.querySelector("img");
  if(!img)return;

  var oldLabel=brand.querySelector(".brand-label")||brand.querySelector(":scope > span:not(.brand-divider)");
  if(oldLabel)oldLabel.remove();

  var divider=brand.querySelector(".brand-divider");
  if(!divider){
    divider=document.createElement("span");
    divider.className="brand-divider";
    divider.setAttribute("aria-hidden","true");
    img.insertAdjacentElement("afterend",divider);
  }

  var meta=brand.querySelector(".brand-meta");
  if(!meta){
    meta=document.createElement("div");
    meta.className="brand-meta";
    divider.insertAdjacentElement("afterend",meta);
  }
  meta.innerHTML=(name?'<b class="brand-user-name">'+escapeHtml(name)+'</b>':'')+'<span class="brand-user-label">ملف المستخدم</span>';
  brand.classList.add("brand-polished");
}

function escapeHtml(value){
  return String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function apply(){
  polishBrand(document.querySelector(".top-brand"));
  polishBrand(document.querySelector(".subpage-brand"));
}

var root=document.getElementById("portal-root")||document.body;
var observer=new MutationObserver(function(){window.requestAnimationFrame(apply);});
observer.observe(root,{childList:true,subtree:true});
apply();
})();
