/* Inventory & medicines sheets — look layer (owner via inventory chat 2026-11-23: «اطلب من شات ux يظبطه»).
   Labels each table cell with its column header so the tables turn into cards on phones (CSS in inventory-look.css).
   Display only: no RPC, payload or data-* hook changes. */
(function(w,d){'use strict';
var SEL='.rvu-t,.idi-t,.mdp-t';
function label(t){var hs=[].map.call(t.querySelectorAll('thead th'),function(h){return (h.textContent||'').trim();});if(!hs.length){var first=t.querySelector('tr');if(first&&first.querySelector('th'))hs=[].map.call(first.querySelectorAll('th'),function(h){return (h.textContent||'').trim();});}
 [].forEach.call(t.querySelectorAll('tbody tr, tr'),function(tr){if(tr.querySelector('th'))return;var i=0;[].forEach.call(tr.children,function(td){var span=+td.getAttribute('colspan')||1;if(span===1&&hs[i]&&td.getAttribute('data-l')!==hs[i])td.setAttribute('data-l',hs[i]);if(span>1)td.setAttribute('data-wide','');i+=span;});});
 t.classList.add('inv-cards');}
function scan(root){[].forEach.call((root||d).querySelectorAll(SEL),label);}
var pending=false;function soon(){if(pending)return;pending=true;(w.requestAnimationFrame||setTimeout)(function(){pending=false;scan(d);});}
if(w.MutationObserver)new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var n=ms[i].target;if(n&&n.closest&&n.closest('.rx-sheet,.rvu,.idi,.mdp,.mdd,.mdr')){soon();return;}}}).observe(d.documentElement,{childList:true,subtree:true});
w.SSMPDInventoryLook={scan:scan};
})(window,document);
