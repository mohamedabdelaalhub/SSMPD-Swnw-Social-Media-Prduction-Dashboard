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
assert.ok(html.includes('data-so-upload="o1"'));assert.ok(html.includes('type="file"'));assert.ok(!html.includes('data-so-open="o1"'));assert.ok(html.includes('data-so-status="scheduled"'));
assert.ok(!/price|سعر|عمولة/.test(html));                                                          // no money on the board
assert.ok(P.boardTable([]).includes('لا توجد'));
console.log('reception-service-orders tests passed');

// ---- setup screens ----
const B=window.SSMPDReceptionServiceOrders._pure;
assert.deepEqual(B.buildSetup('service_specialty',{service_id:'s',specialty_id:' neuro '}),{op:'add',service_id:'s',specialty_id:'neuro'});
assert.throws(()=>B.buildSetup('service_specialty',{service_id:'s',specialty_id:' '}),/اختر/);
assert.deepEqual(B.buildSetup('performer',{service_id:'s',doctor_key:'drA'}),{op:'add',service_id:'s',doctor_key:'drA'});
assert.deepEqual(B.buildSetup('performer',{service_id:'s',specialty_id:'obgyn'}),{op:'add',service_id:'s',specialty_id:'obgyn'});
assert.throws(()=>B.buildSetup('performer',{service_id:'s',doctor_key:'drA',specialty_id:'x'}),/واحد فقط/);
assert.throws(()=>B.buildSetup('performer',{service_id:'s'}),/واحد فقط/);
assert.deepEqual(B.buildSetup('referral_rate',{doctor_key:'d',category:'lab',percent:'7.5',valid_from:'2026-01-01'}),{op:'set',doctor_key:'d',category:'lab',percent:7.5,valid_from:'2026-01-01'});
assert.throws(()=>B.buildSetup('referral_rate',{doctor_key:'d',category:'lab',percent:'101'}),/النسبة/);
assert.throws(()=>B.buildSetup('referral_rate',{doctor_key:'d',category:'lab',percent:''}),/النسبة/);
assert.throws(()=>B.buildSetup('referral_rate',{doctor_key:'',category:'lab',percent:'5'}),/اختر/);
assert.deepEqual(B.buildSetup('provider',{name:'Rad',kind:'radiology',phone:'1',providerSharePercent:'70',centerSharePercent:'30'}).terms,{providerSharePercent:70,centerSharePercent:30});
assert.deepEqual(B.buildSetup('provider',{name:'Lab',kind:'lab',providerSharePercent:'70'}).terms,{});          // labs carry no percent terms
assert.throws(()=>B.buildSetup('provider',{name:'Rad',kind:'radiology',providerSharePercent:'170'}),/نسبة المزوّد/);
assert.throws(()=>B.buildSetup('provider',{name:' ',kind:'lab'}),/اسم/);
assert.equal(B.buildSetup('provider',{id:'p',name:'L',kind:'lab',active:'0'}).active,false);
assert.deepEqual(B.buildSetup('cost',{provider_id:'p',service_id:'s',year:'2026',cost:'40'}),{op:'set',provider_id:'p',service_id:'s',year:2026,cost:40});
assert.throws(()=>B.buildSetup('cost',{provider_id:'p',service_id:'s',year:'2026',cost:'-1'}),/التكلفة/);
assert.throws(()=>B.buildSetup('cost',{provider_id:'p',service_id:'s',year:'1999',cost:'1'}),/السنة/);
assert.throws(()=>B.buildSetup('bogus',{}),/غير معروف/);
const S0={services:[{id:'s1',name:'<i>X</i>'}],doctors:[{doctor_key:'d1',name:'Dr'}],service_specialties:[{service_id:'s1',specialty_id:'neuro'}],
 performers:[{service_id:'s1',doctor_key:'d1'}],referral_rates:[{id:'r1',doctor_key:'d1',category:'lab',percent:5,valid_from:'2026-01-01',valid_to:null}],
 providers:[{id:'p1',name:'Lab',kind:'lab',phone:'1',terms:{},active:true},{id:'p2',name:'Rad',kind:'radiology',phone:'2',terms:{providerSharePercent:70},active:false}],
 costs:[{provider_id:'p1',service_id:'s1',year:2026,cost:40}]};
for(const t of ['spec','perf','rate','prov','cost']){const h=B.setupTab(t,S0);assert.ok(h.includes('data-so-form')||t==='x');assert.ok(!h.includes('<i>X</i>'));}
assert.ok(B.setupTab('rate',S0).includes('مستمرة'));
assert.ok(B.setupTab('prov',S0).includes('تفعيل'));
console.log('setup screen tests passed');

// ---- report upload ----
assert.equal(B.validateReportFile({type:'application/pdf',size:1000}),true);
assert.throws(()=>B.validateReportFile({type:'application/x-msdownload',size:1000}),/PDF/);
assert.throws(()=>B.validateReportFile({type:'application/pdf',size:0}),/حجم/);
assert.throws(()=>B.validateReportFile({type:'application/pdf',size:20971521}),/حجم/);
assert.throws(()=>B.validateReportFile(null),/PDF/);
assert.equal(B.safeFileName('تقرير الدم 2026.pdf','application/pdf'),'2026.pdf');
assert.equal(B.safeFileName('../../etc/passwd','application/pdf'),'etc-passwd.pdf');
assert.equal(B.safeFileName('a..b.png','image/png'),'a.b.png');
assert.equal(B.safeFileName('!!!','image/jpeg'),'report.jpg');
assert.equal(B.safeFileName('x'.repeat(200)+'.pdf','application/pdf').length<=80,true);
const WS='00000000-0000-0000-0000-000000000000',OR='00000000-0000-0000-0000-000000000001';
const pth=B.reportPath(WS,OR,'CBC result.pdf','application/pdf','abcd1234');
assert.equal(pth,WS+'/'+OR+'/abcd1234-CBC-result.pdf');
assert.ok(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(pth)&&!pth.includes('..'));       // matches the server path rule
const open=B.boardTable([{order_id:'o3',patient_name:'N',phone:'1',service:'S',provider:'P',status:'report_uploaded'}]);
assert.ok(open.includes('data-so-open="o3"')&&!open.includes('data-so-upload'));
console.log('report upload tests passed');
