/* Owner 2026-11-21 (mockup docs/ui-references/mockups/booking-discount.html «موافق»): optional «خصم» on a new booking.
   «خصم نقابة / نادي»: الجهة نقابة / نادي / أخرى + name, card number, card valid-until and a card photo — all required.
   «خصم خاص»: a reason. Fields ride the booking payload as discount_*; the photo is uploaded first to the private bucket
   'booking-discount-cards' (path <auth uid>/<workspace>/<random>) and only its path is sent. The server
   (clinic_reception_command, 20261121180000) validates, applies it at arrival (maximum 30%) and
   refuses any other discount on that visit. Hook: SSMPDReceptionBookingDiscount.enhance(form, {data, workspace}). */
(function(w){'use strict';
var MAX=30;   /* owner «خليه ٣٠٪» — the maximum; server: clinic_reception.booking_discount_max() */
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م';}
function chips(name,opts,val){return '<div class="rbd-chips" role="radiogroup">'+opts.map(function(o){return '<label class="rbd-chip"><input type="radio" name="'+name+'" value="'+o[0]+'"'+(o[0]===val?' checked':'')+'><span>'+esc(o[1])+'</span></label>';}).join('')+'</div>';}
var ORG_LABEL={syndicate:'اسم النقابة',club:'اسم النادي',other:'اسم الجهة'};
function preview(price,pct){price=+price||0;pct=+pct||0;if(!(price>0)||!(pct>0)||pct>100)return null;var off=Math.round(price*pct)/100;return {price:price,off:off,net:Math.round((price-off)*100)/100};}
function uploadCard(ws,file){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c||!c.storage)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.auth.getUser()).then(function(r){var u=r&&r.data&&r.data.user;if(!u)throw new Error('سجّل دخولك تاني');
  var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',
      rnd=(w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2),
      path=u.id+'/'+ws+'/'+rnd+'.'+ext;
  return Promise.resolve(c.storage.from('booking-discount-cards').upload(path,file,{upsert:false,contentType:file.type||undefined})).then(function(x){if(x&&x.error)throw x.error;return path;});});}
