'use strict';
const assert=require('node:assert/strict');
const {oneSpecialty,availableServices,quote}=require('./doctor-insurance-rules');
assert.equal(oneSpecialty({specialty_id:'neuro'}),'neuro');
assert.throws(()=>oneSpecialty({specialty_ids:['neuro','ortho']}),/exactly one/);
assert.throws(()=>oneSpecialty({specialty_ids:[]}),/exactly one/);
assert.deepEqual(availableServices({specialty_id:'neuro'},[
 {id:'a',specialty_id:'neuro',active:true},{id:'b',specialty_id:'ortho',active:true},
 {id:'c',specialty_id:'neuro',active:false}
]).map(s=>s.id),['a']);
assert.deepEqual(quote({servicePrice:300,discountPercent:20,copayPercent:10}),
 {before:300,discount:60,after:240,copay:24,insurerNet:216});
assert.deepEqual(quote({servicePrice:100,discountPercent:0,copayPercent:0}),
 {before:100,discount:0,after:100,copay:0,insurerNet:100});
assert.throws(()=>quote({servicePrice:-1}),/Invalid monetary/);
assert.throws(()=>quote({servicePrice:100,discountPercent:101}),/Invalid percentage/);
const {validateService,gradeTariff,invoice}=require('./doctor-insurance-rules');
assert.equal(validateService({specialty_id:'neuro'},{id:'c',specialty_id:'neuro',active:true}),true);
assert.throws(()=>validateService({specialty_id:'neuro'},{id:'x',specialty_id:'ortho'}),/not eligible/);
assert.throws(()=>oneSpecialty({specialty_id:'neuro',specialty_ids:['ortho']}),/conflict/);
assert.equal(gradeTariff({specialty_id:'neuro',grade:'consultant'},[
  {specialty_id:'neuro',grade:'consultant',price:1000,approved:true,active:true}
]).price,1000);
assert.throws(()=>gradeTariff({specialty_id:'neuro',grade:'consultant'},[
  {specialty_id:'neuro',grade:'consultant',price:1000,approved:false,active:true}
]),/approved grade tariff/);
const bill=invoice({id:'consult',price:300},[
  {id:'med1',type:'medicine',price:50,quantity:2},
  {id:'supply1',type:'supply',price:20}
],{discountPercent:20,copayPercent:10,supplyCopayPercent:0});
assert.equal(bill.lines.length,3);
assert.deepEqual(bill.totals,{before:420,discount:60,after:360,copay:24,insurerNet:336});
assert.equal(bill.lines[1].discount,0);
const dflt=invoice({id:'consult',price:300},[{id:'med1',type:'medicine',price:50,quantity:2}],{discountPercent:20,copayPercent:10});
assert.equal(dflt.lines[1].copay,100);assert.equal(dflt.lines[1].insurerNet,0); // medicines: patient pays 100% by default

assert.throws(()=>invoice({id:'consult',price:300},[{id:'other',type:'service',price:50}]),/Invalid linked/);
assert.throws(()=>invoice({id:'consult',price:300},[{id:'m',type:'medicine',price:50,quantity:-1}]),/quantity/);
assert.deepEqual(quote({servicePrice:0.1+0.2}),{before:0.3,discount:0,after:0.3,copay:0,insurerNet:0.3});
console.log('18 isolated doctor/insurance contract assertions passed');
