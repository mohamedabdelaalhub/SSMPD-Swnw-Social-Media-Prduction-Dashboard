/* Extend the source scene. The rendered design and its text are never sent to AI. */
(function(){
 'use strict';
 function png(canvas){return canvas.toDataURL('image/png');}
 function prepare(scene,mode){
  var canvas=document.createElement('canvas');canvas.width=mode==='horizontal'?1536:1024;canvas.height=mode==='horizontal'?1024:1536;
  var scale=Math.min(canvas.width*(mode==='horizontal'?.7:.5)/scene.width,canvas.height*(mode==='horizontal'?1:.5)/scene.height);
  var w=Math.round(scene.width*scale),h=Math.round(scene.height*scale),x=Math.floor((canvas.width-w)/2),y=Math.floor((canvas.height-h)/2);
  canvas.getContext('2d').drawImage(scene,x,y,w,h);
  var mask=document.createElement('canvas');mask.width=canvas.width;mask.height=canvas.height;var ctx=mask.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(x,y,w,h);
  var original=document.createElement('canvas');var originalScale=Math.min(1,Math.sqrt(1600000/(scene.width*scene.height)),2048/Math.max(scene.width,scene.height));original.width=Math.max(1,Math.floor(scene.width*originalScale));original.height=Math.max(1,Math.floor(scene.height*originalScale));original.getContext('2d').drawImage(scene,0,0,original.width,original.height);
  return {image:png(canvas),mask:png(mask),original:png(original)};
 }
 function mount(root,item,api){
  var details=document.createElement('details');details.className='design-editor__subgroup';details.dataset.standardOnly='';
  details.innerHTML='<summary>توسيع خلفية الصورة</summary><p>نكمّل الخلفية حول الصورة الحالية. كل توسيع يُحسب ضمن حد التوليد الحالي.</p><label>اتجاه التوسيع<select data-expand-mode><option value="all">كل الجهات — مساحة لتصغير الشخص</option><option value="horizontal">يمين وشمال — مساحة للحركة الأفقية</option></select></label><button type="button" class="btn ghost" data-expand>توسيع الخلفية</button><p role="status" data-expand-status></p><div data-expand-result hidden><img alt="معاينة الخلفية الموسّعة" style="display:block;width:100%;max-height:220px;object-fit:contain"><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn" data-expand-apply>استخدام النتيجة</button><button type="button" class="btn ghost" data-expand-discard>إلغاء النتيجة</button></div></div><button type="button" class="btn ghost" data-expand-original hidden>رجوع للصورة قبل التوسيع</button>';
  root.querySelector('[data-tool-panel=image]').append(details);
  details.querySelector('summary').onclick=function(){if(details.open)return;Array.from(details.parentElement.children).forEach(function(n){if(n!==details&&n.tagName==='DETAILS')n.open=false;});};
  var status=details.querySelector('[data-expand-status]'),result=details.querySelector('[data-expand-result]'),candidate=null,backup=null,requestStore='ssmpd-expand-request-'+item.id+'-'+(window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id||'staff');
  function sync(){var current=api.current(),busy=api.busy();details.querySelector('[data-expand]').disabled=busy||!current.scene;details.querySelector('[data-expand-apply]').disabled=busy||!candidate;details.querySelector('[data-expand-discard]').disabled=busy;var undo=details.querySelector('[data-expand-original]');undo.hidden=!backup&&!current.originalUrl;undo.disabled=busy;}
  function discard(){candidate=null;result.hidden=true;result.querySelector('img').removeAttribute('src');sync();}
  details.querySelector('[data-expand]').onclick=async function(){
   if(api.busy()||!api.current().scene)return;
   api.setBusy(true);status.textContent='جاري توسيع الخلفية…';
   try{
    var mode=details.querySelector('[data-expand-mode]').value,prepared=prepare(api.current().scene,mode);
    var hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(mode+'|'+prepared.image+'|'+prepared.mask+'|'+prepared.original));var fingerprint=Array.from(new Uint8Array(hash),function(n){return n.toString(16).padStart(2,'0');}).join('');
    var saved=null;try{saved=JSON.parse(localStorage.getItem(requestStore));}catch(ignore){}
    var key=saved&&saved.fingerprint===fingerprint?saved.key:crypto.randomUUID();localStorage.setItem(requestStore,JSON.stringify({key:key,fingerprint:fingerprint}));
    var response=await api.invoke(Object.assign({action:'expand',content_id:item.id,request_key:key,mode:mode,quality:'high'},prepared));
    if(!response.url){status.textContent='الطلب قيد التنفيذ. اضغط توسيع الخلفية لاستعادة نفس الطلب بدون طلب مدفوع جديد.';return;}
    if(!response.expansion)throw new Error('حدّث وظيفة design-scene لتفعيل توسيع الخلفية. الصورة الحالية لم تتغير.');
    candidate=response;result.querySelector('img').src=response.url;result.hidden=false;status.textContent='راجع النتيجة ثم اختر استخدامها. الصورة الحالية لم تتغير.';
   }catch(error){status.textContent=error.message;if(error.terminal){localStorage.removeItem(requestStore);status.textContent+=' المحاولة التالية ستكون طلبًا جديدًا.';}}
   finally{api.setBusy(false);sync();}
  };
  details.querySelector('[data-expand-apply]').onclick=async function(){if(api.busy()||!candidate)return;var next=candidate,previous=api.current();api.setBusy(true);try{await api.apply(next.url,next.job_id,next.expansion.original_url,next.expansion.original_path,true,next.expansion.mode);backup=previous;await api.save();localStorage.removeItem(requestStore);discard();status.textContent='تم تطبيق الخلفية. تقدر ترجع للصورة قبل التوسيع.';}catch(error){status.textContent=error.message;}finally{api.setBusy(false);sync();}};
  details.querySelector('[data-expand-discard]').onclick=function(){localStorage.removeItem(requestStore);discard();status.textContent='تم إلغاء النتيجة. الصورة الحالية كما هي.';};
  details.querySelector('[data-expand-original]').onclick=async function(){if(api.busy())return;api.setBusy(true);try{var current=api.current();if(backup)await api.restore(backup);else await api.apply(current.originalUrl,null,null,null,false);backup=null;discard();await api.save();status.textContent='تم الرجوع للصورة قبل التوسيع.';}catch(error){status.textContent=error.message;}finally{api.setBusy(false);sync();}};
  return {sync:sync,discard:discard,reset:function(){backup=null;discard();}};
 }
 window.SSMPDDesignExpansion={prepare:prepare,mount:mount};
})();
