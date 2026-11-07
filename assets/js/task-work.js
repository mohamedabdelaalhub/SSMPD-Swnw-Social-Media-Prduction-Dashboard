/* Employee work and delivery. Drafts are per account/task on this browser. */
(function(root){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function safeUrl(v){try{var u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:'';}catch(e){return '';}}
function text(v){return esc(v).replace(/https?:\/\/[^\s<]+/g,function(u){return '<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+u+'</a>';});}
async function taskAttachmentPreview(file){
  if(!file||file.size>2*1024*1024||!/\.(csv|xlsx|xls|txt)$/i.test(file.name))return '';
  try {
    var ext=(file.name.split('.').pop()||'').toLowerCase(),result='';
    if(ext==='txt'){result=(await file.text()).slice(0,12000);}
    else {
      if(!root.XLSX||!root.XLSX.read||!root.XLSX.utils||!root.XLSX.utils.sheet_to_json)return '';
      var buf=await file.arrayBuffer(),wb=root.XLSX.read(buf,{type:'array',cellFormula:false,cellHTML:false,sheetRows:95});
      var parts=[];
      for(var name of wb.SheetNames.slice(0,3)){
        var rows=root.XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:'',blankrows:false});
        var lines=rows.slice(0,90).map(function(row){return (Array.isArray(row)?row:[]).slice(0,24).map(function(v){return String(v==null?'':v).replace(/[\t\n\r|]/g,' ').slice(0,180);}).join(' | ');});
        parts.push('ورقة: '+name+' | إجمالي الصفوف المقروءة: '+rows.length+'\n'+lines.join('\n'));
      }
      result=parts.join('\n----\n').slice(0,12000);
    }
    // An employee-side preview is unverified and never authorizes approving a task.
    return result.replace(/\b(?:\+?20|0)?1[0125]\d{8}\b/g,'[هاتف محجوب]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[بريد محجوب]')
      .replace(/\b\d{14}\b/g,'[رقم هوية محجوب]').slice(0,11000);
  }catch(e){return '';}
}
var currentCapture=function(){};root.addEventListener("pagehide",function(){currentCapture();});
function create(opts){
 currentCapture();
 var el=opts.el,admin=opts.admin,entries={},active='',saving=false,saveTimer,historySerial=0;
 function saved(message){if(root.SSMPDAuth.currentAdmin&&root.SSMPDAuth.currentAdmin.id===admin.id&&el.isConnected)return opts.onSaved(message);}
 function key(id){return 'ssmpd.task-work.'+admin.id+'.'+id;}
 function entry(id){if(entries[id])return entries[id];var saved={};try{saved=JSON.parse(localStorage.getItem(key(id))||'{}')||{};}catch(e){}return entries[id]={body:String(saved.body||''),link:String(saved.link||''),files:Array.isArray(saved.files)?saved.files:[],selected:{},request:saved.request||null,stored:true};}
 function persist(id){var d=entry(id);try{localStorage.setItem(key(id),JSON.stringify({body:d.body,link:d.link,files:d.files,request:d.request}));d.stored=true;}catch(e){d.stored=false;}return d.stored;}
 function canWork(t){return t&&t.assignee_id===admin.id&&root.SSMPDRoles.canModuleAction(admin,'tasks','update')&&['todo','in_progress','revision','blocked'].includes(t.status);}
 function fileId(f){return f.name+'|'+f.size+'|'+f.lastModified;}
 function capture(){if(!active)return;var form=el.querySelector('[data-work-form]');if(!form||saving||form.dataset.workOwner!==admin.id||form.dataset.workId!==active)return;var d=entry(active);if(!d.request){d.body=form.elements.body.value;d.link=form.elements.link.value;persist(active);}}
 var STAGE_HINT={todo:'لم تبدأ — لازم تتسلّم الأول',in_progress:'جاري العمل — لسه ما اتسلّمتش',review:'اتسلّمت ومستنية اعتماد المدير',revision:'المدير طلب تعديل — افتحها وعدّل',blocked:'متوقفة — محتاجة مساعدة'};
 function lockNote(t,kids,pend){return '<div class="tw-lock" id="tw-lock-'+esc(t.id)+'" role="note"><p><b>ليه زرار التسليم مقفول؟</b> المهمة دي ليها مراحل، وفاضل '+pend.length+' من '+kids.length+' لسه المدير ما اعتمدهاش. أول ما كلها تتعتمد، الزرار هيشتغل.</p><ul>'+pend.map(function(x){var other=x.assignee_id&&x.assignee_id!==admin.id;return '<li><span><b>'+esc(x.title)+'</b><small>'+esc(STAGE_HINT[x.status]||x.status)+(other?' · مع '+esc(x.assignee_name||'زميل'):'')+'</small></span><button type="button" class="btn" data-action="open-task" data-id="'+esc(x.id)+'">افتح المرحلة</button></li>';}).join('')+'</ul></div>';}
 function html(t,kids){
  var editable=canWork(t),d=entry(t.id),waiting=t.status==='review',pend=kids.filter(function(x){return x.status!=='done';}).sort(function(a,b){return (Number(a.sort_order)||0)-(Number(b.sort_order)||0);}),locked=pend.length>0;
  var h='<section class="tw-work tv-sec" data-work-task="'+t.id+'"><h3>شغلك</h3>';
  if(editable){var pending=!!d.request;h+='<form data-work-form data-work-owner="'+admin.id+'" data-work-id="'+t.id+'" novalidate><label>اكتب شغلك هنا أو أرفق ملفًا<textarea name="body" rows="8" maxlength="50000" placeholder="الصق النص أو اكتب اللي خلصته…" '+(pending?'readonly':'')+'>'+esc(d.body)+'</textarea></label><label>رابط الشغل (اختياري)<input name="link" type="url" maxlength="2000" placeholder="https://…" value="'+esc(d.link)+'" '+(pending?'readonly':'')+'></label><div data-work-files></div><label class="btn tw-attach">إضافة ملفات<input data-work-upload type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx" '+(pending?'disabled':'')+'></label><p class="tw-help">اكتب النص أو أضف ملفًا أو رابطًا. حتى 10 ملفات، كل ملف حتى 10 ميجا.</p><p class="tw-draft" data-work-draft role="status">'+(pending?'فيه محاولة تسليم لم نتأكد من نتيجتها. اضغط إعادة المحاولة للتأكد من نفس التسليم.':d.body||d.link||d.files.length?'استعدنا مسودتك على هذا المتصفح. الملفات غير المرفوعة تحتاج اختيارها من جهازك.':'المسودة تتحفظ على هذا المتصفح. المدير يشوف شغلك بعد حفظ التقدم أو التسليم.')+'</p><p class="tsk-field-error" role="alert" hidden></p><div class="tw-submit-row"><button type="button" class="btn" data-work-save '+(pending?'disabled':'')+'>حفظ مسودة</button>'+(t.status==='todo'?'<button class="btn btn-primary" type="button" data-work-start '+(pending?'disabled':'')+'>ابدأ المهمة</button>':'<button class="btn" type="submit" value="in_progress" data-work-progress '+(pending?'disabled':'')+'>حفظ تقدمي</button>')+'<button type="submit" value="review" class="btn btn-primary" data-work-submit '+(locked&&!pending?'disabled aria-describedby="tw-lock-'+esc(t.id)+'"':'')+'>'+(pending?'إعادة المحاولة':t.parent_task_id?'تسليم المرحلة':'تسليم للمدير')+'</button></div>'+(locked?lockNote(t,kids,pend):'')+'<button type="button" class="btn tw-help-button" data-action="blocked" data-id="'+t.id+'" '+(pending?'disabled':'')+'>محتاج مساعدة</button></form>';
  }else h+='<p class="tw-state">'+(waiting?'تم تسليم الشغل. المهمة بانتظار مراجعة المدير.':t.status==='done'?'المدير اعتمد المهمة.':'هنا يظهر شغل المسؤول عن المهمة.')+'</p>';
  h+='<div class="tw-results" data-work-results aria-live="polite">تحميل نتائج الشغل…</div></section><section class="tv-sec tw-feedback"><h3>ملاحظات المدير</h3><p>'+text(t.return_note||'مفيش طلب تعديل حاليًا.')+'</p></section>';
  return h;
 }
 function updateFiles(id){var d=entry(id),host=el.querySelector('[data-work-files]');if(!host)return;host.innerHTML=d.files.map(function(f,i){var status=f.uploaded?'تم رفعه':d.selected[f.key]?'جاهز للرفع':'اختاره تاني من جهازك';return '<div class="tw-file"><span>'+esc(f.name)+'<small>'+status+'</small></span><button type="button" class="btn" data-work-remove="'+i+'" '+(saving||d.request?'disabled':'')+' aria-label="إزالة '+esc(f.name)+'">إزالة</button></div>';}).join('');host.querySelectorAll('[data-work-remove]').forEach(function(b){b.onclick=function(){d.files.splice(Number(b.dataset.workRemove),1);persist(id);updateFiles(id);};});}
 // رسالة الرفض لازم تبان: نوصل لها بالسكرول ونخليها واضحة (كانت بتتشاف كأن الصفحة عملت ريلود)
 function error(form,msg){var n=form.querySelector('[role=alert]');n.textContent=msg;n.hidden=false;n.classList.add('tw-error-strong');if(n.scrollIntoView)n.scrollIntoView({behavior:'smooth',block:'center'});}
 function draftMessage(form,id,msg){var d=entry(id),n=form.querySelector('[data-work-draft]');n.textContent=msg||(d.stored?'تم حفظ المسودة على هذا المتصفح. لم تُرسل للمدير.':'تعذر حفظ المسودة على المتصفح. النص موجود طالما الشاشة مفتوحة.');}
 function renderResults(host,rows){if(!host.isConnected)return;host.innerHTML=rows.length?'<h4>الشغل المسجّل</h4>'+rows.map(function(r){return '<details class="tw-result" '+(r===rows[0]?'open':'')+'><summary>'+(r.status==='review'?'تسليم للمراجعة':'تحديث تقدم')+' · '+esc(new Date(r.created_at).toLocaleString('ar-EG-u-nu-latn'))+'</summary><div class="tw-result-body">'+text(r.body)+(r.link?'<p><a href="'+esc(safeUrl(r.link))+'" target="_blank" rel="noopener noreferrer">فتح رابط الشغل</a></p>':'')+'</div><div class="tw-result-files">'+(r.attachments||[]).map(function(a){return '<a href="'+esc(safeUrl(a.url))+'" target="_blank" rel="noopener noreferrer">'+esc(a.name)+'</a>';}).join('')+'</div></details>';}).join(''):'<p class="tw-help">لسه مفيش تسليم في المساحة دي. الشغل والتعليقات السابقة موجودة في المناقشة.</p>';}
 function mount(id){
  active=id;var t=opts.getTask(id),form=el.querySelector('[data-work-form]'),d=entry(id),host=el.querySelector('[data-work-results]'),serial=++historySerial;
  if(host&&root.SSMPDDb.taskWorkResults)root.SSMPDDb.taskWorkResults(id).then(function(rows){if(serial===historySerial){if(d.request&&(rows||[]).some(function(r){return r.request_id===d.request.request_id;})){active='';delete entries[id];try{localStorage.removeItem(key(id));}catch(e){}if(form){saved('التسليم السابق محفوظ. افتح المهمة لمتابعة ملاحظات المدير.');return;}}renderResults(host,rows||[]);}}).catch(function(){if(host.isConnected)host.textContent='تعذر تحميل الشغل المسجّل. افتح المهمة مرة تانية للمحاولة.';});
  if(!form)return;updateFiles(id);
  form.oninput=function(){if(d.request)return;d.body=form.elements.body.value;d.link=form.elements.link.value;clearTimeout(saveTimer);saveTimer=setTimeout(function(){persist(id);draftMessage(form,id);},350);};
  form.querySelector('[data-work-save]').onclick=function(){capture();draftMessage(form,id);};
  form.querySelector('[data-work-upload]').onchange=function(e){var problem='';Array.from(e.target.files||[]).forEach(function(f){if(!/\.(png|jpe?g|webp|gif|pdf|txt|csv|docx?|xlsx?|pptx?)$/i.test(f.name)){problem='نوع الملف غير مدعوم.';return;}if(f.size>10485760){problem='كل ملف لازم يكون أقل من أو يساوي 10 ميجا.';return;}var k=fileId(f),old=d.files.find(function(x){return x.key===k;});if(!old&&d.files.length>=10){problem='الحد الأقصى 10 ملفات.';return;}d.selected[k]=f;if(!old)d.files.push({key:k,name:f.name,size:f.size});});e.target.value='';persist(id);updateFiles(id);if(problem)error(form,problem);};
  var start=form.querySelector('[data-work-start]');if(start)start.onclick=function(){if(saving)return;capture();saving=true;start.disabled=true;root.SSMPDDb.taskSetStatus(id,'in_progress','بدأت تنفيذ المهمة').then(function(){saving=false;t.status='in_progress';capture();saved('بدأت المهمة. افتحها علشان تكمل شغلك.');}).catch(function(e){saving=false;start.disabled=false;error(form,e.message||'تعذر بدء المهمة.');});};
  form.onsubmit=function(e){e.preventDefault();submit(id,form,e.submitter&&e.submitter.value||'review');};
 }
 async function submit(id,form,status){
  if(saving)return;capture();var d=entry(id),t=opts.getTask(id);if(!canWork(t)){error(form,'المهمة غير متاحة للتسليم. افتحها من جديد.');return;}
  if(!d.request){if(!d.body.trim()&&!d.link.trim()&&!d.files.length){error(form,'اكتب شغلك أو أضف ملفًا أو رابطًا قبل الحفظ.');return;}if(d.link.trim()&&!safeUrl(d.link.trim())){error(form,'اكتب رابطًا يبدأ بـ https:// أو http://.');return;}if(d.link.length>2000){error(form,'الرابط أطول من 2000 حرف.');return;}if(d.body.length>50000){error(form,'النص أطول من 50000 حرف. ارفعه كملف.');return;}}
  var buttons=Array.from(form.querySelectorAll('button,input,textarea'));saving=true;buttons.forEach(function(b){b.disabled=true;});
  try{
   var evidencePreviews=[];
   if(!d.request){
    for(var f of d.files){
      var file=d.selected[f.key];
      if(!f.uploaded){
        if(!file)throw Error('اختار الملف «'+f.name+'» تاني من جهازك قبل التسليم.');
        f.uploaded=await root.SSMPDDb.taskUploadAttachment(id,file,t.title);persist(id);
      }
      if(file&&f.uploaded&&f.uploaded.file_id){
        var excerpt=await taskAttachmentPreview(file);
        if(excerpt.length>=10)evidencePreviews.push({drive_file_id:f.uploaded.file_id,file_name:f.uploaded.name,content_excerpt:excerpt});
      }
    }
    d.request={task_id:id,request_id:root.crypto.randomUUID(),status:status,body:d.body.trim(),link:d.link.trim(),attachments:d.files.map(function(f){return f.uploaded;})};persist(id);
   }
   var r=d.request,workResultId=await root.SSMPDDb.taskSubmitWork(r);
   // Non-blocking evidence preview; task submission and its original attachments never depend on this.
   if(workResultId&&evidencePreviews.length&&root.SSMPDDb.taskSaveAttachmentPreview){
     Promise.allSettled(evidencePreviews.map(function(item){
       return root.SSMPDDb.taskSaveAttachmentPreview(Object.assign({work_result_id:workResultId},item));
     })).catch(function(){});
   }delete entries[id];try{localStorage.removeItem(key(id));}catch(e){}saving=false;active='';await saved(r.status==='review'?'تم تسليم شغلك للمدير. المهمة بانتظار المراجعة.':'تم حفظ تقدمك وإرساله للمدير.');
  }catch(e){saving=false;if(e&&e.code&&(/^(P0001|22)/.test(e.code))){d.request=null;persist(id);if(opts.onRedraw){opts.onRedraw();var fresh=el.querySelector('[data-work-form]');if(fresh)error(fresh,e.message||'راجع بيانات التسليم.');return;}}buttons.forEach(function(b){b.disabled=false;});if(d.request){form.querySelectorAll('textarea,input,[data-work-save],[data-work-progress],[data-work-start],[data-work-remove]').forEach(function(b){b.disabled=true;});form.querySelector('[data-work-submit]').textContent='إعادة المحاولة';}error(form,(e&&e.message||'تعذر التسليم.')+(d.request?' مسودتك محفوظة. إعادة المحاولة تستخدم نفس التسليم.':''));updateFiles(id);}
 }
 currentCapture=capture;
 return {html:html,mount:mount,capture:capture,busy:function(){return saving;}};
}
root.SSMPDTaskWork={create:create};
})(window);
