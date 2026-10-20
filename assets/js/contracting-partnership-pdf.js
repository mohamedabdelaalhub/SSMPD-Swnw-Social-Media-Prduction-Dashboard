/* Swnw partnership PDF export — exports the exact WYSIWYG A4 preview pages. */
(function(){
'use strict';
function load(src,test){return new Promise(function(resolve,reject){if(test())return resolve();var s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=function(){reject(new Error('library-load'));};document.head.appendChild(s);});}
function name(doc){var t=(doc.querySelector('.swnw-page h2')||doc.querySelector('h2')||{}).textContent||'Partnership';return 'SWNW-'+(t.indexOf('اتفاق')>=0?'Final-Agreement':'Partnership-Proposal')+'.pdf';}
function waitImages(root){var imgs=Array.from(root.querySelectorAll('img'));return Promise.all(imgs.map(function(i){if(i.complete&&i.naturalWidth)return Promise.resolve();return new Promise(function(resolve,reject){i.addEventListener('load',resolve,{once:true});i.addEventListener('error',reject,{once:true});});}));}
function nativePrint(doc){
  var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
  var w=window.open('','_blank');if(!w)throw new Error('popup-blocked');
  var css=(window.SSMPDOfficialLetterhead||{}).fontCss||'';
  w.document.write('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>'+name(doc)+'</title><style>'+css+'@page{size:A4;margin:0}html,body{margin:0;background:#fff}.swnw-page{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;background:#fff}.swnw-page:last-child{page-break-after:auto}.swnw-page-header,.swnw-page-footer{position:absolute;left:0;width:210mm}.swnw-page-header{top:0}.swnw-page-footer{bottom:0}.swnw-page-watermark{position:absolute;left:50%;top:49%;transform:translate(-50%,-50%);width:58%;opacity:.035}.swnw-page-body{position:absolute;z-index:2;top:43mm;bottom:42mm;right:15mm;left:15mm;overflow:hidden;font-family:BigVesta Arabic,Tahoma,sans-serif;font-size:16px;line-height:1.85}h2{font-size:27px;color:#0f369d;text-align:center}h3{font-size:19px;color:#0f369d}p,li{font-size:16px;line-height:1.85}.swnw-latin-number{font-family:Swnw Hiragino,Arial,sans-serif}.swnw-percentage{font-family:Swnw Hiragino,Arial,sans-serif;font-weight:800}.ce-hub-doc-footer{font-size:9.5px;color:#777;text-align:center}</style></head><body>'+pages.map(function(p){return p.outerHTML;}).join('')+'</body></html>');
  w.document.close();setTimeout(function(){w.focus();w.print();},700);
}
function render(doc){
  var api=window.SSMPDOfficialLetterhead||{};if(api.apply)api.apply(doc);if(api.paginate)api.paginate(doc);
  return load('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',function(){return !!(window.html2canvas&&window.jspdf&&window.jspdf.jsPDF);}).then(function(){return Promise.all([document.fonts?document.fonts.ready:Promise.resolve(),waitImages(doc)]);}).then(function(){
    var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
    var PDF=window.jspdf.jsPDF,pdf=new PDF({unit:'mm',format:'a4',orientation:'portrait'});
    var chain=Promise.resolve();
    pages.forEach(function(page,index){chain=chain.then(function(){return window.html2canvas(page,{scale:2,useCORS:true,backgroundColor:'#fff',logging:false,width:page.scrollWidth,height:page.scrollHeight,windowWidth:page.scrollWidth,windowHeight:page.scrollHeight}).then(function(canvas){if(index)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.98),'JPEG',0,0,210,297,undefined,'FAST');});});});
    return chain.then(function(){pdf.save(name(doc));});
  });
}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pdf],#ceh-saved-pdf');if(!b)return;var scope=b.closest('.ce-hub-body')||document,doc=scope.querySelector('#ceh-document');if(!doc)return;e.preventDefault();e.stopImmediatePropagation();render(doc).catch(function(err){console.warn('Direct PDF failed; using native print',err);try{nativePrint(doc);}catch(e2){console.error(e2);alert('تعذر فتح الطباعة. تأكد من السماح بالنوافذ المنبثقة ثم حاول مرة أخرى.');}});},true);
window.SSMPDPartnershipPdf={render:render,nativePrint:nativePrint};
})();