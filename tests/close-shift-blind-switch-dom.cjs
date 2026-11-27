// 20261127020000 (owner 2026-11-26 «نأجل تطبيق العد الأعمى مؤقتا»): reception's real close path «جرد وتسليم الوردية» (finance-advances.js,
// data from clinic_booking_snapshot) shows «المفروض في الدرج (نقدي)» while the blind-count switch is OFF (the server sends expected for
// the cashier's own open shift) and stays exactly as before while it is ON. Rule 9: the button is clicked as the reception cashier.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const d=new JSDOM('<!doctype html><html dir="rtl"><body></body></html>',{runScripts:'outside-only'}),w=d.window,errors=[];w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDFinanceControls={panel:t=>t,act:()=>false,due:()=>0};w.SSMPDDb={bookingCommand:()=>Promise.resolve({})};
w.eval(fs.readFileSync('assets/js/finance-advances.js','utf8'));const act=w.SSMPDFinanceControls.act;
let shown=null;const h={field:(n,l)=>'<label>'+l+'<input name="'+n+'"></label>',select:()=>'',modal:(title,body)=>{shown={title,body};}};
const shift={id:'S1',status:'open',opened_at:'2026-11-27T06:00:00Z',register_name:'خزينة الاستقبال 1'};
// switch ON (or an older server): blind, exactly as before
act('booking-close','S1',{advance_data:{shifts:[shift]}},h);
assert.equal(shown.title,'جرد وتسليم الوردية');assert(shown.body.includes('المتوقع يظهر للمراجع بعد التسليم'));assert(!shown.body.includes('data-fc-expect'),'blind: no expected');
assert.equal((shown.body.match(/name="c/g)||[]).length,9,'9 count inputs');
// switch OFF (trial): the server added expected + blind_off → shown above the counts
act('booking-close','S1',{advance_data:{blind_count:false,shifts:[Object.assign({},shift,{expected:1234.5,opening_book:500,blind_off:true})]}},h);
assert(shown.body.includes('data-fc-expect')&&shown.body.includes('المفروض في الدرج (نقدي): <b>1,234.50 ج.م</b>'),'expected shown while OFF');
assert.equal((shown.body.match(/name="c/g)||[]).length,9);assert(!/[٠-٩]/.test(shown.body),'Latin digits');
assert.deepEqual(errors,[]);console.log('PASS close-shift blind switch UI (reception «جرد وتسليم الوردية»): switch ON/older server → blind as before; OFF → «المفروض في الدرج (نقدي)» above the 9 count inputs.');
