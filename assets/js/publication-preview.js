(function(){
 'use strict';
 var signedCache=new Map();
 function el(tag,cls,text){var node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;}
 function safeUrl(value){try{var url=new URL(value,location.href);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;}catch(e){return null;}}
 function signed(url,force){
  var entry=signedCache.get(url);if(!force&&entry&&entry.until>Date.now())return entry.promise;
  var promise=window.SSMPDDesignFiles?window.SSMPDDesignFiles.resolve(url):Promise.resolve(url);
  signedCache.set(url,{promise:promise,until:Date.now()+240000});promise.catch(function(){signedCache.delete(url);});return promise;
 }
 function mount(root,item,options){
  options=options||{};root.replaceChildren();root.classList.add('publication-preview');
  var finalText=window.SSMPDPublicationText.compose(item),source=window.SSMPDPublicationText.source(item);
  root.append(el('h4','publication-preview__heading','معاينة المنشور'));
  var post=el('article','publication-post');post.setAttribute('aria-label','التصميم ونص النشر');
  post.append(el('header','publication-post__brand',item.brand==='dr_dina'?'د. دينا حسني':item.brand==='sono'?'سونو':item.brand||'الصفحة'));
  if(options.destination==='website')post.append(el('h4','publication-post__title',item.title||''));
  var media=el('div','publication-post__media');post.append(media);
  var body=el('div','publication-post__body',finalText||'لا يوجد نص نشر محفوظ.');body.dir='auto';post.append(body);root.append(post);
  if(!String(item.hook_text||'').trim())root.append(el('p','publication-preview__source','الهوك غير مسجل لهذه المادة. يمكنك إضافته من تعديل المحتوى.'));
  root.append(el('p','publication-preview__source',source==='caption_text'?'الكابشن المحفوظ مع الهوك والتفاعل وبيانات التواصل.':'الكابشن غير مسجل. المعاينة تستخدم '+(source==='body'?'نص المحتوى':'العنوان')+' مع الهوك والتفاعل وبيانات التواصل.'));
  var slides=item.content_format==='carousel'&&Array.isArray(item.carousel_slides)?item.carousel_slides.filter(function(u){return typeof u==='string';}):[];
  if(item.content_format==='carousel'&&slides.length<2){media.append(el('p','publication-preview__empty','لم تُرفع صور الكاروسيل بعد (من ٢ لـ ١٠ صور).'));}
  else if(slides.length>1){
   var strip=el('div','publication-carousel');strip.setAttribute('aria-label','شرايح الكاروسيل');media.append(strip);
   slides.forEach(function(url,i){
    var cell=el('figure','publication-carousel__slide'),img=el('img');img.alt='الشريحة '+(i+1);img.loading='lazy';
    cell.append(img,el('figcaption',null,(i+1)+' / '+slides.length));strip.append(cell);
    signed(url).then(function(s){var safe=safeUrl(s);if(safe&&root.isConnected)img.src=safe;}).catch(function(){cell.append(el('p','publication-preview__empty','تعذر التحميل'));});
   });
  }
  else if(!item.design_file_url){media.append(el('p','publication-preview__empty','لم يُرفع التصميم بعد.'));}
  else {
   var linkUrl=safeUrl(item.design_file_url);
   if(!linkUrl){media.append(el('p','publication-preview__empty','رابط التصميم غير صالح.'));}
   else {
    var link=el('a','publication-preview__file','فتح الملف المحفوظ');link.href=linkUrl;link.target='_blank';link.rel='noopener noreferrer';root.append(link);
    var drive=new URL(linkUrl),driveId=drive.hostname==='drive.google.com'?((drive.pathname.match(/\/d\/([\w-]+)/)||[])[1]||drive.searchParams.get('id')):null;
    if(driveId&&/^[\w-]+$/.test(driveId)){
     var frame=el('iframe');frame.title='التصميم المحفوظ';frame.loading='lazy';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.src='https://drive.google.com/file/d/'+driveId+'/preview';media.append(frame);
    }else {
     var status=el('p','publication-preview__empty','تحميل التصميم…');media.append(status);
     var video=item.content_format==='video';var asset=el(video?'video':'img');
     if(video){asset.controls=true;asset.preload='metadata';}else{asset.alt='التصميم المحفوظ للمنشور';asset.loading='lazy';}
     var refreshed=false;
     function failed(){status.textContent='تعذر تحميل التصميم. يمكنك فتح الملف المحفوظ.';}
     function loaded(){status.remove();}
     asset.addEventListener(video?'loadedmetadata':'load',loaded);
     asset.addEventListener('error',function(){if(refreshed){failed();return;}refreshed=true;signed(item.design_file_url,true).then(function(url){if(root.isConnected){var safe=safeUrl(url);if(safe)asset.src=safe;else failed();}}).catch(failed);});
     media.append(asset);
     signed(item.design_file_url).then(function(url){if(!root.isConnected)return;var safe=safeUrl(url);if(safe)asset.src=safe;else failed();}).catch(failed);
    }
   }
  }
  if(options.details!==false){
   var details=el('details','publication-preview__details');details.append(el('summary',null,'الفكرة والسكريبت وتفاصيل المحتوى'));
   var fields=[['وصف الفكرة',item.body],['الهوك / الافتتاحية',item.hook_text],['زاوية المحتوى',item.content_angle],['السكريبت',item.script_text],['نص التواصل / CTA',item.cta_text],['نوع التواصل',item.cta_type],['الموضوع / الخدمة',item.topic_service],['سبب الفكرة',item.hypothesis_reason]];
   fields.forEach(function(field){if(!field[1])return;var row=el('div','publication-preview__detail');row.append(el('strong',null,field[0]));var text=el('p',null,field[1]);text.dir='auto';row.append(text);details.append(row);});
   if(item.target_duration_min_seconds!=null||item.target_duration_max_seconds!=null)details.append(el('p',null,'مدة الفيديو '+(item.target_duration_min_seconds==null?'—':item.target_duration_min_seconds)+' إلى '+(item.target_duration_max_seconds==null?'—':item.target_duration_max_seconds)+' ثانية'));
   if(details.children.length>1)root.append(details);
  }
 }
 function mountSlots(container,items,options){var map={};items.forEach(function(item){map[item.id]=item;});container.querySelectorAll('[data-publication-preview]').forEach(function(slot){var item=map[slot.dataset.publicationPreview];if(item)mount(slot,item,options);});}
 window.SSMPDPublicationPreview={mount:mount,mountSlots:mountSlots};
})();
