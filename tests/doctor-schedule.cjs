const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');const context={window:{}};vm.runInNewContext(fs.readFileSync('assets/js/doctor-schedule.js','utf8'),context);const D=context.window.SSMPDDoctorSchedule;
for(let n=1;n<=7;n++){const rows=D.days.slice(0,n).map((days,i)=>({days,time_from:String(15+i).padStart(2,'0')+':00',time_to:'23:00'}));const r=D.normalise(rows,'different');assert.equal(r.rows.length,n);assert.equal(r.issues.length,0);assert.equal(r.variant,n===1?1:12-n);}
for(let n=1;n<=7;n++){const r=D.normalise([{days:D.days.slice(0,n).join(' - '),time_from:'17:00',time_to:'19:00'}],'shared');assert.equal(r.rows.length,n);assert.equal(r.variant,n>4?4:Math.max(1,n-1));assert.equal(r.issues.length,0);}
let r=D.normalise([{days:'',time_from:'17:00',time_to:'00:00'}],'except',['الأحد','الأربعاء']);assert.equal(r.rows.length,5);assert.equal(r.variant,4);assert.equal(r.issues.length,0);assert(!r.days.includes('الأحد'));
r=D.normalise([{days:'',time_from:'17:00',time_to:'00:00'}],'except',[]);assert.equal(r.rows.length,7);assert.equal(r.issues.length,0);
assert(D.normalise([{days:'الأحد',time_from:'17:00',time_to:'19:00'},{days:'الأحد',time_from:'20:00',time_to:'22:00'}],'different').issues.some(x=>x.includes('مكرر')));
assert(D.normalise([{days:'الأحد',time_from:'17:00',time_to:''}],'different').issues.length);
assert.equal(D.normalise([{days:'الأحد',time_from:'17:00',time_to:'19:00'},{days:'الأربعاء',time_from:'17:00',time_to:'19:00'}]).mode,'different');
console.log('PASS: all 1–7 day mappings, shared times, exceptions, midnight, duplicate and incomplete days.');
