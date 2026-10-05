(function(){
 'use strict';
 var C=window.SSMPDDesignComposer;
 var draftDatabase;
 function drafts(){
  if(!draftDatabase)draftDatabase=new Promise(function(resolve,reject){
   var req=indexedDB.open('ssmpd-design-drafts',1);
   req.onupgradeneeded=function(){req.result.createObjectStore('drafts');};
   req.onsuccess=function(){resolve(req.result);};req.onerror=function(){reject(req.error);};
  });return draftDatabase;
 }
 async function draftStore(key,value){
  var db=await drafts();return new Promise(function(resolve,reject){
   var tx=db.transaction('drafts',value===undefined?'readonly':'readwrite'),store=tx.objectStore('drafts');
   var req=value===undefined?store.get(key):store.put(value,key);
   tx.oncomplete=function(){resolve(req.result);};tx.onerror=function(){reject(tx.error);};tx.onabort=function(){reject(tx.error);};
  });
 }

 function mount(slot,item){
  if(!slot||!window.SSMPDRoles.canCreateAIDesign(window.SSMPDAuth.currentAdmin)||['published','scheduled','ready_to_publish'].includes(item.stage)||item.brand!=='sono'||item.content_format==='video'||!(window.SSMPDWorkflow.canEditItem(window.SSMPDAuth.currentAdmin,item)||item.assigned_designer===window.SSMPDAuth.currentAdmin.id||(item.design_execution==='ai'&&['in_design','needs_revision'].includes(item.stage)&&window.SSMPDRoles.hasAnyRole(window.SSMPDAuth.currentAdmin,['approver'])))) return;
  var start=document.createElement('button'); start.className='btn ghost'; start.textContent='إنشاء تصميم بالذكاء الاصطناعي'; slot.appendChild(start);
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
   '<details open><summary>حجم النص وموضعه</summary>'+
   '<label>ترتيب السطرين<select data-field="textOrder"><option value="headline_first">العنوان الكبير فوق — السطر التوضيحي تحت</option><option value="subtitle_first">السطر التوضيحي فوق — العنوان الكبير تحت</option></select></label>'+
   '<label>وضع العنوان<select data-field="titlePosition"><option value="bottom">تحت</option><option value="top">فوق</option><option value="right">يمين</option><option value="left">يسار</option></select></label>'+
   '<label>حجم خط العنوان بالبكسل<input type="number" data-field="headlineSize" min="20" max="180" step="1" value="83"></label>'+
   '<label>حجم خط السطر التوضيحي بالبكسل<input type="number" data-field="subtitleSize" min="16" max="100" step="1" value="42"></label>'+
   '<label>حجم خط زر التفاعل بالبكسل<input type="number" data-field="ctaSize" min="16" max="80" step="1" value="31"></label>'+
   '<p>الموضع بالبكسل. السالب يحرّك لفوق والموجب لتحت. حجم الزر يتناسب مع النص.</p>'+
   '<label>تحريك العنوان<input type="number" data-field="headlineOffset" min="-600" max="600" step="5" value="0"></label>'+
   '<label>تحريك السطر التوضيحي<input type="number" data-field="subtitleOffset" min="-600" max="600" step="5" value="0"></label>'+
   '<label>تحريك زر التفاعل<input type="number" data-field="ctaOffset" min="-900" max="60" step="5" value="0"></label>'+
   '<p>الشعار ثابت فوق الصورة. أبعد الوجه والتفاصيل المهمة عن ركن الشعار. يمكنك تعديل القص والموضع، وتظهر خلفية فاتحة تحت النص للحفاظ على وضوحه.</p></details>'+
   '<label>صورة من جهازك<input type="file" accept="image/png,image/jpeg,image/webp" data-upload></label>'+
   '<button class="btn ghost" data-library>صور سونو المحفوظة</button><div data-images style="display:flex;flex-wrap:wrap;gap:6px"></div>'+
   '<details><summary>توليد صورة بالذكاء الاصطناعي</summary><label>وصف المشهد<textarea data-prompt rows="3"></textarea></label>'+
   '<label>الجودة<select data-quality><option value="medium">Medium</option><option value="high">High</option></select></label>'+
   '<p>توليد صورة واحدة لكل طلب. حد التجربة ٣ محاولات للمادة و٥ دولارات شهريًا. تعديل النص لا يستهلك توليدًا جديدًا.</p>'+
   '<div class="design-ai-actions"><button class="btn" data-generate>توليد الصورة</button><button class="btn ghost" data-retry hidden>محاولة جديدة بعد الفشل</button></div></details>'+
   '<label>تكبير أو تصغير الصورة <input type="number" data-number-for="zoom" min="0.5" max="3" step="0.05" value="1">×<input type="range" data-field="zoom" min="0.5" max="3" step="0.05" value="1"></label><p>اكتب قيمة من 0.5× إلى 3×. التصغير قد يظهر خلفية فارغة حول الصورة.</p>'+
   '<label>موضع أفقي <input type="number" data-number-for="x" min="0" max="100" step="1" value="50"><input type="range" data-field="x" min="0" max="100" value="50"></label>'+
   '<label>تحريك الصورة رأسيًا <input type="number" data-number-for="imageOffsetY" min="-400" max="400" step="5" value="0"> بكسل<input type="range" data-field="imageOffsetY" min="-400" max="400" step="5" value="0"></label><p>السالب لفوق والموجب لتحت، حتى بدون تكبير. لو ظهرت حافة فارغة، قلّل التحريك أو كبّر الصورة.</p>'+
   '<label>بداية الـFade <input type="number" data-number-for="fadeStartY" min="500" max="1000" step="5" value="960"> بكسل<input type="range" data-field="fadeStartY" min="500" max="1000" step="5" value="960"></label>'+
   '<label>نهاية الـFade <input type="number" data-number-for="fadeEndY" min="550" max="1120" step="5" value="1105"> بكسل<input type="range" data-field="fadeEndY" min="550" max="1120" step="5" value="1105"></label><p>حرّك بداية ونهاية التلاشي لتحكم مساحة ظهور الصورة. النهاية تتوقف قبل الفوتر.</p>'+
   '<p role="status" data-draft-status></p><p role="status" data-status></p><button class="btn" data-download disabled>تنزيل PNG</button> '+
   '<button class="btn ghost" data-save disabled>حفظ نسخة للمراجعة</button><div data-versions></div></div>'+
   '<div style="flex:1 1 350px;min-width:0"><canvas style="width:100%;height:auto;border:1px solid #e2e6ed"></canvas></div></div></div>';
  document.body.appendChild(root);
  var sceneJobId=null,sourceFile=null,sourceUrl=null;
  var scene=null,valid=false,version=0,working=false;
  var status=root.querySelector('[data-status]'),canvas=root.querySelector('canvas');
  var owner=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;
  var draftKey=(owner&&owner.id||'session')+':'+item.id;
  var sceneBlob=null,draftTimer,saveQueue=Promise.resolve(),restoring=true;
  var draftStatus=root.querySelector('[data-draft-status]');
  async function saveDraft(){
   if(restoring)return;
   var snapshot={settings:data(),prompt:root.querySelector('[data-prompt]').value,quality:root.querySelector('[data-quality]').value,sceneBlob:sceneBlob,sceneJobId:sceneJobId,sourceFile:sourceFile,sourceUrl:sourceUrl,updatedAt:Date.now()};
   saveQueue=saveQueue.catch(function(){}).then(function(){return draftStore(draftKey,snapshot);});
   try{await saveQueue;draftStatus.textContent='تم حفظ المسودة على هذا الجهاز';}
   catch(e){draftStatus.textContent='تعذر حفظ المسودة. اترك النافذة مفتوحة حتى تحفظ نسخة للمراجعة.';throw e;}
  }
  function scheduleDraft(){if(restoring)return;clearTimeout(draftTimer);draftTimer=setTimeout(function(){saveDraft().catch(function(){});},350);}
  root.addEventListener('input',scheduleDraft);root.addEventListener('change',scheduleDraft);
  var requestStore='ssmpd-scene-request-'+item.id;
  root.querySelector('[data-field="headline"]').value=item.hook||item.title||'';
  root.querySelector('[data-field="cta"]').value='';
  root.querySelector('[data-prompt]').value=item.title||'';
  root.querySelector('.modal-close').onclick=async function(){clearTimeout(draftTimer);if(restoring||working){draftStatus.textContent='انتظر انتهاء تحميل أو توليد الصورة قبل الإغلاق.';return;}try{await saveDraft();root.remove();}catch(e){}};
  root.querySelectorAll('input:not([type=file]),textarea,select').forEach(function(el){el.style.width='100%';el.style.boxSizing='border-box';el.style.marginBottom='10px';});
  root.querySelectorAll('[data-number-for]').forEach(function(el){el.style.width='90px';el.style.display='inline-block';el.style.margin='0 8px';el.style.direction='ltr';});
  function data(){var out={};root.querySelectorAll('[data-field]').forEach(function(el){out[el.dataset.field]=el.value;});return out;}
  async function paint(){
   var current=++version;valid=false;buttons();
   try{var settings=data();if(!settings.headline.trim())throw new Error('اكتب عنوان التصميم.');var buffer=document.createElement('canvas');await C.render(buffer,scene,settings,{preview:true});if(current!==version)return;canvas.width=buffer.width;canvas.height=buffer.height;canvas.getContext('2d').drawImage(buffer,0,0);var issues=buffer.designIssues||[];valid=!!scene&&!issues.length;status.textContent=issues.length?'المعاينة تعرض القيم الحالية. '+issues.join(' ')+' الحفظ متوقف حتى تصحيح الموضع.':scene?'المعاينة جاهزة. راجع النص وموضع الصورة.':'اختر صورة أو ولّد مشهدًا لبدء المعاينة.';}
   catch(e){if(current!==version)return;canvas.width=1080;canvas.height=1350;status.textContent='تعذر عرض القيم الحالية. '+e.message;}buttons();
  }
  function buttons(){root.querySelectorAll('input,textarea,select,[data-library],[data-retry]').forEach(function(el){el.disabled=working||restoring;});root.querySelector('[data-download]').disabled=!valid||working||restoring;root.querySelector('[data-save]').disabled=!valid||working||restoring;root.querySelector('[data-generate]').disabled=working||restoring;}
  root.querySelectorAll('[data-field]').forEach(function(el){function changed(){if(el.dataset.field==='titlePosition'){root.querySelector('[data-field="x"]').value=el.value==='left'?100:el.value==='right'?0:50;root.querySelector('[data-field="headlineOffset"]').value=0;root.querySelector('[data-field="subtitleOffset"]').value=0;}if(el.dataset.field==='fadeStartY'){var end=root.querySelector('[data-field="fadeEndY"]');if(Number(end.value)<Number(el.value)+50){end.value=Math.min(1120,Number(el.value)+50);var endOutput=root.querySelector('[data-value="fadeEndY"]');if(endOutput)endOutput.textContent=end.value;}}if(el.dataset.field==='fadeEndY'){var start=root.querySelector('[data-field="fadeStartY"]');if(Number(start.value)>Number(el.value)-50){start.value=Math.max(500,Number(el.value)-50);var startOutput=root.querySelector('[data-value="fadeStartY"]');if(startOutput)startOutput.textContent=start.value;}}var numberInput=root.querySelector('[data-number-for="'+el.dataset.field+'"]');if(numberInput)numberInput.value=el.value;var output=root.querySelector('[data-value="'+el.dataset.field+'"]');if(output)output.textContent=el.dataset.field==='ctaScale'?Math.round(Number(el.value)*100)+'%':el.value;paint();}el.oninput=changed;el.onchange=changed;});
  root.querySelectorAll('[data-number-for]').forEach(function(input){var slider=root.querySelector('[data-field="'+input.dataset.numberFor+'"]');function changed(){if(input.value==='')return;var min=Number(input.min),max=Number(input.max),value=Math.max(min,Math.min(max,Number(input.value)));if(!Number.isFinite(value))return;input.value=value;slider.value=value;slider.dispatchEvent(new Event('input',{bubbles:true}));}input.oninput=changed;input.onchange=changed;});
  async function setScene(url){
   var loaded=await C.loadImage(url),raw=document.createElement('canvas');raw.width=loaded.width;raw.height=loaded.height;raw.getContext('2d').drawImage(loaded,0,0);
   var stored=await new Promise(function(resolve,reject){try{raw.toBlob(function(blob){blob?resolve(blob):reject(new Error('تعذر حفظ صورة المسودة'));},'image/png');}catch(e){reject(e);}});
   scene=loaded;sceneBlob=stored;await paint();scheduleDraft();
  }
  root.querySelector('[data-upload]').onchange=async function(){
   var file=this.files[0];if(!file)return;
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){status.textContent='اختر PNG أو JPEG أو WebP بحجم أقل من ٢٠ ميجابايت.';return;}
   var url=URL.createObjectURL(file);try{await setScene(url);sourceFile=file;sourceUrl=null;sceneJobId=null;await saveDraft();}catch(e){status.textContent=e.message;}finally{URL.revokeObjectURL(url);}
  };
  async function invoke(body){var res=await window.SSMPDDb.client.functions.invoke('design-scene',{body:body});if(res.error){if(res.error.context){try{var body=await res.error.context.json();var detail=new Error(body.error||res.error.message);detail.terminal=body.status==='failed';throw detail;}catch(e){if(e.terminal!==undefined)throw e;}}throw new Error('تعذر الاتصال بتوليد الصور. تأكد من نشر design-scene. '+res.error.message);}if(res.data.error){var err=new Error(res.data.error);err.terminal=res.data.status==='failed';throw err;}return res.data;}
  root.querySelector('[data-library]').onclick=async function(){
   status.textContent='تحميل الصور المحفوظة…';
   try{var result=await invoke({action:'library'}),list=root.querySelector('[data-images]');list.replaceChildren();
    result.images.forEach(function(row){var button=document.createElement('button'),img=document.createElement('img');button.title=row.scene_prompt;img.src=row.url;img.alt='صورة محفوظة';img.style.cssText='width:85px;height:65px;object-fit:cover';button.appendChild(img);button.onclick=function(){sceneJobId=row.id;sourceFile=null;sourceUrl=null;setScene(row.url).then(saveDraft).catch(function(e){status.textContent=e.message;});};list.appendChild(button);});
    status.textContent=result.images.length?'اختر صورة لإعادة استخدامها بدون توليد.':'لا توجد صور مولّدة محفوظة بعد.';
   }catch(e){status.textContent=e.message;}
  };
  root.querySelector('[data-retry]').onclick=function(){localStorage.removeItem(requestStore);this.hidden=true;root.querySelector('[data-generate]').click();};
  root.querySelector('[data-generate]').onclick=async function(){
   if(working)return;working=true;buttons();status.textContent='جاري توليد الصورة وحفظها…';
   var key=localStorage.getItem(requestStore)||crypto.randomUUID();localStorage.setItem(requestStore,key);
   try{var result=await invoke({content_id:item.id,request_key:key,prompt:C.scenePrompt(root.querySelector('[data-prompt]').value,data()),quality:root.querySelector('[data-quality]').value});
    if(result.url){sceneJobId=result.job_id;sourceFile=null;sourceUrl=null;await setScene(result.url);localStorage.removeItem(requestStore);root.querySelector('[data-generate]').textContent='إعادة توليد صورة جديدة';await saveDraft();}
    else status.textContent='الطلب مسجل وما زال قيد التنفيذ. اضغط مجددًا لاستعادة نتيجته بدون طلب مدفوع جديد.';
   }catch(e){status.textContent=e.message+' — نفس الطلب محفوظ لمنع تكرار الخصم.';root.querySelector('[data-retry]').hidden=!e.terminal;}
   finally{working=false;buttons();}
  };
  function blob(){if(!valid)return Promise.reject(new Error('صحّح المعاينة قبل التنزيل.'));return new Promise(function(resolve,reject){canvas.toBlob(function(b){b?resolve(b):reject(new Error('فشل تصدير الصورة'));},'image/png');});}
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
  buttons();root.querySelectorAll('input,textarea,select,button').forEach(function(el){el.disabled=true;});
  (async function(){
   try{var saved=await draftStore(draftKey);if(saved){
    Object.keys(saved.settings||{}).forEach(function(key){var field=root.querySelector('[data-field="'+key+'"]');if(field)field.value=saved.settings[key];});
    root.querySelectorAll('[data-number-for]').forEach(function(el){var field=root.querySelector('[data-field="'+el.dataset.numberFor+'"]');if(field)el.value=field.value;});
    root.querySelector('[data-prompt]').value=saved.prompt||'';root.querySelector('[data-quality]').value=saved.quality||'medium';
    sceneJobId=saved.sceneJobId;sourceFile=saved.sourceFile;sourceUrl=saved.sourceUrl;
    if(saved.sceneBlob){var url=URL.createObjectURL(saved.sceneBlob);try{await setScene(url);}finally{URL.revokeObjectURL(url);}}
    draftStatus.textContent='تم استرجاع المسودة السابقة';
   }}catch(e){draftStatus.textContent='تعذر استرجاع المسودة. '+e.message;}
   finally{restoring=false;root.querySelectorAll('button').forEach(function(el){el.disabled=false;});buttons();await paint();}
  })();
 }
 window.SSMPDDesignStudio={mount:mount,open:open};
})();
