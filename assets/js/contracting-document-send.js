/* SSMPD — direct delivery of immutable contracting PDFs by email or WhatsApp. */
(function(){
  'use strict';
  var cachedPdf={};

  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function toast(msg,type){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,type);else alert(msg);}
  function db(){return window.SSMPDDb&&window.SSMPDDb.client;}
  function safeName(v){return String(v||'SWNW-Partnership').replace(/[\\/:*?"<>|]+/g,'-').replace(/\.pdf$/i,'')+'.pdf';}
  function errorText(err,fallback){
    if(err==null)return fallback||'حدث خطأ غير معروف';
    if(typeof err==='string'||typeof err==='number'||typeof err==='boolean')return String(err);
    if(err.message)return String(err.message);
    if(err.error)return errorText(err.error,fallback);
    if(err.details)return String(err.details);
    try{var s=JSON.stringify(err);if(s&&s!=='{}')return s;}catch(_e){}
    return fallback||'حدث خطأ غير معروف';
  }
  function loadScript(src,test){
    return new Promise(function(resolve,reject){
      try{if(test())return resolve();}catch(_e){}
      var s=document.createElement('script');s.src=src;s.async=false;
      s.onload=function(){try{if(test())resolve();else reject(new Error('تم تحميل المكتبة لكن لم تعمل بشكل صحيح'));}catch(e){reject(e);}};
      s.onerror=function(){reject(new Error('تعذر تحميل مكتبة PDF'));};
      document.head.appendChild(s);
    });
  }
  function ensurePdfLibraries(){
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',function(){return !!(window.jspdf&&window.jspdf.jsPDF);})
      .then(function(){return loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',function(){return typeof window.html2canvas==='function';});})
      .then(function(){
        if(!(window.jspdf&&window.jspdf.jsPDF))throw new Error('تعذر تهيئة مكتبة PDF');
        if(typeof window.html2canvas!=='function')throw new Error('تعذر تهيئة محرك تحويل المستند إلى PDF');
      });
  }
  function textAfterInstitution(doc){var nodes=Array.from(doc.querySelectorAll('p,.swnw-meta'));for(var i=0;i<nodes.length;i++){var t=(nodes[i].textContent||'').replace(/\s+/g,' ').trim();if(/^المؤسسة\s*[:：]?/.test(t))return t.replace(/^المؤسسة\s*[:：]?\s*/,'').trim();}return '';}
  function docType(doc){var title=(doc.querySelector('h2')&&doc.querySelector('h2').textContent||'').trim();return title.indexOf('اتفاق تعاون')>-1?'final_contract':'proposal';}
  function subjectFor(type){return type==='proposal'?'عرض تعاون وشراكة مع عيادات سونو التخصصية':'النسخة النهائية من اتفاق التعاون مع عيادات سونو التخصصية';}
  function messageFor(type,name){return type==='proposal'?'السادة إدارة '+name+' المحترمين،\n\nتحية طيبة،\n\nيسعدنا في عيادات سونو التخصصية أن نشارككم مقترح التعاون والشراكة. مرفق نسخة PDF من العرض للاطلاع والمراجعة.\n\nنرحب بأي ملاحظات أو تعديلات بما يتناسب مع طبيعة التعاون.\n\nمع خالص التحية،\nإدارة عيادات سونو التخصصية':'السادة إدارة '+name+' المحترمين،\n\nمرفق نسخة PDF النهائية من اتفاق التعاون بعد اعتماد البنود المتفق عليها. يرجى مراجعتها لاستكمال إجراءات التوقيع والتفعيل.\n\nتحياتنا،\nعيادات سونو التخصصية';}

  function parseInvokeError(error){
    if(!error)return Promise.resolve({message:'تعذر الإرسال'});
    var fallback={message:errorText(error,'تعذر الإرسال')};
    try{var ctx=error.context;if(ctx&&typeof ctx.clone==='function')return ctx.clone().json().then(function(body){return{message:(body&&(body.error||body.message))||fallback.message,code:body&&body.code,storage_path:body&&body.storage_path};}).catch(function(){return fallback;});}catch(e){}
    return Promise.resolve(fallback);
  }

  function resolveContext(btn){
    var modal=btn.closest('.modal');var doc=modal&&modal.querySelector('#ceh-document');if(!modal||!doc)return Promise.reject(new Error('تعذر تحديد المستند'));
    var nameInput=modal.querySelector('#ceb-entity');var entityName=(nameInput&&nameInput.value||textAfterInstitution(doc)).trim();if(!entityName)return Promise.reject(new Error('تعذر تحديد جهة التعاقد'));
    var type=docType(doc);var title=(modal.querySelector('.modal-head h3')||{}).textContent||'';var vm=title.match(/V\s*(\d+)/i);var wantedVersion=vm?Number(vm[1]):null;
    var client=db();if(!client)return Promise.reject(new Error('اتصال قاعدة البيانات غير متاح'));
    return client.from('contracting_entities').select('*').eq('name',entityName).order('updated_at',{ascending:false}).limit(2).then(function(er){if(er.error)throw er.error;var rows=er.data||[];if(!rows.length)throw new Error('جهة التعاقد غير موجودة');if(rows.length>1)throw new Error('يوجد أكثر من جهة بنفس الاسم. افتح الجهة من مركز الشراكات وحاول مرة أخرى.');var entity=rows[0];var q=client.from('contracting_agreements').select('*').eq('entity_id',entity.id).eq('document_type',type);q=wantedVersion?q.eq('version_no',wantedVersion):q.order('version_no',{ascending:false}).limit(1);return q.then(function(ar){if(ar.error)throw ar.error;var agreement=(ar.data||[])[0];if(!agreement)throw new Error('احفظ المسودة أولًا قبل الإرسال');return client.from('contracting_agreement_versions').select('*').eq('agreement_id',agreement.id).eq('version_no',agreement.version_no).single().then(function(vr){if(vr.error)throw vr.error;return{modal:modal,entity:entity,agreement:agreement,version:vr.data,type:type,explicitVersion:!!wantedVersion};});});});
  }

  function makeHiddenDocument(html){var host=document.createElement('div');host.style.cssText='position:fixed;left:-200vw;top:0;width:210mm;visibility:hidden;pointer-events:none;z-index:-1;';host.innerHTML=html;document.body.appendChild(host);var doc=host.querySelector('#ceh-document');if(!doc){host.remove();throw new Error('نسخة المستند المحفوظة غير صالحة');}return{host:host,doc:doc};}
  function pdfBlobFromSaved(ctx){
    var key=ctx.agreement.id+':'+ctx.version.version_no;if(cachedPdf[key])return Promise.resolve(cachedPdf[key]);
    var hidden=makeHiddenDocument(ctx.version.content_html);var doc=hidden.doc;var prep=window.SSMPDPartnershipPdf&&window.SSMPDPartnershipPdf.prepare?window.SSMPDPartnershipPdf.prepare(doc):Promise.resolve();
    return Promise.resolve(prep).then(ensurePdfLibraries).then(function(){
      var pages=Array.from(doc.querySelectorAll('.swnw-page'));if(!pages.length)throw new Error('تعذر تجهيز صفحات PDF');
      var PDF=window.jspdf.jsPDF,pdf=new PDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});var chain=Promise.resolve();
      pages.forEach(function(page,index){chain=chain.then(function(){return Promise.resolve(window.html2canvas(page,{scale:2,useCORS:true,allowTaint:false,backgroundColor:'#fff',logging:false,scrollX:-window.scrollX,scrollY:-window.scrollY,foreignObjectRendering:false,removeContainer:true})).then(function(canvas){if(!canvas||typeof canvas.toDataURL!=='function')throw new Error('تعذر رسم صفحة PDF رقم '+(index+1));if(index)pdf.addPage('a4','portrait');pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297,undefined,'FAST');}).catch(function(err){throw new Error('تعذر إنشاء صفحة PDF رقم '+(index+1)+': '+errorText(err,'خطأ غير معروف'));});});});
      return chain.then(function(){var blob=pdf.output('blob');cachedPdf[key]=blob;return blob;});
    }).catch(function(err){console.error('Contracting PDF generation failed',err);throw new Error(errorText(err,'تعذر إنشاء ملف PDF'));}).finally(function(){hidden.host.remove();});
  }
  function blobBase64(blob){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(String(r.result||'').split(',')[1]||'');};r.onerror=function(){reject(new Error('تعذر قراءة ملف PDF'));};r.readAsDataURL(blob);});}
  function download(blob,name){var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);}
  function shareFallback(blob,filename,title,text,recipient){var file=new File([blob],filename,{type:'application/pdf'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){return navigator.share({files:[file],title:title,text:text}).then(function(){return true;}).catch(function(){return false;});}download(blob,filename);if(recipient)window.location.href='mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(text);return Promise.resolve(false);}

  function sendModal(ctx,channel){
    var filename=safeName(ctx.version.file_name||((ctx.type==='proposal'?'SWNW-Partnership-Proposal-':'SWNW-Final-Agreement-')+ctx.entity.name+'-V'+ctx.agreement.version_no));
    var recipient=channel==='email'?(ctx.entity.representative_email||''):(ctx.entity.representative_phone||'');var subject=subjectFor(ctx.type),message=messageFor(ctx.type,ctx.entity.name);
    var bd=document.createElement('div');bd.className='modal-backdrop';bd.innerHTML='<div class="modal" style="max-width:620px"><div class="modal-head"><h3>'+(channel==='email'?'إرسال المستند بالبريد':'إرسال المستند عبر واتساب')+'</h3><button class="modal-close">×</button></div><div class="section" style="margin:0 0 12px"><b>'+esc(ctx.entity.name)+'</b><div style="font-size:12px;color:var(--c-muted);margin-top:4px">النسخة V'+ctx.agreement.version_no+' · '+esc(filename)+'</div>'+(!ctx.explicitVersion?'<div style="font-size:12px;color:#8a5a00;background:#fff6db;border-radius:8px;padding:8px 10px;margin-top:8px">سيتم إرسال آخر نسخة محفوظة V'+ctx.agreement.version_no+'. أي تعديل غير محفوظ في شاشة المعاينة لن يدخل في الملف المرسل.</div>':'')+'</div><div class="field"><label>'+(channel==='email'?'البريد الإلكتروني':'رقم واتساب')+'</label><input id="ceds-recipient" '+(channel==='email'?'type="email"':'type="tel"')+' value="'+esc(recipient)+'"></div>'+(channel==='email'?'<div class="field"><label>عنوان الرسالة</label><input id="ceds-subject" value="'+esc(subject)+'"></div>':'')+'<div class="field"><label>نص الرسالة</label><textarea id="ceds-message" rows="8">'+esc(message)+'</textarea></div><div id="ceds-error" class="err-msg" style="display:none"></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn ghost" id="ceds-preview">معاينة PDF</button><button class="btn btn-primary" id="ceds-send">إرسال الآن مع PDF</button></div><div id="ceds-fallback" style="display:none;margin-top:10px"></div></div>';document.body.appendChild(bd);
    bd.querySelector('.modal-close').onclick=function(){bd.remove();};bd.onclick=function(e){if(e.target===bd)bd.remove();};
    function showError(err){var el=bd.querySelector('#ceds-error');el.textContent='خطأ: '+errorText(err,'تعذر تنفيذ العملية');el.style.display='block';}
    bd.querySelector('#ceds-preview').onclick=function(){var b=this;b.disabled=true;b.textContent='جاري تجهيز PDF…';pdfBlobFromSaved(ctx).then(function(blob){var url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(function(){URL.revokeObjectURL(url);},60000);}).catch(showError).finally(function(){b.disabled=false;b.textContent='معاينة PDF';});};
    bd.querySelector('#ceds-send').onclick=function(){
      var send=this,rec=bd.querySelector('#ceds-recipient').value.trim(),msg=bd.querySelector('#ceds-message').value.trim(),sub=channel==='email'?bd.querySelector('#ceds-subject').value.trim():subject;
      if(!rec)return showError(channel==='email'?'اكتب البريد الإلكتروني':'اكتب رقم واتساب');if(!msg)return showError('اكتب نص الرسالة');
      bd.querySelector('#ceds-error').style.display='none';send.disabled=true;send.textContent='جاري تجهيز وإرسال PDF…';var blobRef;
      pdfBlobFromSaved(ctx).then(function(blob){blobRef=blob;return blobBase64(blob);}).then(function(base64){return db().functions.invoke('contracting-document-send',{body:{agreement_id:ctx.agreement.id,channel:channel,recipient:rec,subject:sub,message:msg,filename:filename,pdf_base64:base64}});}).then(function(res){if(res.error)return parseInvokeError(res.error).then(function(x){var ex=new Error(x.message);ex.code=x.code;ex.storage_path=x.storage_path;throw ex;});if(res.data&&res.data.error){var ex=new Error(res.data.error);ex.code=res.data.code;throw ex;}toast(channel==='email'?'تم إرسال البريد ومعه ملف PDF':'تم إرسال رسالة واتساب ومعها ملف PDF');bd.remove();}).catch(function(e){console.error('Contracting document send failed',e);showError(e);var fb=bd.querySelector('#ceds-fallback');var code=e&&e.code;if(channel==='email'&&code==='EMAIL_NOT_CONFIGURED'&&blobRef){fb.style.display='block';fb.innerHTML='<button class="btn ghost" id="ceds-share-file">مشاركة PDF عبر تطبيق البريد</button><div style="font-size:11px;color:var(--c-muted);margin-top:5px">خدمة البريد المباشر غير مهيأة على السيرفر. الملف جاهز للمشاركة كمرفق.</div>';fb.querySelector('#ceds-share-file').onclick=function(){shareFallback(blobRef,filename,sub,msg,rec);};}else if(channel==='whatsapp'&&(code==='WHATSAPP_NOT_CONFIGURED'||code==='WHATSAPP_SENDER_UNKNOWN')&&blobRef){fb.style.display='block';fb.innerHTML='<button class="btn ghost" id="ceds-share-file">مشاركة ملف PDF</button>';fb.querySelector('#ceds-share-file').onclick=function(){shareFallback(blobRef,filename,subject,msg,'');};}}).finally(function(){send.disabled=false;send.textContent='إرسال الآن مع PDF';});
    };
  }

  function start(btn,channel){resolveContext(btn).then(function(ctx){sendModal(ctx,channel);}).catch(function(e){toast(errorText(e,'تعذر فتح نافذة الإرسال'),'error');});}
  document.addEventListener('click',function(e){var btn=e.target&&e.target.closest&&e.target.closest('[data-email],[data-wa]');if(!btn)return;e.preventDefault();e.stopImmediatePropagation();start(btn,btn.hasAttribute('data-email')?'email':'whatsapp');},true);
  function enhance(root){(root||document).querySelectorAll('[data-email]').forEach(function(b){b.textContent='إرسال بالبريد + PDF';b.title='إرسال النسخة المحفوظة كمرفق PDF';});(root||document).querySelectorAll('[data-wa]').forEach(function(b){b.textContent='إرسال واتساب + PDF';b.title='إرسال النسخة المحفوظة كمستند PDF';});(root||document).querySelectorAll('.modal').forEach(function(m){var savedPdf=m.querySelector('#ceh-saved-pdf');if(!savedPdf||m.querySelector('[data-saved-send-actions]'))return;var wrap=document.createElement('span');wrap.setAttribute('data-saved-send-actions','1');wrap.style.display='contents';wrap.innerHTML='<button class="btn ghost" data-email>إرسال بالبريد + PDF</button><button class="btn ghost" data-wa>إرسال واتساب + PDF</button>';savedPdf.parentNode.insertBefore(wrap,savedPdf.nextSibling);});}
  enhance(document);new MutationObserver(function(rows){rows.forEach(function(r){Array.from(r.addedNodes||[]).forEach(function(n){if(n.nodeType===1)enhance(n);});});}).observe(document.documentElement,{childList:true,subtree:true});
})();
