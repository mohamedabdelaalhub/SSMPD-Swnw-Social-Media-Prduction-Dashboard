/* Owner 2026-11-21 («طبقه», mockup docs/ui-references/mockups/reminders-compact.html): «متابعات مطلوبة» and «تذكيرات غداً»
   are two small cards side by side (numbers only); a click opens the full list in a sheet over the page, «إغلاق» (or Esc /
   a click outside) closes it. Shared by reception-follow-ups.js and reception-reminders.js.
   SSMPDMiniCards.slot(host, key, order) → the mini-card element in the shared row (created after the «مصاريف» card if any);
   SSMPDMiniCards.sheet(key, title, content|null, onClose) → shows / replaces / (null) removes the sheet. */
(function(w,d){'use strict';
function row(host){var r=host.querySelector('[data-rx-minirow]');if(r)return r;r=d.createElement('div');r.className='rx-minirow';r.setAttribute('data-rx-minirow','');
 var anchor=host.querySelector('[data-rse]')||host.querySelector('.rx-section,.rx-mode-card');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(r,anchor.nextSibling);else host.prepend(r);return r;}
function slot(host,key,order){var r=row(host),el=r.querySelector('[data-mini="'+key+'"]');if(el)return el;el=d.createElement('button');el.type='button';el.className='rx-mini';el.setAttribute('data-mini',key);el.style.order=String(order||0);r.appendChild(el);return el;}
function close(back,onClose){if(!back||!back.isConnected)return;back.remove();d.removeEventListener('keydown',back._esc);if(back._from&&back._from.isConnected)back._from.focus();if(onClose)onClose();}
function sheet(key,title,content,onClose){var back=d.querySelector('[data-rx-sheet="'+key+'"]');
 if(!content){if(back){d.removeEventListener('keydown',back._esc);back.remove();}return null;}
 if(!back){back=d.createElement('div');back.className='rx-sheet-back';back.setAttribute('data-rx-sheet',key);
  back.innerHTML='<section class="rx-sheet" role="dialog" aria-modal="true"><header class="rx-sheet-head"><h3></h3><button type="button" class="rx-sheet-x" data-rx-sheet-close>✕ إغلاق</button></header><div class="rx-sheet-body"></div></section>';
  back._from=d.activeElement;d.body.appendChild(back);
  back.addEventListener('click',function(e){if(e.target===back||(e.target.closest&&e.target.closest('[data-rx-sheet-close]')))close(back,onClose);});
  back._esc=function(e){if(e.key==='Escape')close(back,onClose);};d.addEventListener('keydown',back._esc);
  setTimeout(function(){var x=back.querySelector('[data-rx-sheet-close]');if(x)x.focus();},0);}
 back.querySelector('.rx-sheet').setAttribute('aria-label',title);back.querySelector('h3').textContent=title;
 var body=back.querySelector('.rx-sheet-body');body.innerHTML='';body.appendChild(content);return back;}
w.SSMPDMiniCards={slot:slot,sheet:sheet};
})(window,document);
