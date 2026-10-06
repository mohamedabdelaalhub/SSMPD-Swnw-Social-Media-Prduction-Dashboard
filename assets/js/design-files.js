/* Private design files: no public bucket and no permanent signed URLs in records. */
(function () {
 'use strict';
 var bucket='content-designs';
 function client(){return window.SSMPDDb.client;}
 function base(){return window.SSMPD_CONFIG.supabase.url.replace(/\/+$/,'')+'/storage/v1/object/authenticated/'+bucket+'/';}
 function path(url){return typeof url==='string'&&url.indexOf(base())===0?url.slice(base().length):null;}
 async function resolve(url){
  var key=path(url);if(!key)return url;
  var result=await client().storage.from(bucket).createSignedUrl(key,300);
  if(result.error)throw result.error;return result.data.signedUrl;
 }
 async function view(url){
  var root=document.createElement('div');root.className='modal-backdrop';root.style.zIndex=10002;
  root.innerHTML='<div class="modal" dir="rtl"><div class="modal-head"><h3>معاينة التصميم</h3><button class="modal-close" aria-label="إغلاق">×</button></div><p role="status">تحميل التصميم…</p></div>';
  document.body.appendChild(root);root.querySelector('button').onclick=function(){root.remove();};
  try{var signed=await resolve(url);if(!root.isConnected)return;var image=document.createElement('img');image.alt='التصميم المحفوظ';image.style.cssText='display:block;width:100%;height:auto;max-height:75vh;object-fit:contain';image.src=signed;image.onerror=function(){root.querySelector('p').textContent='تعذر تحميل التصميم. أغلق المعاينة وافتحها مجددًا.';};image.onload=function(){root.querySelector('p').textContent='';};root.querySelector('.modal').appendChild(image);
   var download=document.createElement('button');download.className='btn ghost sm';download.textContent='تنزيل التصميم';download.onclick=async function(){download.disabled=true;try{var fresh=await resolve(url),response=await fetch(fresh);if(!response.ok)throw new Error('تعذر تنزيل الملف');var blob=await response.blob(),local=URL.createObjectURL(blob),a=document.createElement('a');a.href=local;a.download='design.png';a.click();setTimeout(function(){URL.revokeObjectURL(local);},1000);}catch(e){root.querySelector('p').textContent=e.message;}finally{download.disabled=false;}};root.querySelector('.modal').appendChild(download);
  }catch(e){root.querySelector('p').textContent='تعذر الاستعراض: '+e.message;}
 }
 // Also handles existing links in publishing/archive without changing legacy Drive links.
 document.addEventListener('click',function(event){var a=event.target.closest&&event.target.closest('a[href]');if(a&&path(a.getAttribute('href'))){event.preventDefault();view(a.getAttribute('href'));}});
 async function latest(id){var r=await client().from('design_versions').select('*').eq('content_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);if(r.error)throw r.error;return r.data&&r.data[0]||null;}
 async function save(item,output,source,settings,sceneJobId,baseVersion){
  var folder=item.id+'/'+crypto.randomUUID()+'/',outputPath=folder+'output.png',sourcePath=source?folder+'source.png':null;
  var storage=client().storage.from(bucket);
  for(var entry of [[outputPath,output],[sourcePath,source]]){if(!entry[0])continue;var upload=await storage.upload(entry[0],entry[1],{contentType:'image/png',upsert:false});if(upload.error)throw new Error('تعذر حفظ التصميم الخاص. تأكد من تشغيل ملف تفعيل التخزين في Supabase. '+upload.error.message);}
  var result=await client().rpc('save_private_design_version',{p_content_id:item.id,p_output_url:base()+outputPath,p_source_url:sourcePath?base()+sourcePath:null,p_scene_job_id:sceneJobId||null,p_settings:settings,p_base_version:baseVersion||null});
  if(result.error)throw result.error;return result.data;
 }
 function canEdit(item){var me=window.SSMPDAuth.currentAdmin,R=window.SSMPDRoles;return !!(me&&R.canCreateAIDesign(me)&&item.brand==='sono'&&item.content_format!=='video'&&!['published','scheduled','ready_to_publish'].includes(item.stage)&&(window.SSMPDWorkflow.canEditItem(me,item)||item.assigned_designer===me.id||(item.design_execution==='ai'&&['in_design','needs_revision','final_approval'].includes(item.stage)&&R.hasRole(me,'approver'))));}
 window.SSMPDDesignFiles={resolve:resolve,view:view,path:path,latest:latest,save:save,canEdit:canEdit};
})();
