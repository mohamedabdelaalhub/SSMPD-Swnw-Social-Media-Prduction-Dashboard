const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const services=[
 {id:'s1',code:'C1',name:'كشف أمراض النساء والتوليد',department:'نساء',price:300,minutes:20},
 {id:'s2',code:'C2',name:'متابعة حمل',department:'نساء',price:200,minutes:20},
 {id:'s3',code:'D1',name:'حشو عصب',department:'أسنان',price:500,minutes:30},
 {id:'s4',code:'D2',name:'إزالة جير ٌ',department:'أسنان',price:250,minutes:30},
 {id:'s5',code:'E1',name:'Ultrasound Pelvic',department:'أشعة',price:400,minutes:20},
 {id:'s6',code:'X1',name:'خدمة بلا قسم',department:'',price:100,minutes:10},
 {id:'s7',code:'K1',name:'كشف عام',department:'خدمات الكشف',price:150,minutes:10}];
const providers=[{id:'p5',name:'د. كشف',department:'خدمات الكشف'},{id:'p1',name:'د. منى',department:'نساء'},{id:'p2',name:'د. هالة',department:'نساء'},{id:'p3',name:'د. أحمد',department:'أسنان'},{id:'p4',name:'د. سامي',department:'أشعة'}];
const snap={workspace:{id:'w',mode:'trial'},patients:[{id:'pt',file_no:'1001',name:'سارة أيمن مصطفى'},{id:'pt2',file_no:'1002',name:'ساره محمد جميل'},{id:'pt3',file_no:'1003',name:'نور ياسر'}],services,providers,availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[{kind:'services',name:'خدمة غير جاهزة'}],can_manage:true};
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
let submitted=null;
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async(ws,a,p)=>{submitted={a,p};return {id:'x'};}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));q('[data-guide-skip]').click();
const type=(el,v)=>{el.focus();el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const opts=el=>[...el.closest('.rx-combo').querySelectorAll('li[data-i]')].map(l=>l.textContent);
q('[data-rx-section="appointments"]').click();q('[data-rx-action="book"]').click();
const form=q('.rx-modal form'),pSel=form.elements.patient_id,pIn=pSel.closest('label').querySelector('.rx-combo input');
assert(pIn,'patient search box exists');assert.equal(pSel.required,false,'native select no longer blocks submit');
// focus lists everything, typing narrows, أ/ا and ة/ه are equal
pIn.focus();assert.equal(opts(pIn).length,3);
type(pIn,'ساره');assert.deepEqual(opts(pIn).length,2);
type(pIn,'1003');assert.equal(opts(pIn).length,1);
type(pIn,'zzz');assert(pIn.closest('.rx-combo').textContent.includes('مفيش مريض'));
// required: empty patient is invalid until chosen
pIn.value='';pIn.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(pIn.validity.valid,false);
type(pIn,'نور');pIn.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
assert.equal(pSel.value,'pt3');assert.equal(pIn.validity.valid,true);assert.equal(pIn.value.includes('نور ياسر'),true);
// clear button resets
pSel.closest('label').querySelector('.rx-combo-clear').click();assert.equal(pSel.value,'');
// department combo drives the service filter through the native change event
const dSel=q('[data-rx-dept]'),dIn=dSel.closest('label').querySelector('.rx-combo input');
dIn.focus();assert.equal(dIn.placeholder,'كل الأقسام');type(dIn,'اسنان');assert.equal(opts(dIn).length,1);
dIn.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(dSel.value,'أسنان');
assert.deepEqual([...form.elements.service_id.options].map(o=>o.value).filter(Boolean),['s3','s4']);
// doctor combo follows rebuilt options
const prSel=form.elements.provider_id,prIn=prSel.closest('label').querySelector('.rx-combo input');
await new Promise(r=>setTimeout(r,20));prIn.focus();assert.deepEqual(opts(prIn),['د. أحمد']);
// extra service row gets its own search boxes
q('[data-rx-add-extra]').click();
const xs=q('[data-x-service]'),xIn=xs.closest('label').querySelector('.rx-combo input');
type(xIn,'ultra');assert.equal(opts(xIn).length,1);xIn.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(xs.value,'s5');
assert(q('[data-x-provider]').closest('label').querySelector('.rx-combo input'),'extra doctor search exists');
assert.deepEqual(errors,[]);
console.log('PASS booking selects are searchable: patient, department, doctor, extra service');
})().catch(e=>{console.error(e);process.exit(1);});
