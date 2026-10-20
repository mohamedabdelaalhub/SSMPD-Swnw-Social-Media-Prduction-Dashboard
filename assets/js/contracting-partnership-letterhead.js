/* Partnership document print identity + deterministic Swnw typography. */
(function(){
  'use strict';
  var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
  var HEADER=BASE+'assets/img/report-letterhead-header.jpg';
  var FOOTER=BASE+'assets/img/report-letterhead-footer.jpg';
  var FONT_CSS=
    "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap;}"+
    "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2');font-style:normal;font-weight:700 900;font-display:swap;}"+
    "@font-face{font-family:'Swnw Hiragino';src:url('"+BASE+"assets/fonts/Hiragino-W3.woff2') format('woff2');font-style:normal;font-weight:300 500;font-display:swap;}"+
    "@font-face{font-family:'Swnw Hiragino';src:url('"+BASE+"assets/fonts/Hiragino-W6.woff2') format('woff2');font-style:normal;font-weight:600 700;font-display:swap;}"+
    "@font-face{font-family:'Swnw Hiragino';src:url('"+BASE+"assets/fonts/Hiragino-W8.woff2') format('woff2');font-style:normal;font-weight:800 900;font-display:swap;}";

  function ensureFontStyle(){
    var old=document.getElementById('swnw-partnership-print-font');
    if(old) old.remove();
    var style=document.createElement('style');
    style.id='swnw-partnership-print-font';
    style.textContent=FONT_CSS+
      ".ce-hub-doc{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:14px;line-height:1.9;}"+
      ".ce-hub-doc :is(p,div,span,li,td,th,h1,h2,h3,h4,strong,b,label){font-family:inherit;}"+
      ".ce-hub-doc strong,.ce-hub-doc b,.ce-hub-doc h1,.ce-hub-doc h2,.ce-hub-doc h3,.ce-hub-doc h4,.ce-hub-doc th{font-weight:700!important;}"+
      ".ce-hub-doc .swnw-latin-number{font-family:'Swnw Hiragino',sans-serif!important;font-weight:400;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;display:inline-block;}"+
      ".ce-hub-doc .swnw-percentage{font-family:'Swnw Hiragino',sans-serif!important;font-weight:800!important;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;display:inline-block;}"+
      "@media print{@page{size:A4;margin:0}.ce-hub-doc{margin:0!important;box-shadow:none!important;max-width:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.swnw-official-letterhead-header,.swnw-official-letterhead-footer{position:fixed!important;width:210mm!important;max-width:none!important}.swnw-official-letterhead-header{top:0!important}.swnw-official-letterhead-footer{bottom:0!important}}";
    document.head.appendChild(style);
  }

  function routeNumericFonts(root){
    if(!root || !document.createTreeWalker) return;
    root.querySelectorAll('.swnw-latin-number,.swnw-percentage').forEach(function(el){
      el.replaceWith(document.createTextNode(el.textContent));
    });
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(node){
      if(!node.nodeValue || !/[0-9]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      var p=node.parentElement;
      if(!p || p.closest('script,style,.swnw-official-letterhead-header,.swnw-official-letterhead-footer')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    var nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(node){
      var text=node.nodeValue;
      var re=/([0-9]+(?:[.,][0-9]+)?\s*%|%\s*[0-9]+(?:[.,][0-9]+)?|[0-9]+(?:[.,][0-9]+)?)/g;
      if(!re.test(text)) return;
      re.lastIndex=0;
      var frag=document.createDocumentFragment(),last=0,m;
      while((m=re.exec(text))){
        if(m.index>last) frag.appendChild(document.createTextNode(text.slice(last,m.index)));
        var span=document.createElement('span');
        span.className=m[0].indexOf('%')!==-1?'swnw-percentage':'swnw-latin-number';
        span.textContent=m[0]; frag.appendChild(span); last=m.index+m[0].length;
      }
      if(last<text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag,node);
    });
  }

  function apply(doc){
    if(!doc) return;
    ensureFontStyle();
    doc.dataset.swnwOfficialLetterhead='yes';
    doc.style.position='relative';
    doc.style.width='210mm'; doc.style.maxWidth='100%'; doc.style.minHeight='297mm';
    doc.style.margin='0 auto'; doc.style.padding='56mm 15mm 58mm'; doc.style.boxSizing='border-box';
    doc.style.background='#fff'; doc.style.color='#1d2433';
    doc.style.setProperty('font-family',"'BigVesta Arabic',Tahoma,sans-serif",'important');
    doc.style.fontSize='14px'; doc.style.lineHeight='1.9';

    var old=doc.querySelector('.ce-hub-doc-head'); if(old) old.remove();
    doc.querySelectorAll('.swnw-official-letterhead-header,.swnw-official-letterhead-footer').forEach(function(x){x.remove();});
    var header=document.createElement('img'); header.src=HEADER; header.alt='Swnw official letterhead header'; header.className='swnw-official-letterhead-header';
    header.style.cssText='position:absolute;top:0;left:0;width:210mm;max-width:100%;display:block;z-index:0;'; doc.insertBefore(header,doc.firstChild);
    var footer=document.createElement('img'); footer.src=FOOTER; footer.alt='Swnw official letterhead footer'; footer.className='swnw-official-letterhead-footer';
    footer.style.cssText='position:absolute;bottom:0;left:0;width:210mm;max-width:100%;display:block;z-index:0;'; doc.appendChild(footer);
    Array.prototype.forEach.call(doc.children,function(el){if(el!==header&&el!==footer){el.style.position=el.style.position||'relative';el.style.zIndex='1';}});
    Array.prototype.forEach.call(doc.querySelectorAll('h1,h2,h3'),function(h){h.style.color='#0F369D';h.style.fontWeight='700';});
    routeNumericFonts(doc);
    if(document.fonts&&document.fonts.load){
      document.fonts.load("400 14px 'BigVesta Arabic'"); document.fonts.load("700 14px 'BigVesta Arabic'");
      document.fonts.load("400 14px 'Swnw Hiragino'"); document.fonts.load("800 14px 'Swnw Hiragino'");
    }
  }

  function scan(root){if(!root)return;if(root.matches&&root.matches('.ce-hub-doc'))apply(root);if(root.querySelectorAll)root.querySelectorAll('.ce-hub-doc').forEach(apply);}
  ensureFontStyle();
  var observer=new MutationObserver(function(records){records.forEach(function(r){Array.prototype.forEach.call(r.addedNodes,function(n){if(n.nodeType===1)scan(n);});});});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){scan(document);});else scan(document);
  window.SSMPDOfficialLetterhead={headerUrl:HEADER,footerUrl:FOOTER,fontCss:FONT_CSS,apply:apply,routeNumericFonts:routeNumericFonts};
})();