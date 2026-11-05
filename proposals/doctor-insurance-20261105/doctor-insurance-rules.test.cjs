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
console.log('8 isolated doctor/insurance contract assertions passed');
