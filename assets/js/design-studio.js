(function(){
 'use strict';
 var C=window.SSMPDDesignComposer;
 function mount(slot,item){
  if(!slot||['published','scheduled','ready_to_publish'].includes(item.stage)||item.brand!=='sono'||item.content_format==='video'||!(window.SSMPDWorkflow.canEditItem(window.SSMPDAuth.currentAdmin,item)||item.assigned_designer===window.SSMPDAuth.currentAdmin.id)) return;
  var start=document.createElement('button'); start.className='btn ghost'; start.textContent='إنشاء تصميم'; slot.appendChild(start);
  start.onclick=function(){open(item);};
 }
 function open(item){
  var root=document.createElement('div'); root.className='modal-backdrop'; root.style.zIndex=10001;
  root.innerHTML='<div class="modal" style="width:min(1100px,96vw);max-height:94vh;overflow:auto" dir="rtl">'+
   '<div class="modal-head"><h3>تصميم سونو — الصورة العلوية</h3><button class="modal-close" aria-label="إغلاق">×</button></div>'+
   '<div class="design-layout" style="display:flex;flex-wrap:wrap;gap:20px"><div style="flex:1 1 300px;min-width:0">'+
   '<label>العنوان على التصميم<textarea data-field="headline" rows="2"></textarea></label>'+
   '<label>السطر التوضيحي<textarea data-field="subtitle" rows="2"></textarea></label>'+
   '<label>الدعوة للتفاعل<input data-field="cta"></label><p>النصوص قابلة للتعديل قبل الحفظ. الكابشن الأصلي يظل محفوظًا.</p>'+
   '<details><summary>أحجام النص وزر التفاعل</summary>'+
   '<label>حجم العنوان الرئيسي <output data-value="headlineSize">83</output><input type="range" data-field="headlineSize" min="46" max="90" step="1" value="83"></label>'+
   '<label>حجم السطر التوضيحي <output data-value="subtitleSize">42</output><input type="range" data-field="subtitleSize" min="24" max="48" step="1" value="42"></label>'+
   '<label>حجم زر التفاعل <output data-value="ctaScale">100%</output><input type="range" data-field="ctaScale" min="0.8" max="1.15" step="0.01" value="1"></label></details>'+
   '<label>صورة من جهازك<input type="file" accept="image/png,image/jpeg,image/webp" data-upload></label>'+
   '<button class="btn ghost" data-library>صور سونو المحفوظة</button><div data-images style="display:flex;flex-wrap:wrap;gap:6px"></div>'+
   '<details><summary>توليد صورة بالذكاء الاصطناعي</summary><label>وصف المشهد<textarea data-prompt rows="3"></textarea></label>'+
   '<label>الجودة<select data-quality><option value="medium">Medium</option><option value="high">High</option></select></label>'+
   '<p>توليد صورة واحدة لكل طلب. حد التجربة ٣ محاولات للمادة و٥ دولارات شهريًا. تعديل النص لا يستهلك توليدًا جديدًا.</p>'+
   '<button class="btn" data-generate>توليد الصورة</button> <button class="btn ghost" data-retry hidden>محاولة جديدة بعد الفشل</button></details>'+
   '<label>تكبير الصورة<input type="range" data-field="zoom" min="1" max="2" step="0.05" value="1"></label>'+
   '<label>موضع أفقي<input type="range" data-field="x" min="0" max="100" value="50"></label>'+
   '<label>موضع رأسي<input type="range" data-field="y" min="0" max="100" value="50"></label>'+
   '<p role="status" data-status></p><button class="btn" data-download disabled>تنزيل PNG</button> '+
   '<button class="btn ghost" data-save disabled>حفظ نسخة للمراجعة</button><div data-versions></div></div>'+
   '<div style="flex:1 1 350px;min-width:0"><canvas style="width:100%;height:auto;border:1px solid #e2e6ed"></canvas></div></div></div>';
  document.body.appendChild(root);
  var sceneJobId=null,sourceFile=null,sourceUrl=null;
  var scene=null,valid=false,version=0,working=false;
  var status=root.querySelector('[data-status]'),canvas=root.querySelector('canvas');
  var requestStore='ssmpd-scene-request-'+item.id;
  root.querySelector('[data-field="headline"]').value=item.hook||item.title||'';
  root.querySelector('[data-field="cta"]').value='';
  root.querySelector('[data-prompt]').value=item.title||'';
  root.querySelector('.modal-close').onclick=function(){root.remove();};
  root.querySelectorAll('input:not([type=file]),textarea,select').forEach(function(el){el.style.width='100%';el.style.boxSizing='border-box';el.style.marginBottom='10px';});
  function data(){var out={};root.querySelectorAll('[data-field]').forEach(function(el){out[el.dataset.field]=el.value;});return out;}
  async function paint(){
   var current=++version;valid=false;buttons();
   try{var settings=data();if(!settings.headline.trim())throw new Error('اكتب عنوان التصميم.');var buffer=document.createElement('canvas');await C.render(buffer,scene,settings);if(current!==version)return;canvas.width=buffer.width;canvas.height=buffer.height;canvas.getContext('2d').drawImage(buffer,0,0);valid=!!scene;status.textContent=scene?'المعاينة جاهزة. راجع النص وموضع الصورة.':'اختر صورة أو ولّد مشهدًا لبدء المعاينة.';}
   catch(e){status.textContent=e.message;}buttons();
  }
  function buttons(){root.querySelectorAll('input,textarea,select,[data-library],[data-retry]').forEach(function(el){el.disabled=working;});root.querySelector('[data-download]').disabled=!valid||working;root.querySelector('[data-save]').disabled=!valid||working;root.querySelector('[data-generate]').disabled=working;}
  root.querySelectorAll('[data-field]').forEach(function(el){el.oninput=function(){var output=root.querySelector('[data-value="'+el.dataset.field+'"]');if(output)output.textContent=el.dataset.field==='ctaScale'?Math.round(Number(el.value)*100)+'%':el.value;paint();};});
  async function setScene(url){scene=await C.loadImage(url);await paint();}
  root.querySelector('[data-upload]').onchange=async function(){
   var file=this.files[0];if(!file)return;
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){status.textContent='اختر PNG أو JPEG أو WebP بحجم أقل من ٢٠ ميجابايت.';return;}
   var url=URL.createObjectURL(file);try{await setScene(url);sourceFile=file;sourceUrl=null;sceneJobId=null;}catch(e){status.textContent=e.message;}finally{URL.revokeObjectURL(url);}
  };
  async function invoke(body){var res=await window.SSMPDDb.client.functions.invoke('design-scene',{body:body});if(res.error){if(res.error.context){try{var body=await res.error.context.json();var detail=new Error(body.error||res.error.message);detail.terminal=body.status==='failed';throw detail;}catch(e){if(e.terminal!==undefined)throw e;}}throw new Error('تعذر الاتصال بتوليد الصور. تأكد من نشر design-scene. '+res.error.message);}if(res.data.error){var err=new Error(res.data.error);err.terminal=res.data.status==='failed';throw err;}return res.data;}
  root.querySelector('[data-library]').onclick=async function(){
   status.textContent='تحميل الصور المحفوظة…';
   try{var result=await invoke({action:'library'}),list=root.querySelector('[data-images]');list.replaceChildren();
    result.images.forEach(function(row){var button=document.createElement('button'),img=document.createElement('img');button.title=row.scene_prompt;img.src=row.url;img.alt='صورة محفوظة';img.style.cssText='width:85px;height:65px;object-fit:cover';button.appendChild(img);button.onclick=function(){sceneJobId=row.id;sourceFile=null;sourceUrl=null;setScene(row.url).catch(function(e){status.textContent=e.message;});};list.appendChild(button);});
    status.textContent=result.images.length?'اختر صورة لإعادة استخدامها بدون توليد.':'لا توجد صور مولّدة محفوظة بعد.';
   }catch(e){status.textContent=e.message;}
  };
  root.querySelector('[data-retry]').onclick=function(){localStorage.removeItem(requestStore);this.hidden=true;root.querySelector('[data-generate]').click();};
  root.querySelector('[data-generate]').onclick=async function(){
   if(working)return;working=true;buttons();status.textContent='جاري توليد الصورة وحفظها…';
   var key=localStorage.getItem(requestStore)||crypto.randomUUID();localStorage.setItem(requestStore,key);
   try{var result=await invoke({content_id:item.id,request_key:key,prompt:root.querySelector('[data-prompt]').value,quality:root.querySelector('[data-quality]').value});
    if(result.url){sceneJobId=result.job_id;sourceFile=null;sourceUrl=null;await setScene(result.url);localStorage.removeItem(requestStore);root.querySelector('[data-generate]').textContent='إعادة توليد صورة جديدة';}
    else status.textContent='الطلب مسجل وما زال قيد التنفيذ. اضغط مجددًا لاستعادة نتيجته بدون طلب مدفوع جديد.';
   }catch(e){status.textContent=e.message+' — نفس الطلب محفوظ لمنع تكرار الخصم.';root.querySelector('[data-retry]').hidden=!e.terminal;}
   finally{working=false;buttons();}
  };
  function blob(){return new Promise(function(resolve,reject){canvas.toBlob(function(b){b?resolve(b):reject(new Error('فشل تصدير الصورة'));},'image/png');});}
  root.querySelector('[data-download]').onclick=async function(){try{var url=URL.createObjectURL(await blob()),a=document.createElement('a');a.href=url;a.download='sono-'+item.id+'-'+Date.now()+'.png';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}catch(e){status.textContent=e.message;}};
  root.querySelector('[data-save]').onclick=async function(){
   if(!valid||working)return;working=true;buttons();status.textContent='حفظ نسخة جديدة للمراجعة…';
   try{var file=new File([await blob()],'sono-'+item.id+'-'+Date.now()+'.png',{type:'image/png'});
    if(sourceFile&&!sourceUrl){var original=await window.SSMPDDrive.uploadContentFile(sourceFile,{title:item.title,contentId:item.id});sourceUrl=original.fileUrl;}
    var saved=await window.SSMPDDrive.uploadDesignFile(file,{title:item.title,contentId:item.id});
    var record=await window.SSMPDDb.client.rpc('save_design_version',{p_content_id:item.id,p_output_url:saved.fileUrl,p_source_url:sourceUrl,p_scene_job_id:sceneJobId,p_settings:Object.assign({template:'sono-white-v1',width:1080,height:1350},data())});if(record.error)throw record.error;
    await window.SSMPDDb.updateContentItem(item.id,{design_file_url:saved.fileUrl,design_drive_folder:saved.folderUrl});
    var a=document.createElement('a');a.href=saved.fileUrl;a.target='_blank';a.rel='noopener';a.textContent='فتح النسخة المحفوظة — '+new Date().toLocaleTimeString('ar-EG');root.querySelector('[data-versions]').appendChild(a);
    status.textContent='تم حفظ نسخة جديدة. الاعتماد يتم من مسار المراجعة المعتاد.';
   }catch(e){status.textContent=e.message;}finally{working=false;buttons();}
  };
  window.SSMPDDb.client.from('design_versions').select('output_file_url,created_at').eq('content_id',item.id).order('created_at',{ascending:false}).limit(20).then(function(res){
   (res.data||[]).forEach(function(row){var a=document.createElement('a');a.href=row.output_file_url;a.target='_blank';a.rel='noopener';a.style.display='block';a.textContent='نسخة '+new Date(row.created_at).toLocaleString('ar-EG');root.querySelector('[data-versions]').appendChild(a);});
  });
  paint();
 }
 window.SSMPDDesignStudio={mount:mount,open:open};
})();
