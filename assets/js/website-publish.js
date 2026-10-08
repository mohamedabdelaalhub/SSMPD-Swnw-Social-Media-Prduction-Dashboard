(function(){
 'use strict';
 var db=window.SSMPDDb.client;
 var labels={queued:'في انتظار الإرسال',processing:'جاري الإرسال',retry:'إعادة محاولة تلقائية',published:'منشور على الموقع',pending_review:'في مراجعة الموقع',unpublished:'مسحوب من الموقع',failed:'فشل الإرسال'};
 function check(r){if(r.error)throw r.error;return r.data;}
 function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function notice(text){if(window.SSMPDToast)window.SSMPDToast.show(text);else window.alert(text);}
 function enqueue(id,action){return db.rpc('website_enqueue',{p_id:id,p_action:action||'upsert'}).then(check).then(function(){
  // Durable queue remains pending even if the immediate worker call fails.
  return db.functions.invoke('website-publish-process',{body:{}}).then(function(r){return {queued:true,workerError:r.error};}).catch(function(){return {queued:true,workerError:true};});
 });}
 function mount(container,items){
  var panel=document.createElement('section');panel.className='section';panel.innerHTML='<h3>نشر الموقع</h3><p>مسار مستقل عن السوشيال. الموقع ينشر فور تأكيد الإرسال. الجدولة هنا تخص السوشيال فقط.</p><label>المواد <select data-website-filter><option value="ready_to_publish">جاهزة للنشر</option><option value="published">المواد القديمة المنشورة</option><option value="scheduled">المجدولة للسوشيال</option><option value="all">كل المواد</option></select></label><div data-website-list>جاري تحميل حالة الموقع…</div>';
  container.prepend(panel);
  function refresh(){db.from('website_publications').select('*').then(function(r){
   if(r.error){panel.querySelector('[data-website-list]').textContent='نشر الموقع يحتاج تفعيل قاعدة البيانات والدالة الخلفية أولًا.';return;}
   var states={};r.data.forEach(function(x){states[x.content_id]=x;});
   var selected=items.filter(function(i){var filter=panel.querySelector('[data-website-filter]').value;return (states[i.id]||['ready_to_publish','scheduled','published'].indexOf(i.stage)>=0)&&(filter==='all'||i.stage===filter);});
   panel.querySelector('[data-website-list]').innerHTML=selected.length?selected.map(function(i){
    var st=states[i.id];return '<details style="border-bottom:1px solid var(--c-border);padding:10px 0"><summary style="cursor:pointer">'+esc(i.title)+' — '+esc(st?labels[st.website_publish_status]:'لم يُرسل للموقع')+'</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">'+
    '<button class="btn sm" data-web-send="'+i.id+'">'+(st?'إرسال النسخة الحالية / إعادة المحاولة':'تأكيد النشر على الموقع')+'</button>'+
    (st&&st.website_publish_status!=='unpublished'?'<button class="btn ghost sm" data-web-withdraw="'+i.id+'">سحب من الموقع</button>':'')+
    (window.SSMPDWorkflow.canEditItem(window.SSMPDAuth.currentAdmin,i)?'<button class="btn ghost sm" data-web-edit="'+i.id+'">تعديل المادة</button>':'')+
    (st?'<button class="btn ghost sm" data-web-log="'+i.id+'">سجل المحاولات</button>':'')+'</div>'+
    (st&&st.last_error?'<p role="status">'+esc(st.last_error)+'</p>':'')+'<div data-web-history="'+i.id+'"></div></details>';
   }).join(''):'لا توجد مواد معتمدة للموقع.';
   panel.querySelectorAll('[data-web-send]').forEach(function(b){b.onclick=async function(){b.disabled=true;try{await publishItem(b.dataset.webSend);refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};});
   panel.querySelectorAll('[data-web-withdraw]').forEach(function(b){b.onclick=async function(){if(!window.confirm('سحب هذه المادة من الموقع فقط؟'))return;b.disabled=true;try{await enqueue(b.dataset.webWithdraw,'unpublish');refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};});
   panel.querySelectorAll('[data-web-edit]').forEach(function(b){b.onclick=function(){window.SSMPDDb.getContentItem(b.dataset.webEdit).then(function(item){window.SSMPDWorkflow.openEditContentModal(item,function(updated){var index=items.findIndex(function(i){return i.id===updated.id;});if(index>=0)items[index]=updated;db.functions.invoke('website-publish-process',{body:{}}).finally(refresh);});var modal=document.querySelector('.modal-backdrop:last-of-type .modal');if(modal){var warning=document.createElement('p');warning.textContent='لو المادة منشورة على الموقع، حفظ التعديلات سيرسل النسخة الجديدة تلقائيًا.';modal.prepend(warning);}}).catch(function(e){notice(e.message);});};});
   panel.querySelectorAll('[data-web-log]').forEach(function(b){b.onclick=function(){db.from('website_publish_attempts').select('attempted_at,http_status,outcome').eq('content_id',b.dataset.webLog).order('id',{ascending:false}).limit(20).then(check).then(function(rows){panel.querySelector('[data-web-history="'+b.dataset.webLog+'"]').innerHTML=rows.map(function(r){return '<p>'+esc(new Date(r.attempted_at).toLocaleString())+' — '+esc(r.outcome)+' ('+esc(r.http_status)+')</p>';}).join('')||'لا توجد محاولات بعد.';}).catch(function(e){notice(e.message);});};});
  });}
  panel.querySelector('[data-website-filter]').onchange=refresh;
  var listener=function(){if(!panel.isConnected){document.removeEventListener('website-publication-updated',listener);return;}refresh();};document.addEventListener('website-publication-updated',listener);
  refresh();
  var refreshButton=document.createElement('button');refreshButton.className='btn ghost sm';refreshButton.textContent='تحديث حالة الموقع';refreshButton.onclick=refresh;panel.append(refreshButton);
 }
 var busy=new Set();
 function allowed(item){
  var me=window.SSMPDAuth.currentAdmin,roles=window.SSMPDRoles;
  if(!me)return false;
  var has=function(names){return roles&&roles.hasAnyRole?roles.hasAnyRole(me,names):names.indexOf(me.role)>=0;};
  return has(['super_admin','general_manager','approver'])||(has(['page_manager'])&&item.created_by===me.id);
 }
 async function publishItem(id){
  if(busy.has(id))return;busy.add(id);
  try{
   var current=await window.SSMPDDb.getContentItem(id);
   if(!allowed(current))throw new Error('غير مسموح بالنشر على الموقع');
   if(['ready_to_publish','scheduled','published'].indexOf(current.stage)<0)throw new Error('اعتمد المادة أولًا');
   if(!await window.SSMPDContentText.preview(current,'تأكيد النشر الفوري على الموقع',{destination:'website'}))return;
   var platforms=Array.isArray(current.publish_platforms)?current.publish_platforms.slice():[];
   if(!platforms.length&&current.publish_platform)platforms.push(current.publish_platform);
   if(platforms.indexOf('website')<0){platforms.push('website');await window.SSMPDDb.updateContentItem(id,{publish_platforms:platforms});}
   var result=await enqueue(id);
   notice(result.workerError?'تم حفظ طلب النشر. يلزم تشغيل الدالة الخلفية لإتمام الإرسال.':'تمت معالجة طلب النشر. راجع حالة الموقع.');
   document.dispatchEvent(new CustomEvent('website-publication-updated',{detail:{id:id}}));
   return result;
  }finally{busy.delete(id);}
 }
 function mountAction(root,item){
  if(!root)return;root.replaceChildren();
  if(!allowed(item)||['ready_to_publish','scheduled','published'].indexOf(item.stage)<0)return;
  var box=document.createElement('div');box.className='website-publish-toolbar';
  var button=document.createElement('button');button.className='btn ghost sm';button.textContent='نشر على الموقع';
  var hint=document.createElement('small');hint.textContent='نشر مستقل عن السوشيال، بدون رابط منشور مسبق.';
  button.onclick=async function(){button.disabled=true;try{await publishItem(item.id);}catch(e){notice(e.message);}finally{button.disabled=false;}};
  box.append(button,hint);root.append(box);
 }
 function mountActions(root,items){var byId={};items.forEach(function(i){byId[i.id]=i;});root.querySelectorAll('[data-website-publish-action]').forEach(function(slot){var item=byId[slot.dataset.websitePublishAction];if(item)mountAction(slot,item);});}
 window.SSMPDWebsite={enqueue:enqueue,mount:mount,mountAction:mountAction,mountActions:mountActions,publishItem:publishItem};
})();

