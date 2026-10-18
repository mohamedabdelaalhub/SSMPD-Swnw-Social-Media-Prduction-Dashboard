/* Daily schedules use the supplied artwork and the existing private design/workflow APIs. */
(function(){
 'use strict';
 var days=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'],assets;
 function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function validate(b){
  if(!b||!days.includes(b.day))throw Error('اختر يوم جدول العيادات.');
  if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>13)throw Error('أضف من طبيب واحد إلى ١٣ طبيبًا في التصميم.');
  b.rows.forEach(function(r,i){
   if(!r.name||!r.name.trim()||!r.specialty||!r.specialty.trim())throw Error('أكمل اسم الطبيب والتخصص في السطر '+(i+1)+'.');
   if(r.name.length>80||r.specialty.length>80)throw Error('اختصر الاسم أو التخصص في السطر '+(i+1)+' إلى ٨٠ حرفًا بحد أقصى.');
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.from)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.to)||r.from===r.to)throw Error('حدد بداية ونهاية مختلفتين للموعد في السطر '+(i+1)+'.');
  });return b;
 }
 function from(item){try{var raw=typeof item.agent_raw_output==='string'?JSON.parse(item.agent_raw_output):item.agent_raw_output;return item.brand==='sono'&&raw&&raw.content_kind==='daily_clinics'&&raw.daily_clinics_brief||null;}catch(e){return null;}}
 function metadata(raw,b){try{raw=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){raw={};}raw=Object.assign({},raw||{});['doctor_brief','dina_brief','before_after_brief','carousel_brief'].forEach(function(k){delete raw[k];});return Object.assign(raw,{content_kind:'daily_clinics',daily_clinics_brief:b});}
 function fields(){return '<div class="daily-clinics-layout"><div><label>يوم جدول العيادات<select data-daily-day><option value="">اختر اليوم</option>'+days.map(function(d){return '<option>'+d+'</option>';}).join('')+'</select></label><div data-daily-rows></div><button type="button" class="btn ghost" data-daily-add>إضافة طبيب</button><p>حتى ١٣ طبيبًا في التصميم. اكتب الاسم كما سيظهر للجمهور، واختر المواعيد صباحًا أو مساءً. النهاية الأقل من البداية تعني اليوم التالي. هذه مدخلات منشور، ولا تعدّل حجوزات المرضى أو عقود الأطباء.</p></div><div><canvas data-daily-canvas aria-label="معاينة مواعيد العيادات اليومية"></canvas><p data-daily-status role="status" aria-live="polite"></p></div></div>';}
 function row(r){r=r||{};return '<fieldset class="daily-clinics-row"><legend>بيانات العيادة</legend><label>اسم الطبيب في جدول اليوم<input data-daily-key="name" maxlength="80" value="'+esc(r.name)+'"></label><label>تخصص العيادة في الجدول<input data-daily-key="specialty" maxlength="80" value="'+esc(r.specialty)+'"></label><div class="daily-clinics-times"><label>بداية موعد العيادة<input type="time" dir="ltr" data-daily-key="from" value="'+esc(r.from)+'"></label><label>نهاية موعد العيادة<input type="time" dir="ltr" data-daily-key="to" value="'+esc(r.to)+'"></label></div><div class="daily-clinics-order"><button type="button" class="btn ghost sm" data-daily-up aria-label="تحريك العيادة لأعلى">↑</button><button type="button" class="btn ghost sm" data-daily-down aria-label="تحريك العيادة لأسفل">↓</button><button type="button" class="btn ghost sm" data-daily-remove>حذف السطر</button></div></fieldset>';}
 function load(){if(!assets)assets=Promise.all([
  new FontFace('DailyArabic','url(assets/fonts/BigVesta-Bold.woff2)').load(),
  new FontFace('DailyLatin','url(assets/fonts/Hiragino-W6.woff2)').load(),
  new Promise(function(resolve,reject){var im=new Image();im.onload=function(){resolve(im);};im.onerror=function(){reject(Error('تعذر تحميل خلفية مواعيد العيادات. أعد المحاولة.'));};im.src='assets/design-templates/daily-clinics/background.webp?v=daily-clinics-20261018-1';})
 ]).then(function(a){document.fonts.add(a[0]);document.fonts.add(a[1]);return a[2];}).catch(function(e){assets=null;throw e;});return assets;}
 function time(t){var p=t.split(':'),h=+p[0];return {clock:String(h%12||12).padStart(2,'0')+':'+p[1],period:h<12?'صباحًا':'مساءً'};}
 async function render(canvas,b){
  validate(b);var im=await load();canvas.width=1080;canvas.height=1350;var c=canvas.getContext('2d');c.drawImage(im,0,0,1080,1350);
  c.fillStyle='#fff';c.direction='rtl';c.textBaseline='middle';
  function text(s,x,y,width,max,min,align){var size=max;c.textAlign=align||'right';do{c.font=size+'px DailyArabic';if(c.measureText(s).width<=width)break;size--;}while(size>=min);if(size<min)throw Error('النص «'+s+'» أطول من مساحة التصميم. اختصره ثم راجع المعاينة.');c.fillText(s,x,y);}
  text(b.day,376,201,283,60,30,'center');
  b.rows.forEach(function(r,i){var y=371+i*58.9;
   text(r.name,998,y,300,29,18);text(r.specialty,656,y,262,29,18);
   [[r.from,302],[r.to,138]].forEach(function(pair){var t=time(pair[0]),x=pair[1];c.direction='ltr';c.textAlign='right';c.font='25px DailyLatin';c.fillText(t.clock,x+55,y);c.direction='rtl';text(t.period,x-33,y,43,15,12,'right');});
  });return canvas;
 }
 function blob(canvas){return new Promise(function(resolve,reject){canvas.toBlob(function(b){if(b)resolve(b);else reject(Error('تعذر تجهيز صورة التصميم.'));},'image/png');});}
 function setup(root,initial){
  var rows=root.querySelector('[data-daily-rows]'),status=root.querySelector('[data-daily-status]'),canvas=root.querySelector('canvas'),revision=0,ready=null;
  root.querySelector('[data-daily-day]').value=initial&&initial.day||'';
  rows.innerHTML=(initial&&initial.rows||[{}]).map(row).join('');
  function current(required){var b={day:root.querySelector('[data-daily-day]').value,rows:Array.from(rows.children).map(function(el){var r={};el.querySelectorAll('[data-daily-key]').forEach(function(input){r[input.dataset.dailyKey]=input.value.trim();});return r;})};return required?validate(b):b;}
  function changed(){var version=++revision;ready=null;status.textContent='';canvas.hidden=true;root.querySelector('[data-daily-add]').disabled=rows.children.length>=13;var b=current(false);try{validate(b);}catch(e){status.textContent=e.message;return;}var buffer=document.createElement('canvas');render(buffer,b).then(function(){if(version!==revision||!root.isConnected)return;canvas.width=buffer.width;canvas.height=buffer.height;canvas.getContext('2d').drawImage(buffer,0,0);canvas.hidden=false;ready=JSON.stringify(b);status.textContent='المعاينة جاهزة. راجع الأسماء والمواعيد قبل الحفظ.';}).catch(function(e){if(version===revision)status.textContent=e.message;});}
  root.addEventListener('input',changed);root.addEventListener('change',changed);
  root.addEventListener('click',function(e){var button=e.target.closest('button');if(!button)return;var el=button.closest('.daily-clinics-row');if(button.hasAttribute('data-daily-add')&&rows.children.length<13)rows.insertAdjacentHTML('beforeend',row());else if(el&&button.hasAttribute('data-daily-remove'))el.remove();else if(el&&button.hasAttribute('data-daily-up')&&el.previousElementSibling)rows.insertBefore(el,el.previousElementSibling);else if(el&&button.hasAttribute('data-daily-down')&&el.nextElementSibling)rows.insertBefore(el.nextElementSibling,el);else return;changed();});changed();
  return {current:current,refresh:changed,prepare:async function(){var b=current(true);if(ready!==JSON.stringify(b)){await render(canvas,b);ready=JSON.stringify(b);canvas.hidden=false;}return {brief:b,output:await blob(canvas)};}};
 }
 function description(b){return 'مواعيد العيادات — '+b.day+'\n'+b.rows.map(function(r){var a=time(r.from),z=time(r.to);return r.name+' — '+r.specialty+' — من '+a.clock+' '+a.period+' إلى '+z.clock+' '+z.period;}).join('\n');}
 function html(){return '<section id="daily-clinics-fields" class="daily-clinics" hidden><h4>مواعيد العيادات اليومية</h4>'+fields()+'<p>يُحفظ التصميم مع المادة نفسها، ثم يمر بالاعتماد الأولي والتصميم والاعتماد النهائي والنشر المعتاد.</p></section>';}
 var createForm;
 function wire(root){var kind=root.querySelector('#cf-content-kind'),section=root.querySelector('#daily-clinics-fields');kind.insertAdjacentHTML('beforeend','<option value="daily_clinics">مواعيد العيادات اليومية</option>');createForm=setup(section);
  function sync(){var active=kind.value==='daily_clinics';section.hidden=!active;['#cf-ai-generate','#cf-ai-import','#cf-import-agent'].forEach(function(s){var e=root.querySelector(s);if(e)e.disabled=active;});if(active){root.querySelector('#cf-brand').value='sono';root.querySelector('#ci-format').value='image_post';if(!root.querySelector('#cf-title').value)root.querySelector('#cf-title').value='مواعيد العيادات اليومية';createForm.refresh();}}
  kind.addEventListener('change',sync);sync();
 }
 function current(required){var k=document.getElementById('cf-content-kind');if(!k||k.value!=='daily_clinics')return null;if(required&&document.getElementById('cf-brand').value!=='sono')throw Error('قالب مواعيد العيادات اليومية مخصص لسونو.');return createForm.current(required);}
 async function attach(item,prepared,baseVersion){if(!window.SSMPDDesignFiles.canEdit(item))throw Error('لا تملك صلاحية حفظ التصميم لهذه المادة.');return window.SSMPDDesignFiles.save(item,prepared.output,null,{template:'sono-daily-clinics-v1',width:1080,height:1350,daily_clinics_brief:prepared.brief},null,baseVersion||null);}
 function mount(slot,item){if(!from(item))return false;if(!window.SSMPDDesignFiles.canEdit(item))return true;var button=document.createElement('button');button.className='btn ghost';button.textContent='مواعيد العيادات اليومية — معاينة وتعديل';slot.appendChild(button);button.onclick=function(){open(item);};return true;}
 async function open(item){
  if(!window.SSMPDDesignFiles.canEdit(item))return;var root=document.createElement('div');root.className='modal-backdrop';root.style.zIndex=10001;
  root.innerHTML='<div class="modal daily-clinics" dir="rtl"><div class="modal-head"><h3>مواعيد العيادات اليومية</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></div><p data-daily-load role="status">تحميل آخر نسخة محفوظة…</p><div data-daily-editor hidden>'+fields()+'</div><button type="button" class="btn" data-daily-save disabled>حفظ التصميم في المادة</button><p data-daily-feedback role="status"></p></div>';document.body.appendChild(root);
  var busy=false,save=root.querySelector('[data-daily-save]'),feedback=root.querySelector('[data-daily-feedback]'),editor=root.querySelector('[data-daily-editor]'),form,baseVersion;
  function close(){if(!busy){document.removeEventListener('keydown',escape);root.remove();buttonFocus();}}function buttonFocus(){var b=document.querySelector('[data-id="'+item.id+'"]');if(b)b.focus();}
  function escape(e){if(e.key==='Escape')close();}root.querySelector('.modal-close').onclick=close;document.addEventListener('keydown',escape);root.onclick=function(e){if(e.target===root)close();};
  try{var latest=await window.SSMPDDesignFiles.latest(item.id);if(!root.isConnected)return;baseVersion=latest&&latest.id||null;var b=latest&&latest.settings&&latest.settings.daily_clinics_brief||from(item);form=setup(editor,b);editor.hidden=false;root.querySelector('[data-daily-load]').textContent='تعديل المواعيد ينشئ نسخة تصميم جديدة. راجع كابشن المنشور بعد أي تعديل للمواعيد، ثم أرسلها للاعتماد والنشر من إجراءات المادة الحالية.';save.disabled=false;}catch(e){root.querySelector('[data-daily-load]').textContent='تعذر تحميل آخر نسخة. أغلق النافذة وأعد المحاولة. '+e.message;}
  save.onclick=async function(){if(busy||!form)return;busy=true;save.disabled=true;editor.inert=true;feedback.textContent='جاري حفظ التصميم…';try{var p=await form.prepare(),result=await attach(item,p,baseVersion);baseVersion=result.version_id;Object.assign(item,result.item);feedback.textContent='تم حفظ التصميم في المادة. راجع الكابشن ثم أكمل إرسالها للاعتماد من إجراءات المادة.';}catch(e){feedback.textContent='لم يُحفظ التصميم. '+e.message;}finally{busy=false;save.disabled=false;editor.inert=false;}};
 }
 window.SSMPDDailyClinics={html:html,wire:wire,current:current,metadata:metadata,from:from,validate:validate,description:description,render:render,mount:mount,attach:attach,prepare:function(){return createForm.prepare();}};
})();
