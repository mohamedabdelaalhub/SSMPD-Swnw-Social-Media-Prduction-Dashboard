/* Interface-only localization. Data, input values and permissions are never translated. */
(function () {
  'use strict';
  var key='ssmpd_language', language='ar', pending=false;
  try { if(localStorage.getItem(key)==='en')language='en'; } catch(e) {}
  var dict=window.SSMPD_TRANSLATIONS||{};
  function t(ar){return language==='en'&&dict[ar]?dict[ar]:ar;}
  function textHtml(ar){return '<!--ssmpd-i18n:'+encodeURIComponent(ar)+'-->'+String(ar).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function apply(){
    pending=false;
    document.documentElement.lang=language;
    document.documentElement.dir=language==='en'?'ltr':'rtl';
    document.title=language==='en'?'Content dashboard — Swnw':'لوحة إنتاج المحتوى — Swnw';
    var walker=document.createTreeWalker(document.body,128),node;
    while((node=walker.nextNode())){
      if(node.data.indexOf('ssmpd-i18n:')!==0)continue;
      var next=node.nextSibling;
      if(next&&next.nodeType===3){var ar=decodeURIComponent(node.data.slice(11)),value=t(ar);if(next.data!==value)next.data=value;}
    }
    document.querySelectorAll('[data-i18n-text]').forEach(function(el){var value=t(decodeURIComponent(el.dataset.i18nText));if(el.textContent!==value)el.textContent=value;});
    ['placeholder','title','aria-label'].forEach(function(attr){document.querySelectorAll('[data-i18n-'+attr+']').forEach(function(el){var value=t(decodeURIComponent(el.getAttribute('data-i18n-'+attr)));if(el.getAttribute(attr)!==value)el.setAttribute(attr,value);});});
    document.querySelectorAll('[data-language-switch]').forEach(function(el){var label=language==='ar'?'English':'العربية';if(el.textContent!==label)el.textContent=label;el.setAttribute('aria-label',language==='ar'?'Switch interface to English':'تغيير لغة الواجهة إلى العربية');});
  }
  function set(lang){if(lang!=='ar'&&lang!=='en')return;language=lang;try{localStorage.setItem(key,lang);}catch(e){}apply();document.dispatchEvent(new CustomEvent('ssmpd:languagechange',{detail:{language:lang}}));}
  function button(){return '<button type="button" class="btn ghost sm language-switch" data-language-switch dir="auto">'+(language==='ar'?'English':'العربية')+'</button>';}
  window.SSMPDI18n={t:t,textHtml:textHtml,set:set,apply:apply,buttonHtml:button,getLanguage:function(){return language;}};
  document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';
  document.addEventListener('click',function(e){if(e.target.closest('[data-language-switch]'))set(language==='ar'?'en':'ar');});
  function start(){apply();new MutationObserver(function(records){if(pending)return;pending=true;queueMicrotask(apply);}).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
