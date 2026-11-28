/* Owner 2026-11-19: every non-cash collection (card / InstaPay / wallet / bank) needs the transaction number AND a photo of the
   machine slip or the transfer. The photo goes to the private bucket payment-proofs (<workspace>/<me>/<file>), is registered with
   clinic_reception_payment_proof, and the database attaches it to the payment on save (and refuses a live non-cash payment without it). */
(function(){'use strict';
var MAX=10*1024*1024,TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
/* Owner 2026-11-21 («طبقه», mockup docs/ui-references/mockups/proof-photo.html): easier photo — «صوّر الإيصال» opens the
   phone camera, «اختار صورة», paste a screenshot (Ctrl+V) anywhere in the form, or drag & drop it on the box; a thumbnail
   shows «✓ الصورة جاهزة» with «تغيير». The real <input type=file name=proof_file> still carries the file (same upload path). */
var CSS='.pp-drop{border:2px dashed #9fb2db;border-radius:14px;padding:12px;display:grid;gap:8px;justify-items:center;text-align:center;background:#F7F9FD}'+
 '.pp-drop.is-over{border-color:#0F369D;background:#EEF3FD}.pp-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}'+
 '.pp-or{font-size:12px;color:#5b6577;margin:0}.pp-kbd{display:inline-block;border:1px solid #c7d0e6;border-bottom-width:2px;border-radius:5px;padding:0 5px;font-size:11px;direction:ltr;background:#fff}'+
 '.pp-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}'+
 '.pp-done{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;border:1px solid #cfe5da;background:#F1F8F4;border-radius:12px;padding:8px}'+
 '.pp-done img,.pp-done .pp-pdf{width:64px;height:64px;border-radius:8px;object-fit:cover;background:#e1e7f3;display:grid;place-items:center;font-size:11px;color:#5b6577}'+
 '.pp-done b{color:#2F7D5C;font-size:13px}.pp-done small{display:block;color:#5b6577;font-size:12px;word-break:break-all}.pp-err{color:#D0402A;font-size:12px;margin:0}'+
 '.pp-read{border-radius:12px;padding:8px 10px;font-size:12.5px;background:#EEF4FF;color:#0F369D;border:1px solid #CFDDF7}.pp-read.wait{background:#F1F4F8;color:#475467;border-color:#e6ebf3}.pp-read.bad{background:#FFF8F4;color:#7A2E0B;border-color:#F7C9B3}'+
 '.pp-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.pp-chip{font:inherit;font-size:13px;padding:4px 10px;border-radius:999px;border:1px solid #D5DEEE;background:#fff;color:#16212E;direction:ltr;cursor:pointer}.pp-chip.on{background:#0F369D;color:#fff;border-color:#0F369D}'+
 '[data-pp-filled]{border-color:#0F369D!important;box-shadow:0 0 0 3px rgba(15,54,157,.12);direction:ltr;text-align:left;font-weight:700}';
function css(){if(document.getElementById('pp-css'))return;var st=document.createElement('style');st.id='pp-css';st.textContent=CSS;document.head.appendChild(st);}
function field(n){var name='proof_file'+(n?'_'+n:'');css();return '<div data-pay-proof="'+name+'" class="pp" hidden><span class="pp-label">صورة إيصال الماكينة أو التحويل (إجبارية لغير النقدي)</span>'+
 '<input type="file" class="pp-file" name="'+name+'" accept="image/jpeg,image/png,image/webp,application/pdf" tabindex="-1" aria-hidden="true">'+
 '<input type="file" class="pp-file" data-pp-cam accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">'+
 '<div class="pp-drop" data-pp-drop><div class="pp-btns"><button type="button" class="btn btn-primary" data-pp-take>📷 صوّر الإيصال</button><button type="button" class="btn" data-pp-pick>🖼 اختار صورة</button></div>'+
 '<p class="pp-or">أو الصق سكرين شوت هنا بـ <span class="pp-kbd">Ctrl</span>+<span class="pp-kbd">V</span> — أو اسحب الصورة وسيبها هنا</p></div>'+
 '<div class="pp-done" data-pp-done hidden></div><p class="pp-err" data-pp-err role="alert" hidden></p><div class="pp-read" data-pp-read role="status" hidden></div>'+
 '<small class="fc-hint">صوّر إيصال ماكينة الفيزا أو سكرين شوت رسالة التحويل، واكتب رقم العملية اللي عليه في خانة المرجع.</small></div>';}
function okFile(f){return f&&(!f.type||TYPES.indexOf(f.type)>=0);}
function setFile(input,file){try{var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;}catch(_){return false;}input.dispatchEvent(new Event('change',{bubbles:true}));return true;}
function kb(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
/* «رقم العملية من الصورة» (owner 2026-11-28 «الله عليك. وعايز الكلام دا يتسجل اوتوماتيك بعد كدة في وسايل الدفع دي», mockup
   docs/ui-references/mockups/receipt-ocr.html, server 20261128020000). The photo is read IN THE BROWSER (Tesseract.js — free, the same
   engine «رفع كشف» uses); nothing is sent to any outside service. Order: (1) a transaction number printed on the receipt (RRN /
   Reference / Transaction ID / رقم العملية …; several → chips); (2) wallets without one: VF-<sender mobile>-<dd-mm>; (3) any method:
   <letter>-<file no>-<dd-mm> (IP InstaPay, VF wallet, CC card, BK bank). (2)/(3) never repeat: clinic_reception_reference_free adds
   -2, -3 …. The suggestion is only filled when «رقم العملية» is empty or was filled automatically, and the employee can edit it. */
var LETTER={instapay:'IP',wallet:'VF',pos:'CC',bank:'BK'},ocrLib=null;
function loadScript(src){return new Promise(function(ok,no){var t=document.createElement('script');t.src=src;t.onload=ok;t.onerror=function(){no(Error('تعذر تحميل أداة القراية'));};document.head.appendChild(t);});}
function ocrText(file,progress){if(window.SSMPDPaymentProof&&window.SSMPDPaymentProof._ocr)return new Promise(function(ok){ok(window.SSMPDPaymentProof._ocr(file));});
 if(!ocrLib)ocrLib=(window.Tesseract?Promise.resolve():loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js')).catch(function(e){ocrLib=null;throw e;});
 return ocrLib.then(function(){return window.Tesseract.createWorker('ara+eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0',workerBlobURL:true,
  logger:function(m){if(progress&&m&&m.status==='recognizing text')progress(Math.round((m.progress||0)*100));}});})
  .then(function(wk){return wk.recognize(file).then(function(r){wk.terminate();return (r&&r.data&&r.data.text)||'';},function(e){wk.terminate();throw e;});});}
function latin(t){return String(t||'').replace(/[٠-٩]/g,function(d){return String(d.charCodeAt(0)-1632);}).replace(/[۰-۹]/g,function(d){return String(d.charCodeAt(0)-1776);});}
/* → {numbers:[{label,value}], mobile, day:'dd-mm'|null} */
function parseReceipt(raw){var t=latin(raw).replace(/‏|‎/g,''),out=[],seen={};
 var RULES=[['RRN',/\bR\.?\s?R\.?\s?N\.?\s*(?:No\.?|#|:)?\s*[:#]?\s*([A-Z0-9]{6,20})/i],['Reference',/\b(?:Ref(?:erence)?(?:\s*(?:No|Number|Num|ID))?\.?)\s*[:#]?\s*([A-Z0-9]{6,24})/i],
  ['Transaction ID',/\b(?:Transaction|Txn|Trx|TRX)\s*(?:ID|No\.?|Number|#)?\s*[:#]?\s*([A-Z0-9]{6,24})/i],['رقم العملية',/رقم\s*(?:ال)?(?:عملية|عمليه|معاملة|معامله|مرجع|المرجع|الحركة)\s*[:#]?\s*([A-Z0-9]{6,24})/],
  ['Auth',/\b(?:Auth(?:orization)?|Approval|APPR)\s*(?:Code|No\.?|#)?\s*[:#]?\s*([A-Z0-9]{4,12})/i],['Trace',/\b(?:Trace|STAN)\s*(?:No\.?|#)?\s*[:#]?\s*([0-9]{4,12})/i]];
 RULES.forEach(function(r){var m=t.match(r[1]);if(m&&!seen[m[1]]&&/\d/.test(m[1])){seen[m[1]]=1;out.push({label:r[0],value:m[1].toUpperCase()});}});
 var mob=(t.replace(/[\s-]/g,'').match(/(?:\+?20|0020)?(01[0125]\d{8})/)||[])[1]||null;
 var d=t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/)||t.match(/\b(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/),day=null;
 if(d){var dd,mm;if(d[1].length===4){dd=+d[3];mm=+d[2];}else{dd=+d[1];mm=+d[2];}if(dd>=1&&dd<=31&&mm>=1&&mm<=12)day=('0'+dd).slice(-2)+'-'+('0'+mm).slice(-2);}
 return {numbers:out,mobile:mob,day:day};}
function todayDM(){var t=window.SSMPDBusinessDay&&window.SSMPDBusinessDay.today?window.SSMPDBusinessDay.today():new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return t.slice(8,10)+'-'+t.slice(5,7);}
function fileNoOf(f){var pf=f.elements.patient_file;if(pf&&String(pf.value||'').trim())return String(pf.value).trim();var ps=f.elements.patient_id;
 if(ps&&ps.selectedIndex>=0&&ps.value){var tx=(ps.options[ps.selectedIndex]||{}).text||'';var m=tx.split(' — ')[0].trim();if(m)return m;}return '';}
function cleanFile(v){return String(v||'').replace(/[^A-Za-z0-9]/g,'').slice(-12);}
function freeRef(method,base){var c=window.SSMPDDb&&window.SSMPDDb.client;if(!c)return Promise.resolve(base);
 return Promise.resolve(c.rpc('clinic_reception_reference_free',{p_method:method,p_base:base})).then(function(r){return r&&!r.error&&r.data?r.data:base;},function(){return base;});}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function bind(form,n){var f=form&&(form.tagName==='FORM'?form:form.querySelector('form')),name='proof_file'+(n?'_'+n:''),method=f&&f.elements[n?'method_'+n:'method'],input=f&&f.elements[name];if(!method||!input)return null;var box=f.querySelector('[data-pay-proof="'+name+'"]');
 var cam=box.querySelector('[data-pp-cam]'),drop=box.querySelector('[data-pp-drop]'),done=box.querySelector('[data-pp-done]'),err=box.querySelector('[data-pp-err]'),url='';
 var ref=f.elements[n?'reference_'+n:'reference'],readBox=box.querySelector('[data-pp-read]'),readSeq=0;
 if(ref)ref.addEventListener('input',function(){if(!ref.__ppSetting){delete ref.dataset.ppFilled;ref.removeAttribute('data-pp-filled');ref.dataset.ppTyped='1';}});
 function canFill(){return ref&&(!String(ref.value||'').trim()||ref.dataset.auto==='1'||ref.hasAttribute('data-pp-filled'))&&ref.dataset.ppTyped!=='1';}
 function put(v){if(!ref||!canFill())return false;ref.__ppSetting=true;ref.value=v;ref.dataset.auto='0';ref.setAttribute('data-pp-filled','1');ref.dispatchEvent(new Event('input',{bubbles:true}));ref.__ppSetting=false;return true;}
 function say(cls,html){if(!readBox)return;readBox.className='pp-read'+(cls?' '+cls:'');readBox.innerHTML=html;readBox.hidden=!html;}
 function readPhoto(file){var me=++readSeq;if(!ref||!file||!/^image\//.test(file.type||'')||method.value==='cash'){say('','');return;}
  if(ref.dataset.ppTyped==='1'){say('','');return;}
  say('wait','⏳ بقرا رقم العملية من الصورة… (أول مرة بس بتاخد ثواني لحد ما أداة القراية تتحمّل)');
  ocrText(file,function(pc){if(me===readSeq)say('wait','⏳ بقرا رقم العملية من الصورة… '+pc+'%');}).then(function(text){if(me!==readSeq)return;var r=parseReceipt(text),m=method.value,L=LETTER[m]||'TX';
   if(r.numbers.length){var best=r.numbers[0];if(!put(best.value)){say('','');return;}
    var chips=r.numbers.length>1?'<div class="pp-chips">'+r.numbers.map(function(x,i){return '<button type="button" class="pp-chip'+(i?'':' on')+'" data-pp-chip="'+esc(x.value)+'">'+esc(x.label)+' '+esc(x.value)+'</button>';}).join('')+'</div>':'';
    say('','🔎 اتقرا من الصورة: «'+esc(best.label)+' '+esc(best.value)+'» — راجعه قبل الحفظ.'+(chips?' لقيت أكتر من رقم — لو الصح غيره دوس عليه:'+chips:''));
    readBox.querySelectorAll('[data-pp-chip]').forEach(function(b){b.onclick=function(){if(ref.dataset.ppTyped==='1')return;ref.dataset.ppTyped='';ref.setAttribute('data-pp-filled','1');put(b.dataset.ppChip);readBox.querySelectorAll('[data-pp-chip]').forEach(function(x){x.classList.toggle('on',x===b);});};});return;}
   var day=r.day||todayDM(),base,why;
   if(m==='wallet'&&r.mobile){base='VF-'+r.mobile+'-'+day;why='الإيصال ده مافيهوش رقم عملية، فعملنا مرجع من الصورة: VF + رقم الموبايل اللي حوّل + التاريخ.';}
   else{var fno=cleanFile(fileNoOf(f));base=L+'-'+(fno||'0')+'-'+day;why='الصورة مافيهاش رقم عملية'+(m==='wallet'?' ولا رقم موبايل':'')+'، فعملنا مرجع: حرف الطريقة + رقم ملف المريض + التاريخ.';}
   return freeRef(m,base).then(function(v){if(me!==readSeq)return;if(!put(v)){say('','');return;}say('',' 🔎 '+why+' <b dir="ltr">'+esc(v)+'</b> — راجعه قبل الحفظ.'+(v!==base?' (اتزود <b dir="ltr">'+esc(v.slice(base.length))+'</b> لأن المرجع ده اتسجل قبل كده)':''));});
  }).catch(function(){if(me!==readSeq)return;say('bad','مقدرتش أقرا رقم العملية من الصورة (ممكن تكون مش واضحة) — اكتبه بإيدك. الصورة هتتحفظ عادي.');});}
 function oops(m){err.textContent=m||'';err.hidden=!m;}
 function paint(){var file=input.files&&input.files[0];if(url){try{URL.revokeObjectURL(url);}catch(_){}url='';}
  if(!file){done.hidden=true;done.innerHTML='';drop.hidden=false;return;}
  var pic=/^image\//.test(file.type||'')&&window.URL&&URL.createObjectURL?(url=URL.createObjectURL(file)):'';
  done.innerHTML=(pic?'<img alt="صورة الإيصال" src="'+pic+'">':'<span class="pp-pdf">PDF</span>')+'<div><b>✓ الصورة جاهزة</b><small></small></div><button type="button" class="btn" data-pp-change>تغيير</button>';
  done.querySelector('small').textContent=(file.name||'صورة')+' · '+kb(file.size||0)+' — هتترفع مع الحفظ';
  done.querySelector('[data-pp-change]').onclick=function(){input.value='';paint();input.click();};done.hidden=false;drop.hidden=true;oops('');readPhoto(file);}
 function take(file){if(!file)return;if(!okFile(file)){oops('ارفع صورة (JPG / PNG / WEBP) أو PDF');return;}if(file.size>MAX){oops('الصورة أكبر من ١٠ ميجا — صوّرها تاني بجودة أقل');return;}
  if(!setFile(input,file))oops('المتصفح ده مش بيدعم اللصق — استخدم «اختار صورة»');}
 box.querySelector('[data-pp-take]').onclick=function(){cam.click();};box.querySelector('[data-pp-pick]').onclick=function(){input.click();};
 cam.addEventListener('change',function(){var file=cam.files&&cam.files[0];cam.value='';take(file);});
 input.addEventListener('change',paint);
 input.addEventListener('invalid',function(){oops('ارفع صورة إيصال الماكينة أو التحويل');});
 f.addEventListener('paste',function(e){if(box.hidden)return;var items=(e.clipboardData&&e.clipboardData.items)||[];for(var i=0;i<items.length;i++){if(items[i].kind==='file'){var file=items[i].getAsFile();if(file&&okFile(file)){e.preventDefault();take(file.name?file:new File([file],'screenshot.png',{type:file.type||'image/png'}));return;}}}});
 ['dragenter','dragover'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add('is-over');});});
 ['dragleave','drop'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove('is-over');});});
 drop.addEventListener('drop',function(e){var file=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];take(file);});
 function sync(){var need=method.value!=='cash'&&box.dataset.optional!=='1';box.hidden=!need;input.required=need;input.disabled=!need;cam.disabled=!need;}
 method.addEventListener('change',sync);method.addEventListener('change',function(){var file=input.files&&input.files[0];if(file&&!box.hidden)readPhoto(file);else say('','');});sync();paint();return sync;}
function ext(file){var m=/\.([a-z0-9]{2,5})$/i.exec(file.name||'');return m?m[1].toLowerCase():file.type==='application/pdf'?'pdf':'jpg';}
/* uploads + registers the photo; resolves the values without the file so they can go straight to the command */
async function upload(workspace,method,reference,file){
 if(!method||method==='cash')return String(reference||'');
 if(!file||!file.size)throw new Error('ارفع صورة إيصال الماكينة أو التحويل قبل الحفظ');
 if(file.size>MAX)throw new Error('الصورة أكبر من ١٠ ميجا — صوّرها تاني بجودة أقل');
 if(file.type&&TYPES.indexOf(file.type)<0)throw new Error('ارفع صورة (JPG / PNG / WEBP) أو PDF');
 var ref=String(reference||'').trim();if(ref.length<3)throw new Error('اكتب رقم العملية من إيصال الماكينة أو رسالة التحويل');
 var me=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id;if(!me)throw new Error('سجّل الدخول من جديد');
 var client=window.SSMPDDb.client,path=workspace+'/'+me+'/'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2))+'.'+ext(file);
 var up=await client.storage.from('payment-proofs').upload(path,file,{upsert:false,contentType:file.type||undefined});if(up&&up.error)throw new Error('تعذر رفع الصورة — جرّب تاني');
 var r=await client.rpc('clinic_reception_payment_proof',{p_workspace:workspace,p_reference:ref,p_path:path});if(r&&r.error)throw r.error;
 return ref;}
async function attach(workspace,values){var v=Object.assign({},values),file=v.proof_file;delete v.proof_file;if(v.method&&v.method!=='cash')v.reference=await upload(workspace,v.method,v.reference,file);return v;}
function open(path){var c=window.SSMPDDb.client,win=window.open('','_blank');return Promise.resolve(c.storage.from('payment-proofs').createSignedUrl(path,300)).then(function(r){if(r.error)throw r.error;if(win){win.opener=null;win.location.href=r.data.signedUrl;}else window.location.assign(r.data.signedUrl);},function(e){if(win)win.close();throw e;});}
window.SSMPDPaymentProof={field:field,bind:bind,upload:upload,attach:attach,open:open,parseReceipt:parseReceipt};
})();
