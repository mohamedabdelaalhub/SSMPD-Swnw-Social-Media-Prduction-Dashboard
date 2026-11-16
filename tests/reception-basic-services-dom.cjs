// Owner 2026-11-16: basic services (كشف/استشارة/متابعة) appear for every doctor's department in the booking form; readiness modal.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[{id:'pt',file_no:'1',name:'مريض'}],
 services:[{id:'own',code:'N1',name:'رسم أعصاب',department:'المخ والأعصاب',price:400,minutes:30},{id:'kashf',code:'K1',name:'كشف أخصائي أمراض المخ والأعصاب',department:'خدمات الكشف',price:800,minutes:20},{id:'fu',code:'F1',name:'متابعة',department:'خدمات الكشف',price:150,minutes:15},{id:'derm',code:'D1',name:'جلسة ليزر',department:'الجلدية',price:900,minutes:30}],
 providers:[{id:'dina',name:'د.دينا',department:'المخ والأعصاب'},{id:'derm1',name:'د.جلدية',department:'الجلدية'}],
 basic_service_ids:['kashf','fu'],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
const rd={day:'2026-11-16',basic_services:2,doctors:[{id:'dina',name:'د.دينا',department:'المخ والأعصاب',own_services:1,basic_services:2,agreements:0,availability_14d:0,ready:false},{id:'derm1',name:'د.جلدية',department:'الجلدية',own_services:1,basic_services:2,agreements:1,availability_14d:3,ready:true}]};
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async()=>({}),client:{rpc:async(n)=>n==='clinic_reception_booking_readiness'?{data:rd,error:null}:{data:null,error:{message:'x'}}}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));const skip=q('[data-guide-skip]');if(skip)skip.click();
q('[data-rx-section="appointments"]').click();await new Promise(r=>setTimeout(r,30));q('[data-rx-action="book"]').click();await wait(()=>q('.rx-modal'));
const opts=n=>[...q('.rx-modal [name="'+n+'"]').options].filter(o=>o.value).map(o=>o.value);
const dept=q('.rx-modal [data-rx-dept]');dept.value='المخ والأعصاب';dept.dispatchEvent(new w.Event('change',{bubbles:true}));
assert.deepEqual(opts('service_id').sort(),['fu','kashf','own'],'own department + basic services, not other departments');
const svc=q('.rx-modal [name="service_id"]');svc.value='kashf';svc.dispatchEvent(new w.Event('change',{bubbles:true}));
assert.deepEqual(opts('provider_id'),['dina'],'department doctor for the basic service');
dept.value='';dept.dispatchEvent(new w.Event('change',{bubbles:true}));svc.value='kashf';svc.dispatchEvent(new w.Event('change',{bubbles:true}));
assert.deepEqual(opts('provider_id').sort(),['derm1','dina'],'no department: every doctor can take a basic service');
svc.value='derm';svc.dispatchEvent(new w.Event('change',{bubbles:true}));assert.deepEqual(opts('provider_id'),['derm1'],'non-basic stays department-only');
q('.rx-modal [data-rx-cancel]').click();
// readiness modal from settings
q('[data-rx-action="back"]')&&q('[data-rx-action="back"]').click();q('[data-rx-section="settings"]').click();await new Promise(r=>setTimeout(r,20));
q('[data-rx-action="booking-readiness"]').click();await wait(()=>q('.rx-ready'));
const cards=[...w.document.querySelectorAll('.rx-ready')];assert.equal(cards.length,2);
assert(q('.rx-ready-sum').textContent.includes('1')&&q('.rx-ready-sum').textContent.includes('2'));
const dina=cards.find(c=>c.textContent.includes('د.دينا'));assert(dina.classList.contains('bad')&&dina.textContent.includes('عقد أتعاب')&&dina.textContent.includes('مواعيد تواجد'));
assert(cards.find(c=>c.textContent.includes('د.جلدية')).classList.contains('ok'));
assert.deepEqual(errors,[]);console.log('PASS basic services UI: department shows its own + basic services, basic service open to every doctor (dept-filtered when chosen), non-basic stays department-only; readiness modal flags missing agreement/availability.');
})().catch(e=>{console.error(e);process.exit(1);});
