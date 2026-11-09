/* Viewport-safe main navigation. Only reorganizes already-authorized links. */
(function(root){'use strict';var cleanup=function(){},current='',liveMenu=null;
function normalized(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');}
function setCurrent(tab){current=tab;var menu=document.getElementById('user-dropdown');if(menu)menu.querySelectorAll('[data-goto]').forEach(function(b){if(b.dataset.goto===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});openCurrentGroup(menu);}
/* القائمة في مجموعات (موافقة المالك 2026-11-08): نفس الأزرار المسموحة بس، متجمعة. مجموعة واحدة مفتوحة في المرة. */
var GROUPS=[['الرئيسية',['home','my_kpi','summary']],['الاستقبال والمرضى',['reception_services','leads','patients','booking_cash','clinic_info']],['المالية والتعاقدات',['accounting','contracting_entities','price_lists','inventory']],['المحتوى والتسويق',['production','review','design','publish','comments','archive','performance','metaads','mediabuyer']],['الفريق والإدارة',['tasks','human_resources','staff_kpi','indicator_reports','admin']]];
function groupOf(key){for(var i=0;i<GROUPS.length;i++)if(GROUPS[i][1].indexOf(key)!==-1)return i;return -1;}
function openCurrentGroup(menu){if(!menu)return;var input=menu.querySelector('.nav-menu-search input');if(input&&input.value.trim())return;var cur=current&&menu.querySelector('.ud-group [data-goto="'+current+'"]'),box=cur&&cur.closest('.ud-group');menu.querySelectorAll('.ud-group').forEach(function(d){d.open=d===box;});}
/* المالك عمّمها 2026-11-09 بعد المعاينة على حسابات التجربة. */
function groupItems(items){if(!items||items.dataset.grouped)return;items.dataset.grouped='1';var bar=document.getElementById('tabs-bar'),suite=bar?Array.from(bar.querySelectorAll('.tab-btn[data-tab]')):[];
 if(suite.length>1&&suite.every(function(b){return groupOf(b.dataset.tab)===3||groupOf(b.dataset.tab)===0;})){var entry=items.querySelector('.ud-item[data-goto="'+suite[0].dataset.tab+'"]');if(entry){suite.forEach(function(t){var b=document.createElement('button');b.type='button';b.className='ud-item';b.dataset.goto=t.dataset.tab;b.dataset.suite='1';b.innerHTML=t.innerHTML;entry.before(b);});entry.remove();}}
 var all=Array.from(items.children).filter(function(n){return n.classList.contains('ud-item');}),buckets=GROUPS.map(function(){return [];}),rest=[];
 all.forEach(function(n){var g=n.dataset.goto?groupOf(n.dataset.goto):-1;if(g<0)rest.push(n);else buckets[g].push(n);});
 if(buckets.filter(function(b){return b.length;}).length<2)return;
 var frag=document.createDocumentFragment();buckets.forEach(function(list,i){if(!list.length)return;if(list.length===1){frag.appendChild(list[0]);return;}var d=document.createElement('details');d.className='ud-group';d.setAttribute('name','ud-group');var sm=document.createElement('summary');sm.innerHTML='<span></span><em></em>';sm.firstChild.textContent=GROUPS[i][0];sm.lastChild.textContent=String(list.length);d.appendChild(sm);list.forEach(function(n){d.appendChild(n);});d.addEventListener('toggle',function(){if(d.open)items.querySelectorAll('.ud-group[open]').forEach(function(o){if(o!==d)o.open=false;});});frag.appendChild(d);});
 rest.forEach(function(n){frag.appendChild(n);});items.insertBefore(frag,items.firstChild);}

function mount(){
 var menu=document.getElementById('user-dropdown');if(menu&&menu===liveMenu)return;cleanup();liveMenu=menu;var toggle=document.getElementById('user-menu-btn'),mobile=document.getElementById('menu-toggle-btn'),roleToggle=document.getElementById('header-roles-btn'),legacy=document.getElementById('mobile-menu');if(!menu||!toggle)return;
 var items=menu.querySelector('.ud-items'),origin=toggle;groupItems(items);
 var top=document.createElement('div');top.className='nav-menu-head';top.innerHTML='<strong>القائمة الرئيسية</strong><button type="button" aria-label="إغلاق القائمة">×</button>';menu.prepend(top);
 var search=document.createElement('label');search.className='nav-menu-search';search.innerHTML='<span>الوصول إلى قسم</span><input type="search" placeholder="ابحث عن قسم…" aria-label="بحث في القائمة">';items.before(search);var input=search.querySelector('input');
 var empty=document.createElement('p');empty.className='nav-menu-empty';empty.textContent='لا توجد أقسام مطابقة.';empty.hidden=true;items.appendChild(empty);
 var shade=document.createElement('div');shade.className='nav-menu-shade';shade.hidden=true;shade.setAttribute('aria-hidden','true');menu.before(shade);
 menu.setAttribute('role','region');menu.setAttribute('aria-label','القائمة الرئيسية');
 [toggle,mobile,roleToggle].filter(Boolean).forEach(function(b){b.setAttribute('aria-controls','user-dropdown');b.setAttribute('aria-expanded','false');});
 function layout(){if(!menu.isConnected)return;var bar=document.querySelector('.topbar');if(!bar)return;var viewport=root.visualViewport,height=viewport?viewport.height:root.innerHeight;var rect=bar.getBoundingClientRect();var y=Math.min(Math.max(8,rect.bottom+8),Math.max(8,height-180));menu.style.maxWidth=Math.max(80,Math.min(350,document.documentElement.clientWidth-24))+'px';menu.style.setProperty('--nav-menu-top',y+'px');menu.style.setProperty('--nav-menu-height',Math.max(80,height-y-12)+'px');}
 function sync(){var open=menu.classList.contains('open');shade.hidden=!open;[toggle,mobile,roleToggle].filter(Boolean).forEach(function(b){b.setAttribute('aria-expanded',String(open));});}
 function filter(){var query=normalized(input.value.trim()),n=0;items.querySelectorAll('.ud-item').forEach(function(b){b.hidden=!!query&&!normalized(b.textContent).includes(query);if(!b.hidden)n++;});empty.hidden=!!n;items.querySelectorAll('.ud-group').forEach(function(d){if(query){var any=Array.from(d.querySelectorAll('.ud-item')).some(function(b){return !b.hidden;});d.hidden=!any;d.open=any;}else d.hidden=false;var c=Array.from(d.querySelectorAll('.ud-item')).filter(function(b){return !b.hidden&&b.getAttribute('aria-hidden')!=='true';}).length,em=d.querySelector('summary em');if(em)em.textContent=String(c);if(!query&&!c)d.hidden=true;});if(!query)openCurrentGroup(menu);}
 function close(focus){menu.classList.remove('open');sync();if(focus&&origin.isConnected)origin.focus();}
 function open(b){origin=b;if(legacy)legacy.classList.remove('open');input.value='';filter();layout();menu.classList.add('open');sync();input.focus();}
 [toggle,mobile,roleToggle].filter(Boolean).forEach(function(b){b.onclick=function(e){e.stopPropagation();if(menu.classList.contains('open'))close(true);else open(b);};});
 input.oninput=filter;top.querySelector('button').onclick=function(){close(true);};shade.onclick=function(){close(true);};
 function onKeys(e){if(!menu.isConnected){cleanup();return;}if(!menu.classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();close(true);return;}
 var focusable=Array.from(menu.querySelectorAll('button,input,a[href]')).filter(function(n){return !n.disabled&&!n.hidden&&!n.closest('[hidden]');}),at=focusable.indexOf(document.activeElement),first=focusable[0],last=focusable[focusable.length-1];
 if(e.key==='Tab'&&((e.shiftKey&&at===0)||(!e.shiftKey&&document.activeElement===last))){e.preventDefault();(e.shiftKey?last:first).focus();}
 var links=Array.from(items.querySelectorAll('.ud-item')).filter(function(n){return !n.hidden&&!n.closest('.ud-group:not([open])');});if((e.key==='ArrowDown'||e.key==='ArrowUp')&&(document.activeElement===input||links.includes(document.activeElement))&&links.length){e.preventDefault();var i=links.indexOf(document.activeElement);links[(i+(e.key==='ArrowDown'?1:-1)+links.length)%links.length].focus();}
 }
 function selected(e){var s=e.target.closest('.ud-item[data-suite]');if(s){var t=document.querySelector('#tabs-bar .tab-btn[data-tab="'+s.dataset.goto+'"]');if(t)t.click();}if(e.target.closest('.ud-item,.mm-logout'))close(false);}
 menu.addEventListener('click',selected);document.addEventListener('keydown',onKeys);root.addEventListener('resize',layout);if(root.visualViewport)root.visualViewport.addEventListener('resize',layout);
 var observer=new MutationObserver(sync);observer.observe(menu,{attributes:true,attributeFilter:['class']});
 cleanup=function(){observer.disconnect();menu.removeEventListener('click',selected);document.removeEventListener('keydown',onKeys);root.removeEventListener('resize',layout);if(root.visualViewport)root.visualViewport.removeEventListener('resize',layout);shade.remove();};
 setCurrent(current);sync();
}
root.SSMPDNavigationUI={mount:mount,setCurrent:setCurrent};
})(window);
