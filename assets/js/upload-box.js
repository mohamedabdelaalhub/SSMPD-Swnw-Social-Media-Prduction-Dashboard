/* «خانة رفع موحّدة» (owner 2026-11-28 «موافق، نفّذ 1 لـ 4 ورقم الملف كفاية», mockup docs/ui-references/mockups/upload-unify.html).
   Every receipt / document upload in reception looks and works like the photo box of «تسجيل تحصيل» (payment-proof.js):
   📷 صوّر (camera) + 🖼 اختار صورة + paste (Ctrl+V) or drag & drop, then a thumbnail «✓ الصورة جاهزة» with «تغيير».
   «وعايز لما يرفعوا صورة او يلزقوها تتسمي اوتوماتيك باسم مناسب»: the picked/pasted file is renamed
   <kind>_<file no>_<label>_<amount>_<method>_<dd-mm>_<HH-MM>.<ext> (Arabic, Cairo time, English digits). Storage keys must be
   ASCII, so key(file) gives the same order in English plus 4 random characters (collect_P-1720_1400_visa_27-11_21-40_a7f3.jpg).
   The file number is used, never the patient name (owner: «رقم الملف كفاية»).
   The REAL <input type=file> keeps its name / data-* attributes, so the callers' change listeners and form values do not change;
   it is never opened directly (📷 / 🖼 use helper inputs) so it always receives the renamed file. */
