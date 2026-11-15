// HR: warn before creating a person who may already exist (same name ignoring hamza / «د.» prefix, or same mobile
// ignoring the country code). Saving needs an explicit «متأكد إنه شخص جديد». Editing an existing file never warns.
const fs=require('fs'),{JSDOM}=require('jsdom'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;let saved=[];
w.SSMPDAuth={currentAdmin:{id:'mgr',role:'super_admin'}};w.SSMPDToast={show:()=>{}};w.eval(fs.readFileSync('assets/js/roles.js','utf8'));
const people=[{id:'p52',full_name:'د.شريف إبراهيم',code:'EMP-000052',kind:'doctor',department:'جراحة',status:'needs_setup',phone:'01001234567'},{id:'p9',full_name:'منى علي',code:'EMP-000009',kind:'employee',department:'استقبال',status:'active',phone:'01110000000'}];
w.SSMPDDb={client:{rpc:async()=>({data:{can_manage:true,people,accounts:[],documents:[],attendance:[],requests:[],doctor_keys:[],employee_keys:[]}})},hrSaveEmployee:async(...v)=>{saved.push(v);return {person_id:'new'};}};
w.eval(fs.readFileSync('assets/js/workforce-prices.js','utf8'));w.SSMPDHumanResources.render(d.querySelector('main'));await tick();
const open=()=>{d.querySelector('[data-wp=new]').click();const f=d.querySelector('form');f.elements.account_mode.value='none';f.elements.account_mode.dispatchEvent(new w.Event('change'));return f;};
const set=(f,k,v)=>{f.elements[k].value=v;f.elements[k].dispatchEvent(new w.Event('change'));};
const submit=f=>f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
// 1) Same doctor typed without hamza and without «د.» → warning; save blocked.
let f=open();set(f,'full_name','شريف ابراهيم');const box=f.querySelector('.wp-dup');assert.equal(box.hidden,false);assert.match(box.textContent,/EMP-000052/);assert.match(box.textContent,/نفس الاسم/);
submit(f);await tick();assert.equal(saved.length,0,'blocked until confirmed');assert.match(f.querySelector('[role=alert]').textContent,/موجود/);
// 2) Same mobile with +20 prefix and Arabic digits is caught too.
set(f,'full_name','شخص تاني');set(f,'phone','+٢٠١٠٠١٢٣٤٥٦٧');assert.equal(box.hidden,false);assert.match(box.textContent,/نفس رقم الموبايل/);
// 3) Explicit confirmation lets it save once, without leaking dup_ok into the payload.
f.querySelector('[name=dup_ok]').checked=true;submit(f);await tick();assert.equal(saved.length,1);assert.equal('dup_ok' in saved[0][0],false);
// 4) A different person: no warning, saves directly.
f=open();set(f,'full_name','أحمد سامي');set(f,'phone','01229999999');assert.equal(f.querySelector('.wp-dup').hidden,true);submit(f);await tick();assert.equal(saved.length,2);
d.querySelector('[data-close]')&&d.querySelectorAll('.wp-overlay').forEach(x=>x.remove());
dom.window.close();console.log('PASS HR duplicate warning: hamza/«د.» name match, +20/Arabic-digit phone match, save needs explicit confirmation, unrelated person saves directly.');
})().catch(e=>{console.error(e);process.exitCode=1;});
