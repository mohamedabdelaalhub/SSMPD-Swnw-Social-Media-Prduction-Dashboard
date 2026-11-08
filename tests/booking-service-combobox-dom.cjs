const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const services=[
 {id:'s1',code:'C1',name:'كشف أمراض النساء والتوليد',department:'نساء',price:300,minutes:20},
 {id:'s2',code:'C2',name:'متابعة حمل',department:'نساء',price:200,minutes:20},
 {id:'s3',code:'D1',name:'حشو عصب',department:'أسنان',price:500,minutes:30},
 {id:'s4',code:'D2',name:'إزالة جير ٌ',department:'أسنان',price:250,minutes:30},
 {id:'s5',code:'E1',name:'Ultrasound Pelvic',department:'أشعة',price:400,minutes:20},
 {id:'s6',code:'X1',name:'خدمة بلا قسم',department:'',price:100,minutes:10}];
const providers=[{id:'p1',name:'د. منى',department:'نساء'},{id:'p2',name:'د. هالة',department:'نساء'},{id:'p3',name:'د. أحمد',department:'أسنان'},{id:'p4',name:'د. سامي',department:'أشعة'}];
const snap={workspace:{id:'w',mode:'trial'},patients:[{id:'pt',file_no:'1',name:'مريض'}],services,providers,availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[{kind:'services',name:'خدمة غير جاهزة'}],can_manage:true};
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
let submitted=null;
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async(ws,a,p)=>{submitted={a,p};return {id:'x'};}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
const type=(s,v)=>{const e=q(s);e.focus();e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}));};
const key=(k)=>q('#rx-svc-q').dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
const opts=()=>qa('#rx-svc-list [role=option]').map(o=>o.firstChild.textContent);
const natives=()=>[...q('[name=service_id]').options].filter(o=>o.value).map(o=>o.value);
const provs=()=>[...q('[name=provider_id]').options].filter(o=>o.value).map(o=>o.text);
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));q('[data-guide-skip]').click();
q('[data-rx-section="appointments"]').click();q('[data-rx-action="book"]').click();
// baseline: all departments, native select keeps every service, no providers until a service is picked
assert(q('.rx-modal [data-rx-dept]'));assert(q('[name=service_id]').classList.contains('rx-combo-native'));assert.deepEqual(natives(),['s1','s2','s3','s4','s5','s6']);assert.deepEqual(provs(),[]);
assert.equal(q('#rx-svc-q').getAttribute('role'),'combobox');assert.equal(q('#rx-svc-list').hidden,true);
// 1 letter: hint only; 2 letters: matches
type('#rx-svc-q','ن');assert.equal(opts().length,0);assert(q('#rx-svc-list').textContent.includes('حرفين'));
// Arabic variants: alef forms, ya/alef-maqsura, ta-marbuta/ha, tashkeel, extra spaces
type('#rx-svc-q','  امراض   النِّسَاء ');assert.deepEqual(opts(),['كشف أمراض النساء والتوليد']);
type('#rx-svc-q','آمراض');assert.deepEqual(opts(),['كشف أمراض النساء والتوليد']);type('#rx-svc-q','عصب');assert.deepEqual(opts(),['حشو عصب']);
type('#rx-svc-q','ازاله');assert.deepEqual(opts(),['إزالة جير ٌ']);
type('#rx-svc-q','متابعه حمل');assert.deepEqual(opts(),['متابعة حمل']);
type('#rx-svc-q','ULTRA');assert.deepEqual(opts(),['Ultrasound Pelvic']);type('#rx-svc-q','pelvic ultra');assert.deepEqual(opts(),['Ultrasound Pelvic']);
type('#rx-svc-q','zzzz');assert(q('#rx-svc-list').textContent.includes('لا توجد'));
// price shown next to name; unavailable services listed but not selectable
type('#rx-svc-q','حشو');assert(q('#rx-svc-list').textContent.includes('500'));
type('#rx-svc-q','غير جاهزة');assert.equal(qa('#rx-svc-list [aria-disabled=true]').length,1);key('Enter');assert.equal(q('[name=service_id]').value,'');
// ranking: prefix beats contains
type('#rx-svc-q','خدمة');assert.equal(opts()[0],'خدمة بلا قسم');
// keyboard pick: ArrowDown + Enter
type('#rx-svc-q','حمل');key('ArrowDown');assert.equal(q('#rx-svc-q').getAttribute('aria-activedescendant'),'rx-svc-o0');key('Enter');
assert.equal(q('[name=service_id]').value,'s2');assert.equal(q('#rx-svc-q').value,'متابعة حمل — 200.00 ج.م');assert.equal(q('#rx-svc-list').hidden,true);
assert.deepEqual(provs(),['د. منى','د. هالة']); // today's behaviour: doctors of the service's department
// editing the text drops the selection (no stale service)
type('#rx-svc-q','متابعة حم');assert.equal(q('[name=service_id]').value,'');assert.deepEqual(provs(),[]);assert.equal(q('#rx-svc-q').validity.valid,false);
// mouse pick, then clear button
type('#rx-svc-q','جير');q('#rx-svc-list [data-i="0"]').dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));assert.equal(q('[name=service_id]').value,'s4');assert.equal(q('#rx-svc-q').validity.valid,true);
q('.rx-combo-clear').click();assert.equal(q('[name=service_id]').value,'');assert.equal(q('#rx-svc-q').value,'');assert.equal(q('.rx-combo-clear').hidden,true);
// Escape closes the list only; second Escape closes the modal
type('#rx-svc-q','حشو');assert.equal(q('#rx-svc-list').hidden,false);key('Escape');assert(q('.rx-modal'));assert.equal(q('#rx-svc-list').hidden,true);
q('#rx-svc-q').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(q('.rx-modal'),null);
// department filter
q('[data-rx-action="book"]').click();
const deptOpts=[...q('[data-rx-dept]').options].map(o=>o.value);assert.deepEqual(deptOpts,['','أسنان','أشعة','نساء','__none__']);
const dept=v=>{q('[data-rx-dept]').value=v;q('[data-rx-dept]').dispatchEvent(new w.Event('change',{bubbles:true}));};
dept('أسنان');assert.deepEqual(natives(),['s3','s4']);assert.deepEqual(provs(),['د. أحمد']);
type('#rx-svc-q','كشف');assert(q('#rx-svc-list').textContent.includes('لا توجد'));assert(q('#rx-svc-list').textContent.includes('في هذا القسم'));
type('#rx-svc-q','حشو');key('Enter');assert.equal(q('[name=service_id]').value,'s3');
dept('نساء');assert.equal(q('[name=service_id]').value,'s3'.replace('s3',''));assert.deepEqual(natives(),['s1','s2']);assert.deepEqual(provs(),['د. منى','د. هالة']);assert.equal(q('#rx-svc-q').value,'');
type('#rx-svc-q','حمل');key('Enter');assert.deepEqual(provs(),['د. منى','د. هالة']);
dept('__none__');assert.deepEqual(natives(),['s6']);assert.deepEqual(provs(),[]);
dept('');assert.deepEqual(natives(),['s1','s2','s3','s4','s5','s6']);
// submit requires a chosen service; chosen service is what gets saved
q('.rx-modal [name=patient_id]').value='pt';q('.rx-modal form [type=submit]').click();await new Promise(r=>setTimeout(r,30));assert.equal(submitted,null);assert.equal(q('.rx-modal [name=service_id]').value,'');
assert.equal(errors.length,0,errors.join('|'));
console.log('PASS booking service combobox + department filter: DOM');
process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
