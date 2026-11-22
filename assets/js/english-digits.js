/* Owner 2026-11-22 «كل الأرقام إنجليزي»: every number the dashboard shows uses Western digits (0-9), never Arabic-Indic
   (٠-٩) or Persian (۰-۹). Loaded first. It converts text already on the page and anything added later (MutationObserver),
   the placeholder / title / aria-label / alt attributes, read-only field values, and every print window opened with
   window.open (its document.write output). What the user types is left as typed. Date / number formatting in the code
   also uses the 'ar-EG-u-nu-latn' locale. SSMPDDigits.en(text) is available to other modules. */
(function(w){'use strict';
var RX=/[٠-٩۰-۹]/,RXG=/[٠-٩۰-۹]/g;
function en(s){if(s==null)return s;s=String(s);return RX.test(s)?s.replace(RXG,function(c){var k=c.charCodeAt(0);return String(k>=0x06F0?k-0x06F0:k-0x0660);}):s;}
var ATTRS=['placeholder','title','aria-label','alt','data-tooltip'];
function fixEl(el){for(var i=0;i<ATTRS.length;i++){var v=el.getAttribute&&el.getAttribute(ATTRS[i]);if(v&&RX.test(v))el.setAttribute(ATTRS[i],en(v));}
 if((el.tagName==='INPUT'||el.tagName==='TEXTAREA')&&(el.readOnly||el.disabled)&&RX.test(el.value||''))el.value=en(el.value);
 if(el.tagName==='OPTION'&&RX.test(el.text||''))el.text=en(el.text);}
function fixTree(root){if(!root)return;
 if(root.nodeType===3){if(RX.test(root.nodeValue))root.nodeValue=en(root.nodeValue);return;}
 if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
 var tag=root.tagName;if(tag==='SCRIPT'||tag==='STYLE')return;
 var doc=root.ownerDocument||root,walker=doc.createTreeWalker(root,5,null),n;
 if(root.nodeType===1)fixEl(root);
 while((n=walker.nextNode())){if(n.nodeType===3){var p=n.parentNode;if(p&&(p.tagName==='SCRIPT'||p.tagName==='STYLE'))continue;if(RX.test(n.nodeValue))n.nodeValue=en(n.nodeValue);}else fixEl(n);}}
function watch(doc){if(!doc||!w.MutationObserver||doc.__enDigits)return;doc.__enDigits=1;
 var mo=new w.MutationObserver(function(list){for(var i=0;i<list.length;i++){var m=list[i];
  if(m.type==='characterData'){if(RX.test(m.target.nodeValue))m.target.nodeValue=en(m.target.nodeValue);}
  else if(m.type==='attributes'){fixEl(m.target);}
  else for(var j=0;j<m.addedNodes.length;j++)fixTree(m.addedNodes[j]);}});
 var pass=function(){fixTree(doc.documentElement);if(RX.test(doc.title||''))doc.title=en(doc.title);};
 mo.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});pass();
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',pass);}
function patchWin(win){try{var d=win&&win.document;if(!d||d.__enWrite)return;d.__enWrite=1;var wr=d.write,wl=d.writeln;
 d.write=function(){return wr.apply(d,Array.prototype.map.call(arguments,en));};if(wl)d.writeln=function(){return wl.apply(d,Array.prototype.map.call(arguments,en));};}catch(_){}}
if(typeof w.open==='function'&&!w.open.__en){var op=w.open,wrapped=function(){var x=op.apply(this,arguments);patchWin(x);return x;};wrapped.__en=1;w.open=wrapped;}
watch(w.document);
w.SSMPDDigits={en:en,fixTree:fixTree,patchWin:patchWin};
})(window);
