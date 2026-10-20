(function(){
  'use strict';
  var conf=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
  if(!conf||!window.supabase)return;
  var db=window.supabase.createClient(conf.url,conf.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  var code=new URLSearchParams(location.search).get('code')||'';
  var name=document.getElementById('partner-name');
  var intro=document.getElementById('partner-intro');
  var form=document.getElementById('partner-form-card');
  var errorBox=document.getElementById('partner-error');
  var success=document.getElementById('partner-success');
  function showError(msg){errorBox.textContent=msg;errorBox.classList.remove('partner-hidden');form.classList.add('partner-hidden');}
  function call(fn,args){return db.rpc(fn,args).then(function(r){if(r.error)throw r.error;return r.data;});}
  if(!code){showError('رابط الشراكة غير مكتمل.');return;}
  call('contracting_partner_public_profile',{p_code:code}).then(function(p){
    if(!p||!p.enabled){showError('بوابة هذه المؤسسة غير مفعلة حاليًا.');return;}
    name.textContent=p.name||'شريك عيادات سونو';
    intro.textContent='أعضاء '+(p.name||'المؤسسة')+' يستفيدون من مزايا برنامج سونو وخصم يصل إلى '+Number(p.discount||20)+'% على الخدمات المؤهلة.';
    form.classList.remove('partner-hidden');
  }).catch(function(){showError('تعذر تحميل بيانات الشراكة.');});
  document.getElementById('pp-submit').onclick=function(){
    var btn=this;var patientName=document.getElementById('pp-name').value.trim(),phone=document.getElementById('pp-phone').value.trim();
    if(!patientName&&!phone){showError('اكتب الاسم أو رقم الهاتف.');form.classList.remove('partner-hidden');return;}
    btn.disabled=true;btn.textContent='جاري إرسال الطلب…';
    call('contracting_partner_submit_referral',{p_code:code,p_patient_name:patientName,p_patient_phone:phone,p_specialty:document.getElementById('pp-specialty').value.trim()||null,p_service_name:document.getElementById('pp-service').value.trim()||null,p_preferred_at:document.getElementById('pp-date').value||null,p_notes:document.getElementById('pp-notes').value.trim()||null}).then(function(){form.classList.add('partner-hidden');errorBox.classList.add('partner-hidden');success.innerHTML='<b>تم استلام طلبك.</b><br>سيتواصل فريق عيادات سونو معك لتأكيد الموعد أو تعديله.';success.classList.remove('partner-hidden');}).catch(function(e){btn.disabled=false;btn.textContent='إرسال طلب الحجز';showError(e.message||'تعذر إرسال الطلب.');form.classList.remove('partner-hidden');});
  };
})();
