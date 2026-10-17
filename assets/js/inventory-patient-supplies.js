/* Patient extras share reception invoices and the inventory ledger. */
(function(){'use strict';
 function open(c){
  var admin=window.SSMPDAuth.currentAdmin.id,location=c.state.data.location_id;
  var previous=c.state.patientSupplyAttempt;
  if(previous&&previous.admin!==admin){delete c.state.patientSupplyAttempt;previous=null;}
  if(previous&&previous.pending)return;
  var seq=0,context=null,chosen=null,busy=false;
  function owner(){return window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id===admin;}
  function esc(x){return c.esc(x);}
  function options(rows,key,label){return '<option value="">اختر</option>'+rows.map(function(x){return '<option value="'+esc(x[key])+'">'+esc(label(x))+'</option>';}).join('');}
  var body=previous&&previous.uncertain?'<p>نتيجة الصرف السابق لم تتأكد بسبب الاتصال. اضغط التحقق لإكمال نفس العملية دون تكرار الخصم أو الفاتورة.</p>':
   '<p>مستلزم إضافي غير مشمول بالخدمة. الصرف يضيف سعر البيع إلى فاتورة الزيارة ويخصم المخزون مرة واحدة. المشمول يصرف من تنفيذ الخدمة.</p><div class="inv-form" data-patient-supply-fields>'+
   '<label>الصنف<select name="supply_item">'+options(c.state.data.items,'id',function(x){return x.name+' — '+x.base_unit;})+'</select></label>'+
   '<label>بحث باسم المريض أو الهاتف أو رقم الملف<input name="supply_search" autocomplete="off" maxlength="120"></label><button type="button" class="btn" data-supply-search>بحث عن ملف له زيارة مفتوحة</button>'+
   '<label>المريض<select name="supply_patient"><option value="">ابحث أولًا</option></select></label>'+
   '<label>الزيارة<select name="supply_visit"><option value="">اختر المريض</option></select></label>'+
   '<label>الفاتورة<select name="supply_invoice"><option value="">اختر الزيارة</option></select></label>'+
   '<label>الكمية بوحدة الصرف<input name="supply_quantity" inputmode="decimal"></label>'+
   '<label>سبب الصرف الإضافي<input name="supply_note" maxlength="500"></label></div>'+
   '<div data-supply-preview></div><div data-supply-history></div>'+
   '<label class="inv-check"><input name="supply_repeat" type="checkbox"> راجعت الصرف السابق، وهذه كمية إضافية جديدة فعلًا وليست إعادة تسجيله</label>'+
   '<label class="inv-check"><input name="supply_confirm" type="checkbox"> المريض وافق على قيمة المستلزم الإضافي الظاهرة</label>';
  var m=c.modal('صرف مستلزم إضافي لمريض',body+'<p data-supply-status role="status" aria-live="polite"></p>',save,previous&&previous.uncertain?'التحقق من الصرف السابق':'تأكيد الصرف والإضافة للفاتورة');
  var saveButton=m.querySelector('[data-save]'),status=m.querySelector('[data-supply-status]');
  function field(name){return m.querySelector('[name="supply_'+name+'"]');}
  function message(text,error){status.textContent=text;status.setAttribute('role',error?'alert':'status');}
  function freeze(on){busy=on;m.querySelectorAll('input,select,[data-supply-search],[data-cancel],.modal-close').forEach(function(el){el.disabled=on;});saveButton.disabled=on;}
  function active(){return owner()&&m.isConnected;}
  function render(){
   if(!context)return;
   var visit=field('visit').value,it=context.item,qty=window.SSMPDInventoryWorkspace.number(field('quantity').value),prior=(context.previous||[]).filter(function(x){return x.visit_id===visit;}),planned=(context.planned||[]).filter(function(x){return x.visit_id===visit;});
   m.querySelector('[data-supply-preview]').textContent=it?'سعر بيع الوحدة '+c.fmt(it.sale_price)+' ج.م — الإجمالي '+c.fmt((Number.isFinite(qty)?qty:0)*Number(it.sale_price))+' ج.م':'';
   m.querySelector('[data-supply-history]').innerHTML=planned.length?'<p role="alert">هذا الصنف موجود ضمن خدمة لم تنفذ: '+planned.map(function(x){return esc(x.service_name);}).join('، ')+'. سجله من تنفيذ الخدمة حتى لا يصرف مرتين.</p>':
    '<h4>الصرف السابق لنفس الصنف في الزيارة</h4>'+(prior.length?prior.map(function(x){return '<p>'+esc(x.kind==='included'?'مشمول بالخدمة':'إضافي بسعر البيع')+' — '+c.fmt(x.quantity)+' — '+esc(x.invoice_ref||'')+' — '+esc(x.actor_name)+' — '+c.date(x.created_at)+'</p>';}).join(''):'<p>لا يوجد صرف سابق مسجل لهذا الصنف.</p>');
   field('repeat').closest('label').hidden=!prior.length;field('repeat').required=!!prior.length;
   saveButton.disabled=busy||!visit||!it||Number(it.sale_price)<=0||!!planned.length;
  }
  async function load(term,patient){
   var current=++seq;saveButton.disabled=true;message('جاري قراءة بيانات الزيارة وسعر البيع…');
   try{var d=await c.rpc('inventory_patient_supply_context',{p_location:location,p_item:field('item').value||null,p_term:term||'',p_patient:patient||null});
    if(!active()||current!==seq)return;
    context=d;message('');
    if(!patient){chosen=null;field('patient').innerHTML=options(d.patients||[],'patient_id',function(x){return x.name+' — '+x.file_no+' — '+(x.phone||'');});field('visit').innerHTML='<option value="">اختر المريض</option>';field('invoice').innerHTML='<option value="">اختر الزيارة</option>';if(term&&!d.patients.length)message('لا توجد زيارة مفتوحة مطابقة. افتح زيارة للمريض من الاستقبال ثم أعد البحث.');}
    else{chosen=patient;field('visit').innerHTML=options(d.visits||[],'id',function(x){return 'زيارة '+x.visit_no+' — '+c.date(x.opened_at);});if(d.visits.length===1)field('visit').value=d.visits[0].id;invoices();}
    render();
   }catch(err){if(active()&&seq===current){context=null;message(err.message||'تعذر قراءة بيانات المريض',true);saveButton.disabled=true;}}
  }
  function invoices(){var rows=(context&&context.invoices||[]).filter(function(x){return x.visit_id===field('visit').value;});field('invoice').innerHTML=rows.length?options(rows,'id',function(x){return 'RX-'+x.invoice_no+' — '+x.description+' — عليه '+c.fmt(x.due);}):'<option value="">إنشاء بيان مستلزمات مرتبط بنفس الزيارة</option>';if(rows.length===1)field('invoice').value=rows[0].id;field('repeat').checked=false;field('confirm').checked=false;render();}
  function save(){
   if(busy||!owner())return;
   var attempt=c.state.patientSupplyAttempt;
   if(!(attempt&&attempt.admin===admin&&attempt.uncertain)){
    if(!context||!chosen||!field('visit').value||!field('item').value){message('اختر الصنف والمريض والزيارة',true);return;}
    var qty=window.SSMPDInventoryWorkspace.number(field('quantity').value),note=field('note').value.trim(),visit=field('visit').value;
    if(!Number.isFinite(qty)||qty<=0||Math.abs(qty*1000-Math.round(qty*1000))>0.000001){message('أدخل كمية موجبة بحد أقصى 3 أرقام عشرية',true);return;}
    if(note.length<3){message('وضح سبب الصرف الإضافي بثلاثة أحرف على الأقل',true);return;}
    if((context.invoices||[]).some(function(x){return x.visit_id===visit;})&&!field('invoice').value){message('اختر فاتورة نفس الزيارة',true);return;}
    if(!field('confirm').checked){message('أكد موافقة المريض على السعر المعروض',true);return;}
    if((context.previous||[]).some(function(x){return x.visit_id===visit;})&&!field('repeat').checked){message('راجع الصرف السابق وأكد أنها كمية جديدة فعلًا',true);return;}
    if((context.planned||[]).some(function(x){return x.visit_id===visit;})){message('هذا المستلزم يصرف من تنفيذ الخدمة المسجل بها',true);return;}
    attempt={admin:admin,location:location,token:window.crypto.randomUUID(),payload:{workspace_id:context.workspace_id,location_id:location,item_id:field('item').value,patient_id:chosen,visit_id:visit,invoice_id:field('invoice').value||null,quantity:qty,sale_price:Number(context.item.sale_price),note:note,repeat_confirmed:field('repeat').checked,patient_confirmed:true}};
    c.state.patientSupplyAttempt=attempt;
   }
   attempt.pending=true;freeze(true);saveButton.textContent='جاري تأكيد الصرف…';message('جاري الحفظ؛ لا تسجل المستلزم مرة ثانية.');
   c.rpc('inventory_dispense_patient',{p_payload:attempt.payload,p_token:attempt.token}).then(function(result){
    if(c.state.patientSupplyAttempt===attempt)delete c.state.patientSupplyAttempt;
    if(!owner())return;
    var text='تم الصرف والإضافة إلى RX-'+result.invoice_no+' — زيارة '+result.visit_no+' بقيمة '+c.fmt(result.amount)+' ج.م. المستحق بعد التسجيل على الفاتورة '+c.fmt(result.due)+' ج.م.';
    c.state.usageResult={key:admin+'|'+attempt.location,type:'success',message:text,item_id:attempt.payload.item_id};
    if(window.SSMPDToast)window.SSMPDToast.show(text,'success');m.remove();if(c.state.data&&c.state.data.location_id===attempt.location&&c.state.view==='usage')c.refresh();
   }).catch(function(err){
    attempt.pending=false;attempt.uncertain=/fetch|network|timeout|abort|connection/i.test(err&&err.message||'')||!err||!err.message;
    if(!active())return;
    if(attempt.uncertain){message('تعذر تأكيد النتيجة بسبب الاتصال. اضغط التحقق لإعادة نفس الطلب بأمان؛ لا تدخل صرفًا جديدًا.',true);saveButton.disabled=false;saveButton.textContent='التحقق من الصرف السابق';m.querySelectorAll('[data-cancel],.modal-close').forEach(function(el){el.disabled=false;});busy=false;}
    else{if(c.state.patientSupplyAttempt===attempt)delete c.state.patientSupplyAttempt;freeze(false);message(err.message,true);saveButton.textContent='تأكيد الصرف والإضافة للفاتورة';if(!m.querySelector('[data-patient-supply-fields]')){saveButton.disabled=true;saveButton.textContent='أغلق النافذة وابدأ بعد مراجعة السبب';}else render();}
   });
  }
  if(previous&&previous.uncertain)return;
  saveButton.disabled=true;field('item').onchange=function(){chosen=null;field('confirm').checked=false;load(field('search').value.trim());};
  m.querySelector('[data-supply-search]').onclick=function(){var term=field('search').value.trim();if(term.length<2){message('اكتب حرفين أو رقمين على الأقل للبحث',true);return;}load(term);};
  field('search').oninput=function(){++seq;chosen=null;context=null;field('patient').innerHTML='<option value="">اضغط بحث</option>';field('visit').innerHTML='<option value="">اختر المريض</option>';field('invoice').innerHTML='<option value="">اختر الزيارة</option>';saveButton.disabled=true;};
  field('search').onkeydown=function(event){if(event.key==='Enter'){event.preventDefault();m.querySelector('[data-supply-search]').click();}};
  field('patient').onchange=function(){chosen=null;load('',field('patient').value);};field('visit').onchange=invoices;field('quantity').oninput=function(){field('confirm').checked=false;render();};
 }
 window.SSMPDInventoryPatientSupplies={open:open};
})();
