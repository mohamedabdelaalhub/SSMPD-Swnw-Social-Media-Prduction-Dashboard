'use strict';
const assert=require('node:assert/strict');
global.window=global;require('../assets/js/reception-service-orders.js');
const P=window.SSMPDReceptionServiceOrders._pure;
const cat={providers:[{id:'p1',name:'Lab A',kind:'lab'},{id:'p2',name:'Rad B',kind:'radiology'}],
 performers:[{service_id:'s1',doctor_key:'drA'}],referral_rates:[{doctor_key:'dr9',category:'consult',percent:10}]};
const docs=[{doctor_key:'drA',name:'A'},{doctor_key:'dr9',name:'N'},{doctor_key:'drX',name:'X'}];
assert.deepEqual(P.providersFor(cat,'lab').map(p=>p.id),['p1']);
assert.deepEqual(P.performersFor(cat,'s1',docs).map(d=>d.doctor_key),['drA']);       // allow-list restricts
assert.equal(P.performersFor(cat,'s2',docs).length,3);                                 // open service
assert.deepEqual(P.referrers(cat,docs).map(d=>d.doctor_key),['dr9']);                  // only doctors with a rate
assert.deepEqual(P.nextStatuses('referred'),['scheduled','cancelled']);
assert.deepEqual(P.nextStatuses('done'),[]);
assert.equal(P.needsBillingParty('radiology','external'),true);
assert.equal(P.needsBillingParty('lab','external'),false);
assert.deepEqual(P.buildExt({kind:'service',category:'followup',referring_doctor_key:'dr9'}),
 {kind:'service',mode:'internal',billing_party:'center',referring_doctor_key:'dr9',performing_doctor_key:'',category:'followup'});
assert.deepEqual(P.buildExt({kind:'radiology',mode:'external',provider_id:'p2',billing_party:'provider'}).billing_party,'provider');
assert.equal(P.buildExt({kind:'lab',mode:'external',provider_id:'p1',billing_party:'provider'}).billing_party,'center');
assert.throws(()=>P.buildExt({kind:'service',mode:'external',provider_id:'p1'}),/للمعمل والأشعة/);
assert.throws(()=>P.buildExt({kind:'lab',mode:'external'}),/اختر المزوّد/);
const html=P.boardTable([{order_id:'o1',patient_name:'<b>Mona</b>',phone:'0100',service:'CBC',provider:'Lab A',status:'done'},
 {order_id:'o2',patient_name:'Ali',phone:'0101',service:'US',provider:'Rad B',status:'referred'}]);
assert.ok(!html.includes('<b>Mona'));assert.ok(html.includes('&lt;b&gt;Mona'));                 // escaped
assert.ok(html.includes('data-so-report="o1"'));assert.ok(html.includes('data-so-status="scheduled"'));
assert.ok(!/price|سعر|عمولة/.test(html));                                                          // no money on the board
assert.ok(P.boardTable([]).includes('لا توجد'));
console.log('reception-service-orders tests passed');
