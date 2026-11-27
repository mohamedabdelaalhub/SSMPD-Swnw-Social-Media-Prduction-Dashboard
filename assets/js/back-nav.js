/* One back arrow for every main screen (owner 2026-11-26 «وفي كل الشاشات الرئيسية كذلك», mockup docs/ui-references/mockups/accounting-back-arrow.html, help 298).
   Client-only session history: app.js switchTab() calls SSMPDBackNav.record(tab); the arrow goes back to the previous main screen via
   SSMPDGotoTab. A screen with its own sub-history (the accounting shell sections) registers it with setLocal({canBack, back}) and the
   same arrow steps through it first. Always present (rule 10), greyed when there is nowhere to go. No RPC, no storage. */
(function(w,d){'use strict';
var stack=[],cur='',going=false,local=null,MAX=30;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
/* ---- in-page back (owner 2026-11-27, rule 10): the arrow also steps back INSIDE a screen — it closes the open popup, or presses the screen's own
   «العودة إلى …» / «رجوع …» button — before it goes to the previous main screen. Nothing to register per screen: any such button is found automatically. */
var LINK_RE=/^[\s←→‹›«»]*(العودة(\s|$)|رجوع\s*$|رجوع\s+إلى\s|رجوع\s+(للأقسام|للنتايج|للقايمة|للقائمة|للقوائم|للتفاصيل|للصفحة|للسابق))/,OVERLAY='.modal-backdrop,.rx-modal,.wp-overlay,dialog[open],[role="dialog"]',CLOSE='[data-close],[data-rht-x],[data-hra-close],.modal-close,[data-x],button[aria-label="إغلاق"]',EXPLICIT='[data-back],[data-detail-back] button,[data-rx-action="back"],#ce-back,.back-link';
function shown(el){return !!(el&&el.isConnected&&!el.hidden&&!el.disabled&&el.getClientRects().length);}
function viewEl(){return d.getElementById('view-container')||d.body;}
function overlayClose(){var o=d.querySelectorAll(OVERLAY),i,c,k;for(i=o.length-1;i>=0;i--){if(!shown(o[i]))continue;c=o[i].querySelectorAll(CLOSE);for(k=0;k<c.length;k++)if(shown(c[k]))return c[k];}return null;}
function isLink(el){var t=(el.textContent||'').trim();return t.length<60&&LINK_RE.test(t);}
function pageBack(){var v=viewEl(),found=null,list,i;
 list=v.querySelectorAll(EXPLICIT);for(i=0;i<list.length;i++){if(shown(list[i])){found=found||list[i];}}
 var all=v.querySelectorAll('button,a');for(i=0;i<all.length;i++){var el=all[i];if(el.id==='back-nav-btn'||el.hasAttribute('data-acs-back')||el.closest(OVERLAY))continue;if(isLink(el)){if(!el.classList.contains('bn-link')&&!el.classList.contains('modal-close'))el.classList.add('bn-link');if(!found&&shown(el))found=el;}}
 return found;}
function target(){return overlayClose()||pageBack();}
function canBack(){return !!((local&&local.canBack&&local.canBack())||target()||stack.length);}
function button(){var b=d.getElementById('back-nav-btn');if(b)return b;var tools=d.querySelector('.topbar-tools');if(!tools)return null;
 b=d.createElement('button');b.type='button';b.id='back-nav-btn';b.className='btn ghost sm header-icon back-nav-btn';b.setAttribute('aria-label','رجوع للصفحة السابقة');b.title='رجوع';
 b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
 b.onclick=function(){back();};tools.appendChild(b);return b;}
function paint(){var b=button(),ok=canBack();if(b){b.disabled=!ok;b.title=ok?'رجوع':'مفيش صفحة سابقة';}var s=d.querySelector('[data-acs-back]');if(s)s.disabled=!ok;}
var obs=[],queued=false;
function later(){if(queued)return;queued=true;(w.requestAnimationFrame||setTimeout)(function(){queued=false;paint();});}
function watch(){obs.forEach(function(o){o.disconnect();});obs=[];if(!w.MutationObserver)return;[viewEl(),d.body].forEach(function(n){if(!n)return;var o=new w.MutationObserver(later);o.observe(n,{childList:true,subtree:n!==d.body});obs.push(o);});}
function record(tab){if(!tab)return;d.body.classList.toggle('bn-in-acs',tab==='accounting');
 if(tab!==cur&&!going){if(cur){stack.push(cur);if(stack.length>MAX)stack.shift();}local=null;}
 else if(tab!==cur){local=null;}
 cur=tab;watch();paint();}
function back(){if(local&&local.canBack&&local.canBack()){local.back();paint();return true;}
 var t=target();if(t){t.click();later();return true;}
 var prev=stack.pop();if(!prev){paint();return false;}
 going=true;try{if(w.SSMPDGotoTab)w.SSMPDGotoTab(prev);}finally{going=false;}paint();return true;}
w.SSMPDBackNav={record:record,back:back,canBack:canBack,setLocal:function(l){local=l||null;paint();},repaint:paint,_t:{stack:function(){return stack.slice();},current:function(){return cur;}}};
})(window,document);
