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
 function metadata(raw,b){try{raw=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){raw={};}return Object.assign({},raw||{},{content_kind:'carousel',carousel_brief:b});}
 function from(item){try{var raw=typeof item.agent_raw_output==='string'?JSON.parse(item.agent_raw_output):item.agent_raw_output;return raw&&raw.content_kind==='carousel'&&raw.carousel_brief||null;}catch(e){return null;}}
 function copyHtml(copy){
  if(!Array.isArray(copy)||!copy.length)return '';
  return '<ol style="font-size:12px;margin:6px 0;padding-inline-start:18px">'+copy.map(function(s){return '<li><b>'+esc(s.headline)+'</b>'+(s.body?' — '+esc(s.body):'')+'</li>';}).join('')+'</ol>';
 }
 function hydrate(b,copy){
  if(!b)return;var kind=document.getElementById('cf-content-kind');if(!kind)return;
  kind.value='carousel';kind.dispatchEvent(new Event('change'));
  document.getElementById('carousel-count').value=String(b.slides_count||6);
  document.getElementById('carousel-style').value=b.style||'tips';
  document.getElementById('carousel-notes').value=b.notes||'';
  var p=document.getElementById('carousel-copy-preview');if(p)p.innerHTML=copy&&copy.length?'<b style="font-size:12px">نصوص الشرايح من الوكيل:</b>'+copyHtml(copy):'';
 }
 window.SSMPDCarouselContent={html:html,wire:wire,current:current,metadata:metadata,from:from,hydrate:hydrate,copyHtml:copyHtml,styles:STYLES};
})();
