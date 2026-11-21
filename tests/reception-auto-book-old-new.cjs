// Owner 2026-11-22: «حجوزات من غير ساعة» split new / old (old = Masa service «استكمال»), grouped by day incl. future days.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><header class="rx-header"><div class="rx-actions"></div></header><div class="rx-actions" data-section-actions></div><ol><li><button data-tl-open="ap1">مريض</button><article data-tl-card="ap1"><header><h4>مريض تجريبي</h4></header></article></li></ol><details class="rx-fb-imports"></details></div></body>',{runScripts:'outside-only'});
 const w=dom.window,calls=[],toasts=[];
 const T=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
 const addD=n=>{const d=new Date(T+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const rows=[
  {id:'n1',source:'masa',state:'needs_time',day:T,day_only:true,customer_name:'جديد النهارده',phone:'0100',doctor_name:'د. سارة',needed_service:'كشف جديد'},
  {id:'o1',source:'masa',state:'needs_time',day:T,day_only:true,customer_name:'قديم النهارده',phone:'0101',patient_code:'P-2026-000001',doctor_name:'د. أحمد',needed_service:'استكمال أسنان'},
  {id:'n2',source:'masa',state:'needs_time',day:addD(1),day_only:true,customer_name:'جديد بكرة',doctor_name:'د. سارة',needed_service:'استشاره'},
  {id:'o2',source:'masa',state:'needs_time',day:addD(2),day_only:true,customer_name:'قديم بعد بكرة',doctor_name:'د. أحمد',needed_service:'استكمال'},
  {id:'n3',source:'masa',state:'needs_time',day:addD(9),day_only:true,customer_name:'جديد بعيد',doctor_name:'د. سارة'}];
 let enabled=true;
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);if(a.p_action==='list')return {data:{enabled,synced_at:new Date(Date.now()-4*60000).toISOString(),rows,services:[{id:'s1',name:'كشف',department:'أسنان'}]},error:null};return {data:{id:a.p_payload.id,state:'booked'},error:null};}}};
 w.eval(fs.readFileSync('assets/js/reception-auto-book.js','utf8'));
 const host=w.document.getElementById('host');let loads=0;
 const c={host,workspace:'ws1',from:T,to:T,data:{workspace:{mode:'live'}},load:()=>{loads++;return Promise.resolve();}};
 await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 const box=host.querySelector('[data-rx-auto-book]'),doc=w.document;
 assert.deepEqual([...box.querySelectorAll('.rx-ab-tile')].map(t=>t.getAttribute('data-ab-open')),['times-new','times-old'],'two summary tiles: new and old');
 assert.match(box.querySelector('[data-ab-open="times-new"]').textContent,/3/);assert.match(box.querySelector('[data-ab-open="times-old"]').textContent,/2/);
 assert(calls.some(c=>c[1].p_action==='list'&&c[1].p_payload.to>c[1].p_payload.from&&c[1].p_payload.to>addD(30)),'wide range list call for future days');
 box.querySelector('[data-ab-open="times-old"]').click();let m=doc.querySelector('.rx-ab-modal');
 assert.equal(m.querySelectorAll('.rx-ab-time').length,2);assert(!m.querySelector('[data-ab-time]'),'old rows have no time input');
 assert.deepEqual([...m.querySelectorAll('.rx-ab-day b')].map(x=>x.textContent),['النهارده','بعد بكرة'],'grouped by day');
 assert.deepEqual([...m.querySelectorAll('[data-ab-kind]')].map(x=>x.textContent),['الكل 5','جديد 3','قديم 2']);
 m.querySelector('[data-ab-kind="new"]').click();m=doc.querySelector('.rx-ab-modal');
 assert.deepEqual([...m.querySelectorAll('.rx-ab-day b')].map(x=>x.textContent),['النهارده','بكرة',m.querySelectorAll('.rx-ab-day b')[2].textContent]);
 assert(m.querySelectorAll('.rx-ab-kn').length===3&&!m.querySelector('.rx-ab-ko'));
 m.querySelector('[data-ab-kind="old"]').click();m=doc.querySelector('.rx-ab-modal');
 w.confirm=()=>true;const n=calls.length;m.querySelector('[data-ab="archive"]').click();await new Promise(r=>setTimeout(r,0));
 const last=calls.slice(n).find(c=>c[1].p_action==='dismiss');assert(last&&last[1].p_payload.id==='o1'&&/اتنقل للأرشيف/.test(last[1].p_payload.reason),'archive = dismiss with a fixed reason');
 await w.SSMPDReceptionAutoBook.decorate({...c,data:{workspace:{mode:'trial'}}},'appointments');
 console.log('PASS Masa no-time list: new/old tiles + filter, day groups incl. future days, wide range, archive.');
})().catch(e=>{console.error(e);process.exit(1);});
