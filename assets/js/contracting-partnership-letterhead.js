/* Partnership document print identity.
   Keep these values in lock-step with render-patients.js medical-report printing. */
(function(){
  'use strict';
  var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
  var HEADER=BASE+'assets/img/report-letterhead-header.jpg';
  var FOOTER=BASE+'assets/img/report-letterhead-footer.jpg';
  var FONT_CSS="@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2');font-weight:400;}"+
    "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2');font-weight:700;}";

  function ensureFontStyle(){
    if(document.getElementById('swnw-partnership-print-font')) return;
    var style=document.createElement('style');
    style.id='swnw-partnership-print-font';
    style.textContent=FONT_CSS+
      ".ce-hub-doc,.ce-hub-doc *{font-family:'BigVesta Arabic','Hiragino Kaku',system-ui,Tahoma,sans-serif;}"+
      ".ce-hub-doc{font-size:14px;line-height:1.9;}"+
      "@media print{@page{size:A4;margin:0}.ce-hub-doc{margin:0!important;box-shadow:none!important;max-width:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.swnw-official-letterhead-header,.swnw-official-letterhead-footer{position:fixed!important;width:210mm!important;max-width:none!important}.swnw-official-letterhead-header{top:0!important}.swnw-official-letterhead-footer{bottom:0!important}}";
    document.head.appendChild(style);
  }

  function apply(doc){
    if(!doc) return;
    ensureFontStyle();
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
    doc.style.fontFamily="'BigVesta Arabic','Hiragino Kaku',system-ui,Tahoma,sans-serif";
    doc.style.fontSize='14px';
    doc.style.lineHeight='1.9';

    var old=doc.querySelector('.ce-hub-doc-head');
    if(old) old.remove();
    doc.querySelectorAll('.swnw-official-letterhead-header,.swnw-official-letterhead-footer').forEach(function(x){x.remove();});

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
    Array.prototype.forEach.call(doc.querySelectorAll('h1,h2,h3'),function(h){h.style.color='#0F369D';});
  }

  function scan(root){
    if(!root) return;
    if(root.matches && root.matches('.ce-hub-doc')) apply(root);
    if(root.querySelectorAll) root.querySelectorAll('.ce-hub-doc').forEach(apply);
  }
  ensureFontStyle();
  var observer=new MutationObserver(function(records){
    records.forEach(function(r){Array.prototype.forEach.call(r.addedNodes,function(n){if(n.nodeType===1)scan(n);});});
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){scan(document);});
  else scan(document);
  window.SSMPDOfficialLetterhead={headerUrl:HEADER,footerUrl:FOOTER,fontCss:FONT_CSS,apply:apply};
})();