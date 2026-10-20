/* SSMPD — expose Business Intelligence as a first-class manager tab without changing the legacy router. */
(function(root){
  'use strict';
  var TAB='business_intelligence', LABEL='ذكاء الإدارة';

  function manager(){
    var a=root.SSMPDAuth&&root.SSMPDAuth.currentAdmin;
    return !!(a&&root.SSMPDRoles&&root.SSMPDRoles.hasAnyRole(a,['general_manager','super_admin']));
  }
  function view(){return document.getElementById('view-container')||document.querySelector('.view-container');}
  function setActive(btn){
    document.querySelectorAll('#tabs-bar .tab-btn').forEach(function(x){x.classList.remove('active');});
    if(btn)btn.classList.add('active');
    if(root.SSMPDNavigationUI&&root.SSMPDNavigationUI.setCurrent)root.SSMPDNavigationUI.setCurrent(TAB);
  }
  function open(){
    if(!manager())return;
    var container=view();if(!container||!root.SSMPDBusinessIntelligence)return;
    setActive(document.querySelector('#tabs-bar [data-tab="'+TAB+'"]'));
    container.innerHTML='';
    root.SSMPDBusinessIntelligence.mount(container);
    var brand=document.getElementById('brand-section-name');
    if(brand)brand.textContent=LABEL;
    try{history.replaceState(null,'','#'+TAB);}catch(e){}
    var menu=document.getElementById('user-dropdown');if(menu)menu.classList.remove('open');
  }
  function inject(){
    if(!manager())return;
    var bar=document.getElementById('tabs-bar');
    if(bar&&!bar.querySelector('[data-tab="'+TAB+'"]')){
      var b=document.createElement('button');b.className='tab-btn';b.dataset.tab=TAB;b.textContent=LABEL;b.onclick=open;
      bar.appendChild(b);
    }
    var items=document.querySelector('#user-dropdown .ud-items');
    if(items&&!items.querySelector('[data-goto="'+TAB+'"]')){
      var m=document.createElement('button');m.className='ud-item';m.dataset.goto=TAB;m.textContent=LABEL;m.onclick=function(e){e.preventDefault();open();};
      var empty=items.querySelector('.nav-menu-empty');items.insertBefore(m,empty||null);
    }
  }
  function boot(){
    inject();
    var observer=new MutationObserver(function(){inject();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    if(location.hash==='#'+TAB)setTimeout(open,250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  root.SSMPDOpenBusinessIntelligence=open;
})(window);
