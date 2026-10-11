(function(){
 'use strict';
 function allowed(){var a=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;return !!a&&(a.role==='super_admin'||(a.roles||[]).includes('super_admin'));}
 function mount(slot){
  if(!allowed()||slot.querySelector('[data-design-budget]'))return;
  var box=document.createElement('details');box.dataset.designBudget='';box.style.marginTop='12px';
  box.innerHTML='<summary>ميزانية توليد التصميمات</summary><p>ميزانية شهرية للفريق بالدولار. صفر يوقف التوليد. الاستخدام تقديري ويشمل المحاولات الفاشلة، ولا يعرض رصيد حساب التوليد.</p><label>الميزانية الشهرية بالدولار<input data-budget-limit type="number" min="0" max="100000" step="0.01" dir="ltr" disabled></label><p data-budget-usage></p><p>بعد تغيير الرقم اضغط حفظ الميزانية.</p><button type="button" class="btn sm" data-budget-save disabled>حفظ الميزانية</button><p role="status" data-budget-status></p>';
  slot.appendChild(box);var input=box.querySelector('[data-budget-limit]'),save=box.querySelector('[data-budget-save]'),status=box.querySelector('[data-budget-status]'),loaded=false;
  function display(data){input.value=data.limit_usd;box.querySelector('[data-budget-usage]').textContent='المحجوز هذا الشهر '+Number(data.reserved_usd).toFixed(2)+' دولار — المتبقي '+Number(data.remaining_usd).toFixed(2)+' دولار';}
  async function rpc(name,args){var r=await window.SSMPDDb.client.rpc(name,args);if(r.error)throw r.error;return r.data;}
  box.addEventListener('toggle',async function(){if(!box.open||loaded)return;status.textContent='جاري تحميل الميزانية…';try{display(await rpc('get_design_monthly_budget'));loaded=true;input.disabled=false;save.disabled=false;status.textContent='الميزانية المحفوظة '+Number(input.value).toFixed(2)+' دولار شهريًا.';}catch(e){status.textContent='تعذر تحميل الميزانية. تأكد من تشغيل ملف تفعيل الميزانية في Supabase.';}});
  save.onclick=async function(){var value=input.value.trim(),amount=Number(value);if(!value||!Number.isFinite(amount)||amount<0||amount>100000||Math.abs(amount*100-Math.round(amount*100))>1e-7){status.textContent='اكتب قيمة من صفر إلى 100000 وبحد أقصى رقمين بعد العلامة.';return;}save.disabled=true;input.disabled=true;try{display(await rpc('set_design_monthly_budget',{p_limit_usd:amount}));var confirmed=await rpc('get_design_monthly_budget');display(confirmed);if(Number(confirmed.limit_usd)!==amount)throw new Error('القيمة المحفوظة على الحساب تختلف. أعد تحميل الميزانية.');status.textContent='الميزانية المحفوظة على الحساب '+Number(confirmed.limit_usd).toFixed(2)+' دولار شهريًا.';}catch(e){status.textContent=e.message||'تعذر حفظ الميزانية';}finally{save.disabled=false;input.disabled=false;}};
 }
 window.SSMPDDesignBudget={mount:mount};
})();

