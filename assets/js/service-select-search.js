/* Searchable service lists everywhere (owner 2026-11-23, angry: «طلب خدمة أثناء الزيارة» was a plain list of thousands of services).
   Any <select> of services (name="service_id", or data-service-select) with many options gets a search box right above it:
   type part of the name, the code, the department or an alias → the list shrinks to the matches (shown open, 8 rows); one match
   is chosen by itself. The select stays the real form field, so every form keeps working unchanged. Arabic letters are normalised
   (أ/إ/آ → ا، ة → ه، ى → ي، no tashkeel), every word must match. The booking form's own combobox (#rx-svc-q) is left alone. */
(function(w,d){'use strict';
var MIN=12;
function norm(v){return String(v==null?'':v).toLowerCase().replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ').trim();}
function eligible(sel){if(!sel||sel.tagName!=='SELECT'||sel.multiple||sel.hasAttribute('data-sss')||sel.hasAttribute('data-sss-off'))return false;
 if(!(sel.name==='service_id'||sel.hasAttribute('data-service-select')))return false;
 if(sel.form&&sel.form.querySelector('#rx-svc-q'))return false;            // booking form: its own combobox
 return sel.options.length>=MIN;}
function enhance(sel){if(!eligible(sel))return;sel.setAttribute('data-sss','');
 var all=[];Array.prototype.forEach.call(sel.children,function(ch){if(ch.tagName==='OPTGROUP'){Array.prototype.forEach.call(ch.children,function(o){all.push({o:o,g:ch.label});});}else all.push({o:ch,g:''});});
 all.forEach(function(x){x.key=norm([x.o.textContent,x.g,x.o.value,x.o.getAttribute('data-code'),x.o.getAttribute('data-alias'),x.o.getAttribute('data-department')].join(' '));});
 var box=d.createElement('div');box.className='sss';box.innerHTML='<input type="search" class="sss-q" data-sss-q placeholder="ابحث باسم الخدمة أو الكود أو القسم" autocomplete="off" aria-label="ابحث عن الخدمة"><small class="sss-n" data-sss-n role="status"></small>';
 sel.parentNode.insertBefore(box,sel);var q=box.querySelector('input'),n=box.querySelector('small');
 function rebuild(list){var cur=sel.value,html='',groups={},order=[];list.forEach(function(x){if(x.o.value===''&&!x.g)return;var g=x.g||'';if(!groups[g]){groups[g]=[];order.push(g);}groups[g].push(x.o);});
  while(sel.firstChild)sel.removeChild(sel.firstChild);var ph=all.find(function(x){return x.o.value===''&&!x.g;});if(ph)sel.appendChild(ph.o);
  order.forEach(function(g){if(!g){groups[g].forEach(function(o){sel.appendChild(o);});return;}var og=d.createElement('optgroup');og.label=g;groups[g].forEach(function(o){og.appendChild(o);});sel.appendChild(og);});
  if(list.some(function(x){return x.o.value===cur;}))sel.value=cur;}
 q.addEventListener('input',function(){var t=norm(q.value).split(' ').filter(Boolean);
  if(!t.length){rebuild(all);sel.removeAttribute('size');n.textContent='';return;}
  var hit=all.filter(function(x){return x.o.value!==''&&t.every(function(k){return x.key.indexOf(k)>=0;});});
  rebuild(hit);sel.size=Math.max(2,Math.min(8,hit.length+1));n.textContent=hit.length?hit.length+' خدمة':'مفيش خدمة بالاسم ده — جرّب كلمة تانية أو الكود';
  if(hit.length===1){sel.value=hit[0].o.value;sel.dispatchEvent(new Event('change',{bubbles:true}));}});
 q.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var first=Array.prototype.find.call(sel.options,function(o){return o.value;});if(first){sel.value=first.value;sel.dispatchEvent(new Event('change',{bubbles:true}));sel.focus();}}
  if(e.key==='ArrowDown'){e.preventDefault();sel.focus();}});
 sel.addEventListener('change',function(){if(sel.value&&q.value){var o=sel.options[sel.selectedIndex];n.textContent='اخترت: '+(o?o.textContent:'');}});}
function scan(root){if(!root||!root.querySelectorAll)return;if(root.tagName==='SELECT')enhance(root);Array.prototype.forEach.call(root.querySelectorAll('select'),enhance);}
var mo=new MutationObserver(function(ms){ms.forEach(function(m){Array.prototype.forEach.call(m.addedNodes,function(x){if(x.nodeType===1)scan(x);});
 if(m.type==='childList'&&m.target&&m.target.tagName==='SELECT')enhance(m.target);});});
function start(){scan(d.body);mo.observe(d.body,{childList:true,subtree:true});}
if(d.body)start();else d.addEventListener('DOMContentLoaded',start);
w.SSMPDServiceSelectSearch={enhance:enhance,norm:norm,scan:scan};
})(window,document);
