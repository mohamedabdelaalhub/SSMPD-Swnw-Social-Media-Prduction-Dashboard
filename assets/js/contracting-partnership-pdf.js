/* Swnw partnership PDF export — exports the exact shared A4 preview pages. */
(function(){
'use strict';
var OFFICIAL='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/assets/img/swnw-official-letterhead.png';
var PARTNERSHIP_SPACING_CSS='.ce-hub-doc .swnw-page-body .swnw-meta{margin-bottom:0!important;line-height:1.38!important}.ce-hub-doc .swnw-page-body .swnw-meta+.swnw-meta{margin-top:-2px!important}.ce-hub-doc .swnw-page-body h3{margin-top:30px!important;margin-bottom:1px!important}.ce-hub-doc .swnw-page-body h3:first-of-type{margin-top:22px!important}.ce-hub-doc .swnw-page-body h3+p,.ce-hub-doc .swnw-page-body h3+ul,.ce-hub-doc .swnw-page-body h3+ol{margin-top:0!important}.ce-hub-doc .swnw-letter-closing{margin-top:116px!important;margin-bottom:23px!important;font-weight:700!important}.ce-hub-doc .swnw-letter-signature{margin-top:0!important}.ce-hub-doc .swnw-letter-signature-text{font-weight:400!important}.ce-hub-doc .swnw-letter-signature-text strong{font-weight:700!important}';
function installOfficialArtworkStyle(){
  if(document.getElementById('swnw-partnership-official-artwork-style'))return;
  var s=document.createElement('style');s.id='swnw-partnership-official-artwork-style';
  s.textContent='.swnw-page>.swnw-page-header,.swnw-page>.swnw-page-footer,.swnw-page>.swnw-page-watermark{display:none!important}.swnw-page>.swnw-letterhead-bg,.swnw-page>.swnw-page-official-artwork{position:absolute!important;inset:0!important;width:210mm!important;height:297mm!important;max-width:none!important;object-fit:fill!important;display:block!important;z-index:0!important;pointer-events:none!important}.swnw-page>.swnw-page-body{z-index:2!important}.swnw-page>.swnw-system-note{z-index:3!important}';
  document.head.appendChild(s);
}
function officialize(root){
  installOfficialArtworkStyle();
  (root||document).querySelectorAll('.swnw-page').forEach(function(page){
    page.querySelectorAll('.swnw-page-header,.swnw-page-footer,.swnw-page-watermark').forEach(function(x){x.remove();});
    var images=Array.from(page.querySelectorAll('.swnw-letterhead-bg,.swnw-page-official-artwork'));
    var img=images.shift();images.forEach(function(x){x.remove();});
    if(!img){img=document.createElement('img');page.insertBefore(img,page.firstChild);}
    img.className='swnw-letterhead-bg';img.alt='';img.setAttribute('crossorigin','anonymous');
    if(img.src!==OFFICIAL)img.src=OFFICIAL;
  });
}
function hookPaginator(){
  var api=window.SSMPDOfficialLetterhead;if(!api||api.__officialArtworkHooked)return;
  var old=api.paginate;
  api.paginate=function(doc){if(old)old(doc);officialize(doc);};
  api.letterheadUrl=OFFICIAL;api.headerUrl=OFFICIAL;api.footerUrl=OFFICIAL;api.watermarkUrl=OFFICIAL;api.officialArtworkUrl=OFFICIAL;api.__officialArtworkHooked=true;
  officialize(document);
}
hookPaginator();new MutationObserver(function(){hookPaginator();officialize(document);}).observe(document.documentElement,{childList:true,subtree:true});
function load(src,test){return new Promise(function(resolve,reject){if(test())return resolve();var s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=function(){reject(new Error('library-load'));};document.head.appendChild(s);});}
function name(doc){var t=(doc.querySelector('.swnw-page h2')||doc.querySelector('h2')||{}).textContent||'Partnership';return 'SWNW-'+(t.indexOf('اتفاق')>=0?'Final-Agreement':'Partnership-Proposal')+'.pdf';}
function waitImages(root){var imgs=Array.from(root.querySelectorAll('img'));return Promise.all(imgs.map(function(i){if(i.complete&&i.naturalWidth)return Promise.resolve();return new Promise(function(resolve,reject){i.addEventListener('load',resolve,{once:true});i.addEventListener('error',reject,{once:true});});}));}
function sharedPrintCss(){
  var ids=['swnw-official-letter-style','swnw-partnership-official-artwork-style'];
  return ids.map(function(id){var s=document.getElementById(id);return s?s.textContent:'';}).join('\n')+'\n'+PARTNERSHIP_SPACING_CSS+
    '@page{size:A4;margin:0!important}html,body{margin:0!important;padding:0!important;background:#fff!important}.swnw-page{margin:0!important;box-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}';
}
function nativePrint(doc){
  var api=window.SSMPDOfficialLetterhead||{};
  if(api.paginate)api.paginate(doc);officialize(doc);
  var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
  var w=window.open('','_blank');if(!w)throw new Error('popup-blocked');
  w.document.write('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>'+name(doc)+'</title><style>'+sharedPrintCss()+'</style></head><body><div class="ce-hub-doc">'+pages.map(function(p){return p.outerHTML;}).join('')+'</div></body></html>');
  w.document.close();
  var readyFonts=w.document.fonts?w.document.fonts.ready:Promise.resolve();
  Promise.all([readyFonts,waitImages(w.document)]).then(function(){setTimeout(function(){w.focus();w.print();},100);}).catch(function(){setTimeout(function(){w.focus();w.print();},250);});
}
function prepare(doc){
  var api=window.SSMPDOfficialLetterhead||{};
  if(api.apply)api.apply(doc);
  var fonts=document.fonts?document.fonts.ready:Promise.resolve();
  return fonts.then(function(){if(api.paginate)api.paginate(doc);officialize(doc);return waitImages(doc);}).then(function(){if(api.paginate)api.paginate(doc);officialize(doc);return waitImages(doc);});
}
function render(doc){
  return prepare(doc).then(function(){
    return load('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',function(){return !!(window.html2canvas&&window.jspdf&&window.jspdf.jsPDF);});
  }).then(function(){
    var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
    var PDF=window.jspdf.jsPDF,pdf=new PDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
    var chain=Promise.resolve();
    pages.forEach(function(page,index){chain=chain.then(function(){
      return window.html2canvas(page,{scale:2,useCORS:true,allowTaint:false,backgroundColor:'#fff',logging:false,scrollX:-window.scrollX,scrollY:-window.scrollY,foreignObjectRendering:false,removeContainer:true}).then(function(canvas){
        if(index)pdf.addPage('a4','portrait');
        pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297,undefined,'FAST');
      });
    });});
    return chain.then(function(){pdf.save(name(doc));});
  });
}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pdf],#ceh-saved-pdf');if(!b)return;var scope=b.closest('.ce-hub-body')||document,doc=scope.querySelector('#ceh-document');if(!doc)return;e.preventDefault();e.stopImmediatePropagation();render(doc).catch(function(err){console.warn('Direct PDF failed; using native print',err);try{nativePrint(doc);}catch(e2){console.error(e2);alert('تعذر فتح الطباعة. تأكد من السماح بالنوافذ المنبثقة ثم حاول مرة أخرى.');}});},true);
window.SSMPDPartnershipPdf={render:render,nativePrint:nativePrint,officialize:officialize,prepare:prepare};
})();
