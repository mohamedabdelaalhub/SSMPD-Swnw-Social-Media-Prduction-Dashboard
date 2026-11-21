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
 '.pp-done b{color:#2F7D5C;font-size:13px}.pp-done small{display:block;color:#5b6577;font-size:12px;word-break:break-all}.pp-err{color:#D0402A;font-size:12px;margin:0}';
function css(){if(document.getElementById('pp-css'))return;var st=document.createElement('style');st.id='pp-css';st.textContent=CSS;document.head.appendChild(st);}
function field(n){var name='proof_file'+(n?'_'+n:'');css();return '<div data-pay-proof="'+name+'" class="pp" hidden><span class="pp-label">صورة إيصال الماكينة أو التحويل (إجبارية لغير النقدي)</span>'+
 '<input type="file" class="pp-file" name="'+name+'" accept="image/jpeg,image/png,image/webp,application/pdf" tabindex="-1" aria-hidden="true">'+
 '<input type="file" class="pp-file" data-pp-cam accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">'+
 '<div class="pp-drop" data-pp-drop><div class="pp-btns"><button type="button" class="btn btn-primary" data-pp-take>📷 صوّر الإيصال</button><button type="button" class="btn" data-pp-pick>🖼 اختار صورة</button></div>'+
 '<p class="pp-or">أو الصق سكرين شوت هنا بـ <span class="pp-kbd">Ctrl</span>+<span class="pp-kbd">V</span> — أو اسحب الصورة وسيبها هنا</p></div>'+
 '<div class="pp-done" data-pp-done hidden></div><p class="pp-err" data-pp-err role="alert" hidden></p>'+
 '<small class="fc-hint">صوّر إيصال ماكينة الفيزا أو سكرين شوت رسالة التحويل، واكتب رقم العملية اللي عليه في خانة المرجع.</small></div>';}
function okFile(f){return f&&(!f.type||TYPES.indexOf(f.type)>=0);}
function setFile(input,file){try{var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;}catch(_){return false;}input.dispatchEvent(new Event('change',{bubbles:true}));return true;}
function kb(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
function bind(form,n){var f=form&&(form.tagName==='FORM'?form:form.querySelector('form')),name='proof_file'+(n?'_'+n:''),method=f&&f.elements[n?'method_'+n:'method'],input=f&&f.elements[name];if(!method||!input)return null;var box=f.querySelector('[data-pay-proof="'+name+'"]');
 var cam=box.querySelector('[data-pp-cam]'),drop=box.querySelector('[data-pp-drop]'),done=box.querySelector('[data-pp-done]'),err=box.querySelector('[data-pp-err]'),url='';
 function oops(m){err.textContent=m||'';err.hidden=!m;}
 function paint(){var file=input.files&&input.files[0];if(url){try{URL.revokeObjectURL(url);}catch(_){}url='';}
  if(!file){done.hidden=true;done.innerHTML='';drop.hidden=false;return;}
  var pic=/^image\//.test(file.type||'')&&window.URL&&URL.createObjectURL?(url=URL.createObjectURL(file)):'';
  done.innerHTML=(pic?'<img alt="صورة الإيصال" src="'+pic+'">':'<span class="pp-pdf">PDF</span>')+'<div><b>✓ الصورة جاهزة</b><small></small></div><button type="button" class="btn" data-pp-change>تغيير</button>';
  done.querySelector('small').textContent=(file.name||'صورة')+' · '+kb(file.size||0)+' — هتترفع مع الحفظ';
  done.querySelector('[data-pp-change]').onclick=function(){input.value='';paint();input.click();};done.hidden=false;drop.hidden=true;oops('');}
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
 method.addEventListener('change',sync);sync();paint();return sync;}
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
window.SSMPDPaymentProof={field:field,bind:bind,upload:upload,attach:attach,open:open};
})();