(function(w,d){'use strict';
var MAX=10*1024*1024,TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
var KIND={collect:['تحصيل','collect'],expense:['مصروف-وردية','shift-expense'],doctor:['إيصال-طبيب','doctor-receipt'],
 discount:['إثبات-خصم','discount-proof'],relation:['إثبات-قرابة','relation-proof'],payer:['مستند-جهة','payer-proof'],
 document:['مستند','document'],result:['نتيجة','result']};
var METHOD={cash:['كاش','cash'],pos:['فيزا','visa'],instapay:['إنستاباي','instapay'],bank:['تحويل-بنكي','bank'],wallet:['محفظة','wallet']};
var EN={};[KIND,METHOD].forEach(function(m){Object.keys(m).forEach(function(k){EN[m[k][0]]=m[k][1];});});
var CSS='.ub{display:grid;gap:6px;min-width:0}.ub[hidden]{display:none!important}.ub-label{font-size:13px;font-weight:700;color:#16212E}.ub-label .ub-req{color:#D0402A}'+
 '.ub-drop{border:2px dashed #9fb2db;border-radius:14px;padding:12px;display:grid;gap:8px;justify-items:center;text-align:center;background:#F7F9FD}'+
 '.ub-drop.is-over{border-color:#0F369D;background:#EEF3FD}.ub-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}'+
 '.ub-or{font-size:12px;color:#5b6577;margin:0;line-height:1.7}.ub-kbd{display:inline-block;border:1px solid #c7d0e6;border-bottom-width:2px;border-radius:5px;padding:0 5px;font-size:11px;direction:ltr;background:#fff}'+
 '.ub-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}'+
 '.ub-done{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #cfe5da;background:#F1F8F4;border-radius:12px;padding:8px}'+
 '.ub-done[hidden],.ub-drop[hidden],.ub-err[hidden]{display:none}'+
 '.ub-done img,.ub-done .ub-pdf{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#e1e7f3;display:grid;place-items:center;font-size:11px;color:#5b6577}'+
 '.ub-done b{color:#2F7D5C;font-size:13px}.ub-done small{display:block;color:#5b6577;font-size:12px;overflow-wrap:anywhere}.ub-err{color:#D0402A;font-size:12px;margin:0}'+
 '.ub.is-compact .ub-drop{padding:8px}.ub.is-compact .ub-or{font-size:11.5px}';
function css(){if(d.getElementById('ub-css'))return;var st=d.createElement('style');st.id='ub-css';st.textContent=CSS;(d.head||d.documentElement).appendChild(st);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function kb(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
function ext(f){var m=/\.([a-z0-9]{2,5})$/i.exec((f&&f.name)||'');return m?m[1].toLowerCase():f&&f.type==='application/pdf'?'pdf':f&&f.type==='image/png'?'png':f&&f.type==='image/webp'?'webp':'jpg';}
function stamp(at){var t=at&&typeof at.getTime==='function'?at:new Date(),p={};
 try{new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(t).forEach(function(x){p[x.type]=x.value;});}
 catch(_){p={day:('0'+t.getDate()).slice(-2),month:('0'+(t.getMonth()+1)).slice(-2),hour:('0'+t.getHours()).slice(-2),minute:('0'+t.getMinutes()).slice(-2)};}
 return p.day+'-'+p.month+'_'+(p.hour==='24'?'00':p.hour)+'-'+p.minute;}
function latin(s){return String(s==null?'':s).replace(/[٠-٩]/g,function(c){return String(c.charCodeAt(0)-1632);}).replace(/[۰-۹]/g,function(c){return String(c.charCodeAt(0)-1776);});}
function part(s){return latin(s).trim().replace(/[\s_\/\\:*?"<>|#%]+/g,'-').replace(/-{2,}/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(0,40);}
function amt(v){var n=Number(latin(v));return n>0?String(Math.round(n*100)/100):'';}
/* meta {kind, fileNo, label, amount, method, at} → Arabic file name */
function name(meta,file){meta=meta||{};var k=KIND[meta.kind]||KIND.document,m=METHOD[meta.method];
 return [k[0],part(meta.fileNo),part(meta.label),amt(meta.amount),m?m[0]:'',stamp(meta.at)].filter(Boolean).join('_')+'.'+ext(file);}
function ours(n){var first=String(n||'').split('_')[0];return Object.keys(KIND).some(function(k){return KIND[k][0]===first;});}
/* Arabic name → ASCII storage key (null when the file was not named here) */
function key(file){var n=String((file&&file.name)||'');if(!ours(n))return null;var e=ext(file),base=n.replace(/\.[a-z0-9]{2,5}$/i,'');
 var bits=base.split('_').map(function(t){return EN[t]||latin(t).replace(/[^A-Za-z0-9-]+/g,'').replace(/^-+|-+$/g,'');}).filter(Boolean);
 var rnd=(w.crypto&&w.crypto.getRandomValues)?Array.prototype.map.call(w.crypto.getRandomValues(new Uint8Array(2)),function(x){return ('0'+x.toString(16)).slice(-2);}).join(''):Math.random().toString(16).slice(2,6);
 return bits.join('_').slice(0,100).replace(/[_-]+$/,'')+'_'+rnd+'.'+e;}
function rename(file,n){if(!file||!n||file.name===n)return file;try{return new File([file],n,{type:file.type,lastModified:file.lastModified});}catch(_){return file;}}
function quiet(input,file){try{var dt=new DataTransfer();if(file)dt.items.add(file);input.files=dt.files;return true;}catch(_){return false;}}
function setFile(input,file){if(!quiet(input,file))return false;input.dispatchEvent(new Event('change',{bubbles:true}));return true;}
function scopeOf(el){return (el&&el.closest&&el.closest('form,.dp-modal,[role=dialog],.rx-modal,.modal'))||d;}
/* the file number on screen: [data-ub-file-no] wins, else the picked patient «file no — name» */
function fileNoIn(scope){var x=scope.querySelector&&scope.querySelector('[data-ub-file-no]');if(x)return x.getAttribute('data-ub-file-no')||x.textContent;
 var s=scope.querySelector&&scope.querySelector('select[name=patient_id]'),o=s&&s.selectedIndex>=0&&s.value?s.options[s.selectedIndex]:null;
 var m=o&&/^\s*([^\s—]+)\s*—/.exec(o.textContent||'');return m?m[1]:'';}
function val(scope,n){var e=scope.querySelector&&scope.querySelector('[name="'+n+'"]');if(!e)return '';if(e.type==='radio'){var c=scope.querySelector('[name="'+n+'"]:checked');return c?c.value:'';}return e.value||'';}
/* default meta: the box's data-ub-* plus the form around it (amount / method / patient); box.__ubMeta() can add or override */
function metaFor(box){var scope=scopeOf(box),n=box.getAttribute('data-ub-n')||'',sfx=n?'_'+n:'';
 var m={kind:box.getAttribute('data-ub-kind')||'document',label:box.getAttribute('data-ub-label')||'',fileNo:box.getAttribute('data-ub-file-no')||fileNoIn(scope),
  amount:val(scope,'amount'+sfx),method:val(scope,'method'+sfx)};
 if(typeof box.__ubMeta==='function'){var x=box.__ubMeta()||{};Object.keys(x).forEach(function(k){if(x[k]!=null&&x[k]!=='')m[k]=x[k];});}
 return m;}
function named(box,file){if(!file)return file;var at=box.__ubAt||(box.__ubAt=new Date());var m=metaFor(box);m.at=at;return rename(file,name(m,file));}
/* markup — o: {name, attr (extra attributes on the real input), kind, label, req, take, pick, accept, hint, compact, wrap (extra attributes on the box), n, live} */
function html(o){o=o||{};css();
 return '<div class="ub'+(o.compact?' is-compact':'')+'" data-ub data-ub-kind="'+esc(o.kind||'document')+'"'+(o.n?' data-ub-n="'+esc(o.n)+'"':'')+(o.live===false?' data-ub-live="0"':'')+(o.wrap?' '+o.wrap:'')+'>'+
  (o.label?'<span class="ub-label">'+o.label+(o.req?' <b class="ub-req">*</b>':'')+'</span>':'')+
  '<input type="file" class="ub-file" data-ub-real data-fdp-skip tabindex="-1" aria-hidden="true" accept="'+esc(o.accept||TYPES.join(','))+'"'+(o.name?' name="'+esc(o.name)+'"':'')+(o.req?' required':'')+(o.attr?' '+o.attr:'')+'>'+
  '<input type="file" class="ub-file" data-ub-cam data-fdp-skip tabindex="-1" aria-hidden="true" accept="image/*" capture="environment">'+
  '<input type="file" class="ub-file" data-ub-pickin data-fdp-skip tabindex="-1" aria-hidden="true" accept="'+esc(o.accept||TYPES.join(','))+'">'+
  '<div class="ub-drop" data-ub-drop><div class="ub-btns"><button type="button" class="btn btn-primary" data-ub-take>'+(o.take||'📷 صوّر')+'</button><button type="button" class="btn" data-ub-pick>'+(o.pick||'🖼 اختار صورة')+'</button></div>'+
  '<p class="ub-or">أو الصق سكرين شوت بـ <span class="ub-kbd">Ctrl</span>+<span class="ub-kbd">V</span> — أو اسحب الصورة وسيبها هنا</p></div>'+
  '<div class="ub-done" data-ub-done hidden></div><p class="ub-err" data-ub-err role="alert" hidden></p>'+(o.hint?'<small class="fc-hint">'+o.hint+'</small>':'')+'</div>';}
function okType(input,f){var acc=(input.getAttribute('accept')||'').split(',').map(function(s){return s.trim();}).filter(Boolean);if(!f)return false;if(!acc.length||!f.type)return true;
 return acc.some(function(a){return a===f.type||(/\/\*$/.test(a)&&f.type.indexOf(a.slice(0,-1))===0);});}
function shown(el){for(var x=el;x&&x!==d;x=x.parentNode){if(x.hidden||(x.style&&x.style.display==='none'))return false;}return !!(el&&el.isConnected);}
var lastBox=null;
function bind(box){if(!box||box.__ub)return box&&box.__ub;css();
 var input=box.querySelector('[data-ub-real]'),cam=box.querySelector('[data-ub-cam]'),pin=box.querySelector('[data-ub-pickin]'),drop=box.querySelector('[data-ub-drop]'),done=box.querySelector('[data-ub-done]'),err=box.querySelector('[data-ub-err]'),url='';
 if(!input)return null;box.setAttribute('data-ub-on','');
 function oops(m){err.textContent=m||'';err.hidden=!m;}
 function paint(){var file=input.files&&input.files[0];if(url){try{URL.revokeObjectURL(url);}catch(_){}url='';}
  if(!file){done.hidden=true;done.innerHTML='';drop.hidden=false;return;}
  var pic=/^image\//.test(file.type||'')&&w.URL&&URL.createObjectURL?(url=URL.createObjectURL(file)):'';
  done.innerHTML=(pic?'<img alt="الصورة المختارة" src="'+pic+'">':'<span class="ub-pdf">PDF</span>')+'<div><b>✓ الصورة جاهزة</b><small></small></div><button type="button" class="btn" data-ub-change>تغيير</button>';
  done.querySelector('small').innerHTML='<bdi data-ub-name></bdi> · '+kb(file.size||0)+(box.getAttribute('data-ub-live')==='0'?'':' — هتترفع مع الحفظ');
  done.querySelector('[data-ub-name]').textContent=file.name||'صورة';
  done.querySelector('[data-ub-change]').onclick=function(){box.__ubAt=null;quiet(input,null);input.dispatchEvent(new Event('change',{bubbles:true}));pin.click();};
  done.hidden=false;drop.hidden=true;oops('');}
 function take(file){if(!file)return;if(!okType(input,file)){oops(/pdf/.test(input.getAttribute('accept')||'')?'ارفع صورة (JPG / PNG / WEBP) أو PDF':'ارفع صورة');return;}
  if(file.size>(+box.getAttribute('data-ub-max')||MAX)){oops('الملف أكبر من '+Math.round((+box.getAttribute('data-ub-max')||MAX)/1048576)+' ميجا — صوّره تاني بجودة أقل');return;}
  box.__ubAt=new Date();if(!setFile(input,named(box,file)))oops('المتصفح ده مش بيدعم اللصق — استخدم «اختار صورة»');}
 box.querySelector('[data-ub-take]').onclick=function(){lastBox=box;cam.click();};box.querySelector('[data-ub-pick]').onclick=function(){lastBox=box;pin.click();};
 [cam,pin].forEach(function(x){x.addEventListener('change',function(e){e.stopPropagation();var f=x.files&&x.files[0];x.value='';take(f);});});
 input.addEventListener('change',paint);input.addEventListener('invalid',function(){oops(box.getAttribute('data-ub-need')||'ارفع الصورة الأول');});
 box.addEventListener('pointerdown',function(){lastBox=box;});
 ['dragenter','dragover'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add('is-over');});});
 ['dragleave','drop'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove('is-over');});});
 drop.addEventListener('drop',function(e){var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];take(f);});
 /* the name follows the form: amount / method / patient typed after the photo */
 if(box.getAttribute('data-ub-live')!=='0'){var sc=scopeOf(box),re=function(e){if(e.target&&e.target.type==='file')return;var f=input.files&&input.files[0];if(!f||!ours(f.name))return;var nf=named(box,f);
   if(nf!==f&&quiet(input,nf)){var s=done.querySelector('[data-ub-name]');if(s)s.textContent=nf.name;}};
  if(sc&&sc.addEventListener){sc.addEventListener('input',re);sc.addEventListener('change',re);}}
 paint();box.__ub={take:take,paint:paint,input:input};return box.__ub;}
