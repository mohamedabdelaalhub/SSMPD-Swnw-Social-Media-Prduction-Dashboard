'use strict';
// Pure, side-effect-free reference contract for doctor/service eligibility and invoice previews.
// Not an authorization boundary: booking and billing RPCs must revalidate server-side.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SWNWDoctorInsuranceRules=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  function oneSpecialty(doctor){
    if(!doctor||typeof doctor!=='object')throw Error('Doctor required');
    const ids=Array.isArray(doctor.specialty_ids)?doctor.specialty_ids:
      (doctor.specialty_id?[doctor.specialty_id]:[]);
    if(ids.length!==1||!ids[0])throw Error('Doctor must have exactly one specialty');
    return String(ids[0]);
  }
  function availableServices(doctor,services){
    const specialty=oneSpecialty(doctor);
    if(!Array.isArray(services))throw Error('Services required');
    return services.filter(s=>s&&s.active!==false&&String(s.specialty_id||'')===specialty);
  }
  function cents(amount){
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)throw Error('Invalid monetary amount');
    return Math.round((amount+Number.EPSILON)*100);
  }
  function percent(value){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('Invalid percentage');
    return value;
  }
  function quote({servicePrice,discountPercent=0,copayPercent=0}){
    const before=cents(servicePrice),discount=Math.round(before*percent(discountPercent)/100);
    const after=before-discount,copay=Math.round(after*percent(copayPercent)/100);
    return {before:before/100,discount:discount/100,after:after/100,copay:copay/100,insurerNet:(after-copay)/100};
  }
  return Object.freeze({oneSpecialty,availableServices,quote});
});
