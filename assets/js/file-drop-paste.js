/* Every file picker also takes drag & drop and paste (owner 2026-11-25, main chat help 267).
   One global enhancer: it adds a small drop zone under each visible <input type=file> (also ones added later), and routes a pasted
   file (Ctrl+V, or long-press → «لصق» on a phone) to ONE input: the zone you used last, else the input inside the form/modal you are in,
   else the only file input on the page. It sets input.files through DataTransfer and fires 'input' + 'change', so the existing upload
   code runs unchanged. It respects accept / multiple / data-max-mb. Inputs that already have their own drop/paste are left alone. */
(function(w,d){'use strict';
if(w.SSMPDFileDropPaste)return;
var SKIP='.pp,[data-fdp-skip],#design-file-input';
var last=null; // the input whose zone (or the input itself) was used last
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function kb(n){n=Number(n)||0;return n>=1048576?(n/1048576).toFixed(1)+' ميجا':Math.max(1,Math.round(n/1024))+' ك.ب';}
function visible(el){return !!(el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));}
function skipped(inp){return inp.disabled||inp.readOnly||inp.closest(SKIP)||inp.hasAttribute('data-fdp-skip');}
function accepts(inp,file){var a=(inp.getAttribute('accept')||'').trim();if(!a)return true;var type=(file.type||'').toLowerCase(),name=(file.name||'').toLowerCase();
 return a.split(',').some(function(t){t=t.trim().toLowerCase();if(!t)return false;if(t.charAt(0)==='.')return name.slice(-t.length)===t;if(t.slice(-2)==='/*')return type.indexOf(t.slice(0,-1))===0;return type===t;});}
function named(file){if(file&&file.name)return file;var ext=((file&&file.type)||'image/png').split('/')[1]||'png';try{return new File([file],'صورة-ملصقة-'+(function(t){return ('0'+t.getHours()).slice(-2)+('0'+t.getMinutes()).slice(-2)+('0'+t.getSeconds()).slice(-2);})(new Date())+'.'+ext.replace('jpeg','jpg'),{type:file.type||'image/png'});}catch(_){return file;}}
function say(zone,msg,bad){var m=zone&&zone.querySelector('.fdp-msg');if(!m)return;m.textContent=msg||'';m.hidden=!msg;m.classList.toggle('is-bad',!!bad);}
function put(inp,files){var zone=inp.__fdpZone;files=[].slice.call(files||[]).filter(Boolean);if(!files.length)return false;
 var ok=files.filter(function(f){return accepts(inp,f);});if(!ok.length){say(zone,'نوع الملف ده مش مقبول هنا',true);return false;}
 var max=Number(inp.getAttribute('data-max-mb'))||0;if(max&&ok.some(function(f){return f.size>max*1048576;})){say(zone,'الملف أكبر من '+max+' ميجا',true);return false;}
 if(!inp.multiple)ok=ok.slice(0,1);
 try{var dt=new DataTransfer();ok.forEach(function(f){dt.items.add(named(f));});inp.files=dt.files;}catch(_){say(zone,'المتصفح ده مش بيدعم السحب أو اللصق — استخدم «اختر ملف»',true);return false;}
 last=inp;say(zone,'');inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));paint(inp);return true;}
function limits(inp){var a=(inp.getAttribute('accept')||'').toLowerCase(),t=[];if(/image/.test(a))t.push('صور');if(/pdf/.test(a))t.push('PDF');if(/sheet|excel|xls|csv/.test(a))t.push('Excel / CSV');if(!a)t.push('أي ملف');else if(!t.length)t.push(a.replace(/,/g,' / '));
 var mb=Number(inp.getAttribute('data-max-mb'))||0;return (mb?'أقصى حجم '+mb+' ميجا · ':'')+t.join(' أو ')+(inp.multiple?' · أكتر من ملف':'');}
function statusEl(inp){var row=inp.parentElement,st=row&&[].filter.call(row.children,function(n){return n!==inp&&n.getAttribute&&n.getAttribute('role')==='status';})[0];return st||null;}
function state(inp){var z=inp.__fdpZone,st=z&&z.__st;if(z&&z.__busy)return ['wait','بيترفع…'];if(!st)return ['ok','✓ جاهز — هيترفع مع الحفظ'];var t=(st.textContent||'').trim();
 if(!t)return ['ok','✓ جاهز — هيترفع مع الحفظ'];if(/✓|اترفع|تم/.test(t))return ['ok','✓ '+t.replace(/✓/g,'').trim()];if(/جار|بيترفع|…|\.\.\./.test(t))return ['wait',t];return ['bad','✗ '+t];}
