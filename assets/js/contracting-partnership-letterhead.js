/* Reuse the exact official Swnw medical-report print assets for partnership documents.
   Source of truth is the same header/footer used by printMedicalReport in render-patients.js. */
(function(){
  'use strict';
  var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
  var HEADER=BASE+'assets/img/report-letterhead-header.jpg';
  var FOOTER=BASE+'assets/img/report-letterhead-footer.jpg';

  function apply(doc){
    if(!doc || doc.dataset.swnwOfficialLetterhead==='yes') return;
    doc.dataset.swnwOfficialLetterhead='yes';
    doc.style.position='relative';
    doc.style.width='210mm';
    doc.style.maxWidth='100%';
    doc.style.minHeight='297mm';
    doc.style.margin='0 auto';
    doc.style.padding='56mm 15mm 58mm';
    doc.style.boxSizing='border-box';
    doc.style.background='#fff';
    doc.style.color='#1d2433';
    doc.style.lineHeight='1.7';

    var old=doc.querySelector('.ce-hub-doc-head');
    if(old) old.remove();

    var header=document.createElement('img');
    header.src=HEADER;
    header.alt='Swnw official letterhead header';
    header.className='swnw-official-letterhead-header';
    header.style.cssText='position:absolute;top:0;left:0;width:210mm;max-width:100%;display:block;z-index:0;';
    doc.insertBefore(header,doc.firstChild);

    var footer=document.createElement('img');
    footer.src=FOOTER;
    footer.alt='Swnw official letterhead footer';
    footer.className='swnw-official-letterhead-footer';
    footer.style.cssText='position:absolute;bottom:0;left:0;width:210mm;max-width:100%;display:block;z-index:0;';
    doc.appendChild(footer);

    Array.prototype.forEach.call(doc.children,function(el){
      if(el!==header && el!==footer){el.style.position=el.style.position||'relative';el.style.zIndex='1';}
    });
    Array.prototype.forEach.call(doc.querySelectorAll('h2,h3'),function(h){h.style.color='#0F369D';});
  }

  function scan(root){
    if(!root) return;
    if(root.matches && root.matches('.ce-hub-doc')) apply(root);
    if(root.querySelectorAll) root.querySelectorAll('.ce-hub-doc').forEach(apply);
  }
  var observer=new MutationObserver(function(records){
    records.forEach(function(r){Array.prototype.forEach.call(r.addedNodes,function(n){if(n.nodeType===1)scan(n);});});
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){scan(document);});
  else scan(document);
  window.SSMPDOfficialLetterhead={headerUrl:HEADER,footerUrl:FOOTER,apply:apply};
})();