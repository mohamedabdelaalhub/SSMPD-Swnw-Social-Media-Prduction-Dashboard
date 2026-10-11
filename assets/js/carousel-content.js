/* Carousel brief: "نوع المحتوى = كاروسيل" in the new-content form. The brief and the AI slide copy
   travel in agent_raw_output (content_kind:'carousel', carousel_brief, carousel_copy). The slide
   images themselves are saved later on content_items.carousel_slides by the designer or Claude. */
(function(){
 'use strict';
 function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 var STYLES={tips:'نصايح / خطوات مرقّمة',myths:'خرافة وحقيقة',symptoms:'أعراض وعلامات تحذير',journey:'رحلة المريض في المركز',faq:'أسئلة شائعة',compare:'مقارنة (الفرق بين…)'};
 function html(){
  var counts='';for(var i=3;i<=10;i++)counts+='<option value="'+i+'"'+(i===6?' selected':'')+'>'+i+' شرايح</option>';
  var styles=Object.keys(STYLES).map(function(k){return '<option value="'+k+'">'+STYLES[k]+'</option>';}).join('');
  return '<section id="carousel-fields" hidden style="border:1px solid var(--c-border);padding:12px;border-radius:12px;margin-bottom:12px"><h4>محتوى كاروسيل</h4>'+
   '<label>عدد الشرايح<select id="carousel-count">'+counts+'</select></label>'+
   '<label>أسلوب الكاروسيل<select id="carousel-style">'+styles+'</select></label>'+
   '<label>نص كل شريحة (اختياري — سطر لكل شريحة، أو سيبه فاضي والوكيل يكتبه)<textarea id="carousel-notes" rows="4" maxlength="3000" placeholder="الشريحة ١: …&#10;الشريحة ٢: …"></textarea></label>'+
   '<p style="font-size:12px;color:var(--c-muted)">أول شريحة = جملة تشد، آخر شريحة = التواصل والحجز. النص الطويل يروح في الكابشن.</p>'+
   '<div id="carousel-copy-preview"></div></section>';
 }
 function wire(root){
  var kind=root.querySelector('#cf-content-kind');if(!kind)return;
  kind.insertAdjacentHTML('beforeend','<option value="carousel">كاروسيل (من ٣ لـ ١٠ شرايح)</option>');
  function sync(){var on=kind.value==='carousel';root.querySelector('#carousel-fields').hidden=!on;var f=root.querySelector('#ci-format');if(f){if(on)f.value='carousel';else if(f.value==='carousel')f.value='';}}
  kind.addEventListener('change',sync);sync();
 }
 function current(required){
  var kind=document.getElementById('cf-content-kind');if(!kind||kind.value!=='carousel')return null;
  var b={slides_count:Number(document.getElementById('carousel-count').value)||6,style:document.getElementById('carousel-style').value,notes:document.getElementById('carousel-notes').value.trim()};
  if(required&&(b.slides_count<3||b.slides_count>10))throw Error('عدد شرايح الكاروسيل من ٣ لـ ١٠.');
  return b;
 }
 function metadata(raw,b){try{raw=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){raw={};}var out=Object.assign({},raw||{},{format:'carousel',content_kind:'carousel',carousel_brief:b});delete out.dina_brief;delete out.doctor_brief;delete out.before_after_brief;return out;}
 function from(item){try{var raw=typeof item.agent_raw_output==='string'?JSON.parse(item.agent_raw_output):item.agent_raw_output;return raw&&raw.carousel_brief||(item.content_format==='carousel'?{slides_count:Array.isArray(raw&&raw.carousel_copy)?raw.carousel_copy.length:6,style:'tips',notes:''}:null);}catch(e){return null;}}
 function copyHtml(copy){
  if(!Array.isArray(copy)||!copy.length)return '';
  return '<div style="display:grid;gap:8px;margin:8px 0">'+copy.map(function(s,i){return '<article style="border:1px solid var(--c-border);border-radius:10px;padding:10px;min-width:0"><small>شريحة '+(i+1)+' من '+copy.length+' — '+(i===0?'الغلاف':i===copy.length-1?'التواصل':'المحتوى')+'</small><h4 style="margin:6px 0">'+esc(s.headline)+'</h4><p style="white-space:pre-wrap;margin:0">'+esc(s.body)+'</p><details><summary>توجيه التصميم</summary>'+esc(s.scene)+'</details></article>';}).join('')+'</div>'; 
 }
 function hydrate(b,copy){
  if(!b)return;var kind=document.getElementById('cf-content-kind');if(!kind)return;
  kind.value='carousel';kind.dispatchEvent(new Event('change'));
  document.getElementById('carousel-count').value=String(b.slides_count||6);
  document.getElementById('carousel-style').value=b.style||'tips';
  document.getElementById('carousel-notes').value=b.notes||'';
  var p=document.getElementById('carousel-copy-preview');if(p)p.innerHTML=copy&&copy.length?'<b style="font-size:12px">نصوص الشرايح من الوكيل:</b>'+copyHtml(copy):'';
 }
 function copyFrom(item){try{var raw=typeof item.agent_raw_output==='string'?JSON.parse(item.agent_raw_output):item.agent_raw_output;return Array.isArray(raw&&raw.carousel_copy)?raw.carousel_copy:[];}catch(e){return [];}}
 function itemHtml(item){var copy=copyFrom(item);return item.content_format==='carousel'&&copy.length?'<details style="margin:12px 0"><summary>نصوص شرايح الكاروسيل ('+copy.length+')</summary>'+copyHtml(copy)+'</details>':'';}
 function designNote(item){if(item.content_format!=='carousel')return null;var raw=item.agent_raw_output||{};try{if(typeof raw==='string')raw=JSON.parse(raw);}catch(e){raw={};}var brief=from(item)||{slides_count:6,style:'tips',notes:''},copy=Array.isArray(raw.carousel_copy)?raw.carousel_copy:[];return JSON.stringify({task:'carousel',brand:item.brand,slides_count:brief.slides_count,style:brief.style,carousel_copy:copy,requires_copy_generation:!copy.length,title:item.title,cover_source_text:(window.SSMPDSources?window.SSMPDSources.fromItem(item).cover_source_text:''),source_slides:'cover_only',caption:item.caption_text||item.body,reference_manifest:"assets/design-templates/carousel-reference/manifest.json",word_ranges:{hook:{headline:[3,6],body:[6,12]},point:{headline:[2,6],body:[10,22]},cta:{headline:[2,6],body:[6,16]}},instructions:'صمم كل الشرايح بالترتيب كمجموعة واحدة. غلاف يشد ثم فكرة واحدة لكل شريحة ثم التواصل. لا تحول الكاروسيل إلى بوست واحد ولا تكرر نفس البوست. في المقارنة عمودان داخل كل شريحة وفي الخرافة والحقيقة صندوقان. استخدم هوية الصفحة وترقيم الشرايح واتصالاتها المعتمدة. احفظ جميع الروابط في carousel_slides عبر save_private_carousel ثم final_approval فقط. راجع نصوص كل الشرايح ومساحات النص قبل الرفع.'});}
 window.SSMPDCarouselContent={copyFrom:copyFrom,itemHtml:itemHtml,designNote:designNote,html:html,wire:wire,current:current,metadata:metadata,from:from,hydrate:hydrate,copyHtml:copyHtml,styles:STYLES};
})();
