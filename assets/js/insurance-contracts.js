/* SSMPD — Insurance plans, card classes, copay, claims and collection UI. */
(function (w) {
  'use strict';
  if (w.__SSMPDInsuranceContractsV1) return;
  w.__SSMPDInsuranceContractsV1 = true;

  function db(){ return w.SSMPDDb && w.SSMPDDb.client; }
  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function money(v){ return Number(v || 0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م'; }
  function toast(msg,type){ if(w.SSMPDToast) w.SSMPDToast.show(msg,type); else alert(msg); }
  async function rpc(name,args){ var r=await db().rpc(name,args||{}); if(r.error) throw r.error; return r.data; }
  function copayLabel(type,value){ if(type==='percentage') return Number(value||0)+'%'; if(type==='fixed') return money(value); if(type==='inherit') return 'حسب الفئة'; return 'بدون تحمل'; }

  function modal(title,html){
    var bd=document.createElement('div');
    bd.className='insurance-modal-backdrop';
    bd.innerHTML='<div class="insurance-modal" role="dialog" aria-modal="true"><div class="insurance-modal-head"><h3>'+esc(title)+'</h3><button type="button" data-close aria-label="إغلاق">×</button></div><div class="insurance-modal-body">'+html+'</div></div>';
    document.body.appendChild(bd);
    bd.querySelector('[data-close]').onclick=function(){bd.remove();};
    bd.addEventListener('click',function(e){if(e.target===bd)bd.remove();});
    return bd;
  }

  function ensureCss(){
    if(document.getElementById('insurance-contracts-style')) return;
    var s=document.createElement('style');s.id='insurance-contracts-style';s.textContent='\
    .insurance-entry{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0;padding:14px 16px;border:1px solid var(--c-border,#dfe5ef);border-radius:14px;background:var(--c-card,#fff)}\
    .insurance-entry p{margin:3px 0 0;color:var(--c-muted,#667085);font-size:12px}.insurance-modal-backdrop{position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.48);display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow:auto}.insurance-modal{width:min(1050px,100%);background:var(--c-card,#fff);color:var(--c-text,#172033);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.22);overflow:hidden}.insurance-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--c-border,#e4e7ec)}.insurance-modal-head h3{margin:0}.insurance-modal-head button{border:0;background:transparent;font-size:28px;cursor:pointer}.insurance-modal-body{padding:18px}.insurance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.insurance-card{border:1px solid var(--c-border,#e4e7ec);border-radius:14px;padding:14px;background:var(--c-card,#fff)}.insurance-card h4{margin:0 0 6px}.insurance-card p{margin:3px 0;color:var(--c-muted,#667085);font-size:12px}.insurance-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.insurance-field{display:flex;flex-direction:column;gap:5px}.insurance-field input,.insurance-field select,.insurance-field textarea{min-height:40px;border:1px solid var(--c-border,#d0d5dd);border-radius:10px;padding:8px;background:var(--c-card,#fff);color:inherit}.insurance-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}.insurance-summary>div{padding:12px;border-radius:12px;background:var(--c-soft,#f6f8fb)}.insurance-summary b{display:block;font-size:18px;margin-top:4px}.insurance-note{padding:10px 12px;border-radius:10px;background:#fff8e7;color:#704c00;font-size:12px;margin:10px 0}.insurance-table{width:100%;border-collapse:collapse}.insurance-table th,.insurance-table td{padding:8px;border-bottom:1px solid var(--c-border,#e4e7ec);text-align:right;font-size:12px}.insurance-patient-box{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.insurance-patient-box label{display:flex;flex-direction:column;gap:5px;font-size:12px}.insurance-patient-box select,.insurance-patient-box input{min-height:40px;border:1px solid var(--c-border,#d0d5dd);border-radius:9px;padding:7px}@media(max-width:650px){.insurance-patient-box{grid-template-columns:1fr}.insurance-modal-body{padding:12px}}';document.head.appendChild(s);
  }

  function ensureBilling(){
    if(w.__SSMPDInsuranceBillingV1 || document.querySelector('script[data-insurance-billing-v1]')) return;
    var s=document.createElement('script');
    s.src='assets/js/insurance-billing.js?v=entity-claims-20261029-1';
    s.async=false;
    s.dataset.insuranceBillingV1='1';
    document.head.appendChild(s);
  }

  async function openManager(){
    ensureCss();
    var bd=modal('إدارة التأمين وفئات الكارنيه','<p role="status">جاري تحميل بيانات التأمين…</p>');
    var body=bd.querySelector('.insurance-modal-body');
    try{
      var all=await rpc('insurance_workspace',{p_contract:null});
      if(!all.contracts.length){body.innerHTML='<p>لا توجد عقود تأمين نشطة أو مسجلة بعد.</p>';return;}
      body.innerHTML='<div class="insurance-field"><label>شركة/عقد التأمين</label><select id="ins-contract">'+all.contracts.map(function(c){return '<option value="'+c.id+'">'+esc(c.entity_name+(c.contract_number?' — '+c.contract_number:''))+'</option>';}).join('')+'</select></div><div id="ins-workspace"></div>';
      var sel=body.querySelector('#ins-contract');
      sel.onchange=function(){loadContract(sel.value,body.querySelector('#ins-workspace'));};
      loadContract(sel.value,body.querySelector('#ins-workspace'));
    }catch(e){body.innerHTML='<p role="alert">'+esc(e.message)+'</p>';}
  }

  async function loadContract(contractId,host){
    host.innerHTML='<p role="status">جاري تحميل العقد…</p>';
    try{
      var data=await rpc('insurance_workspace',{p_contract:contractId}), c=data.contracts[0];
      if(!c){host.innerHTML='<p>العقد غير متاح.</p>';return;}
      var plans=data.plans||[], allowed=(c.service_ids||[]), services=(data.services||[]).filter(function(s){return !allowed.length||allowed.indexOf(s.id)>=0;});
      host.innerHTML='<div class="insurance-note"><b>قاعدة الحساب:</b> تحمل المريض = تحصيل فعلي وقت الخدمة. صافي الشركة = مديونية آجلة تدخل المطالبة حتى التحصيل. الخصم التعاقدي لا يُعتبر مديونية على أي طرف.</div>'+
      '<div class="insurance-grid"><div class="insurance-card"><h4>حساب ذمم شركة التأمين</h4><p>الحساب الذي تُرحّل إليه المطالبة لحين التحصيل.</p><div class="insurance-field"><select id="ins-account">'+(data.accounts||[]).map(function(a){return '<option value="'+esc(a.code)+'" '+(a.code===c.receivable_account_code?'selected':'')+'>'+esc(a.code+' — '+a.name)+'</option>';}).join('')+'</select></div><div class="insurance-actions"><button class="btn" id="ins-save-account">حفظ الحساب</button></div></div><div class="insurance-card"><h4>فئات الكارنيه</h4><p>كل فئة يمكن أن يكون لها تحمل مختلف ولائحة أسعار مختلفة.</p><div class="insurance-actions"><button class="btn" id="ins-new-plan">إضافة فئة كارنيه</button><button class="btn ghost" id="ins-quote">حاسبة التأمين</button></div></div></div>'+
      '<h4 style="margin-top:18px">الفئات الحالية</h4><div class="insurance-grid" id="ins-plans">'+(plans.length?plans.map(function(p){var list=(data.price_lists||[]).find(function(x){return x.id===p.price_list_id;});return '<div class="insurance-card"><h4>'+esc(p.name)+' <small>('+esc(p.code)+')</small></h4><p>التحمل: '+esc(copayLabel(p.copay_type,p.copay_value))+'</p><p>اللائحة: '+esc(list?list.name+' — '+list.version:'لائحة العقد الافتراضية')+'</p><p>السريان: '+esc(p.valid_from)+' → '+esc(p.valid_to||'مفتوح')+'</p><p>'+(p.active?'نشطة':'موقوفة')+'</p><div class="insurance-actions"><button class="btn ghost" data-edit-plan="'+p.id+'">تعديل</button><button class="btn ghost" data-rules="'+p.id+'">استثناءات الخدمات</button><button class="btn ghost" data-toggle="'+p.id+'" data-active="'+(!p.active)+'">'+(p.active?'إيقاف':'تفعيل')+'</button></div></div>';}).join(''):'<p>لا توجد فئات بعد.</p>')+'</div><div id="ins-claims"></div>';
      host.querySelector('#ins-save-account').onclick=async function(){try{await rpc('insurance_command',{p_action:'entity_account',p_payload:{contract_id:contractId,account_code:host.querySelector('#ins-account').value}});toast('تم ربط حساب الذمم');loadContract(contractId,host);}catch(e){toast(e.message,'error');}};
      host.querySelector('#ins-new-plan').onclick=function(){openPlanEditor(contractId,null,data,function(){loadContract(contractId,host);});};
      host.querySelector('#ins-quote').onclick=function(){openQuote(contractId,plans,services);};
      host.querySelectorAll('[data-edit-plan]').forEach(function(b){b.onclick=function(){openPlanEditor(contractId,plans.find(function(p){return p.id===b.dataset.editPlan;}),data,function(){loadContract(contractId,host);});};});
      host.querySelectorAll('[data-rules]').forEach(function(b){b.onclick=function(){openRules(plans.find(function(p){return p.id===b.dataset.rules;}),data,services,function(){loadContract(contractId,host);});};});
      host.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=async function(){try{await rpc('insurance_command',{p_action:'plan_toggle',p_payload:{id:b.dataset.toggle,active:b.dataset.active==='true'}});toast('تم تحديث حالة الفئة');loadContract(contractId,host);}catch(e){toast(e.message,'error');}};});
      loadClaims(contractId,host.querySelector('#ins-claims'));
    }catch(e){host.innerHTML='<p role="alert">'+esc(e.message)+'</p>';}
  }

  function planForm(p,data,contractId){
    p=p||{};var lists=(data.price_lists||[]).filter(function(l){return l.contract_id===contractId;});
    return '<form id="ins-plan-form"><div class="insurance-grid"><label class="insurance-field">اسم الفئة/الكارنيه<input name="name" required value="'+esc(p.name||'')+'"></label><label class="insurance-field">كود الفئة<input name="code" required value="'+esc(p.code||'')+'"></label><label class="insurance-field">لائحة الأسعار<select name="price_list_id"><option value="">لائحة العقد الافتراضية</option>'+lists.map(function(l){return '<option value="'+l.id+'" '+(l.id===p.price_list_id?'selected':'')+'>'+esc(l.name+' — إصدار '+l.version)+'</option>';}).join('')+'</select></label><label class="insurance-field">نوع تحمل المريض<select name="copay_type"><option value="none">بدون تحمل</option><option value="percentage">نسبة مئوية</option><option value="fixed">مبلغ ثابت</option></select></label><label class="insurance-field">قيمة التحمل<input name="copay_value" type="number" min="0" step="0.01" value="'+Number(p.copay_value||0)+'"></label><label class="insurance-field">سارية من<input name="valid_from" type="date" required value="'+esc(p.valid_from||new Date().toISOString().slice(0,10))+'"></label><label class="insurance-field">سارية حتى<input name="valid_to" type="date" value="'+esc(p.valid_to||'')+'"></label><label class="insurance-field">الحالة<select name="active"><option value="true">نشطة</option><option value="false">موقوفة</option></select></label><label class="insurance-field" style="grid-column:1/-1">ملاحظات<textarea name="notes">'+esc(p.notes||'')+'</textarea></label></div><div class="insurance-actions"><button class="btn" type="submit">حفظ</button></div></form>';
  }

  function openPlanEditor(contractId,p,data,done){
    var bd=modal(p?'تعديل فئة الكارنيه':'إضافة فئة كارنيه',planForm(p,data,contractId)),f=bd.querySelector('#ins-plan-form');
    f.elements.copay_type.value=(p&&p.copay_type)||'none';f.elements.active.value=String(p?p.active:true);
    function toggle(){f.elements.copay_value.disabled=f.elements.copay_type.value==='none';if(f.elements.copay_type.value==='none')f.elements.copay_value.value='0';}
    f.elements.copay_type.onchange=toggle;toggle();
    f.onsubmit=async function(e){e.preventDefault();var x=Object.fromEntries(new FormData(f).entries());x.contract_id=contractId;x.id=p&&p.id||null;x.copay_value=Number(x.copay_value||0);x.active=x.active==='true';try{await rpc('insurance_command',{p_action:'plan_save',p_payload:x});toast('تم حفظ فئة الكارنيه');bd.remove();done();}catch(err){toast(err.message,'error');}};
  }

  function openRules(plan,data,services,done){
    var rules=(data.rules||[]).filter(function(r){return r.plan_id===plan.id;}),bd=modal('استثناءات الخدمات — '+plan.name,'<div class="insurance-note">الاستثناء يغيّر تحمل المريض لهذه الخدمة فقط. اختيار «حسب الفئة» يرجع للقاعدة العامة.</div><form id="ins-rule-form"><div class="insurance-grid"><label class="insurance-field">الخدمة<select name="service_id">'+services.map(function(s){return '<option value="'+s.id+'">'+esc((s.category?s.category+' — ':'')+s.name)+'</option>';}).join('')+'</select></label><label class="insurance-field">نوع التحمل<select name="copay_type"><option value="inherit">حسب الفئة</option><option value="none">بدون تحمل</option><option value="percentage">نسبة مئوية</option><option value="fixed">مبلغ ثابت</option></select></label><label class="insurance-field">القيمة<input name="copay_value" type="number" min="0" step="0.01" value="0"></label><label class="insurance-field">ملاحظة<input name="notes"></label></div><div class="insurance-actions"><button class="btn" type="submit">حفظ الاستثناء</button></div></form><h4>الاستثناءات المحفوظة</h4><div id="ins-rule-list">'+(rules.length?rules.map(function(r){var s=services.find(function(x){return x.id===r.service_id;});return '<div class="insurance-card"><b>'+esc(s?s.name:r.service_id)+'</b><p>'+esc(copayLabel(r.copay_type,r.copay_value))+'</p><button class="btn ghost sm" data-del-rule="'+r.id+'">حذف الاستثناء</button></div>';}).join(''):'<p>لا توجد استثناءات.</p>')+'</div>');
    var f=bd.querySelector('#ins-rule-form');
    f.elements.copay_type.onchange=function(){var t=this.value;f.elements.copay_value.disabled=t==='inherit'||t==='none';if(f.elements.copay_value.disabled)f.elements.copay_value.value='0';};
    f.onsubmit=async function(e){e.preventDefault();var x=Object.fromEntries(new FormData(f).entries());x.plan_id=plan.id;x.copay_value=Number(x.copay_value||0);try{await rpc('insurance_command',{p_action:'rule_save',p_payload:x});toast('تم حفظ استثناء الخدمة');bd.remove();done();}catch(err){toast(err.message,'error');}};
    bd.querySelectorAll('[data-del-rule]').forEach(function(b){b.onclick=async function(){try{await rpc('insurance_command',{p_action:'rule_delete',p_payload:{id:b.dataset.delRule}});toast('تم حذف الاستثناء');bd.remove();done();}catch(err){toast(err.message,'error');}};});
  }

  function openQuote(contractId,plans,services){
    if(!plans.length){toast('أضف فئة كارنيه أولًا','error');return;}
    var bd=modal('حاسبة التأمين','<div class="insurance-grid"><label class="insurance-field">فئة الكارنيه<select id="iq-plan">'+plans.filter(function(p){return p.active;}).map(function(p){return '<option value="'+p.id+'">'+esc(p.name+' — '+copayLabel(p.copay_type,p.copay_value))+'</option>';}).join('')+'</select></label><label class="insurance-field">الخدمة<select id="iq-service">'+services.map(function(s){return '<option value="'+s.id+'">'+esc((s.category?s.category+' — ':'')+s.name)+'</option>';}).join('')+'</select></label><label class="insurance-field">التاريخ<input id="iq-date" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label></div><div class="insurance-actions"><button class="btn" id="iq-go">احسب</button></div><div id="iq-result"></div>');
    bd.querySelector('#iq-go').onclick=async function(){var out=bd.querySelector('#iq-result');out.innerHTML='<p>جاري الحساب…</p>';try{var q=await rpc('insurance_quote',{p_service:bd.querySelector('#iq-service').value,p_contract:contractId,p_plan:bd.querySelector('#iq-plan').value,p_date:bd.querySelector('#iq-date').value});out.innerHTML='<div class="insurance-summary"><div>سعر المركز<b>'+money(q.center_price)+'</b></div><div>الخصم التعاقدي<b>'+money(q.contractual_discount)+'</b></div><div>السعر التعاقدي<b>'+money(q.contracted_price)+'</b></div><div>تحمل المريض<b>'+money(q.patient_copay)+'</b><small>'+esc(copayLabel(q.copay_type,q.copay_value))+'</small></div><div>صافي الشركة / المطالبة<b>'+money(q.insurer_net)+'</b></div></div><div class="insurance-note">تحمل المريض يدخل التحصيل الفعلي. '+money(q.insurer_net)+' تظل مديونية على '+esc(q.insurer)+' حتى التحصيل.</div>';}catch(e){out.innerHTML='<p role="alert">'+esc(e.message)+'</p>';}};
  }

  async function loadClaims(contractId,host){
    try{
      var data=await rpc('insurance_claims_workspace',{p_contract:contractId}), claims=data.claims||[];
      host.innerHTML='<h4 style="margin-top:20px">مطالبات الشركة والتحصيل</h4>'+(claims.length?'<div style="overflow:auto"><table class="insurance-table"><thead><tr><th>المرجع</th><th>الفئة</th><th>الخدمة</th><th>المطالبة</th><th>المحصل</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>'+claims.map(function(c){return '<tr><td>'+esc(c.reference)+'</td><td>'+esc(c.plan_name||'—')+'</td><td>'+esc(c.service_name||'—')+'</td><td>'+money(c.amount)+'</td><td>'+money(c.collected_amount)+'</td><td>'+money(c.remaining)+'</td><td>'+esc(c.status)+'</td><td>'+(Number(c.remaining)>0?'<button class="btn ghost sm" data-collect="'+c.id+'" data-rem="'+c.remaining+'">تسجيل تحصيل</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p>لا توجد مطالبات مسجلة على هذا العقد.</p>');
      host.querySelectorAll('[data-collect]').forEach(function(b){b.onclick=function(){openCollection(b.dataset.collect,Number(b.dataset.rem),function(){loadClaims(contractId,host);});};});
    }catch(e){host.innerHTML='';}
  }

  async function openCollection(claimId,remaining,done){
    var shifts=[];try{shifts=await rpc('insurance_open_shifts');}catch(e){}
    var bd=modal('تسجيل تحصيل من شركة التأمين','<div class="insurance-grid"><label class="insurance-field">المبلغ<input id="ic-amount" type="number" min="0.01" max="'+remaining+'" step="0.01" value="'+remaining+'"></label><label class="insurance-field">طريقة التحصيل<select id="ic-method"><option value="bank">تحويل بنكي</option><option value="instapay">InstaPay</option><option value="wallet">محفظة</option><option value="cash">كاش</option><option value="pos">فيزا / POS</option></select></label><label class="insurance-field">الخزينة/الوردية<select id="ic-shift"><option value="">غير مطلوبة للتحويل</option>'+shifts.map(function(s){return '<option value="'+s.id+'">'+esc(s.name)+'</option>';}).join('')+'</select></label><label class="insurance-field">مرجع التحصيل<input id="ic-ref" required placeholder="رقم التحويل/الإيصال"></label></div><div class="insurance-actions"><button class="btn" id="ic-save">تسجيل التحصيل</button></div>');
    var method=bd.querySelector('#ic-method'),shift=bd.querySelector('#ic-shift');
    function sync(){shift.disabled=!['cash','pos'].includes(method.value);}method.onchange=sync;sync();
    bd.querySelector('#ic-save').onclick=async function(){try{if(['cash','pos'].includes(method.value)&&!shift.value)throw Error('اختر الوردية المفتوحة للتحصيل النقدي أو POS');var res=await rpc('clinic_finance_insurance_collect',{p_claim:claimId,p_amount:Number(bd.querySelector('#ic-amount').value),p_method:method.value,p_reference:bd.querySelector('#ic-ref').value,p_shift:shift.value||null,p_token:crypto.randomUUID()});toast('تم تسجيل التحصيل — المتبقي '+money(res.remaining));bd.remove();done();}catch(e){toast(e.message,'error');}};
  }

  function injectEntry(){
    ensureCss();
    var root=document.querySelector('#ce-view')||document.querySelector('[data-contract-navigation]')||document.querySelector('main');
    if(!root||document.getElementById('insurance-management-entry')) return;
    var h=[].slice.call(root.querySelectorAll('h2,h3')).find(function(x){return (x.textContent||'').trim()==='شركات التأمين';});
    if(!h) return;
    var box=document.createElement('div');box.id='insurance-management-entry';box.className='insurance-entry';box.innerHTML='<div><b>إدارة التأمين والكروت والتحمل</b><p>فئات الكارنيه، لوائح الأسعار، تحمل المريض، صافي الشركة، المطالبات والتحصيل.</p></div><button class="btn" type="button">فتح إدارة التأمين</button>';
    var target=h.closest('.section')||h.parentElement;target.insertAdjacentElement('afterend',box);box.querySelector('button').onclick=openManager;
  }

  async function contractOptions(contractId){ if(!contractId)return {is_insurance:false,plans:[]}; return await rpc('insurance_contract_options',{p_contract:contractId}); }
  function addPatientInsurance(select,mode){
    if(!select||select.dataset.insuranceBound) return;select.dataset.insuranceBound='1';
    var box=document.createElement('div');box.className='insurance-patient-box';box.dataset.insurancePatientBox='1';box.hidden=true;box.innerHTML='<label>فئة الكارنيه<select data-ins-plan><option value="">اختر الفئة</option></select></label><label>رقم الكارنيه / العضوية<input data-ins-member placeholder="اختياري"></label>';
    (select.closest('label')||select).insertAdjacentElement('afterend',box);
    async function refresh(){var contract=select.value;if(!contract){box.hidden=true;return;}try{var x=mode==='visit'&&w.__insuranceLastPatientId?await rpc('insurance_patient_context',{p_patient:w.__insuranceLastPatientId,p_contract:contract}):await contractOptions(contract);var plans=x.plans||[];if(mode==='visit'&&x.link&&x.link.member_reference)box.querySelector('[data-ins-member]').value=x.link.member_reference;box.hidden=!plans.length;box.querySelector('[data-ins-plan]').innerHTML='<option value="">اختر الفئة</option>'+plans.map(function(p){return '<option value="'+p.id+'">'+esc(p.name+' — '+copayLabel(p.copay_type,p.copay_value))+'</option>';}).join('');if(mode==='visit'&&x.link&&x.link.insurance_plan_id)box.querySelector('[data-ins-plan]').value=x.link.insurance_plan_id;}catch(e){box.hidden=true;}}
    select.addEventListener('change',refresh);setTimeout(refresh,0);
  }

  function bindPatientDom(){
    var np=document.querySelector('#np-contract');if(np)addPatientInsurance(np,'create');
    var vs=document.querySelector('#vs-contract');if(vs)addPatientInsurance(vs,'visit');
  }

  function wrapDb(){
    if(!w.SSMPDDb||w.SSMPDDb.__insuranceWrapped) return;w.SSMPDDb.__insuranceWrapped=true;
    var D=w.SSMPDDb;
    if(D.createPatientArchive){var origCreate=D.createPatientArchive;D.createPatientArchive=function(payload){var box=document.querySelector('[data-insurance-patient-box]');if(box&&!box.hidden){var plan=box.querySelector('[data-ins-plan]').value;if(!plan)return Promise.reject(new Error('اختر فئة الكارنيه للمريض المؤمن عليه'));payload=Object.assign({},payload,{insurance_plan_id:plan,member_reference:box.querySelector('[data-ins-member]').value.trim()||null});}return origCreate.call(D,payload);};}
    if(D.listContractsForPatientVisit){var origList=D.listContractsForPatientVisit;D.listContractsForPatientVisit=function(patientId){w.__insuranceLastPatientId=patientId;return origList.call(D,patientId);};}
    if(D.addPatientVisit){var origAdd=D.addPatientVisit;D.addPatientVisit=function(patientId,visit,createdBy){var box=document.querySelector('[data-insurance-patient-box]');if(box&&!box.hidden){var plan=box.querySelector('[data-ins-plan]').value;if(!plan)return Promise.reject(new Error('اختر فئة الكارنيه لهذه الزيارة'));visit=Object.assign({},visit,{insurance_plan_id:plan});}return origAdd.call(D,patientId,visit,createdBy);};}
    if(D.updatePatientVisit){var origUpdate=D.updatePatientVisit;D.updatePatientVisit=function(id,patch){var box=document.querySelector('[data-insurance-patient-box]');if(box&&!box.hidden&&Object.prototype.hasOwnProperty.call(patch,'contract_id')){var plan=box.querySelector('[data-ins-plan]').value;if(!plan)return Promise.reject(new Error('اختر فئة الكارنيه لهذه الزيارة'));patch=Object.assign({},patch,{insurance_plan_id:plan});}else if(Object.prototype.hasOwnProperty.call(patch,'contract_id')&&!patch.contract_id){patch=Object.assign({},patch,{insurance_plan_id:null});}return origUpdate.call(D,id,patch);};}
  }

  function boot(){ensureCss();ensureBilling();wrapDb();injectEntry();bindPatientDom();var obs=new MutationObserver(function(){wrapDb();injectEntry();bindPatientDom();});obs.observe(document.documentElement,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  w.SSMPDInsurance={open:openManager,quote:openQuote};
})(window);
