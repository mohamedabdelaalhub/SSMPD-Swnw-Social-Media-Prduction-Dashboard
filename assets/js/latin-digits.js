/* Mohamed 2026-10-11: every design and AI text uses English digits (1234), never ١٢٣٤ / ۱۲۳۴. */
(function(){
 'use strict';
 var map={};'٠١٢٣٤٥٦٧٨٩'.split('').forEach(function(d,i){map[d]=String(i);});'۰۱۲۳۴۵۶۷۸۹'.split('').forEach(function(d,i){map[d]=String(i);});
 function latin(s){return typeof s==='string'?s.replace(/[٠-٩۰-۹]/g,function(d){return map[d];}):s;}
 function deep(v){if(typeof v==='string')return latin(v);if(Array.isArray(v))return v.map(deep);if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(k){o[k]=deep(v[k]);});return o;}return v;}
 // Canvas renderers (Dina, doctor, before/after, composer) — draw and measure with English digits.
 var P=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;
 if(P&&!P.__latinDigits){P.__latinDigits=true;['fillText','strokeText','measureText'].forEach(function(n){var f=P[n];if(f)P[n]=function(t){var a=Array.prototype.slice.call(arguments);a[0]=latin(String(t));return f.apply(this,a);};});}
 // Owner 2026-11-17: «كل الداشبورد خلي الارقام انجليزي» — every date, time and number the dashboard formats uses English digits,
 // whatever locale a screen passes ('ar', 'ar-EG', or none on an Arabic phone). Done once here by defaulting numberingSystem to 'latn'.
 function opts(o){if(o!=null&&typeof o!=='object')return o;var r={};if(o)for(var k in o)r[k]=o[k];if(!r.numberingSystem)r.numberingSystem='latn';return r;}
 if(window.Intl&&!Intl.__latinDigits){
  Intl.__latinDigits=true;
  ['NumberFormat','DateTimeFormat','RelativeTimeFormat'].forEach(function(name){
   var Orig=Intl[name];if(!Orig)return;
   var Wrapped=function(locales,options){return new Orig(locales,opts(options));};
   Wrapped.prototype=Orig.prototype;
   Object.getOwnPropertyNames(Orig).forEach(function(k){if(k!=='prototype'&&k!=='length'&&k!=='name'&&!(k in Wrapped))try{Wrapped[k]=Orig[k];}catch(e){}});
   if(Orig.supportedLocalesOf)Wrapped.supportedLocalesOf=Orig.supportedLocalesOf.bind(Orig);
   try{Object.defineProperty(Orig.prototype,'constructor',{value:Wrapped,configurable:true,writable:true});}catch(e){}
   Intl[name]=Wrapped;
  });
  [[Number.prototype,'toLocaleString'],[Date.prototype,'toLocaleString'],[Date.prototype,'toLocaleDateString'],[Date.prototype,'toLocaleTimeString']].forEach(function(x){
   var f=x[0][x[1]];x[0][x[1]]=function(locales,options){return f.call(this,locales,opts(options));};
  });
  if(window.BigInt&&BigInt.prototype.toLocaleString){var bf=BigInt.prototype.toLocaleString;BigInt.prototype.toLocaleString=function(l,o){return bf.call(this,l,opts(o));};}
 }
 // Text written with Arabic digits in the screens themselves (labels like «١) …») is shown with English digits too.
 // Only displayed text nodes change; what people type (inputs, textareas, editable areas) and scripts/styles are left alone.
 var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,INPUT:1,CODE:1,PRE:1,NOSCRIPT:1};
 function skip(n){for(var e=n.parentNode;e&&e.nodeType===1;e=e.parentNode){if(SKIP[e.nodeName]||e.isContentEditable||(e.getAttribute&&/^(|true|plaintext-only)$/.test(e.getAttribute('contenteditable')==null?'x':e.getAttribute('contenteditable')))||(e.hasAttribute&&e.hasAttribute('data-keep-digits')))return true;}return false;}
 function fixText(n){if(n.nodeType===3&&/[٠-٩۰-۹]/.test(n.nodeValue)&&!skip(n))n.nodeValue=latin(n.nodeValue);}
 function walk(root){if(!root)return;if(root.nodeType===3){fixText(root);return;}if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;if(SKIP[root.nodeName])return;
  var it=document.createTreeWalker(root,4,null),n;while((n=it.nextNode()))fixText(n);
  if(root.querySelectorAll)root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(function(e){['placeholder','title','aria-label'].forEach(function(a){var v=e.getAttribute(a);if(v&&/[٠-٩۰-۹]/.test(v))e.setAttribute(a,latin(v));});});}
 if(window.MutationObserver&&document&&!document.__latinDigits){
  document.__latinDigits=true;
  var mo=new MutationObserver(function(list){list.forEach(function(m){if(m.type==='characterData')fixText(m.target);else m.addedNodes.forEach(walk);});});
  var go=function(){walk(document.body);mo.observe(document.body,{childList:true,subtree:true,characterData:true});};
  if(document.body)go();else document.addEventListener('DOMContentLoaded',go);
 }
 window.SSMPDDigits={latin:latin,deep:deep,walk:walk};
})();