function bindAll(root){[].forEach.call((root||d).querySelectorAll?(root||d).querySelectorAll('[data-ub]:not([data-ub-on])'):[],bind);}
/* paste: the empty box in the topmost open window (or the one last touched) */
var MODALS='.modal-backdrop,.fc-overlay,.dp-backdrop,.rx-modal,[role=dialog],dialog[open],.modal';
function target(){var ms=[].filter.call(d.querySelectorAll(MODALS),shown),scope=ms.length?ms[ms.length-1]:d;
 var all=[].filter.call(scope.querySelectorAll('[data-ub][data-ub-on]'),shown);if(!all.length)return null;
 if(lastBox&&all.indexOf(lastBox)>=0)return lastBox;var empty=all.filter(function(b){var i=b.querySelector('[data-ub-real]');return !(i.files&&i.files.length);});
 return empty.length===1||(empty.length&&all.length>1)?empty[0]:all.length===1?all[0]:null;}
d.addEventListener('paste',function(e){if(e.defaultPrevented)return;var cd=e.clipboardData,items=(cd&&cd.items)||[],file=null;
 for(var i=0;i<items.length;i++){if(items[i].kind==='file'){file=items[i].getAsFile();if(file)break;}}if(!file&&cd&&cd.files&&cd.files.length)file=cd.files[0];if(!file)return;
 var b=target();if(!b||!b.__ub)return;e.preventDefault();b.__ub.take(file.name?file:rename(file,'screenshot.png'));},true);
function start(){bindAll(d);if(w.MutationObserver)new MutationObserver(function(){bindAll(d);}).observe(d.documentElement,{childList:true,subtree:true});}
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start);else start();
w.SSMPDUploadBox={html:html,bind:bind,bindAll:bindAll,name:name,key:key,rename:rename,named:named,metaFor:metaFor,ours:ours,stamp:stamp,KIND:KIND,METHOD:METHOD};
})(window,document);
