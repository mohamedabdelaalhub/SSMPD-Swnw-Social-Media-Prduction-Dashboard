// Owner 2026-11-17 «افتح وردية اليوم»: popup every 5 min until the shift is open; «بعدين» shrinks it into a floating safe
// (orange closed/opening → green open → yellow closing), gone when hidden.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const tick=ms=>new Promise(r=>setTimeout(r,ms||30));
const run=async(role,answer)=>{
 const dom=new JSDOM('<nav><button data-goto="reception_services"></button></nav><div class="ssmpd-aa-launch" style="position:fixed;left:16px;bottom:72px;width:44px;height:44px"></div>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],calls=[],opened=[];
 w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u-'+role,role}};
 const t={w,errors,calls,opened,answer};
 w.SSMPDDb={client:{rpc:async n=>{calls.push(n);return {data:t.answer,error:null};}}};
 w.SSMPDReception={openShiftOpen:async f=>{opened.push(f);return true;}};
 w.eval(fs.readFileSync('assets/js/reception-shift-reminder.js','utf8'));
 w.SSMPDShiftReminder.refresh();await tick();
 t.box=()=>w.document.querySelector('[data-shift-reminder]');t.fab=()=>w.document.querySelector('[data-shift-fab]');
 t.set=async a=>{t.answer=a;w.SSMPDShiftReminder.refresh();await tick();};
 return t;
};
(async()=>{
 const now=new Date().toISOString();
 let t=await run('reception',{show:true,state:'need_open',reason:'punched',first_in:now});
 assert.equal(t.calls[0],'clinic_reception_shift_reminder');assert(t.box(),'popup shown');
 assert.equal(t.box().querySelector('h2').textContent,'افتح وردية اليوم');assert(/بصمت حضور/.test(t.box().textContent));
 assert(t.box().querySelector('.safe-ico .safe-door'),'animated safe icon');assert.equal(t.w.document.activeElement,t.box().querySelector('[data-shift-open]'));
 assert.equal(t.fab(),null,'no floating button while the popup is open');
 // «بعدين» → shrinks into the orange floating safe, above the bottom-left buttons
 t.box().querySelector('[data-shift-later]').click();assert.equal(t.box(),null);
 assert(t.fab()&&t.fab().classList.contains('is-need_open'),'orange floating safe');assert.equal(t.fab().getAttribute('aria-label'),'افتح وردية اليوم');
 t.w.SSMPDShiftReminder.check(false);await tick();assert.equal(t.box(),null,'snoozed for 5 minutes');
 const snoozeUntil=+t.w.localStorage.getItem('ssmpd-shift-reminder-snooze:u-reception');assert(snoozeUntil-Date.now()>4*60000&&snoozeUntil-Date.now()<=5*60000,'5 minutes');
 // after the 5 minutes the popup is back
 t.w.localStorage.setItem('ssmpd-shift-reminder-snooze:u-reception',String(Date.now()-1));t.w.SSMPDShiftReminder.check(false);await tick();assert(t.box(),'popup again after 5 minutes');
 t.box().querySelector('[data-shift-later]').click();
 // clicking the floating safe re-opens the popup; «فتح الوردية» goes to the form
 t.fab().click();await tick();assert(t.box());t.box().querySelector('[data-shift-open]').click();await tick();assert.deepEqual(t.opened,[true]);assert.equal(t.box(),null);
 // shift opened → green; click → shifts list
 await t.set({show:false,state:'open',opened_at:now});assert(t.fab().classList.contains('is-open'),'green');assert.equal(t.box(),null);
 t.fab().click();await tick();assert.deepEqual(t.opened,[true,false]);
 // shift time over → yellow closing safe; click → «اقفل ورديتك» → shifts list
 await t.set({show:false,state:'close_due',reason:'shift_end',exp_end:now});assert(t.fab().classList.contains('is-close_due'),'yellow');assert.equal(t.box(),null,'no popup by itself');
 t.fab().click();await tick();assert.equal(t.box().querySelector('h2').textContent,'اقفل ورديتك');assert(/شيفتك خلص/.test(t.box().textContent));
 t.box().querySelector('[data-shift-open]').click();await tick();assert.deepEqual(t.opened,[true,false,false]);
 await t.set({show:false,state:'close_due',reason:'punched_out'});t.fab().click();await tick();assert(/بصمت انصراف/.test(t.box().textContent));t.box().querySelector('[data-shift-later]').click();
 // closed / punched out → gone
 await t.set({show:false,state:'hidden',why:'closed'});assert.equal(t.fab(),null);assert.equal(t.box(),null);
 // other roles never ask
 const o=await run('accountant',{show:true,state:'need_open'});assert.equal(o.calls.length,0);assert.equal(o.box(),null);assert.equal(o.fab(),null);
 const css=fs.readFileSync('assets/css/styles.css','utf8');
 assert(/\.shift-fab\.is-open\{--safe:#2F7D5C\}/.test(css)&&/\.shift-fab\.is-close_due\{--safe:#F2B705/.test(css)&&/\.shift-fab\{--safe:#F15A22/.test(css),'orange / green / yellow');
 assert(/@keyframes safe-opening/.test(css)&&/@keyframes safe-closing/.test(css)&&/prefers-reduced-motion/.test(css),'door animations with reduced-motion fallback');
 assert.equal(t.errors.length,0,t.errors.join('|'));
 console.log('PASS shift reminder: popup, «بعدين» → orange floating safe, back after 5 min, green when open, yellow closing safe when due, hidden when done, other roles none.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
