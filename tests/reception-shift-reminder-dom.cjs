// Owner 2026-11-17 «افتح وردية اليوم» popup: shown for reception when the server says so; «فتح الوردية» jumps to the form; «بعدين» snoozes.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const run=async(role,answer)=>{
 const dom=new JSDOM('<nav><button data-goto="reception_services"></button></nav>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],calls=[],opened=[];
 w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u-'+role,role}};
 w.SSMPDDb={client:{rpc:async n=>{calls.push(n);return {data:answer,error:null};}}};
 w.SSMPDReception={openShiftOpen:async f=>{opened.push(f);return true;}};
 w.eval(fs.readFileSync('assets/js/reception-shift-reminder.js','utf8'));
 w.SSMPDShiftReminder.check(true);await new Promise(r=>setTimeout(r,30));
 return {w,errors,calls,opened,box:()=>w.document.querySelector('[data-shift-reminder]')};
};
(async()=>{
 const now=new Date().toISOString();
 let t=await run('reception',{show:true,reason:'punched',first_in:now});
 assert.equal(t.calls[0],'clinic_reception_shift_reminder');assert(t.box(),'popup shown');
 assert.equal(t.box().querySelector('h2').textContent,'افتح وردية اليوم');assert(/بصمت حضور/.test(t.box().textContent));
 assert(t.box().querySelector('[role=dialog][aria-modal=true]'));assert.equal(t.w.document.activeElement,t.box().querySelector('[data-shift-open]'),'focus on the main button');
 t.box().querySelector('[data-shift-open]').click();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(t.opened,[true],'opens the «فتح وردية» form');assert.equal(t.box(),null,'popup closed');
 t=await run('reception',{show:true,reason:'shift_start',exp_start:now});assert(/شيفتك بدأ/.test(t.box().textContent));
 t.box().querySelector('[data-shift-later]').click();assert.equal(t.box(),null);
 t.w.SSMPDShiftReminder.check(true);await new Promise(r=>setTimeout(r,20));assert.equal(t.calls.length,1,'snoozed: no new check');
 t=await run('reception',{show:true,reason:'stale',stale_opened_at:now});assert.equal(t.box().querySelector('[data-shift-open]').textContent,'روح للورديات');
 t.box().querySelector('[data-shift-open]').click();await new Promise(r=>setTimeout(r,20));assert.deepEqual(t.opened,[false],'stale: only the shifts list');
 t=await run('reception',{show:false});assert.equal(t.box(),null,'server says no');
 t=await run('accountant',{show:true,reason:'punched'});assert.equal(t.calls.length,0,'other roles never ask');assert.equal(t.box(),null);
 assert.equal(t.errors.length,0,t.errors.join('|'));
 console.log('PASS shift reminder popup: shown when due, focus, open form / shifts list, «بعدين» snoozes, hidden when not due and for other roles.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
