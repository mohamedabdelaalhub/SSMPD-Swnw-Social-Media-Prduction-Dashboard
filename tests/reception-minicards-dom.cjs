// Owner 2026-11-21 («طبقه», mockup reminders-compact.html): «متابعات مطلوبة» + «تذكيرات غداً» are two small cards side by
// side (numbers only); a click opens the existing full list in a sheet; ✕ / Esc / outside click closes it; actions inside
// still work and refresh the numbers.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const dom=new JSDOM('<body><div id="host"><section class="rx-section"></section></div></body>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,d=w.document;
 let pend=2,sent=0;const calls=[];
 w.SSMPDToast={show:()=>{}};
 w.SSMPDDb={client:{rpc:async(fn,a)=>{calls.push([fn,a.p_action]);
  if(fn==='clinic_reception_follow_ups')return {data:{rows:[{id:'f1',status:'open',days:-2,patient_name:'سارة تجريبية',doctor_name:'د. أ',due_date:'2026-11-19'}],counts:{late:1,today:0,soon:3}}};
  if(a.p_action==='mark'){pend--;sent++;return {data:{ok:true}};}
  return {data:{day:'2026-11-23',rows:[{ref:'masa:M-1',name:'سارة تجريبية',phone:'01000000000',doctor:'د. أ',time:'10:00',source:'masa',status:pend?'pending':'sent'}],counts:{pending:pend,sent,no_answer:0,all:2}}};}}};
 for(const f of ['reception-minicards','reception-follow-ups','reception-reminders'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const tick=()=>new Promise(r=>setTimeout(r,0)),host=d.getElementById('host'),ctx={host,workspace:'ws1',data:{workspace:{id:'ws1',mode:'live'}}};
 w.SSMPDFollowUps.decorate(ctx,'operations');w.SSMPDReminders.decorate(ctx,'operations');await tick();await tick();await tick();
 const row=host.querySelector('[data-rx-minirow]');assert.ok(row,'one shared row');const minis=[...row.querySelectorAll('.rx-mini')];assert.equal(minis.length,2,'two small cards side by side');
 assert.equal(host.querySelector('[data-rfu]'),null,'no full follow-ups list on the page');assert.equal(host.querySelector('[data-rtr-card]'),null,'no full reminders list on the page');
 const fu=row.querySelector('[data-mini="rfu"]'),tr=row.querySelector('[data-mini="rtr"]');
 assert.match(fu.textContent,/متابعات مطلوبة/);assert.match(fu.textContent,/1\s*متأخرة/);assert.match(fu.textContent,/3\s*خلال أسبوعين/);
 assert.match(tr.textContent,/تذكيرات غداً — الاثنين 23\/11/,'renamed «تذكيرات غداً»');assert.match(tr.textContent,/2\s*لسه/);assert.equal(+fu.style.order<+tr.style.order,true);
 // open reminders → sheet with the existing list; mark sent → numbers refresh, sheet stays open
 tr.click();await tick();let sheet=d.querySelector('[data-rx-sheet="rtr"]');assert.ok(sheet,'sheet opens');assert.ok(sheet.querySelector('[data-rtr-card]'),'full list inside');
 assert.match(sheet.querySelector('h3').textContent,/تذكيرات غداً/);
 sheet.querySelector('[data-rtr="sent"]').click();await tick();await tick();await tick();
 assert.ok(d.querySelector('[data-rx-sheet="rtr"]'),'still open after an action');assert.match(row.querySelector('[data-mini="rtr"]').textContent,/1\s*اتبعت/);
 // Esc closes
 d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(d.querySelector('[data-rx-sheet="rtr"]'),null,'Esc closes');
 // follow-ups: open, ✕ closes; outside click closes
 fu.click();await tick();sheet=d.querySelector('[data-rx-sheet="rfu"]');assert.ok(sheet.querySelector('[data-rfu]'));sheet.querySelector('[data-rx-sheet-close]').click();assert.equal(d.querySelector('[data-rx-sheet="rfu"]'),null);
 row.querySelector('[data-mini="rfu"]').click();await tick();sheet=d.querySelector('[data-rx-sheet="rfu"]');sheet.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(d.querySelector('[data-rx-sheet="rfu"]'),null,'outside click closes');
 // «+ متابعة جديدة» closes the sheet before its own form
 row.querySelector('[data-mini="rfu"]').click();await tick();ctx.modal=()=>null;ctx.select=()=>'';d.querySelector('[data-rx-sheet="rfu"] [data-fu="new"]').click();assert.equal(d.querySelector('[data-rx-sheet="rfu"]'),null);
 const idx=fs.readFileSync('index.html','utf8');assert.ok(idx.indexOf('reception-minicards.js')<idx.indexOf('reception-follow-ups.js'),'loaded before the cards');
 console.log('PASS follow-ups + tomorrow reminders: two small cards side by side, list in a sheet, close by ✕ / Esc / outside');
})().catch(e=>{console.error(e);process.exit(1);});
