/* «الخزائن والورديات» — details inside buttons, one open at a time (owner «طبقه» 2026-11-26, mockup docs/ui-references/mockups/treasury-accordion.html, help 297).
   UI only: after finance-cash.js renders the accounting «shifts» section it calls SSMPDTreasuryAccordion.wrap(body, tab). The existing nodes
   (open drawers, «طلب تسليم للرئيسية», the handover list, the shifts table + movements view) are MOVED, not rebuilt, so every button keeps its
   data-fin-action handler and the async drawers fill keeps writing into the same node. The top buttons, «ورديتي», the main-balance and count
   cards stay where they are. No RPC, no payload and no permission change. The open item survives a re-render (after an action reloads the data). */
(function(w,d){'use strict';
var openId='';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function item(id,title,sub,nodes,badge){var it=d.createElement('div');it.className='ta-item';it.setAttribute('data-ta-item',id);
 it.innerHTML='<button type="button" class="ta-h" data-ta-btn="'+id+'" aria-expanded="false" aria-controls="ta-b-'+id+'"><span><b>'+esc(title)+'</b><small data-ta-sub>'+esc(sub||'')+'</small></span><span class="ta-r"><span class="ta-badge" data-ta-badge hidden></span><span class="ta-chev" aria-hidden="true">⌄</span></span></button><div class="ta-b" id="ta-b-'+id+'" data-ta-body hidden></div>';
 var b=it.querySelector('[data-ta-body]');nodes.forEach(function(n){if(n)b.appendChild(n);});return it;}
function setBadge(it,text,need){var el=it.querySelector('[data-ta-badge]');if(!el)return;el.textContent=text||'';el.hidden=!text;el.classList.toggle('is-need',!!need);}
function show(acc,id){acc.querySelectorAll('[data-ta-item]').forEach(function(it){var on=it.getAttribute('data-ta-item')===id,btn=it.querySelector('[data-ta-btn]'),b=it.querySelector('[data-ta-body]');it.classList.toggle('open',on);btn.setAttribute('aria-expanded',on?'true':'false');b.hidden=!on;});openId=id||'';}
function needCount(root){var n=0;root.querySelectorAll('[data-fin-action="treasury-review"]').forEach(function(){n++;});return n;}
function wrap(body,tab){if(tab!=='shifts'||!body||body.querySelector('[data-ta]'))return;
 var h3=[].slice.call(body.querySelectorAll('h3')).filter(function(h){return /تسليم التحصيل للخزينة الرئيسية/.test(h.textContent);})[0];
 var drawers=body.querySelector('[data-fc-drawers]'),list=body.querySelector('[data-ho-list]');
 var hint=h3&&h3.nextElementSibling&&h3.nextElementSibling.classList.contains('fc-hint')?h3.nextElementSibling:null;
 var transfer=null;body.querySelectorAll('[data-fin-action="treasury-transfer"]').forEach(function(b){transfer=transfer||b.closest('.fc-actions');});
 var empty=!list&&h3?[].slice.call(body.querySelectorAll('.fc-empty')).filter(function(p){return h3.compareDocumentPosition(p)&4;})[0]:null;
 var table=[].slice.call(body.querySelectorAll('.fc-table')).filter(function(t){return !h3||h3.compareDocumentPosition(t)&4;})[0]||null,movements=body.querySelector('[data-fc-movements]');
 var items=[],acc=d.createElement('div');acc.className='ta';acc.setAttribute('data-ta','');
 var anchor=h3||drawers||table;if(!anchor)return;
 var dr=item('drawers','خزن التحصيل المفتوحة','كل كاشير ومعاه النقدي المسجل في عهدته',[drawers,transfer]);if(drawers||transfer)items.push(dr);
 var ho=item('handovers','تسليم الخزينة الرئيسية','الكاشير بيطلب التسليم والمسؤول بيعدّ ويعتمد',[hint,list||empty]);if(list||empty)items.push(ho);
 var rows=table?table.querySelectorAll('tbody tr').length:0;
 var sh=item('shifts','الورديات',rows?rows+' وردية في الفترة':'مفيش ورديات في الفترة',[table,movements]);if(table||movements)items.push(sh);
 if(!items.length)return;
 if(h3)h3.hidden=true;
 items.forEach(function(it){acc.appendChild(it);});
 anchor.parentNode.insertBefore(acc,anchor);
 /* counts: handovers waiting on me + the shifts rows are known now; the open drawers arrive from the existing async fill */
 var pend=list?list.querySelectorAll('[data-ho-status="pending"]').length:0;
 setBadge(ho,(pend?pend+' مستني الاستلام':(list?list.querySelectorAll('.fc-ho').length+'':'')),needCount(ho)>0);
 if(rows)setBadge(sh,String(rows),false);
 function drawerBadge(){var n=drawers?drawers.querySelectorAll('.fc-drawer').length:0,need=needCount(dr);setBadge(dr,need?need+' محتاج منك':(n?String(n):''),need>0);dr.hidden=!dr.querySelector('[data-ta-body]').children.length;}
 drawerBadge();if(drawers&&w.MutationObserver){var mo=new w.MutationObserver(function(){drawerBadge();});mo.observe(drawers,{childList:true});setTimeout(function(){mo.disconnect();drawerBadge();},15000);}
 acc.addEventListener('click',function(e){var b=e.target.closest('[data-ta-btn]');if(!b||!acc.contains(b))return;var id=b.getAttribute('data-ta-btn');show(acc,openId===id?'':id);});
 show(acc,items.some(function(it){return it.getAttribute('data-ta-item')===openId;})?openId:'');}
w.SSMPDTreasuryAccordion={wrap:wrap,_t:{show:show}};
})(window,document);
