/* Official Swnw partnership letter template — one WYSIWYG A4 renderer for preview and PDF. */
(function(){
'use strict';
var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
var LETTERHEAD=BASE+'assets/img/swnw-official-letterhead.png';
var FONT_CSS="@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2');font-weight:400;font-display:block}"+"@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2');font-weight:700;font-display:block}"+"@font-face{font-family:'Swnw Hiragino';src:url('"+BASE+"assets/fonts/Hiragino-W3.woff2') format('woff2');font-weight:300;font-display:block}"+"@font-face{font-family:'Swnw Hiragino';src:url('"+BASE+"assets/fonts/Hiragino-W8.woff2') format('woff2');font-weight:800;font-display:block}";
var PAGE_CSS=
".ce-hub-doc{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;background:#eef2f8!important;padding:22px!important;box-sizing:border-box!important;overflow:auto!important;direction:rtl}"+
".swnw-letter-source{display:none!important}"+
".swnw-page{position:relative!important;width:210mm!important;height:297mm!important;min-width:210mm!important;min-height:297mm!important;margin:0 auto 18px!important;background:#fff!important;overflow:hidden!important;box-sizing:border-box!important;box-shadow:0 3px 18px rgba(15,54,157,.14)!important;page-break-after:always!important;break-after:page!important}"+
".swnw-page:last-child{page-break-after:auto!important;break-after:auto!important}"+
".swnw-letterhead-bg{position:absolute!important;inset:0!important;width:210mm!important;height:297mm!important;max-width:none!important;object-fit:fill!important;display:block!important;z-index:0!important;pointer-events:none!important}"+
".swnw-page-body{position:absolute!important;z-index:2!important;top:43mm!important;bottom:42mm!important;right:15mm!important;left:15mm!important;overflow:visible!important;font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:16px!important;line-height:1.78!important;color:#171717!important;letter-spacing:0!important}"+
".swnw-page-body p,.swnw-page-body li{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:16px!important;line-height:1.78!important;margin:0 0 8px!important;letter-spacing:0!important}"+
".swnw-page-body h2{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:27px!important;line-height:1.35!important;font-weight:700!important;color:#0f369d!important;text-align:center!important;margin:0 0 14px!important}"+
".swnw-page-body h3{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:19px!important;line-height:1.42!important;font-weight:700!important;color:#0f369d!important;margin:28px 0 2px!important}"+
".swnw-page-body .swnw-meta{margin:0!important;line-height:1.48!important}"+
".swnw-page-body .swnw-meta+.swnw-meta{margin-top:0!important}"+
".swnw-page-body strong,.swnw-page-body b{font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-weight:700!important}"+
".swnw-keep-together{break-inside:avoid!important;page-break-inside:avoid!important}"+
".swnw-latin-number{font-family:'Swnw Hiragino',Arial,sans-serif!important;font-weight:300!important;direction:ltr!important;unicode-bidi:isolate!important;display:inline-block!important}"+
".swnw-percentage{font-family:'Swnw Hiragino',Arial,sans-serif!important;font-weight:800!important;direction:ltr!important;unicode-bidi:isolate!important;display:inline-block!important}"+
".swnw-letter-closing{margin-top:68px!important;text-align:center!important;font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-weight:700!important;font-size:18px!important;line-height:1.55!important;break-inside:avoid!important}"+
".swnw-letter-signature{margin-top:22px!important;display:flex!important;justify-content:flex-start!important;align-items:flex-end!important;gap:18px!important;min-height:62px!important;break-inside:avoid!important}"+
".swnw-letter-signature-text{text-align:right!important;font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-weight:400!important;line-height:1.65!important}"+
".swnw-letter-signature-text strong{font-weight:700!important}"+
".swnw-page-body .ce-hub-signatures{display:flex!important;justify-content:space-between!important;gap:24px!important;margin-top:38px!important;break-inside:avoid!important;page-break-inside:avoid!important}"+
".swnw-page-body .ce-hub-signatures>div{width:48%!important}"+
".swnw-stamp-placeholder{display:none!important}"+
".ce-hub-doc-footer{display:none!important}"+
".swnw-system-note{position:absolute!important;z-index:3!important;left:30mm!important;right:30mm!important;bottom:31mm!important;text-align:center!important;font-family:'BigVesta Arabic',Tahoma,sans-serif!important;font-size:6.5px!important;line-height:1.15!important;color:#666!important;white-space:nowrap!important}"+
".swnw-letter-options{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0;padding:10px 12px;border:1px solid #dbe3f2;border-radius:12px;background:#f8faff;font-family:'BigVesta Arabic',Tahoma,sans-serif}"+
".swnw-letter-options label{display:flex;gap:6px;align-items:center;font-weight:700}"+
"@media(max-width:900px){.ce-hub-doc{padding:10px!important}.swnw-page{margin-inline:0!important}}"+
"@media print{@page{size:A4;margin:0}html,body{margin:0!important;background:#fff!important}.ce-hub-doc{padding:0!important;background:#fff!important;overflow:visible!important}.swnw-page{margin:0!important;box-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.swnw-letter-options{display:none!important}}";
function style(){var o=document.getElementById('swnw-official-letter-style');if(o)o.remove();var s=document.createElement('style');s.id='swnw-official-letter-style';s.textContent=FONT_CSS+PAGE_CSS;document.head.appendChild(s);}
function asciiDigits(t){return String(t||'').replace(/[٠-٩]/g,function(d){return '٠١٢٣٤٥٦٧٨٩'.indexOf(d);}).replace(/[۰-۹]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d);});}
function numbers(root){if(!root)return;root.querySelectorAll('.swnw-latin-number,.swnw-percentage').forEach(function(x){x.replaceWith(document.createTextNode(x.textContent));});var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),a=[];while(w.nextNode()){var n=w.currentNode,p=n.parentElement;if(!p||p.closest('script,style'))continue;var t=asciiDigits(n.nodeValue);if(t!==n.nodeValue)n.nodeValue=t;if(/[0-9]/.test(t))a.push(n);}a.forEach(function(n){var t=n.nodeValue,re=/%\s*[0-9]+(?:[.,][0-9]+)?|[0-9]+(?:[.,][0-9]+)?\s*%|[0-9]+(?:[.,][0-9]+)?/g,m,last=0,f=document.createDocumentFragment();while((m=re.exec(t))){if(m.index>last)f.appendChild(document.createTextNode(t.slice(last,m.index)));var x=document.createElement('span'),raw=m[0];if(raw.indexOf('%')>=0){x.className='swnw-percentage';x.textContent='%'+raw.replace(/%/g,'').trim();}else{x.className='swnw-latin-number';x.textContent=raw;}f.appendChild(x);last=m.index+raw.length;}if(last){if(last<t.length)f.appendChild(document.createTextNode(t.slice(last)));n.replaceWith(f);}});}
function meta(root){Array.from(root.querySelectorAll('p')).slice(0,6).forEach(function(p){var b=p.querySelector('b');if(!b)return;var t=b.textContent.replace(/[:：]/g,'').trim();if(t==='المؤسسة'||t==='التاريخ'){b.textContent=t+': ';p.classList.add('swnw-meta');}});}
function isProposal(root){var h=root.querySelector('h2');return !!(h&&h.textContent.indexOf('عرض شراكة')>=0);}
function ending(root){
  var proposal=isProposal(root);
  if(proposal){
    root.querySelectorAll('.ce-hub-signatures').forEach(function(x){x.remove();});
    var close=root.querySelector('.swnw-letter-closing');
    if(!close){close=document.createElement('div');close.className='swnw-letter-closing';root.appendChild(close);}
    close.textContent='وتفضلوا بقبول فائق الاحترام والتقدير';
    var sig=root.querySelector('.swnw-letter-signature');
    if(!sig){sig=document.createElement('div');sig.className='swnw-letter-signature';root.appendChild(sig);}
    sig.innerHTML='<div class="swnw-letter-signature-text"><strong>د. دينا حسني</strong><br>مدير المركز</div>';
  }else{
    root.querySelectorAll('.swnw-letter-closing,.swnw-letter-signature').forEach(function(x){x.remove();});
  }
  var note=root.querySelector('.ce-hub-doc-footer');if(note)note.remove();
}
function page(){var p=document.createElement('section');p.className='swnw-page';p.innerHTML='<img class="swnw-letterhead-bg" crossorigin="anonymous" src="'+LETTERHEAD+'" alt=""><div class="swnw-page-body"></div>';return p;}
function overflow(body){return body.scrollHeight>body.clientHeight+1;}
function nextPage(doc){var p=page();doc.appendChild(p);return p;}
function splitTextBlock(el,doc,current){
  var words=String(el.textContent||'').trim().split(/\s+/).filter(Boolean),body=current.querySelector('.swnw-page-body');
  if(!words.length)return current;
  var part=el.cloneNode(false);part.textContent='';body.appendChild(part);
  words.forEach(function(word){
    var before=part.textContent;
    part.textContent=before+(before?' ':'')+word;
    if(overflow(body)){
      part.textContent=before;
      current=nextPage(doc);body=current.querySelector('.swnw-page-body');part=el.cloneNode(false);part.textContent=word;body.appendChild(part);
    }
  });
  return current;
}
function appendMeasured(el,doc,current){
  var body=current.querySelector('.swnw-page-body'),c=el.cloneNode(true);body.appendChild(c);
  if(!overflow(body))return current;
  c.remove();
  if(body.children.length){current=nextPage(doc);body=current.querySelector('.swnw-page-body');c=el.cloneNode(true);body.appendChild(c);}
  else{body.appendChild(c);}
  if(!overflow(body))return current;
  c.remove();
  if(el.tagName==='P'&&!el.children.length)return splitTextBlock(el,doc,current);
  body.appendChild(c);
  return current;
}
function splitList(list,doc,current){
  var body=current.querySelector('.swnw-page-body'),shell=list.cloneNode(false);body.appendChild(shell);
  Array.from(list.children).forEach(function(li){
    var c=li.cloneNode(true);shell.appendChild(c);
    if(overflow(body)){
      c.remove();
      if(!shell.children.length)shell.remove();
      current=nextPage(doc);body=current.querySelector('.swnw-page-body');shell=list.cloneNode(false);body.appendChild(shell);shell.appendChild(c);
    }
  });
  return current;
}
function appendPair(first,second,doc,current){
  var wrap=document.createElement('div');wrap.className='swnw-keep-together';wrap.appendChild(first.cloneNode(true));wrap.appendChild(second.cloneNode(true));
  var body=current.querySelector('.swnw-page-body');body.appendChild(wrap);
  if(!overflow(body))return current;
  wrap.remove();
  if(body.children.length){current=nextPage(doc);body=current.querySelector('.swnw-page-body');body.appendChild(wrap);}
  else{body.appendChild(wrap);}
  if(!overflow(body))return current;
  wrap.remove();
  current=appendMeasured(first,doc,current);
  if(second.tagName==='UL'||second.tagName==='OL')return splitList(second,doc,current);
  return appendMeasured(second,doc,current);
}
function paginate(doc,source){
  doc.querySelectorAll('.swnw-page').forEach(function(x){x.remove();});
  var current=page();doc.appendChild(current);
  var els=Array.from(source.children).filter(function(el){return !(el.classList&&el.classList.contains('swnw-letter-options'));});
  for(var i=0;i<els.length;i++){
    var el=els[i],next=els[i+1];
    if((el.classList&&el.classList.contains('swnw-letter-closing'))&&next&&next.classList&&next.classList.contains('swnw-letter-signature')){current=appendPair(el,next,doc,current);i++;continue;}
    if(el.tagName==='H3'&&next){current=appendPair(el,next,doc,current);i++;continue;}
    if(el.tagName==='UL'||el.tagName==='OL'){current=splitList(el,doc,current);continue;}
    current=appendMeasured(el,doc,current);
  }
  var pages=Array.from(doc.querySelectorAll('.swnw-page'));pages.forEach(function(p,i){p.dataset.page=(i+1)+'/'+pages.length;});
  if(pages.length){var note=document.createElement('div');note.className='swnw-system-note';note.textContent='المستند صادر من نظام إدارة الشراكات بعيادات سونو. النسخة المعتمدة تحمل رقم إصدار ولا يتم تعديلها بعد الإرسال.';pages[pages.length-1].appendChild(note);}
}
function options(doc,source){
  var body=doc.closest('.ce-hub-body')||doc.parentElement;if(!body||body.querySelector('.swnw-letter-options'))return;
  var bar=document.createElement('div');bar.className='swnw-letter-options';bar.innerHTML='<label><input type="checkbox" data-swnw-signature checked> بيانات التوقيع</label>';doc.insertAdjacentElement('afterend',bar);
  bar.querySelector('[data-swnw-signature]').onchange=function(){source.querySelectorAll('.swnw-letter-signature,.ce-hub-signatures').forEach(function(e){e.style.display=this.checked?'flex':'none';},this);paginate(doc,source);};
}
function apply(doc){
  if(!doc)return;style();
  if(doc.dataset.swnwBuilt==='yes'){var src=doc.querySelector('.swnw-letter-source');if(src){meta(src);ending(src);numbers(src);paginate(doc,src);}return;}
  doc.dataset.swnwBuilt='yes';
  var old=doc.querySelector('.ce-hub-doc-head');if(old)old.remove();
  var source=document.createElement('div');source.className='swnw-letter-source';Array.from(doc.childNodes).forEach(function(n){source.appendChild(n);});doc.appendChild(source);
  meta(source);ending(source);numbers(source);options(doc,source);
  var ready=document.fonts?Promise.all([document.fonts.load("400 16px 'BigVesta Arabic'"),document.fonts.load("700 16px 'BigVesta Arabic'"),document.fonts.load("300 16px 'Swnw Hiragino'"),document.fonts.load("800 16px 'Swnw Hiragino'")]).catch(function(){}):Promise.resolve();
  ready.then(function(){paginate(doc,source);setTimeout(function(){paginate(doc,source);},120);});
}
function scan(r){if(!r)return;if(r.matches&&r.matches('.ce-hub-doc'))apply(r);if(r.querySelectorAll)r.querySelectorAll('.ce-hub-doc').forEach(apply);}
style();
new MutationObserver(function(rs){rs.forEach(function(r){Array.from(r.addedNodes).forEach(function(n){if(n.nodeType===1)scan(n);});});}).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){scan(document);});else scan(document);
window.SSMPDOfficialLetterhead={letterheadUrl:LETTERHEAD,headerUrl:LETTERHEAD,footerUrl:LETTERHEAD,watermarkUrl:LETTERHEAD,fontCss:FONT_CSS,pageCss:PAGE_CSS,apply:apply,routeNumericFonts:numbers,paginate:function(doc){var s=doc&&doc.querySelector('.swnw-letter-source');if(s)paginate(doc,s);}};
})();