function paint(inp){var zone=inp.__fdpZone;if(!zone)return;var out=zone.querySelector('.fdp-rows'),fs=[].slice.call(inp.files||[]);
 (zone.__urls||[]).forEach(function(u){try{URL.revokeObjectURL(u);}catch(_){}});zone.__urls=[];
 if(!fs.length){out.innerHTML='';zone.classList.remove('has-file');return;}var stt=state(inp);
 out.innerHTML=fs.map(function(f,i){var img=/^image\//.test(f.type||'')&&w.URL&&URL.createObjectURL?URL.createObjectURL(f):'';if(img)zone.__urls.push(img);var ext=((f.name||'').split('.').pop()||'ملف').slice(0,4).toUpperCase();
  return '<div class="fdp-row is-'+stt[0]+'" data-fdp-row="'+i+'">'+(img?'<img class="fdp-th" alt="" src="'+img+'">':'<span class="fdp-th'+(/pdf/i.test(ext)?' is-pdf':'')+'">'+esc(ext)+'</span>')+
  '<span class="fdp-nm"><b><bdi>'+esc(f.name||'ملف')+'</bdi></b><small>'+kb(f.size)+' · <span class="fdp-st">'+esc(stt[1])+'</span></small></span>'+
  '<button type="button" class="fdp-x" data-fdp-remove title="'+(stt[0]==='wait'?'إلغاء':'شيل الملف')+'" aria-label="شيل '+esc(f.name||'الملف')+'">'+(stt[0]==='wait'?'✕':'🗑')+'</button>'+(stt[0]==='bad'?'':'<span class="fdp-bar'+(stt[0]==='wait'?' is-ind':'')+'"><i></i></span>')+'</div>';}).join('');
 zone.classList.add('has-file');
 [].forEach.call(out.querySelectorAll('[data-fdp-remove]'),function(b){b.onclick=function(){var keep=[].slice.call(inp.files||[]).filter(function(_,k){return k!==Number(b.closest('[data-fdp-row]').getAttribute('data-fdp-row'));});
  try{var dt=new DataTransfer();keep.forEach(function(f){dt.items.add(f);});inp.files=dt.files;}catch(_){inp.value='';}zone.__busy=false;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));paint(inp);};});}
function target(inp){if(inp.__fdpAnchor||skipped(inp))return;var a=inp.closest('label')||inp.parentElement;if(!a||a===d.body||a===d.documentElement||!visible(a))return;
 inp.__fdpAnchor=a;inp.setAttribute('data-fdp','');a.classList.add('fdp-target');if(!a.title)a.title='أو اسحب ملف هنا / الصقه (Ctrl+V)';
 ['dragenter','dragover'].forEach(function(t){a.addEventListener(t,function(e){if(!e.dataTransfer||[].indexOf.call(e.dataTransfer.types||[],'Files')<0)return;e.preventDefault();a.classList.add('is-over');});});
 ['dragleave','dragend'].forEach(function(t){a.addEventListener(t,function(){a.classList.remove('is-over');});});
 a.addEventListener('drop',function(e){if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length)return;e.preventDefault();a.classList.remove('is-over');put(inp,e.dataTransfer.files);});
 a.addEventListener('click',function(){last=inp;},true);}
