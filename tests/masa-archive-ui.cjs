// أرشيف ماسا: القسم في الاستقبال، البحث، فتح الملف، النوافذ (RPC مموّه)
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const src=fs.readFileSync(__dirname+'/../assets/js/masa-archive.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
const results=[{source:'current',masa_patient_id:'P1',name:'أحمد محمد علي',phone:'01012345678',age:34,insurance_name:'تأمين مصر',is_blocked:false,is_deleted:false,dashboard_patient:{id:'dp1',patient_code:'P-2026-000001'}},{source:'old',masa_patient_id:'P2',name:'محمد أحمد علي',phone:'01119876543',age:null,is_blocked:true,is_deleted:true,dashboard_patient:null}];
const opened={ok:true,patient:{source:'current',masa_patient_id:'P1',name:'أحمد محمد علي',phone:'01012345678',phone2:'0122',age:34,birth_date:'1992-03-14',birth_date_flag:true,address:'حدائق الأهرام',job:'مهندس',insurance_name:'تأمين مصر',insurance_no:'4471920',relative_name:'منى',relative_phone:'0100',membership_no:'M-1',is_blocked:false,is_deleted:false,dashboard_patient:{id:'dp1',patient_code:'P-2026-000001'}},
 bookings:Array.from({length:8},(_,i)=>({official_booking_id:i,date:'2026-11-'+(20-i),time:'10:30',doctor_id:14,service:'كشف',state:i%2?'عدم حضور':'حضور'})),
 invoices:[{id:1,invoice_no:'INV-1',date:'2026-11-12',doctor_id:14,net:1500,discount:150,paid:1350,remaining:0,is_paid:true,deleted:false},{id:2,invoice_no:'INV-2',date:'2026-10-28',doctor_id:14,net:1250,discount:0,paid:0,remaining:1250,deleted:false}],
 receipts:[{id:1,receipt_no:'R-1',date:'2026-11-12',amount:1350,deleted:false,methods:['نقدي']}],same_phone_other_name:2,booking_states:{'حضور':4,'عدم حضور':4}};
(async()=>{const dom=new JSDOM('<div id="h"></div>',{url:'https://t.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,calls=[];
 let gotoTab=null,openedPatient=null;
 w.SSMPDRoles={hasAnyRole:(a,r)=>r.includes(a.role)};w.SSMPDAuth={currentAdmin:{role:'reception'}};
 w.SSMPDGotoTab=t=>{gotoTab=t;};w.SSMPDRenderPatients={openPatientById:id=>{openedPatient=id;}};
 w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a.p]);return Promise.resolve({data:a.p.action==='search'?{ok:true,results}:opened});}}};
 w.SSMPDReceptionModules={sections:()=>[['packages','x','y']],panel:s=>'base-'+s,act(){},bookingWire(){}};
 w.eval(src);
 const M=w.SSMPDReceptionModules;
 let rows=M.sections({data:{workspace:{mode:'live'}}});assert.ok(rows.some(r=>r[0]==='masa-archive'&&r[1]==='أرشيف ماسا'),'section added for reception');
 assert.ok(!M.sections({data:{workspace:{mode:'trial'}}}).some(r=>r[0]==='masa-archive'),'hidden in trial');
 w.SSMPDAuth.currentAdmin={role:'nursing'};assert.ok(!M.sections({data:{workspace:{mode:'live'}}}).some(r=>r[0]==='masa-archive'),'hidden for non allowed roles');
 w.SSMPDAuth.currentAdmin={role:'customer_service'};assert.ok(M.sections({data:{workspace:{mode:'live'}}}).some(r=>r[0]==='masa-archive'));
 assert.equal(M.panel('packages'),'base-packages');
 d.getElementById('h').innerHTML=M.panel('masa-archive');await tick();
 assert.ok(d.querySelector('[data-ma-form]'),'search form');
 d.querySelector('[name=q]').value='0101234';d.querySelector('[data-ma-src="old"]').click();
 d.querySelector('[data-ma-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(JSON.stringify(calls[0]),JSON.stringify(['masa_archive_lookup',{action:'search',q:'0101234',source:'old'}]));
 assert.equal(d.querySelectorAll('.ma-rc').length,2);assert.ok(d.body.textContent.includes('ماسا الجديد')&&d.body.textContent.includes('الفرع القديم')&&d.body.textContent.includes('موقوف')&&d.body.textContent.includes('ليه ملف في الداشبورد'));
 d.querySelector('[data-ma-open="0"]').click();await tick();
 assert.equal(JSON.stringify(calls[1]),JSON.stringify(['masa_archive_lookup',{action:'open',source:'current',masa_patient_id:'P1'}]));
 assert.ok(d.querySelector('.ma.is-open'));assert.ok(d.body.textContent.includes('حجوزات على نفس الرقم باسم تاني'));assert.ok(d.body.textContent.includes('طبيب #14'));assert.ok(d.body.textContent.includes('تاريخ الميلاد غير مؤكد'));
 assert.equal(d.querySelectorAll('.ma-tl .ma-ev').length,6,'6 bookings shown, rest in popup');
 d.querySelector('[data-ma-pop="bk"]').click();assert.equal(d.querySelectorAll('.ma-modal .ma-ev').length,8);d.querySelector('[data-ma-x]').click();assert.equal(d.querySelector('.ma-modal'),null);
 d.querySelector('[data-ma-dash]').click();assert.equal(gotoTab,'patients');await new Promise(r=>setTimeout(r,450));assert.equal(openedPatient,'dp1');
 d.querySelector('[data-ma-close]').click();assert.ok(!d.querySelector('.ma.is-open'));
 w.SSMPDDb.client.rpc=()=>Promise.resolve({data:null,error:{message:'عدد كبير من الاستعلامات، استنى شوية'}});
 d.querySelector('[data-ma-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.ok(d.querySelector('.ma-err').textContent.includes('استنى شوية'));
 console.log('PASS masa archive UI: section/roles, search, open, popups, dashboard link, error.');w.close();
})().catch(e=>{console.error(e);process.exit(1);});
