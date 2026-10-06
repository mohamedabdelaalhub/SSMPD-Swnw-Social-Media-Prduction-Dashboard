/* Mixed studio scenes. Legacy image-only scenes remain in video-storyboard.js. */
(function () {
  'use strict';
  var motions = { pan_left:'تحريك لليسار',pan_right:'تحريك لليمين',zoom_in:'تقريب',zoom_out:'إبعاد' };
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function normalize(s) { return String(s || '').trim().replace(/\s+/g,' '); }
  function split(item) {
    var board = window.SSMPDVideoStoryboard.split(item);
    board.version = 2;
    board.scenes.forEach(function (s) { s.source='upload';s.clip_start=0;s.prompt='';s.generation_seconds=4;s.framing='cover'; });
    return board;
  }
  function problem(item, board, assets) {
    if (!board || board.version!==2 || !Array.isArray(board.scenes)) return 'قسّم السكريبت إلى مشاهد.';
    if (normalize(board.source_script)!==normalize(item.script_text) || normalize(board.scenes.map(function(s){return s.text;}).join(' '))!==normalize(item.script_text)) return 'السكريبت اتغير. أعد تقسيم المشاهد قبل الإنتاج.';
    if (board.scenes.length<Math.max(3,Math.ceil(Number(item.target_duration_min_seconds||0)/8)) || board.scenes.length>20) return 'عدد المشاهد لا يناسب المدة.';
    if (!['fade','slide','none'].includes(board.transition)) return 'اختر نوع الانتقال.';
    for (var s of board.scenes) {
      if (!normalize(s.text) || normalize(s.text).split(' ').length>35 || !motions[s.motion]) return 'راجع نص المشهد وحركته.';
      if (!['cover','contain'].includes(s.framing||'cover')) return 'اختر طريقة عرض المقطع.';
      if (!Number.isFinite(s.clip_start) || s.clip_start<0 || s.clip_start>3600) return 'بداية المقطع يجب أن تكون بين 0 و3600 ثانية.';
      if (s.source==='upload') {
        if (!assets.some(function(a){return a.id===s.asset_id && ['image','video'].includes(a.asset_type) && a.asset_role!=='legacy_logo';})) return 'اختر صورة أو مقطعًا لكل مشهد من مصدر الملفات.';
      } else if (s.source==='ai_image' || s.source==='ai_video') {
        if (String(s.prompt||'').trim().length<10 || String(s.prompt||'').trim().length>3000) return 'اكتب وصفًا لكل مشهد مولّد من 10 إلى 3000 حرف.';
        if (s.source==='ai_video' && ![4,8,12].includes(s.generation_seconds)) return 'اختر مدة توليد المقطع.';
      } else return 'اختر مصدر كل مشهد.';
    }
    return '';
  }
  function mount(host,item,initialAssets,changed) {
    var assets=initialAssets.slice(),board=item.video_storyboard && item.video_storyboard.version===2 ? JSON.parse(JSON.stringify(item.video_storyboard)):null;
    var dirty=false,busy=false,message='';
    function ready(){return !dirty&&!busy&&!problem(item,board,assets);}
    function signal(){host.classList.toggle('confirm-pending',dirty||busy);changed(ready());}
    function feedback(){signal();var e=host.querySelector('[data-studio-feedback]');if(e)e.textContent=message||(dirty?'احفظ إعدادات المشاهد قبل الإنتاج.':problem(item,board,assets)||'المشاهد جاهزة للإنتاج.');}
    function draw(){
      if(!host.isConnected)return;
      host.innerHTML='<section class="vs-scenes"><div class="vs-row"><h4>خطة المشاهد</h4><button type="button" class="btn ghost sm" data-studio-split>'+ (board?'إعادة تقسيم السكريبت':'تقسيم السكريبت') +'</button></div><p class="vs-hint">اربط كل جزء من السكريبت بصورة أو مقطع من تصوير الفريق، أو اختر توليد صورة أو فيديو. صوت المقاطع يُكتم ويُستخدم التعليق الصوتي المحفوظ للعامل.</p>'+
        (board?'<label class="vs-label">الانتقالات<select data-studio-transition><option value="fade">تلاشي</option><option value="slide">انزلاق</option><option value="none">قطع مباشر</option></select></label><div data-studio-scenes></div><button type="button" class="btn sm" data-studio-save>حفظ المشاهد</button>':'')+'<p role="status" data-studio-feedback></p></section>';
      host.querySelector('[data-studio-split]').onclick=async function(){
        if(board&&!window.confirm('إعادة التقسيم ستغيّر ربط الملفات بالمشاهد. تكمل؟'))return;
        try{board=split(item);dirty=true;message='';draw();await save();}catch(e){message=e.message;feedback();}
      };
      if(board){
        var bulk=document.createElement('div');bulk.className='vs-actions';bulk.innerHTML='<label>مصدر المشاهد<select data-all-source><option value="upload">ملفات مرفوعة</option><option value="ai_image">صور مولدة</option><option value="ai_video">مقاطع مولدة</option></select></label><button type="button" class="btn ghost sm" data-apply-source>تطبيق على كل المشاهد</button>';host.querySelector('[data-studio-scenes]').before(bulk);
        bulk.querySelector('button').onclick=function(){if(!window.confirm('تطبيق هذا المصدر على كل المشاهد؟ الملفات المرفوعة ستظل محفوظة.'))return;var type=bulk.querySelector('select').value;board.scenes.forEach(function(s){s.source=type;if(type!=='upload'&&!String(s.prompt||'').trim())s.prompt='لقطة توضيحية في سياق طبي للفكرة التالية، بدون كتابة أو شعارات، وتكوين رأسي: '+s.text;});dirty=true;message='';draw();};
        var transition=host.querySelector('[data-studio-transition]');transition.value=board.transition;
        transition.onchange=function(){board.transition=transition.value;dirty=true;message='';feedback();};
        var words=board.scenes.reduce(function(n,s){return n+normalize(s.text).split(' ').length;},0),cursor=0;
        board.scenes.forEach(function(scene,index){
          var seconds=Number(item.target_duration_max_seconds||30)*normalize(scene.text).split(' ').length/words;
          var card=document.createElement('details');card.className='vs-scene';card.open=index===0;
          card.innerHTML='<summary><span>المشهد '+(index+1)+'</span><span class="vs-hint">'+cursor.toFixed(1)+'–'+(cursor+seconds).toFixed(1)+' ث تقريبًا</span></summary><div class="vs-scene-body"><p>'+esc(scene.text)+'</p><div class="vs-grid"><label class="vs-label">مصدر المشهد<select data-source><option value="upload">ملف من تصوير الفريق أو صورة</option><option value="ai_image">توليد صورة وتحريكها</option><option value="ai_video">توليد مقطع فيديو</option></select></label><label class="vs-label">حركة الصور<select data-motion>'+Object.keys(motions).map(function(k){return '<option value="'+k+'">'+motions[k]+'</option>';}).join('')+'</select></label></div><label class="vs-label" data-framing-label>إطار مقطع الفيديو<select data-framing><option value="cover">ملء الشاشة وقص الأطراف</option><option value="contain">إظهار اللقطة كاملة</option></select></label><div data-upload-fields><label class="vs-label">اختيار الملف<select data-asset><option value="">اختر ملفًا</option>'+assets.filter(function(a){return ['image','video'].includes(a.asset_type)&&a.asset_role!=='legacy_logo';}).map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.file_name)+'</option>';}).join('')+'</select></label><div class="vs-grid"><label class="vs-label">بداية مقطع الفيديو بالثواني<input type="number" data-start min="0" max="3600" step="0.1" value="'+Number(scene.clip_start||0)+'"></label><label class="vs-label">رفع ملف لهذا المشهد<input type="file" data-file accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"></label></div><div data-preview></div></div><div data-ai-fields><label class="vs-label">وصف اللقطة المطلوبة<textarea data-prompt maxlength="3000" placeholder="صف المكان والأشخاص والحركة والإضاءة المطلوبة">'+esc(scene.prompt)+'</textarea></label><label class="vs-label" data-length-label>مدة المقطع المولد<select data-length><option value="4">4 ثوانٍ</option><option value="8">8 ثوانٍ</option><option value="12">12 ثانية</option></select></label><p class="vs-hint">التوليد يبدأ عند إرسال المهمة للعامل. الناتج يُركّب تحت البصمة الصوتية. مدة المشهد في المونتاج تتبع التعليق الصوتي.</p></div></div>';
          cursor+=seconds;host.querySelector('[data-studio-scenes]').appendChild(card);
          var source=card.querySelector('[data-source]'),motion=card.querySelector('[data-motion]'),assetSelect=card.querySelector('[data-asset]'),start=card.querySelector('[data-start]'),prompt=card.querySelector('[data-prompt]'),length=card.querySelector('[data-length]'),framing=card.querySelector('[data-framing]');
          framing.value=scene.framing||'cover';framing.onchange=function(){scene.framing=framing.value;modified();};source.value=scene.source;motion.value=scene.motion;assetSelect.value=scene.asset_id||'';length.value=String(scene.generation_seconds||4);
          function visibility(){var selected=assets.find(function(a){return a.id===scene.asset_id;});card.querySelector('[data-framing-label]').hidden=scene.source!=='ai_video'&&!(scene.source==='upload'&&selected&&selected.asset_type==='video');card.querySelector('[data-upload-fields]').hidden=scene.source!=='upload';card.querySelector('[data-ai-fields]').hidden=scene.source==='upload';card.querySelector('[data-length-label]').hidden=scene.source!=='ai_video';}
          function modified(){dirty=true;message='';feedback();}
          source.onchange=function(){scene.source=source.value;if(scene.source!=='upload'&&!String(scene.prompt||'').trim()){scene.prompt='لقطة توضيحية في سياق طبي للفكرة التالية، بدون كتابة أو شعارات، وتكوين رأسي: '+scene.text;prompt.value=scene.prompt;}visibility();modified();};motion.onchange=function(){scene.motion=motion.value;modified();};
          start.oninput=function(){scene.clip_start=Number(start.value);modified();};prompt.oninput=function(){scene.prompt=prompt.value;modified();};length.onchange=function(){scene.generation_seconds=Number(length.value);modified();};
          function preview(){
            var chosen=assets.find(function(a){return a.id===scene.asset_id;}),out=card.querySelector('[data-preview]');out.replaceChildren();
            if(!chosen||!card.open)return;
            window.SSMPDDb.getVideoAssetSignedUrl(chosen.storage_path).then(function(url){if(!card.isConnected||scene.asset_id!==chosen.id)return;var media=document.createElement(chosen.asset_type==='video'?'video':'img');media.className='vs-preview';if(chosen.asset_type==='video'){media.controls=true;media.muted=true;media.preload='metadata';}else media.alt='معاينة المشهد';media.src=url;out.replaceChildren(media);}).catch(function(){out.textContent='تعذر تحميل المعاينة.';});
          }
          assetSelect.onchange=function(){scene.asset_id=assetSelect.value||null;visibility();preview();modified();};card.addEventListener('toggle',preview);visibility();preview();
          card.querySelector('[data-file]').onchange=async function(){
            var file=this.files[0];if(!file)return;
            var kind=file.type.startsWith('image/')?'image':'video';
            if(!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.type)||!file.size||file.size>(kind==='image'?15:50)*1024*1024){message='ارفع JPG أو PNG أو WebP حتى 15 ميجابايت، أو MP4 أو MOV حتى 50 ميجابايت.';feedback();return;}
            busy=true;message='جاري رفع ملف المشهد…';draw();
            try{var row=await window.SSMPDDb.uploadVideoAsset(item.id,window.SSMPDAuth.currentAdmin.id,kind,file);assets.push(row);scene.asset_id=row.id;scene.source='upload';dirty=true;await persist();message='تم حفظ ملف المشهد.';}catch(e){message=e.message;}finally{busy=false;draw();}
          };
        });
        host.querySelector('[data-studio-save]').onclick=save;
      }
      host.querySelectorAll('button,input,select,textarea').forEach(function(e){e.disabled=busy;});feedback();
    }
    async function persist(){var result=await window.SSMPDDb.saveVideoStoryboard(item.id,board);item.video_storyboard=result.video_storyboard;item.video_media_mode=result.video_media_mode;dirty=false;}
    async function save(){if(busy)return;busy=true;message='جاري الحفظ…';draw();try{await persist();message='تم حفظ المشاهد.';}catch(e){message=e.message;}finally{busy=false;draw();}}
    draw();return {ready:ready,isDirty:function(){return dirty||busy;}};
  }
  window.SSMPDStudioStoryboard={split:split,problem:problem,mount:mount};
})();

