/* Private design files: no public bucket and no permanent signed URLs in records. */
(function () {
 'use strict';
 var bucket='content-designs';
 function client(){return window.SSMPDDb.client;}
 function base(){return window.SSMPD_CONFIG.supabase.url.replace(/\/+$/,'')+'/storage/v1/object/authenticated/'+bucket+'/';}
 function path(url){return typeof url==='string'&&url.indexOf(base())===0?url.slice(base().length):null;}
 // Private uploaded videos (video-inputs) are previewed the same way as private designs.
 function videoBase(){return window.SSMPD_CONFIG.supabase.url.replace(/\/+$/,'')+'/storage/v1/object/authenticated/video-inputs/';}
 function videoPath(url){return typeof url==='string'&&url.indexOf(videoBase())===0?url.slice(videoBase().length):null;}
 async function resolve(url){
  var vkey=videoPath(url);
  if(vkey){var v=await client().storage.from('video-inputs').createSignedUrl(vkey,600);if(v.error)throw v.error;return v.data.signedUrl;}
  var key=path(url);if(!key)return url;
  var result=await client().storage.from(bucket).createSignedUrl(key,300);
  if(result.error)throw result.error;return result.data.signedUrl;
 }
 async function view(url){
  var root=document.createElement('div');root.className='modal-backdrop';root.style.zIndex=10002;
  root.innerHTML="<div class=\"modal\" dir=\"rtl\"><div class=\"modal-head\"><h3>معاينة التصميم</h3><button class=\"modal-close\" aria-label=\"إغلاق\" data-i18n-aria-label=\"%D8%A5%D8%BA%D9%84%D8%A7%D9%82\" data-i18n-aria-label=\"%D8%A5%D8%BA%D9%84%D8%A7%D9%82\">×</button></div><p role=\"status\">تحميل التصميم…</p></div>";
  document.body.appendChild(root);root.querySelector('button').onclick=function(){root.remove();};
  try{var signed=await resolve(url);if(!root.isConnected)return;var image=document.createElement('img');image.alt='التصميم المحفوظ';image.style.cssText='display:block;width:100%;height:auto;max-height:75vh;object-fit:contain';image.src=signed;image.onerror=function(){root.querySelector('p').textContent='تعذر تحميل التصميم. أغلق المعاينة وافتحها مجددًا.';};image.onload=function(){root.querySelector('p').textContent='';};root.querySelector('.modal').appendChild(image);
   var download=document.createElement('button');download.className='btn ghost sm';download.textContent='تنزيل التصميم';download.onclick=async function(){download.disabled=true;try{var fresh=await resolve(url),response=await fetch(fresh);if(!response.ok)throw new Error('تعذر تنزيل الملف');var blob=await response.blob(),local=URL.createObjectURL(blob),a=document.createElement('a');a.href=local;a.download='design.png';a.click();setTimeout(function(){URL.revokeObjectURL(local);},1000);}catch(e){root.querySelector('p').textContent=e.message;}finally{download.disabled=false;}};root.querySelector('.modal').appendChild(download);
  }catch(e){root.querySelector('p').textContent='تعذر الاستعراض: '+e.message;}
 }
 // Also handles existing links in publishing/archive without changing legacy Drive links.
 document.addEventListener('click',function(event){var a=event.target.closest&&event.target.closest('a[href]');if(!a)return;var href=a.getAttribute('href');if(path(href)){event.preventDefault();view(href);}else if(videoPath(href)){event.preventDefault();resolve(href).then(function(u){window.open(u,'_blank','noopener');}).catch(function(e){alert('تعذر فتح الفيديو: '+e.message);});}});
 async function latest(id){var r=await client().from('design_versions').select('*').eq('content_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);if(r.error)throw r.error;return r.data&&r.data[0]||null;}
 async function save(item,output,source,settings,sceneJobId,baseVersion){
  var folder=item.id+'/'+crypto.randomUUID()+'/',outputPath=folder+'output.png',sourcePath=source?folder+'source.png':null;
  var storage=client().storage.from(bucket);
  for(var entry of [[outputPath,output],[sourcePath,source]]){if(!entry[0])continue;var upload=await storage.upload(entry[0],entry[1],{contentType:'image/png',upsert:false});if(upload.error)throw new Error('تعذر حفظ التصميم الخاص. تأكد من تشغيل ملف تفعيل التخزين في Supabase. '+upload.error.message);}
  var result=await client().rpc('save_private_design_version',{p_content_id:item.id,p_output_url:base()+outputPath,p_source_url:sourcePath?base()+sourcePath:null,p_scene_job_id:sceneJobId||null,p_settings:settings,p_base_version:baseVersion||null});
  if(result.error)throw result.error;return result.data;
 }
 // Carousel: every slide is its own private design file (<content>/<uuid>/output.png), saved together by one RPC.
 async function saveCarousel(item,blobs,settings){
  if(!blobs||blobs.length<2||blobs.length>10)throw new Error('الكاروسيل لازم يكون من ٢ لـ ١٠ صور');
  var storage=client().storage.from(bucket),urls=[];
  for(var i=0;i<blobs.length;i++){
   var key=item.id+'/'+crypto.randomUUID()+'/output.png';
   var upload=await storage.upload(key,blobs[i],{contentType:'image/png',upsert:false});
   if(upload.error)throw new Error('تعذر حفظ الشريحة '+(i+1)+'. '+upload.error.message);
   urls.push(base()+key);
  }
  var result=await client().rpc('save_private_carousel',{p_content_id:item.id,p_output_urls:urls,p_settings:settings||{}});
  if(result.error)throw result.error;return result.data;
 }
 function canEdit(item){var me=window.SSMPDAuth.currentAdmin,R=window.SSMPDRoles;return !!(me&&R.canCreateAIDesign(me)&&['sono','dr_dina'].includes(item.brand)&&item.content_format!=='video'&&item.content_format!=='carousel'&&!['published','scheduled','ready_to_publish'].includes(item.stage)&&(window.SSMPDWorkflow.canEditItem(me,item)||item.assigned_designer===me.id||(item.design_execution==='ai'&&['in_design','needs_revision','final_approval'].includes(item.stage)&&R.hasRole(me,'approver'))));}
 window.SSMPDDesignFiles={resolve:resolve,view:view,path:path,latest:latest,save:save,saveCarousel:saveCarousel,canEdit:canEdit};
})();