function enhance(form,ctx){if(!form||form.querySelector('[data-rbd]')||!form.elements.service_id)return;
 var data=(ctx&&ctx.data)||{},ws=ctx&&ctx.workspace;
 var box=document.createElement('section');box.className='rbd';box.setAttribute('data-rbd','');box.setAttribute('data-wide','');
 box.innerHTML='<label class="rbd-sw"><input type="checkbox" data-rbd-on><span>خصم على الحجز ده <small>(اختياري)</small></span></label>'+
  '<fieldset class="rbd-body" data-rbd-body hidden disabled>'+
   '<div class="rbd-row"><span class="rbd-l">نوع الخصم</span>'+chips('discount_kind',[['syndicate','خصم نقابة / نادي'],['special','خصم خاص']],'syndicate')+'</div>'+
   '<div data-rbd-syn>'+
    '<div class="rbd-row"><span class="rbd-l">الجهة</span>'+chips('discount_org_type',[['syndicate','نقابة'],['club','نادي'],['other','أخرى']],'syndicate')+'</div>'+
    '<label class="rbd-row"><span class="rbd-l" data-rbd-orgl>اسم النقابة</span><input name="discount_org_name" maxlength="120" required placeholder="مثلاً نقابة المهندسين"></label>'+
    '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l">رقم الكارنيه</span><input name="discount_card_no" maxlength="60" required inputmode="numeric" dir="ltr"></label>'+
    '<label class="rbd-row"><span class="rbd-l">الكارنيه ساري لحد</span><input name="discount_card_expiry" type="date" required></label></div>'+
    '<div class="rbd-row"><span class="rbd-l">صورة الكارنيه</span><input type="file" accept="image/*,application/pdf" capture="environment" data-rbd-file><input type="hidden" name="discount_card_path" required><small class="rbd-up" data-rbd-up role="status"></small></div>'+
   '</div>'+
   '<label class="rbd-row" data-rbd-reason hidden><span class="rbd-l">سبب الخصم</span><input name="discount_reason" maxlength="300" placeholder="مثلاً قريب موظف"></label>'+
   '<label class="rbd-row rbd-pct"><span class="rbd-l">نسبة الخصم</span><span class="rbd-pctin"><input name="discount_percent" type="number" min="1" max="'+MAX+'" step="0.5" inputmode="decimal" required dir="ltr"> ٪</span></label>'+
   '<div class="rbd-sum" data-rbd-sum hidden></div><p class="rbd-warn" data-rbd-warn hidden></p>'+
   '<p class="rbd-note">الخصم بيتطبّق على الخدمة لما المريض يوصل. أقصى خصم ٣٠٪. الحجز اللي عليه الخصم ده مايتعملوش أي خصم تاني ولا سعر تعاقد.</p>'+
  '</fieldset>';
 var anchor=form.querySelector('.rbp-cont')||form.querySelector('[data-rbp]')||form.querySelector('.rx-combo-field');
 if(anchor&&anchor.parentNode)anchor.after(box);else form.appendChild(box);
 var on=box.querySelector('[data-rbd-on]'),body=box.querySelector('[data-rbd-body]'),syn=box.querySelector('[data-rbd-syn]'),reason=box.querySelector('[data-rbd-reason]'),
     pct=form.elements.discount_percent,sum=box.querySelector('[data-rbd-sum]'),warn=box.querySelector('[data-rbd-warn]'),file=box.querySelector('[data-rbd-file]'),up=box.querySelector('[data-rbd-up]'),
     orgl=box.querySelector('[data-rbd-orgl]'),exp=form.elements.discount_card_expiry,path=form.elements.discount_card_path;
 function val(n){var r=box.querySelector('input[name="'+n+'"]:checked');return r?r.value:'';}
 function pkg(){return !!(form.elements.package_id&&form.elements.package_id.value);}
 function svc(){return (data.services||[]).find(function(s){return s.id===form.elements.service_id.value;});}
 function paint(){var p=pkg();box.hidden=p;if(p&&on.checked)on.checked=false;body.hidden=!on.checked;body.disabled=!on.checked;
  var isSyn=val('discount_kind')==='syndicate';syn.hidden=!isSyn;reason.hidden=isSyn;
  Array.prototype.forEach.call(syn.querySelectorAll('input'),function(i){i.disabled=!on.checked||!isSyn;});
  var ri=reason.querySelector('input');ri.disabled=!on.checked||isSyn;ri.required=!isSyn;
  orgl.textContent=ORG_LABEL[val('discount_org_type')]||'اسم الجهة';
  var day=form.elements.day&&form.elements.day.value;if(day)exp.min=day;
  var s=svc(),q=Math.max(1,+(form.elements.quantity&&form.elements.quantity.value)||1),pr=preview(s&&s.price*q,pct.value);
  sum.hidden=!(on.checked&&pr);if(pr){var who=isSyn?(form.elements.discount_org_name.value.trim()||''):'خصم خاص';
   sum.innerHTML='<span>السعر</span><s>'+money(pr.price)+'</s><span>الخصم ('+esc(+pct.value)+'٪'+(who?' — '+esc(who):'')+')</span><span>− '+money(pr.off)+'</span><span>المريض يدفع</span><b>'+money(pr.net)+'</b>';}
  var big=on.checked&&+pct.value>MAX;warn.hidden=!big;if(big)warn.textContent='أقصى خصم على الحجز ٣٠٪ — قلّل النسبة.';}
 file.addEventListener('change',function(){var f=file.files&&file.files[0];path.value='';if(!f)return;if(f.size>8*1024*1024){up.textContent='الصورة أكبر من ٨ ميجا — صوّرها تاني';file.value='';return;}
  up.textContent='جاري رفع الصورة…';uploadCard(ws,f).then(function(p){path.value=p;up.textContent='اترفعت ✓';}).catch(function(e){up.textContent='الرفع ما نجحش: '+((e&&e.message)||'حاول تاني');file.value='';});});
 path.addEventListener('invalid',function(){up.textContent='ارفع صورة الكارنيه';});
 form.addEventListener('input',paint);form.addEventListener('change',paint);on.addEventListener('change',paint);paint();}
w.SSMPDReceptionBookingDiscount={enhance:enhance,preview:preview,MAX:MAX};
})(window);
