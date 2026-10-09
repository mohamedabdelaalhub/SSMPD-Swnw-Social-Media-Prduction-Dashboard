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
 var websiteView={tab:'pending',filter:'all',search:''};
 function bucket(state){var status=state&&state.website_publish_status;return status==='published'?'published':status==='unpublished'?'unpublished':'pending';}
 function mount(container,items){
  var panel=document.createElement('section');panel.className='section website-panel';panel.innerHTML='<div class="website-panel__header"><div><h3>نشر الموقع</h3><p>نشر مستقل عن السوشيال. تنتقل المادة للقائمة المناسبة بعد تأكيد حالة الموقع.</p></div><button class="btn ghost sm" data-web-refresh>تحديث الحالة</button></div><div class="website-tabs" role="tablist" aria-label="قوائم نشر الموقع"></div><div class="website-filters"><label>بحث عن مادة<input type="search" data-web-search placeholder="عنوان المادة"></label><label data-web-stage-label>حالة السوشيال<select data-website-filter><option value="all">كل المواد المعتمدة</option><option value="ready_to_publish">جاهزة للنشر</option><option value="published">منشورة على السوشيال</option><option value="scheduled">مجدولة للسوشيال</option></select></label></div><div data-website-list role="tabpanel">جاري تحميل حالة الموقع…</div>';
  container.prepend(panel);
  var states={},request=0,opened=new Set();
  var search=panel.querySelector('[data-web-search]'),filter=panel.querySelector('[data-website-filter]');search.value=websiteView.search;filter.value=websiteView.filter;
  function draw(){
   var eligible=items.filter(function(i){return states[i.id]||['ready_to_publish','scheduled','published'].indexOf(i.stage)>=0;});
   var tabs=[['pending','بانتظار النشر على الموقع'],['published','المنشور على الموقع'],['unpublished','المسحوب من الموقع']];
   panel.querySelector('.website-tabs').innerHTML=tabs.map(function(t){var n=eligible.filter(function(i){return bucket(states[i.id])===t[0];}).length;return '<button type="button" role="tab" aria-selected="'+(websiteView.tab===t[0])+'" class="website-tab" data-web-tab="'+t[0]+'">'+t[1]+'<span>'+n+'</span></button>';}).join('');
   panel.querySelector('[data-web-stage-label]').hidden=websiteView.tab!=='pending';
   var selected=eligible.filter(function(i){return bucket(states[i.id])===websiteView.tab&&(websiteView.tab!=='pending'||websiteView.filter==='all'||i.stage===websiteView.filter)&&String(i.title||'').toLocaleLowerCase().includes(websiteView.search.toLocaleLowerCase());});
   panel.querySelector('[data-website-list]').innerHTML=selected.length?selected.map(function(i){
    var st=states[i.id],status=st&&st.website_publish_status,working=['queued','processing','retry'].indexOf(status)>=0,canPublish=allowed(i)&&['ready_to_publish','scheduled','published'].indexOf(i.stage)>=0;
    return '<details class="website-item" data-web-item="'+esc(i.id)+'"'+(opened.has(i.id)?' open':'')+'><summary><span class="website-item__title">'+esc(i.title)+'</span><span class="website-state website-state--'+(status||'new')+'">'+esc(st?labels[status]||status:'لم يُرسل للموقع')+'</span><span class="website-item__chevron" aria-hidden="true">⌄</span></summary><div class="website-item__body"><div class="website-actions">'+
    (canPublish?'<button class="btn btn-primary sm" data-web-send="'+esc(i.id)+'"'+(working?' disabled':'')+'>'+(working?'جارٍ تنفيذ الطلب':status==='published'?'تحديث المنشور':status==='unpublished'?'إعادة النشر على الموقع':st?'إعادة إرسال للموقع':'نشر على الموقع')+'</button>':'')+
    (allowed(i)&&st&&status!=='unpublished'?'<button class="btn danger sm" data-web-withdraw="'+esc(i.id)+'"'+(working?' disabled':'')+'>سحب من الموقع</button>':'')+
    (window.SSMPDWorkflow.canEditItem(window.SSMPDAuth.currentAdmin,i)?'<button class="btn ghost sm" data-web-edit="'+esc(i.id)+'">تعديل المادة</button>':'')+
    (st?'<button class="btn ghost sm" data-web-log="'+esc(i.id)+'">سجل المحاولات</button>':'')+'</div>'+
    (st&&st.last_error?'<p class="website-error" role="status">'+esc(st.last_error)+'</p>':'')+'<div data-web-preview="'+esc(i.id)+'"></div><div class="website-history" data-web-history="'+esc(i.id)+'"></div></div></details>';
   }).join(''):'<div class="website-empty">'+(websiteView.search?'لا توجد مواد تطابق البحث.':websiteView.tab==='published'?'لا توجد مواد منشورة على الموقع.':websiteView.tab==='unpublished'?'لا توجد مواد مسحوبة من الموقع.':'لا توجد مواد بانتظار النشر على الموقع.')+'</div>';
   panel.querySelectorAll('[data-web-tab]').forEach(function(button){button.onclick=function(){websiteView.tab=button.dataset.webTab;opened.clear();draw();panel.querySelector('[data-web-tab="'+websiteView.tab+'"]').focus();};});
   panel.querySelectorAll('[data-web-item]').forEach(function(details){var mounted=false;function preview(){if(details.open){opened.add(details.dataset.webItem);if(!mounted&&window.SSMPDPublicationPreview){var item=items.find(function(i){return i.id===details.dataset.webItem;});window.SSMPDPublicationPreview.mount(details.querySelector('[data-web-preview]'),item,{destination:'website'});mounted=true;}}else opened.delete(details.dataset.webItem);}details.ontoggle=preview;preview();});
   panel.querySelectorAll('[data-web-send]').forEach(function(b){b.onclick=async function(){b.disabled=true;try{await publishItem(b.dataset.webSend);refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};});
   panel.querySelectorAll('[data-web-withdraw]').forEach(function(b){b.onclick=async function(){if(!window.confirm('سحب هذه المادة من الموقع فقط؟'))return;b.disabled=true;try{await enqueue(b.dataset.webWithdraw,'unpublish');refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};});
   panel.querySelectorAll('[data-web-edit]').forEach(function(b){b.onclick=function(){window.SSMPDDb.getContentItem(b.dataset.webEdit).then(function(item){window.SSMPDWorkflow.openEditContentModal(item,function(updated){var index=items.findIndex(function(i){return i.id===updated.id;});if(index>=0)items[index]=updated;db.functions.invoke('website-publish-process',{body:{}}).finally(refresh);});var modal=document.querySelector('.modal-backdrop:last-of-type .modal');if(modal){var warning=document.createElement('p');warning.textContent='لو المادة منشورة على الموقع، حفظ التعديلات سيرسل النسخة الجديدة تلقائيًا.';modal.prepend(warning);}}).catch(function(e){notice(e.message);});};});
   panel.querySelectorAll('[data-web-log]').forEach(function(b){b.onclick=function(){db.from('website_publish_attempts').select('attempted_at,http_status,outcome').eq('content_id',b.dataset.webLog).order('id',{ascending:false}).limit(20).then(check).then(function(rows){panel.querySelector('[data-web-history="'+b.dataset.webLog+'"]').innerHTML=rows.map(function(r){return '<p>'+esc(new Date(r.attempted_at).toLocaleString())+' — '+esc(r.outcome)+' ('+esc(r.http_status)+')</p>';}).join('')||'لا توجد محاولات بعد.';}).catch(function(e){notice(e.message);});};});
  }
  function refresh(){var token=++request;var button=panel.querySelector('[data-web-refresh]');button.disabled=true;
   return db.from('website_publications').select('*').then(check).then(function(rows){if(token!==request||!panel.isConnected)return;states={};(rows||[]).forEach(function(x){states[x.content_id]=x;});draw();}).catch(function(error){if(token===request){panel.querySelector('[data-website-list]').textContent='تعذر تحميل حالة الموقع. حاول تحديث الحالة.';notice(error.message);}}).finally(function(){if(token===request)button.disabled=false;});
  }
  filter.onchange=function(){websiteView.filter=filter.value;draw();};search.oninput=function(){websiteView.search=search.value.trim();draw();};
  var listener=function(){if(!panel.isConnected){document.removeEventListener('website-publication-updated',listener);return;}refresh();};document.addEventListener('website-publication-updated',listener);
  panel.querySelector('[data-web-refresh]').onclick=refresh;refresh();
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

