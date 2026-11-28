// «رقم العملية من الصورة» (owner 2026-11-28 «الله عليك. وعايز الكلام دا يتسجل اوتوماتيك بعد كدة في وسايل الدفع دي», mockup
// receipt-ocr.html). Real payment-proof.js in the «تسجيل تحصيل» form shape (method / reference data-auto / patient_file), reception user.
// The OCR engine is replaced by fixed texts (the real one is Tesseract.js in the browser). Proves the order: transaction number
// (RRN first, chips for the others) → wallet VF-<mobile>-<dd-mm> → last resort <letter>-<file no>-<dd-mm>, -2 from
// clinic_reception_reference_free; never overwrites what the employee typed; cash / PDF are not read; unreadable → «اكتبه بإيدك».
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(textFor,taken){
 const html='<form><select name="method"><option value="cash">نقدي</option><option value="pos">فيزا</option><option value="bank">بنك</option><option value="instapay">إنستا باي</option><option value="wallet">محفظة إلكترونية</option></select>'+
  '<input name="reference" data-pay-ref data-auto="1" value="RC-261128-010203-123"><input name="patient_file" value="1234"></form>';
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 w.SSMPDAuth={currentAdmin:{id:'u-rec',role:'reception'}};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a]);if(n==='clinic_reception_reference_free'){let c=a.p_base,k=1;while((taken||[]).includes(c))c=a.p_base+'-'+(++k);return {data:c,error:null};}return {data:null,error:null};}}};
 w.SSMPDBusinessDay={today:()=>'2026-11-27'};
 w.eval(fs.readFileSync('assets/js/payment-proof.js','utf8'));const P=w.SSMPDPaymentProof,form=d.querySelector('form');
 P._ocr=f=>{const t=textFor(f);if(t instanceof Error)throw t;return t;};
 form.insertAdjacentHTML('beforeend',P.field());
 const input=form.elements.proof_file;let store=[];Object.defineProperty(input,'files',{get:()=>store,set:v=>{store=v;},configurable:true});
 Object.defineProperty(input,'value',{get:()=>store.length?'C:\\fakepath\\x':'',set:v=>{if(v==='')store=[];},configurable:true});
 w.DataTransfer=function(){const l=[];this.items={add:f=>l.push(f)};this.files=l;};w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
 P.bind(form);
 const pick=async(name,type)=>{const f=new w.File(['x'],name,{type:type||'image/jpeg'});Object.defineProperty(f,'size',{value:4096});
  const e=new w.Event('drop',{bubbles:true,cancelable:true});e.dataTransfer={files:[f]};form.querySelector('[data-pp-drop]').dispatchEvent(e);await sleep(30);};
 const setMethod=m=>{form.elements.method.value=m;form.elements.method.dispatchEvent(new w.Event('change'));};
 return {w,d,form,P,pick,setMethod,calls,ref:form.elements.reference,read:()=>form.querySelector('[data-pp-read]')};
}
(async()=>{
 // 1) card slip: RRN chosen, chips for Auth / Trace, editable
 let t=boot(()=>'MERCHANT COPY\nTERMINAL 12345678\nRRN: 331207458812\nAUTH CODE: 004512\nTRACE NO 000187\nAMOUNT EGP 400.00');
 t.setMethod('pos');await t.pick('pos-slip.jpg');
 assert.equal(t.ref.value,'331207458812','RRN filled');assert(t.ref.hasAttribute('data-pp-filled'),'highlighted');
 assert.match(t.read().textContent,/اتقرا من الصورة: «RRN 331207458812»/);const chips=[...t.read().querySelectorAll('[data-pp-chip]')].map(b=>b.textContent);
 assert.deepEqual(chips,['RRN 331207458812','Auth 004512','Trace 000187']);
 t.read().querySelector('[data-pp-chip="004512"]').click();assert.equal(t.ref.value,'004512','chip picks another number');
 // 2) Arabic wallet message with a transaction number (Arabic-Indic digits)
 t=boot(()=>'تم تحويل ٤٠٠ جنيه\nرقم العملية: ٠٠١٢٣٤٥٦٧٨٩٠');t.setMethod('wallet');await t.pick('vf.jpg');
 assert.equal(t.ref.value,'001234567890');assert.match(t.read().textContent,/رقم العملية 001234567890/);
 // 3) Vodafone Cash without a transaction number → VF-<mobile>-<dd-mm>; repeated → -2
 t=boot(()=>'تم استلام مبلغ 400 جنيه من 01012345678 بتاريخ 27-11-2026 الساعة 20:14',['VF-01012345678-27-11']);t.setMethod('wallet');await t.pick('vf-sms.jpg');
 assert.equal(t.ref.value,'VF-01012345678-27-11-2','VF + mobile + date, -2 because it exists');
 assert.match(t.read().textContent,/رقم الموبايل اللي حوّل/);assert.match(t.read().textContent,/اتزود -2/);
 assert.deepEqual(JSON.parse(JSON.stringify(t.calls.find(c=>c[0]==='clinic_reception_reference_free')[1])),{p_method:'wallet',p_base:'VF-01012345678-27-11'});
 // 4) InstaPay with neither → IP-<file no>-<dd-mm> (date from the business day when the photo has none)
 t=boot(()=>'InstaPay\nTransfer successful\nEGP 400');t.setMethod('instapay');await t.pick('instapay.png','image/png');
 assert.equal(t.ref.value,'IP-1234-27-11');assert.match(t.read().textContent,/حرف الطريقة \+ رقم ملف المريض \+ التاريخ/);
 // 5) the employee typed first → never overwritten; cash → not read; PDF → not read; unreadable → message
 t=boot(()=>'RRN 999999999999');t.setMethod('pos');t.ref.value='MY-OWN-123';t.ref.dispatchEvent(new t.w.Event('input'));await t.pick('slip.jpg');
 assert.equal(t.ref.value,'MY-OWN-123','typed reference kept');assert(t.read().hidden,'nothing shown');
 t=boot(()=>'RRN 999999999999');await t.pick('cash.jpg');assert.equal(t.ref.value,'RC-261128-010203-123','cash: nothing read');
 t=boot(()=>'RRN 999999999999');t.setMethod('pos');await t.pick('slip.pdf','application/pdf');assert.equal(t.ref.value,'RC-261128-010203-123','PDF: not read');
 t=boot(()=>new Error('blur'));t.setMethod('pos');await t.pick('blurry.jpg');assert.match(t.read().textContent,/مقدرتش أقرا رقم العملية.*اكتبه بإيدك/);assert(t.read().classList.contains('bad'));
 // 6) a fresh photo after an automatic fill replaces it (still automatic); parse helper exported
 t=boot(f=>f.name==='a.jpg'?'RRN 111111111111':'RRN 222222222222');t.setMethod('pos');await t.pick('a.jpg');assert.equal(t.ref.value,'111111111111');await t.pick('b.jpg');assert.equal(t.ref.value,'222222222222');
 assert.deepEqual(JSON.parse(JSON.stringify(t.P.parseReceipt('Ref No. AB12345678 date 2026/11/27').numbers)),[{label:'Reference',value:'AB12345678'}]);
 console.log('PASS receipt OCR: RRN + chips, Arabic «رقم العملية» (Arabic digits), VF-mobile-date (-2 when taken), IP-file-date last resort, typed value kept, cash / PDF not read, unreadable → «اكتبه بإيدك».');
})().catch(e=>{console.error(e);process.exit(1);});
