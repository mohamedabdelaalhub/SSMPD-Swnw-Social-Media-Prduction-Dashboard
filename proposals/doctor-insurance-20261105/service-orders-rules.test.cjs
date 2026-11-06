'use strict';
const assert=require('node:assert/strict');
const R=require('./service-orders-rules.js');
const throws=(f,re)=>assert.throws(f,re);
const svc=(o={})=>({id:'s1',name:'Consult',price:300,category:'consult',...o});

// accountant example: 300 -> discount 20% -> 240 -> copay 10% -> 24 patient, 216 insurer
let p=R.priceOrder({kind:'service',service:svc(),contract:{discountPercent:20,copayPercent:10}});
assert.deepEqual([p.before,p.discount,p.after,p.patientShare,p.insurerShare],[300,60,240,24,216]);

// medicine: no discount, patient 100% by default; contract share; included => nothing billed
p=R.priceOrder({kind:'medicine',service:{id:'m1',price:50},quantity:2,contract:{discountPercent:20}});
assert.deepEqual([p.before,p.discount,p.patientShare,p.insurerShare,p.referralCommission],[100,0,100,0,0]);
p=R.priceOrder({kind:'medicine',service:{id:'m1',price:50},contract:{medicineSharePercent:25}});
assert.deepEqual([p.patientShare,p.insurerShare],[12.5,37.5]);
p=R.priceOrder({kind:'supply',service:{id:'x',price:40,includedInService:true}});
assert.equal(p.billed,false);assert.equal(p.patientShare,0);

// referral commission on NET, by category, services only; rate absent => 0
const rd={id:'d9',rates:{consult:10,radiology:15,lab:5}};
p=R.priceOrder({kind:'service',service:svc(),referringDoctor:rd,contract:{discountPercent:20}});
assert.equal(p.referralCommission,24);                       // 10% of 240
p=R.priceOrder({kind:'service',service:svc({category:'followup'}),referringDoctor:rd});
assert.equal(p.referralCommission,0);
p=R.priceOrder({kind:'medicine',service:{id:'m',price:100},referringDoctor:rd});
assert.equal(p.referralCommission,0);
throws(()=>R.priceOrder({kind:'service',service:svc({category:'x'}),referringDoctor:rd}),/category/);
throws(()=>R.priceOrder({kind:'service',service:svc(),referringDoctor:{id:'d',rates:{consult:101}}}),/percentage/);

// external lab: patient pays center price list, center pays provider cost
const lab={id:'L1',terms:{labCostList:{l1:40}}};
p=R.priceOrder({kind:'lab',mode:'external',provider:lab,service:{id:'l1',price:100,category:'lab'}});
assert.deepEqual([p.after,p.providerPayable],[100,40]);
throws(()=>R.priceOrder({kind:'lab',mode:'external',provider:lab,service:{id:'zz',price:1,category:'lab'}}),/cost price/);
throws(()=>R.priceOrder({kind:'lab',mode:'external',service:{id:'l1',price:1,category:'lab'}}),/requires provider/);

// external radiology: center bills -> provider share % of net; provider bills -> center receivable, hidden from invoice
const rad={id:'R1',terms:{providerSharePercent:70,centerSharePercent:30}};
const radSvc={id:'r1',price:200,category:'radiology'};
p=R.priceOrder({kind:'radiology',mode:'external',provider:rad,service:radSvc,contract:{discountPercent:10}});
assert.deepEqual([p.after,p.providerPayable,p.centerReceivable],[180,126,0]);
p=R.priceOrder({kind:'radiology',mode:'external',billingParty:'provider',provider:rad,service:radSvc});
assert.deepEqual([p.providerPayable,p.centerReceivable],[0,60]);
throws(()=>R.priceOrder({kind:'radiology',billingParty:'provider',service:radSvc}),/Provider billing/);

// one invoice per department with serial lines; provider-billed + included lines go to accounting only
const inv=R.buildInvoices([
  {id:'a',kind:'service',service:svc(),contract:{discountPercent:20,copayPercent:10},referringDoctor:rd},
  {id:'b',kind:'service',service:svc({id:'s2',price:100}),contract:{}},
  {id:'c',kind:'radiology',service:radSvc,performingDoctor:{id:'p1',specialty_id:'obgyn'}},
  {id:'d',kind:'radiology',mode:'external',billingParty:'provider',provider:rad,service:radSvc},
  {id:'e',kind:'medicine',service:{id:'m',price:30}},
  {id:'f',kind:'supply',service:{id:'x',price:5,includedInService:true}}
]);
assert.deepEqual(inv.invoices.map(i=>i.department),['consult','pharmacy','radiology']);
const consult=inv.invoices[0];
assert.deepEqual(consult.lines.map(l=>l.serial),[1,2]);
assert.deepEqual([consult.totals.before,consult.totals.after,consult.totals.patientShare,consult.totals.insurerShare],[400,340,24,316]);
assert.equal(inv.invoices[2].lines[0].performingSpecialtyId,'obgyn');
assert.equal(inv.invoices[2].claimServiceType,'radiology');
assert.equal(inv.accounting.length,2);
assert.equal(inv.centerReceivableTotal,60);
assert.equal(inv.referralCommissionTotal,24);

// performer allow-list
const eeg={id:'eeg',performer_doctor_ids:['dr1']};
assert.equal(R.performerAllowed(eeg,{id:'dr1'}),true);
assert.equal(R.performerAllowed(eeg,{id:'dr2'}),false);
const us={id:'us',performer_specialty_ids:['obgyn','internal']};
assert.equal(R.performerAllowed(us,{id:'x',specialty_id:'obgyn'}),true);
assert.equal(R.performerAllowed(us,{id:'y',specialty_id:'ent'}),false);
assert.equal(R.performerAllowed({id:'lab'},{id:'any'}),true);
throws(()=>R.assertPerformer(eeg,{id:'dr2'}),/not allowed/);

// status machine
assert.equal(R.nextStatus('referred','scheduled'),'scheduled');
throws(()=>R.nextStatus('referred','done'),/Invalid status/);
throws(()=>R.nextStatus('cancelled','scheduled'),/Invalid status/);
throws(()=>R.nextStatus('nope','done'),/Unknown/);

// provider sees minimum data only
const v=R.providerView({id:'o1',service:{name:'CBC'},date:'2026-11-07',status:'referred',price:99,referringDoctor:rd},
  {name:'Mona',phone:'0100',national_id:'123',insurance_no:'9'});
assert.deepEqual(Object.keys(v).sort(),['date','orderRef','patientName','phone','serviceName','status']);

// invalid inputs
throws(()=>R.priceOrder({kind:'bogus',service:svc()}),/kind/);
throws(()=>R.priceOrder({kind:'service',service:svc({price:-1})}),/monetary/);
throws(()=>R.priceOrder({kind:'service',service:svc(),quantity:0}),/quantity/);
console.log('service-orders-rules tests passed');
