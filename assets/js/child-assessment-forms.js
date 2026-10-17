/* Source-faithful child assessments. Existing speech fields stay in their original columns. */
(function () {
  'use strict';
  var uid = 0;
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  var common = [
    ['child_name','اسم الطفل/الحالة'], ['age_birth','العمر/تاريخ الميلاد'], ['assessment_date','تاريخ التقييم','date'], ['guardian_contact','اسم ولي الأمر ورقم التواصل']
  ];
  var schemas = {
    speech: {
      title:'استمارة تقييم التخاطب واللغة', intro:'تقييم أولي للنطق واللغة والتواصل',
      groups:[['البيانات الأساسية',common.concat([['home_language','اللغة/اللهجة المستخدمة في المنزل']])],
        ['التاريخ النمائي والصحي',[['hearing','هل توجد مشكلات سمع أو تم إجراء اختبار سمع؟','textarea'],['medical_history','التاريخ الطبي أو النمائي المهم','textarea']]],
        ['ملاحظات النطق',[['sounds_to_assess','الأصوات/الحروف التي تحتاج إلى تقييم','textarea'],['speech_examples','أمثلة على الكلمات أو الأصوات كما ينطقها الطفل','textarea']]]],
      matrixTitle:'مهارات التواصل واللغة', matrixHeader:'المهارة', choices:['مناسب للعمر','يحتاج دعمًا','لم يُقيّم'],
      rows:[['sound_name','الانتباه للصوت والاسم'],['instructions','فهم التعليمات'],['vocabulary','فهم المفردات والأسئلة'],['words_sentences','استخدام الكلمات والجمل'],['needs','التعبير عن الاحتياجات'],['eye_contact','التواصل البصري/الانتباه المشترك'],['turns','تبادل الأدوار والحوار'],['clarity','وضوح الكلام ومخارج الأصوات'],['fluency','الطلاقة وإيقاع الكلام']],
      planTitle:'الخطة والمتابعة', plan:[['goal','الهدف'],['activity','النشاط/التدريب'],['home','إرشادات المنزل'],['review_date','موعد المتابعة','date']],
      end:[['recommendations','التوصيات أو الحاجة إلى تقييم إضافي (مثل السمع/اللغة)','textarea']],
      note:'هذه الاستمارة أداة تنظيمية للتقييم والمتابعة وليست تشخيصًا مستقلًا.'
    },
    behavior: {
      title:'استمارة تقييم ومتابعة تعديل السلوك',intro:'تُستخدم لجمع المعلومات الأولية ومتابعة التقدم',
      groups:[['البيانات الأساسية',common.concat([['school','الصف/المدرسة أو الحضانة'],['referral_reason','سبب التحويل أو الشكوى الأساسية','textarea']])],
        ['وصف السلوك',[['context','متى وأين يظهر السلوك؟','textarea'],['antecedent','ما الذي يحدث عادةً قبل السلوك؟','textarea'],['response','كيف يستجيب المحيطون؟','textarea'],['calming','ما الذي يساعد على تهدئة الطفل؟','textarea']]],
        ['نقاط القوة والمهارات الحالية',[['interests','اهتمامات الطفل ومكافآته المفضلة','textarea'],['mastered_skills','المهارات التي يتقنها','textarea']]]],
      matrixTitle:'السلوكيات محل الملاحظة',matrixHeader:'السلوك',choices:['نادرًا','أحيانًا','غالبًا'],
      rows:[['hyperactivity','فرط الحركة وصعوبة الجلوس'],['distraction','تشتت الانتباه'],['refusal','رفض التعليمات/عدم إكمال المهام'],['tantrums','نوبات غضب أو صراخ'],['aggression','ضرب أو إيذاء الآخرين'],['destruction','إلقاء الأشياء/إتلافها'],['impulsivity','اندفاع/مقاطعة/صعوبة انتظار الدور'],['other','سلوك آخر']],
      planTitle:'أهداف الخطة والمتابعة',plan:[['goal','الهدف السلوكي'],['training','طريقة التدريب/التعزيز'],['review_date','موعد المراجعة','date']],
      end:[['family_school_recommendations','ملاحظات وتوصيات للأسرة/المدرسة','textarea']]
    },
    skills: {
      title:'استمارة تقييم تنمية المهارات',intro:'تقييم مبدئي لتحديد نقاط القوة والاحتياجات',
      groups:[['البيانات الأساسية',common.concat([['school','المدرسة/الحضانة والصف']])],
        ['ملاحظات التقييم',[['strengths','نقاط القوة','textarea'],['needs_development','المهارات التي تحتاج إلى تنمية','textarea'],['reinforcers','اهتمامات الطفل/المعززات المناسبة','textarea']]]],
      matrixTitle:'مجالات المهارات',matrixHeader:'المجال',choices:['مستقل','بمساعدة','يحتاج تدريبًا'],
      rows:[['attention','الانتباه والتركيز'],['instructions','اتباع التعليمات'],['fine_motor','المهارات الحركية الدقيقة (مسك القلم/القص)'],['gross_motor','المهارات الحركية الكبرى (قفز/توازن)'],['visual_motor','التآزر البصري الحركي'],['visual_perception','الإدراك البصري والتمييز'],['classification','التصنيف والمطابقة والتسلسل'],['memory','الذاكرة وحل المشكلات'],['social','التواصل والتفاعل الاجتماعي'],['self_care','الاعتماد على النفس'],['academic','الاستعداد الأكاديمي/ما قبل المدرسة']],
      planTitle:'الخطة المقترحة',plan:[['skill','المهارة المستهدفة'],['activity','النشاط/التدريب'],['assistance','مستوى المساعدة'],['progress','متابعة التقدم']],
      end:[['home_recommendations','توصيات للمنزل','textarea']]
    }
  };
  var signatures = [['specialist_signature','توقيع الأخصائية'],['guardian_signature','توقيع ولي الأمر']];
  function field(def, value, prefix, readOnly) {
    var id=prefix+'-'+def[0], label='<label for="'+id+'">'+esc(def[1])+'</label>';
    if(readOnly)return '<div class="field ca-answer">'+label+'<p>'+esc(value || '—')+'</p></div>';
    return '<div class="field">'+label+(def[2]==='textarea'?'<textarea rows="2" id="'+id+'" data-ca-field="'+def[0]+'">'+esc(value)+'</textarea>':'<input id="'+id+'" data-ca-field="'+def[0]+'" type="'+(def[2]==='date'?'date':'text')+'" value="'+esc(value)+'">')+'</div>';
  }
  function planRow(schema, row, prefix, index, readOnly) {
    return '<div class="ca-plan-row" data-ca-plan-row>'+schema.plan.map(function(def){return field(def,row[def[0]],prefix+'-plan-'+index,readOnly);}).join('')+(!readOnly?'<button type="button" class="btn ghost sm" data-ca-remove-plan>إزالة الهدف</button>':'')+'</div>';
  }
  function formHtml(kind,data,patient,readOnly) {
    data=data||{};var schema=schemas[kind],prefix='ca-'+(++uid),values=Object.assign({child_name:patient.full_name,age_birth:patient.age!=null?String(patient.age):''},data);
    var html='<div class="ca-form" data-ca-kind="'+kind+'"><h4>عيادات سونو التخصصية</h4><p>'+esc(schema.intro)+' | الأخصائية: د/ لينا الحسين</p>';
    if(kind==='behavior')html+='<p class="ca-hint">تُملأ بواسطة ولي الأمر/الأخصائية. ضعي علامة عند الحاجة.</p>';
    schema.groups.forEach(function(group,index){
      html+='<fieldset><legend>'+esc(group[0])+'</legend><div class="ca-fields">'+group[1].map(function(def){return field(def,values[def[0]],prefix,readOnly);}).join('')+'</div></fieldset>';
      if(index===0){
        html+='<fieldset><legend>'+esc(schema.matrixTitle)+'</legend><div class="ca-matrix">';
        schema.rows.forEach(function(row){var saved=(data.ratings||{})[row[0]]||{};html+='<div class="ca-matrix-row" data-ca-rating="'+row[0]+'"><b>'+esc(row[1])+'</b>';
          if(readOnly)html+='<p>'+esc(saved.level||'لم يُسجل')+'</p><p>'+esc(saved.notes||'—')+'</p>';
          else html+='<label for="'+prefix+'-'+row[0]+'-level">التقييم</label><select id="'+prefix+'-'+row[0]+'-level" data-ca-level><option value="">اختر</option>'+schema.choices.map(function(c){return '<option value="'+esc(c)+'" '+(saved.level===c?'selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select><label for="'+prefix+'-'+row[0]+'-notes">ملاحظات'+(row[0]==='other'?' / وصف السلوك الآخر':'')+'</label><textarea id="'+prefix+'-'+row[0]+'-notes" data-ca-notes rows="2">'+esc(saved.notes||'')+'</textarea>';
          html+='</div>';
        });html+='</div></fieldset>';
      }
    });
    var plan=Array.isArray(data.plan)&&data.plan.length?data.plan:[{},{},{}];
    html+='<fieldset><legend>'+esc(schema.planTitle)+'</legend><div data-ca-plans>'+plan.map(function(row,i){return planRow(schema,row,prefix,i,readOnly);}).join('')+'</div>'+(!readOnly?'<button type="button" class="btn ghost sm" data-ca-add-plan>إضافة هدف</button>':'')+'</fieldset>';
    html+='<fieldset><legend>التوصيات والتوقيعات</legend>'+schema.end.concat(kind==='speech'?[['specialist_signature','توقيع أخصائية التخاطب'],signatures[1]]:signatures).map(function(def){return field(def,data[def[0]],prefix,readOnly);}).join('')+'<p class="ca-hint">خانات التوقيع لتدوين الاسم أو وصف التوقيع الوارد بالاستمارة.</p></fieldset>'+(schema.note?'<p>'+esc(schema.note)+'</p>':'')+'</div>';
    return html;
  }
  function wireForm(scope) {
    var form=scope.querySelector('.ca-form');if(!form)return;
    function wireRemove(){form.querySelectorAll('[data-ca-remove-plan]').forEach(function(btn){btn.onclick=function(){btn.closest('[data-ca-plan-row]').remove();};});}
    var add=form.querySelector('[data-ca-add-plan]');if(add)add.onclick=function(){var list=form.querySelector('[data-ca-plans]');list.insertAdjacentHTML('beforeend',planRow(schemas[form.dataset.caKind],{},'ca-'+(++uid),uid,false));wireRemove();};wireRemove();
  }
  function collect(scope,previous) {
    var form=scope.querySelector('.ca-form'),data=Object.assign({},previous||{});
    form.querySelectorAll('[data-ca-field]').forEach(function(input){if(!input.closest('[data-ca-plan-row]'))data[input.dataset.caField]=input.value.trim();});
    data.ratings=Object.assign({},data.ratings||{});
    form.querySelectorAll('[data-ca-rating]').forEach(function(row){data.ratings[row.dataset.caRating]=Object.assign({},data.ratings[row.dataset.caRating]||{},{level:row.querySelector('[data-ca-level]').value,notes:row.querySelector('[data-ca-notes]').value.trim()});});
    data.plan=Array.from(form.querySelectorAll('[data-ca-plan-row]')).map(function(row){var obj={};row.querySelectorAll('[data-ca-field]').forEach(function(input){obj[input.dataset.caField]=input.value.trim();});return obj;});
    data.template_version='lina-20261017-1';return data;
  }
  function overlay(title,html){var el=document.createElement('div');el.className='modal-backdrop';el.innerHTML='<div class="modal ca-modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="modal-head"><h3>'+esc(title)+'</h3><button class="modal-close" aria-label="إغلاق">×</button></div>'+html+'</div>';document.body.appendChild(el);el.querySelector('.modal-close').onclick=function(){el.remove();};el.onclick=function(e){if(e.target===el)el.remove();};return el;}
  function openAssessment(kind,patient,record,canEdit,onSaved,defaults,saveNew){
    var data=record&&record.details||defaults||{},el=overlay(schemas[kind].title,formHtml(kind,data,patient,!canEdit)+(canEdit?'<button class="btn block" data-ca-save>حفظ الاستمارة</button>':'')+'<p role="status" data-ca-status></p>');
    if(!canEdit)return;wireForm(el);el.querySelector('[data-ca-save]').onclick=function(){var btn=this,details=collect(el,data);btn.disabled=true;el.querySelector('[data-ca-status]').textContent='جاري الحفظ…';(saveNew?saveNew(details):window.SSMPDDb.saveDevelopmentAssessment(patient.id,kind,record,details)).then(function(){el.remove();onSaved();}).catch(function(e){btn.disabled=false;el.querySelector('[data-ca-status]').textContent='تعذر الحفظ: '+e.message;});};
  }
  function mount(target,patient,canEdit,speechDefaults){
    function load(){target.innerHTML='<p>جاري تحميل استمارات تعديل السلوك وتنمية المهارات…</p>';return window.SSMPDDb.listDevelopmentAssessments(patient.id).then(function(records){
      if(!target.isConnected)return;var shared={};['child_name','age_birth','guardian_contact','school'].forEach(function(key){var recent=records.find(function(r){return r.details&&r.details[key];});var value=recent?recent.details[key]:(speechDefaults||{})[key];if(value!==undefined&&value!==null&&value!=='')shared[key]=value;});target.innerHTML=['behavior','skills'].map(function(kind){var rows=records.filter(function(r){return r.assessment_kind===kind;});return '<section class="section ca-section" data-ca-section="'+kind+'" data-ca-last="'+esc(rows.length&&rows[0].details&&rows[0].details.assessment_date||'')+'"><h3>'+esc(schemas[kind].title)+'</h3>'+(canEdit?'<button class="btn ghost sm" data-ca-new="'+kind+'">إضافة تقييم</button>':'')+(rows.length?rows.map(function(r){return '<div class="ca-record"><span>'+esc((r.details&&r.details.assessment_date)||'بدون تاريخ تقييم')+'</span><button class="btn ghost sm" data-ca-view="'+r.id+'">عرض الاستمارة</button>'+(canEdit?'<button class="btn ghost sm" data-ca-edit="'+r.id+'">تعديل</button>':'')+'</div>';}).join(''):'<p>لا توجد تقييمات مسجلة.</p>')+'</section>';}).join('');
      target.querySelectorAll('[data-ca-new]').forEach(function(b){b.onclick=function(){openAssessment(b.dataset.caNew,patient,null,true,load,shared);};});
      target.querySelectorAll('[data-ca-view],[data-ca-edit]').forEach(function(b){b.onclick=function(){var id=b.dataset.caView||b.dataset.caEdit,r=records.find(function(x){return x.id===id;});if(r)openAssessment(r.assessment_kind,patient,r,!!b.dataset.caEdit&&canEdit,load);};});
      if(window.SSMPDPatientUI)window.SSMPDPatientUI.decorate(target,{patient:patient});
    }).catch(function(e){if(!target.isConnected)return;target.innerHTML='<p role="alert">تعذر تحميل الاستمارات: '+esc(e.message)+'</p><button class="btn ghost sm" data-ca-retry>إعادة المحاولة</button>';target.querySelector('[data-ca-retry]').onclick=load;});}return load();
  }
  window.SSMPDChildAssessments={open:openAssessment,schemas:schemas,formHtml:formHtml,collect:collect,wireForm:wireForm,mount:mount,showSpeech:function(patient,profile){var el=overlay(schemas.speech.title,formHtml('speech',profile.assessment_details||{},patient,true));var old=[['أول كلمة',profile.first_word],['أول جملة',profile.first_sentence],['هل سبق للطفل الحصول على جلسات تخاطب؟',profile.previous_speech_therapy===true?'نعم':profile.previous_speech_therapy===false?'لا':''],['تفاصيل جلسات التخاطب السابقة',profile.previous_speech_therapy_result],['سبب الحضور والشكوى الأساسية',profile.presenting_complaint],['مستوى الفهم والكلام حاليًا',profile.current_understanding_speech],['الهدف من الجلسات',profile.therapy_goal],['ملاحظات الأخصائي',profile.specialist_notes]];el.querySelector('.ca-form').insertAdjacentHTML('beforeend','<fieldset><legend>بيانات التقييم المحفوظة سابقًا</legend>'+old.map(function(pair){return '<div class="ca-answer"><b>'+esc(pair[0])+'</b><p>'+esc(pair[1]||'—')+'</p></div>';}).join('')+'</fieldset>');}};
})();
