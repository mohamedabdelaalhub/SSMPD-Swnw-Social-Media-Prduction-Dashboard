'use strict';
// Isolated contract helpers. Server booking/invoice RPCs must enforce these rules.
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
    if(doctor.specialty_id&&String(doctor.specialty_id)!==String(ids[0]))throw Error('Doctor specialty conflict');
    return String(ids[0]);
  }
  function availableServices(doctor,services){
    const specialty=oneSpecialty(doctor);
    if(!Array.isArray(services))throw Error('Services required');
    return services.filter(s=>s&&s.active!==false&&String(s.specialty_id||'')===specialty);
  }
  function validateService(doctor,service){
    if(!service||service.active===false||String(service.specialty_id||'')!==oneSpecialty(doctor))
      throw Error('Service not eligible for doctor specialty');
    return true;
  }
  function cents(amount){
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)throw Error('Invalid monetary amount');
    return Math.round((amount+Number.EPSILON)*100);
  }
  function percent(value){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('Invalid percentage');
    return value;
  }
  function money(n){return n/100;}
  function quote({servicePrice,discountPercent=0,copayPercent=0}){
    const before=cents(servicePrice),discount=Math.round(before*percent(discountPercent)/100);
    const after=before-discount,copay=Math.round(after*percent(copayPercent)/100);
    return {before:money(before),discount:money(discount),after:money(after),copay:money(copay),insurerNet:money(after-copay)};
  }
  function gradeTariff(doctor,tariffs){
    const specialty=oneSpecialty(doctor);
    const grade=String(doctor.grade||'').trim();
    if(!grade||!Array.isArray(tariffs))throw Error('Doctor grade and tariffs required');
    const matches=tariffs.filter(t=>t&&t.active===true&&t.approved===true&&
      String(t.specialty_id)===specialty&&String(t.grade)===grade);
    if(matches.length!==1)throw Error('Exactly one approved grade tariff required');
    cents(matches[0].price);
    return matches[0];
  }
  function invoice(service,items,{discountPercent=0,copayPercent=0,supplyCopayPercent=100}={}){
    if(!service||!service.id)throw Error('One service required per invoice');
    if(!Array.isArray(items))throw Error('Invoice items required');
    const serviceQuote=quote({servicePrice:service.price,discountPercent,copayPercent});
    const lines=[{type:'service',id:service.id,...serviceQuote}];
    for(const item of items){
      if(!item||!['medicine','supply'].includes(item.type)||!item.id)throw Error('Invalid linked invoice item');
      const count=item.quantity===undefined?1:item.quantity;
      if(!Number.isInteger(count)||count<=0)throw Error('Invalid item quantity');
      const amount=money(cents(item.price)*count);
      lines.push({type:item.type,id:item.id,quantity:count,...quote({servicePrice:amount,copayPercent:supplyCopayPercent})});
    }
    const sum=k=>money(lines.reduce((n,line)=>n+cents(line[k]),0));
    return {serviceId:service.id,lines,totals:{
      before:sum('before'),discount:sum('discount'),after:sum('after'),
      copay:sum('copay'),insurerNet:sum('insurerNet')}};
  }
  return Object.freeze({oneSpecialty,availableServices,validateService,gradeTariff,quote,invoice});
});
