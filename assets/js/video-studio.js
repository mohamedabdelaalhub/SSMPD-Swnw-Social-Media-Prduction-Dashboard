/* Presentation layer for the existing worker, uploads, covers and job controls. */
(function () {
  'use strict';
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function panel(title,open){var el=document.createElement('details');el.className='vs-panel';el.open=open;el.innerHTML='<summary>'+title+'</summary><div class="vs-panel-body"></div>';return el;}
  function enhance(slot,item,assets,jobs,refresh,hasSceneChanges){
    var main=slot.querySelector('.section');if(!main)return;
    var children=Array.from(main.children),materials=children.find(function(el){return el.querySelector('#video-media-mode');}),covers=children.find(function(el){return el.querySelector('#save-cover-settings');}),scenes=slot.querySelector('#video-storyboard-slot'),worker=children[1];
    var root=document.createElement('section');root.className='video-studio';
    root.innerHTML='<div class="vs-header"><div><h4>استوديو الفيديو</h4><p class="vs-hint">السكريبت ← المشاهد ← الصوت والهوية ← الإنتاج والمراجعة</p></div><span class="status-pill">رأسي 9:16 · 1080×1920</span></div><ol class="vs-steps"><li>1 · السكريبت</li><li>2 · المشاهد والملفات</li><li>3 · الصوت والهوية</li><li>4 · الإنتاج والنسخ</li></ol>';
    if(worker)root.appendChild(worker);
    var script=panel('1 · السكريبت والمدة',!String(item.script_text||'').trim()),media=panel('2 · المشاهد وملفات التصوير',true),identity=panel('3 · الصوت والموسيقى والهوية',false),result=panel('4 · الإنتاج والنسخ',true);
    var scriptBody=script.querySelector('div'),mediaBody=media.querySelector('div'),identityBody=identity.querySelector('div'),resultBody=result.querySelector('div');
    var editable=window.SSMPDWorkflow.canEditItem(window.SSMPDAuth.currentAdmin,item);
    scriptBody.innerHTML='<label class="vs-label">نص التعليق الصوتي<textarea data-studio-script'+(editable?'':' readonly')+'>'+esc(item.script_text)+'</textarea></label><div class="vs-grid"><label class="vs-label">أقل مدة بالثواني<input data-studio-min type="number" min="5" max="120" value="'+Number(item.target_duration_min_seconds||25)+'"'+(editable?'':' readonly')+'></label><label class="vs-label">أقصى مدة بالثواني<input data-studio-max type="number" min="5" max="120" value="'+Number(item.target_duration_max_seconds||35)+'"'+(editable?'':' readonly')+'></label></div><input type="hidden" data-studio-template value="'+esc(item.video_template||'medical_educational')+'"'+'><p class="vs-hint">الصوت يتولد من هذا النص باستخدام إعدادات العامل. تعديل السكريبت يتطلب مراجعة تقسيم المشاهد. المهام التي بدأت تحتفظ بنسختها.</p>'+(editable?'<button type="button" class="btn sm" data-save-script>حفظ السكريبت والمدة</button>':'')+'<p role="status" data-script-feedback></p>';
    if(materials)mediaBody.appendChild(materials);
    if(scenes)mediaBody.appendChild(scenes);
    var music=slot.querySelector('#video-music-mood');if(music)identityBody.appendChild(music.closest('.field'));
    var voice=document.createElement('p');voice.className='vs-hint';voice.textContent='العامل يستخدم البصمة الصوتية المحفوظة على الماك. رفع ملف تعليق صوتي يختار ذلك الملف بدل توليد صوت من النص. صوت لقطات الفيديو لا يدخل في المونتاج.';identityBody.appendChild(voice);
    if(covers){Array.from(covers.children).forEach(function(el){if(el.tagName!=='SUMMARY')identityBody.appendChild(el);});covers.remove();}
    children.forEach(function(el){if(el!==children[0]&&el!==worker&&el!==materials&&el!==covers&&el!==scenes)resultBody.appendChild(el);});
    Array.from(slot.children).forEach(function(el){if(el!==main)resultBody.appendChild(el);});
    var histories=document.createElement('details');histories.className='vs-panel';histories.innerHTML='<summary>النسخ السابقة ('+Math.max(0,jobs.length-1)+')</summary><div class="vs-panel-body"></div>';
    jobs.slice(1).forEach(function(job){var row=document.createElement('div');row.className='vs-row';row.innerHTML='<span>'+esc(new Date(job.created_at).toLocaleString('ar-EG'))+' · '+esc(job.status)+'</span>';var url=job.drive_video_url||job.output_video_url;if(url){var a=document.createElement('a');a.className='btn ghost sm';a.textContent='فتح النسخة';a.href=url;a.target='_blank';a.rel='noopener';row.appendChild(a);}histories.querySelector('div').appendChild(row);});
    if(jobs.length>1)resultBody.appendChild(histories);
    root.append(script,media,identity,result);main.replaceWith(root);
    var dirty=false,saving=false,button=scriptBody.querySelector('[data-save-script]'),feedback=scriptBody.querySelector('[data-script-feedback]');
    function changed(){dirty=true;feedback.textContent='تعديلات السكريبت لم تُحفظ.';var produce=slot.querySelector('#create-video-job-btn');if(produce)produce.disabled=true;}
    if(editable)scriptBody.querySelectorAll('textarea,input').forEach(function(e){e.addEventListener('input',changed);});
    if(button)button.onclick=function(){
      if(saving)return;
      if(hasSceneChanges&&hasSceneChanges()){feedback.textContent='احفظ تعديلات المشاهد قبل تغيير السكريبت.';return;}
      var text=scriptBody.querySelector('[data-studio-script]').value.trim(),min=Number(scriptBody.querySelector('[data-studio-min]').value),max=Number(scriptBody.querySelector('[data-studio-max]').value),template=scriptBody.querySelector('[data-studio-template]').value.trim();
      if(!text||!template||!Number.isInteger(min)||!Number.isInteger(max)||min<5||max<min||max>120){feedback.textContent='أكمل النص والقالب، واختر مدة من 5 إلى 120 ثانية، والأقصى لا يقل عن الأدنى.';return;}
      saving=true;var controls=Array.from(root.querySelectorAll('button,input,textarea,select')).map(function(e){return {element:e,disabled:e.disabled};});controls.forEach(function(c){c.element.disabled=true;});root.setAttribute('aria-busy','true');
      window.SSMPDDb.updateContentItem(item.id,{script_text:text,target_duration_min_seconds:min,target_duration_max_seconds:max,video_template:template}).then(function(updated){Object.assign(item,updated);dirty=false;refresh();}).catch(function(e){feedback.textContent='تعذر حفظ السكريبت: '+e.message;}).finally(function(){saving=false;controls.forEach(function(c){c.element.disabled=c.disabled;});root.removeAttribute('aria-busy');});
    };
    // Explicit view refresh/source changes must not silently discard studio edits.
    function protect(event){if(saving||((dirty||(hasSceneChanges&&hasSceneChanges()))&&!window.confirm('هناك تعديلات لم تُحفظ. متابعة بدون حفظ؟'))){event.preventDefault();event.stopImmediatePropagation();var select=slot.querySelector('#video-media-mode');if(event.target===select)select.value=item.video_media_mode||'uploaded_plus_auto';}}
    var refreshButton=slot.querySelector('[data-refresh-video]');if(refreshButton)refreshButton.addEventListener('click',protect,true);
    var uploadButton=slot.querySelector('#upload-video-assets-btn');if(uploadButton)uploadButton.addEventListener('click',protect,true);
    slot.querySelectorAll('[data-delete-video-asset]').forEach(function(b){b.addEventListener('click',protect,true);});
    var mode=slot.querySelector('#video-media-mode');if(mode){mode.addEventListener('change',protect,true);var option=mode.querySelector('[value="studio_storyboard"]');if(option){option.disabled=true;window.SSMPDDb.getVideoStudioCapabilities().then(function(c){if(mode.isConnected){option.disabled=c.schema_version<4;if(option.disabled)option.textContent='مونتاج الفريق + مشاهد AI — يحتاج تفعيل قاعدة البيانات';}}).catch(function(){if(option.isConnected)option.textContent='تعذر فحص تفعيل استوديو المشاهد';});}}
    // Generated footage stays private; retrieve a short-lived URL only on request.
    var generation=(jobs[0]||{}).generation_state||{};
    var latest=jobs[0],board=item.video_storyboard;
    if(board&&board.version===2&&latest&&latest.storyboard&&Object.keys(generation).some(function(k){return generation[k].asset_id;})){
      var reuse=document.createElement('button');reuse.type='button';reuse.className='btn ghost sm';reuse.textContent='استخدام المشاهد المولدة المحفوظة في النسخة القادمة';
      reuse.onclick=function(event){
        if(dirty||(hasSceneChanges&&hasSceneChanges())){window.SSMPDToast.show('احفظ السكريبت والمشاهد قبل استخدام النتائج.','info');return;}
        var next=JSON.parse(JSON.stringify(item.video_storyboard)),count=0;
        Object.keys(generation).forEach(function(k){var scene=next.scenes[Number(k)],original=(latest.storyboard.scenes||[])[Number(k)],state=generation[k];
          if(scene&&original&&state.asset_id&&scene.source===original.source&&scene.prompt===original.prompt&&scene.text===original.text&&scene.generation_seconds===original.generation_seconds){scene.source='upload';scene.asset_id=state.asset_id;scene.clip_start=0;count++;}});
        if(!count){window.SSMPDToast.show('أوصاف المشاهد اتغيرت. لا توجد نتائج مطابقة لإعادة استخدامها.','info');return;}
        reuse.disabled=true;window.SSMPDDb.saveVideoStoryboard(item.id,next).then(function(updated){Object.assign(item,updated);refresh();}).catch(function(e){reuse.disabled=false;window.SSMPDToast.show(e.message,'error');});
      };resultBody.appendChild(reuse);
    }
    Object.keys(generation).forEach(function(key){var state=generation[key];if(!state.storage_path)return;var b=document.createElement('button');b.type='button';b.className='btn ghost sm';b.textContent='معاينة المشهد المولد '+(Number(key)+1);b.onclick=function(){b.disabled=true;window.SSMPDDb.getVideoAssetSignedUrl(state.storage_path).then(function(url){if(!resultBody.isConnected)return;var video=state.storage_path.endsWith('.mp4'),preview=document.createElement(video?'video':'img');preview.className='vs-preview';if(video){preview.controls=true;preview.muted=true;}else preview.alt='المشهد المولد';preview.src=url;b.after(preview);b.remove();}).catch(function(){b.disabled=false;});};resultBody.appendChild(b);});
    return {isDirty:function(){return dirty||saving;}};
  }
  window.SSMPDVideoStudio={enhance:enhance};
})();

