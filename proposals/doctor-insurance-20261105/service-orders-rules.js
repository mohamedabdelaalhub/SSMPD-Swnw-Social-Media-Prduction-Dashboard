'use strict';
// Service-orders contract helpers (design/rules, no I/O). Money in cents internally.
// Server RPCs must enforce the same rules; this module is the reference + test oracle.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SWNWServiceOrderRules=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  const KINDS=['service','radiology','lab','medicine','supply'];
  const CATEGORIES=['consult','followup','consultation','radiology','lab','procedure'];
  const DEPT={service:'consult',radiology:'radiology',lab:'lab',medicine:'pharmacy',supply:'pharmacy'};
  const DISCOUNTABLE=new Set(['service','radiology','lab']);
  const STATUS_FLOW={
    referred:['scheduled','cancelled'],
    scheduled:['attended','cancelled','no_show'],
    attended:['done'],
    done:['report_uploaded'],
    report_uploaded:['patient_notified'],
    cancelled:[],no_show:[],patient_notified:[]
  };
  function c(v){
    if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Invalid monetary amount');
    return Math.round((v+Number.EPSILON)*100);
  }
  function pct(v,name){
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)throw Error('Invalid percentage'+(name?': '+name:''));
    return v;
  }
  const m=n=>n/100;
  const rp=(cents,p)=>Math.round(cents*p/100);

  function validateOrder(o){
    if(!o||typeof o!=='object')throw Error('Order required');
    if(!KINDS.includes(o.kind))throw Error('Invalid order kind');
    if(!['internal','external'].includes(o.mode||'internal'))throw Error('Invalid order mode');
    if(!o.service||!o.service.id)throw Error('Order service required');
    if(!['center','provider'].includes(o.billingParty||'center'))throw Error('Invalid billing party');
    const q=o.quantity===undefined?1:o.quantity;
    if(!Number.isInteger(q)||q<=0)throw Error('Invalid quantity');
    if((o.mode||'internal')==='external'&&!(o.provider&&o.provider.id))throw Error('External order requires provider');
    if((o.billingParty||'center')==='provider'&&(o.mode||'internal')!=='external')throw Error('Provider billing requires external order');
    return q;
  }

  // Performing doctor allow-list per service (radiology: EEG one doctor, US for OBGYN/internal...).
  function performerAllowed(service,doctor){
    if(!service||!doctor||!doctor.id)throw Error('Service and doctor required');
    const ids=Array.isArray(service.performer_doctor_ids)?service.performer_doctor_ids.map(String):[];
    const sp=Array.isArray(service.performer_specialty_ids)?service.performer_specialty_ids.map(String):[];
    if(!ids.length&&!sp.length)return true; // open to any (labs, simple services)
    if(ids.includes(String(doctor.id)))return true;
    const ds=Array.isArray(doctor.specialty_ids)?doctor.specialty_ids:(doctor.specialty_id?[doctor.specialty_id]:[]);
    return ds.some(x=>sp.includes(String(x)));
  }
  function assertPerformer(service,doctor){
    if(!performerAllowed(service,doctor))throw Error('Doctor not allowed to perform this service');
    return true;
  }

  // Price one order. Returns amounts in money units; internal arithmetic in cents.
  function priceOrder(o){
    const q=validateOrder(o);
    const mode=o.mode||'internal',bp=o.billingParty||'center';
    const contract=o.contract||{};
    const disc=DISCOUNTABLE.has(o.kind)?pct(contract.discountPercent||0,'discount'):0;
    const gross=c(o.service.price)*q;
    const out={orderId:o.id||null,kind:o.kind,department:DEPT[o.kind],mode,billingParty:bp,quantity:q,
      includedInService:false,billed:true};
    if(o.kind==='medicine'||o.kind==='supply'){
      if(o.service.includedInService===true||o.includedInService===true){
        Object.assign(out,{includedInService:true,billed:false,before:0,discount:0,after:0,patientShare:0,insurerShare:0,
          centerCost:null});
        return Object.assign(out,{referralCommission:0,providerPayable:0,centerReceivable:0});
      }
      const share=contract.medicineSharePercent===undefined?100:pct(contract.medicineSharePercent,'medicineShare');
      const patient=rp(gross,share);
      Object.assign(out,{before:m(gross),discount:0,after:m(gross),patientShare:m(patient),insurerShare:m(gross-patient)});
      return Object.assign(out,{referralCommission:0,providerPayable:0,centerReceivable:0});
    }
    const discount=rp(gross,disc),after=gross-discount;
    const copay=rp(after,pct(contract.copayPercent||0,'copay'));
    Object.assign(out,{before:m(gross),discount:m(discount),after:m(after),patientShare:m(copay),insurerShare:m(after-copay)});
    // referral commission: from NET (after discount), by service category, services only
    let commission=0;
    const rd=o.referringDoctor;
    if(rd&&rd.id){
      const cat=o.service.category;
      if(!CATEGORIES.includes(cat))throw Error('Service category required for referral commission');
      const rate=rd.rates&&rd.rates[cat];
      if(rate!==undefined&&rate!==null)commission=rp(after,pct(rate,'referral rate'));
    }
    out.referralCommission=m(commission);
    // external provider economics
    let payable=0,receivable=0;
    if(mode==='external'){
      const t=o.provider.terms||{};
      if(o.kind==='lab'){
        const cost=t.labCostList&&t.labCostList[o.service.id];
        if(cost===undefined)throw Error('Lab cost price missing for external service');
        payable=c(cost)*q;                       // center pays the lab its cost; patient pays center price list
        if(bp==='provider')throw Error('Lab billed by provider is not supported');
      }else if(o.kind==='radiology'){
        if(bp==='center'){
          if(t.providerSharePercent===undefined)throw Error('Provider share percent missing');
          payable=rp(after,pct(t.providerSharePercent,'providerShare'));
        }else{
          if(t.centerSharePercent===undefined)throw Error('Center share percent missing');
          receivable=rp(after,pct(t.centerSharePercent,'centerShare'));
        }
      }
    }
    out.providerPayable=m(payable);out.centerReceivable=m(receivable);
    return out;
  }

  // One invoice per department; lines serial-numbered; claim owner = billing party.
  function buildInvoices(orders){
    if(!Array.isArray(orders))throw Error('Orders required');
    const priced=orders.map(o=>({o,p:priceOrder(o)}));
    const byDept={},accounting=[];
    for(const {o,p} of priced){
      if(p.billingParty==='provider'){accounting.push(p);continue;}   // hidden from patient invoice, still in accounts
      if(!p.billed){accounting.push(p);continue;}
      (byDept[p.department]=byDept[p.department]||[]).push({o,p});
    }
    const invoices=Object.keys(byDept).sort().map(dept=>{
      const lines=byDept[dept].map(({o,p},i)=>({serial:i+1,serviceId:o.service.id,name:o.service.name||null,
        performingDoctorId:(o.performingDoctor&&o.performingDoctor.id)||null,
        performingSpecialtyId:(o.performingDoctor&&o.performingDoctor.specialty_id)||null,
        before:p.before,discount:p.discount,after:p.after,patientShare:p.patientShare,insurerShare:p.insurerShare}));
      const sum=k=>m(lines.reduce((n,l)=>n+c(l[k]),0));
      return {department:dept,claimServiceType:dept,claimOwner:'center',lines,
        totals:{before:sum('before'),discount:sum('discount'),after:sum('after'),patientShare:sum('patientShare'),insurerShare:sum('insurerShare')}};
    });
    const total=k=>m(priced.reduce((n,x)=>n+c(x.p[k]),0));
    return {invoices,accounting,
      referralCommissionTotal:total('referralCommission'),
      providerPayableTotal:total('providerPayable'),
      centerReceivableTotal:total('centerReceivable')};
  }

  function nextStatus(from,to){
    if(!Object.prototype.hasOwnProperty.call(STATUS_FLOW,from))throw Error('Unknown status');
    if(!STATUS_FLOW[from].includes(to))throw Error('Invalid status transition '+from+' -> '+to);
    return to;
  }
  // Minimum data an external provider may see: name + phone (+ requested service, date, status).
  function providerView(order,patient){
    if(!order||!patient)throw Error('Order and patient required');
    return {orderRef:order.id,patientName:patient.name,phone:patient.phone,
      serviceName:(order.service&&order.service.name)||null,date:order.date||null,status:order.status};
  }
  return Object.freeze({KINDS,CATEGORIES,STATUS_FLOW,performerAllowed,assertPerformer,priceOrder,buildInvoices,nextStatus,providerView});
});