function enhance(inp){if(inp.__fdpZone||skipped(inp))return;if(!visible(inp)){target(inp);return;}
 var zone=d.createElement('div');zone.className='fdp-zone fdp-card';zone.setAttribute('data-fdp-zone','');
 zone.innerHTML='<div class="fdp-head"><span class="fdp-ic" aria-hidden="true">⇪</span><span><b>'+(inp.multiple?'ارفع ملفات':'ارفع ملف')+'</b><small>'+esc(limits(inp))+'</small></span></div>'+
  '<div class="fdp-drop"><button type="button" class="fdp-btn">⬆ '+(inp.multiple?'ارفع ملفات':'ارفع ملف')+'</button><p class="fdp-hint">اختار ملف أو اسحبه هنا، أو الصقه <span class="fdp-kbd">Ctrl+V</span></p>'+
  '<div class="fdp-paste" contenteditable="true" inputmode="none" role="textbox" aria-label="الصق صورة هنا" tabindex="0">الصق هنا (اضغط مطوّل)</div></div><div class="fdp-rows"></div><p class="fdp-msg" role="status" hidden></p>';
 inp.classList.add('fdp-native');inp.__fdpZone=zone;zone.__fdpInput=inp;inp.setAttribute('data-fdp','');(inp.closest('label')||inp).insertAdjacentElement('afterend',zone); // outside a <label>, or every click there would open the picker
 ['dragenter','dragover'].forEach(function(t){zone.addEventListener(t,function(e){e.preventDefault();zone.classList.add('is-over');});});
 ['dragleave','dragend'].forEach(function(t){zone.addEventListener(t,function(){zone.classList.remove('is-over');});});
 zone.addEventListener('drop',function(e){e.preventDefault();zone.classList.remove('is-over');put(inp,e.dataTransfer&&e.dataTransfer.files);});
 zone.querySelector('.fdp-btn').addEventListener('click',function(){last=inp;inp.click();});
 zone.addEventListener('pointerdown',function(){last=inp;});zone.addEventListener('mousedown',function(){last=inp;});var pz=zone.querySelector('.fdp-paste');pz.addEventListener('focus',function(){last=inp;});pz.addEventListener('input',function(){pz.textContent='الصق هنا (اضغط مطوّل)';});
 pz.addEventListener('keydown',function(e){if(!(e.ctrlKey||e.metaKey)&&e.key&&e.key.length===1)e.preventDefault();});
 inp.addEventListener('change',function(){last=inp;zone.__busy=false;paint(inp);});var st=statusEl(inp);if(st){zone.__st=st;st.classList.add('fdp-src');if(w.MutationObserver)new MutationObserver(function(){zone.__busy=false;paint(inp);}).observe(st,{childList:true,characterData:true,subtree:true});}if(inp.form)inp.form.addEventListener('submit',function(){if(inp.files&&inp.files.length&&!zone.__st){zone.__busy=true;paint(inp);}});if(inp.form)inp.form.addEventListener('reset',function(){setTimeout(function(){paint(inp);},0);});inp.addEventListener('focus',function(){last=inp;});
 paint(inp);}
function scan(root){[].forEach.call((root||d).querySelectorAll?((root||d).matches&&(root||d).matches('input[type=file]')?[root]:(root||d).querySelectorAll('input[type=file]')):[],enhance);}
var MODALS='.modal-backdrop,.fc-overlay,.wp-overlay,.dh-backdrop,[role=dialog],dialog[open],.modal';
function openScope(){var ms=[].filter.call(d.querySelectorAll(MODALS),visible);return ms.length?ms[ms.length-1]:null;}
function pick(e,files){var ae=d.activeElement,ins=function(s){return [].filter.call((s||d).querySelectorAll('input[type=file][data-fdp]'),function(i){return !skipped(i)&&i.isConnected&&(visible(i)||(i.__fdpAnchor&&visible(i.__fdpAnchor)));});};
 if(ae&&ae.classList&&ae.classList.contains('fdp-paste')){var z=ae.closest('[data-fdp-zone]');if(z&&z.__fdpInput)return z.__fdpInput;}
 var scope=openScope()||(ae&&ae!==d.body&&ae.closest&&ae.closest('form'))||null,list=ins(scope);
 if(last&&list.indexOf(last)>=0)return last;
 var fit=list.filter(function(i){return files.some(function(f){return accepts(i,f);});});
 if(fit.length>1){var exact=fit.filter(function(i){return (i.getAttribute('accept')||'').trim();});if(exact.length)fit=exact;} // an input that names the type beats a catch-all
 if(fit.length===1)return fit[0];
 if(fit.length>1){say(fit[0].__fdpZone,'فيه أكتر من خانة ملف — دوس على «الصق هنا» جوه الخانة اللي عايزها وبعدين الصق',true);return null;}
 return null;}
d.addEventListener('paste',function(e){if(e.defaultPrevented)return;var cd=e.clipboardData;if(!cd)return;var files=[];
 [].forEach.call(cd.items||[],function(it){if(it.kind==='file'){var f=it.getAsFile();if(f)files.push(f);}});if(!files.length&&cd.files&&cd.files.length)files=[].slice.call(cd.files);
 if(!files.length)return;var ae=d.activeElement;
 if(ae&&(ae.tagName==='TEXTAREA'||(ae.tagName==='INPUT'&&ae.type!=='file')||(ae.isContentEditable&&!ae.classList.contains('fdp-paste'))))return; // typing somewhere: leave it alone
 var inp=pick(e,files);if(!inp)return;e.preventDefault();put(inp,files);});
var pending=false;function rescan(){if(pending)return;pending=true;(w.requestAnimationFrame||setTimeout)(function(){pending=false;scan(d);});}
function start(){scan(d);if(w.MutationObserver)new MutationObserver(rescan).observe(d.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','class','open']});}
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start);else start();
w.SSMPDFileDropPaste={scan:scan,put:put,accepts:accepts};
})(window,document);
