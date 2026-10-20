/* Swnw partnership PDF export — exports the exact WYSIWYG A4 preview pages. */
(function(){
'use strict';
var OFFICIAL='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/assets/img/swnw-official-letterhead.png';
function installOfficialArtworkStyle(){if(document.getElementById('swnw-partnership-official-artwork-style'))return;var s=document.createElement('style');s.id='swnw-partnership-official-artwork-style';s.textContent='.swnw-page>.swnw-page-header,.swnw-page>.swnw-page-footer,.swnw-page>.swnw-page-watermark{display:none!important}.swnw-page>.swnw-page-official-artwork{position:absolute!important;inset:0!important;width:210mm!important;height:297mm!important;max-width:none!important;object-fit:fill!important;display:block!important;z-index:0!important;pointer-events:none!important}.swnw-page>.swnw-page-body{z-index:2!important}.swnw-page>.swnw-system-note{z-index:3!important}';document.head.appendChild(s);}
function officialize(root){installOfficialArtworkStyle();(root||document).querySelectorAll('.swnw-page').forEach(function(page){page.querySelectorAll('.swnw-page-header,.swnw-page-footer,.swnw-page-watermark').forEach(function(x){x.remove();});var img=page.querySelector('.swnw-page-official-artwork');if(!img){img=document.createElement('img');img.className='swnw-page-official-artwork';img.alt='';img.setAttribute('crossorigin','anonymous');page.insertBefore(img,page.firstChild);}if(img.src!==OFFICIAL)img.src=OFFICIAL;});}
function hookPaginator(){var api=window.SSMPDOfficialLetterhead;if(!api||api.__officialArtworkHooked)return;var old=api.paginate;api.paginate=function(doc){if(old)old(doc);officialize(doc);};api.headerUrl=OFFICIAL;api.footerUrl=OFFICIAL;api.watermarkUrl=OFFICIAL;api.officialArtworkUrl=OFFICIAL;api.__officialArtworkHooked=true;officialize(document);}
hookPaginator();new MutationObserver(function(){hookPaginator();officialize(document);}).observe(document.documentElement,{childList:true,subtree:true});
function load(src,test){return new Promise(function(resolve,reject){if(test())return resolve();var s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=function(){reject(new Error('library-load'));};document.head.appendChild(s);});}
function name(doc){var t=(doc.querySelector('.swnw-page h2')||doc.querySelector('h2')||{}).textContent||'Partnership';return 'SWNW-'+(t.indexOf('اتفاق')>=0?'Final-Agreement':'Partnership-Proposal')+'.pdf';}
function waitImages(root){var imgs=Array.from(root.querySelectorAll('img'));return Promise.all(imgs.map(function(i){if(i.complete&&i.naturalWidth)return Promise.resolve();return new Promise(function(resolve,reject){i.addEventListener('load',resolve,{once:true});i.addEventListener('error',reject,{once:true});});}));}
function nativePrint(doc){
  officialize(doc);var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
  var w=window.open('','_blank');if(!w)throw new Error('popup-blocked');
  var css=(window.SSMPDOfficialLetterhead||{}).fontCss||'';
  w.document.write('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>'+name(doc)+'</title><style>'+css+'@page{size:A4;margin:0}html,body{margin:0;background:#fff}.swnw-page{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;background:#fff}.swnw-page:last-child{page-break-after:auto}.swnw-page-header,.swnw-page-footer,.swnw-page-watermark{display:none!important}.swnw-page-official-artwork{position:absolute;inset:0;width:210mm;height:297mm;max-width:none;object-fit:fill;display:block;z-index:0}.swnw-page-body{position:absolute;z-index:2;top:43mm;bottom:42mm;right:15mm;left:15mm;overflow:hidden;font-family:BigVesta Arabic,Tahoma,sans-serif;font-size:16px;line-height:1.85}h2{font-size:27px;color:#0f369d;text-align:center}h3{font-size:19px;color:#0f369d}p,li{font-size:16px;line-height:1.85}.swnw-latin-number{font-family:Swnw Hiragino,Arial,sans-serif}.swnw-percentage{font-family:Swnw Hiragino,Arial,sans-serif;font-weight:800}.ce-hub-doc-footer{font-size:9.5px;color:#777;text-align:center}</style></head><body>'+pages.map(function(p){return p.outerHTML;}).join('')+'</body></html>');
  w.document.close();setTimeout(function(){w.focus();w.print();},700);
}
function render(doc){
  var api=window.SSMPDOfficialLetterhead||{};if(api.apply)api.apply(doc);if(api.paginate)api.paginate(doc);officialize(doc);
  return load('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',function(){return !!(window.html2canvas&&window.jspdf&&window.jspdf.jsPDF);}).then(function(){return Promise.all([document.fonts?document.fonts.ready:Promise.resolve(),waitImages(doc)]);}).then(function(){
    var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('no-pages');
    var PDF=window.jspdf.jsPDF,pdf=new PDF({unit:'mm',format:'a4',orientation:'portrait'});
    var chain=Promise.resolve();
    pages.forEach(function(page,index){chain=chain.then(function(){
      var rect=page.getBoundingClientRect();
      return window.html2canvas(page,{scale:2,useCORS:true,backgroundColor:'#fff',logging:false,width:Math.round(rect.width),height:Math.round(rect.height),windowWidth:Math.round(rect.width),windowHeight:Math.round(rect.height),scrollX:0,scrollY:0,onclone:function(cloned){var cp=cloned.querySelector('.swnw-page[data-page="'+page.dataset.page+'"]');if(cp){cp.style.width='210mm';cp.style.height='297mm';cp.style.minWidth='210mm';cp.style.minHeight='297mm';cp.style.margin='0';cp.style.transform='none';cp.style.boxShadow='none';}}}).then(function(canvas){if(index)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.98),'JPEG',0,0,210,297,undefined,'FAST');});
    });});
    return chain.then(function(){pdf.save(name(doc));});
  });
}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pdf],#ceh-saved-pdf');if(!b)return;var scope=b.closest('.ce-hub-body')||document,doc=scope.querySelector('#ceh-document');if(!doc)return;e.preventDefault();e.stopImmediatePropagation();render(doc).catch(function(err){console.warn('Direct PDF failed; using native print',err);try{nativePrint(doc);}catch(e2){console.error(e2);alert('تعذر فتح الطباعة. تأكد من السماح بالنوافذ المنبثقة ثم حاول مرة أخرى.');}});},true);
window.SSMPDPartnershipPdf={render:render,nativePrint:nativePrint,officialize:officialize};
})();