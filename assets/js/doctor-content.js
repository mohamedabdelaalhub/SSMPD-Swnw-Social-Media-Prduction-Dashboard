(function(){
 'use strict';
 var keys=['prefix','name','title','days','time_from','time_to','qualifications','experience'];
 function read(){var out={};keys.forEach(function(key){var el=document.getElementById('doctor-'+key);out[key]=el?el.value.trim():'';});return out;}
 function active(){var el=document.getElementById('cf-content-kind');return !!el&&el.value==='doctor_intro';}
 function validate(d){if(!d.name||!d.title)throw new Error('اكتب اسم الطبيب والتايتل والتخصص.');if(!d.days||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time_from)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time_to))throw new Error('أيام العمل وموعد البداية والنهاية مطلوبة.');}
 function from(item){var raw=item&&item.agent_raw_output;try{if(typeof raw==='string')raw=JSON.parse(raw);}catch(e){return null;}return raw&&raw.content_kind==='doctor_intro'&&raw.doctor_brief||null;}
 function metadata(raw,d){var out;try{out=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){out={original_agent_output:raw};}if(!out||typeof out!=='object'||Array.isArray(out))out={};return Object.assign({},out,{content_kind:'doctor_intro',doctor_brief:d});}
 function hydrate(d){if(!d)return;var kind=document.getElementById('cf-content-kind');if(kind){kind.value='doctor_intro';kind.dispatchEvent(new Event('change',{bubbles:true}));}keys.forEach(function(key){var el=document.getElementById('doctor-'+key);if(el)el.value=d[key]||'';});}
 function html(){return '<div class="field"><label>نوع المحتوى</label><select id="cf-content-kind"><option value="standard">محتوى عام</option><option value="doctor_intro">تعريف طبيب</option></select></div><section id="doctor-content-fields" hidden><h4>بيانات تقديم الطبيب</h4>'+keys.map(function(key){var labels={prefix:'الدكتور أو الدكتورة',name:'اسم الطبيب',title:'التايتل والتخصص',days:'أيام العمل',time_from:'من الساعة',time_to:'حتى الساعة',qualifications:'المؤهلات — اختياري',experience:'الخبرات — اختياري'};var input=key==='prefix'?'<select id="doctor-prefix"><option>الدكتور</option><option>الدكتورة</option></select>':['qualifications','experience','title'].includes(key)?'<textarea id="doctor-'+key+'" rows="2"></textarea>':'<input id="doctor-'+key+'" type="'+(key.startsWith('time_')?'time':'text')+'">';return '<div class="field"><label>'+labels[key]+input+'</label></div>';}).join('')+'<p>الأيام والساعات مطلوبة. المؤهلات والخبرات تظهر في المنشور فقط عند إدخالها. البيانات تنتقل لقالب الدكتور.</p></section>';}
 function wire(root){
  var kind=root.querySelector('#cf-content-kind'),fields=root.querySelector('#doctor-content-fields'),title=root.querySelector('#cf-title'),lastName='';
  function sync(){fields.hidden=!active();if(active()){var format=root.querySelector('#ci-format');if(format){format.value='image_post';format.dispatchEvent(new Event('change',{bubbles:true}));}}}
  kind.addEventListener('change',sync);
  title.addEventListener('input',function(){var m=/^تعريف\s+(?:د\s*[/.]|الدكتور(?:ة)?|دكتور(?:ة)?)\s*(.*)$/u.exec(title.value.trim());if(m){kind.value='doctor_intro';sync();var name=root.querySelector('#doctor-name');if(!name.value||name.value===lastName){name.value=m[1];lastName=m[1];}if(/دكتور(?:ة)/.test(title.value))root.querySelector('#doctor-prefix').value='الدكتورة';}});
  sync();
 }
 function current(requireComplete){if(!active())return null;var d=read();if(requireComplete){validate(d);var brand=document.getElementById('cf-brand');if(brand&&brand.value!=='sono')throw new Error('قالب تعريف الطبيب مخصص لصفحة سونو.');}return d;}
 function prompt(d){return '\nDOCTOR INTRODUCTION — use only these supplied facts: '+JSON.stringify(d)+'\nاكتب منشور ترحيب وتقديم للطبيب للجمهور المصري. الاسم والتايتل والأيام والساعات حقائق ملزمة. اذكر المؤهلات والخبرات فقط إذا وردت هنا. لا تضف سنوات خبرة أو شهادات أو ألقابًا أو خدمات غير مدخلة. لا تستخدم قالب التوعية الطبية أو عنوان سؤال عن مرض. لكل اقتراح كابشن جاهز للنشر يشمل الترحيب والمعلومات والمواعيد والتواصل. هذا المحتوى بوست صورة ويستخدم قالب تعريف الدكتور. حافظ على schema الحالي.';}
 window.SSMPDDoctorContent={html:html,wire:wire,current:current,from:from,metadata:metadata,hydrate:hydrate,prompt:prompt,validate:validate};
})();
