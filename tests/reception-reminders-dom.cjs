// «تذكيرات بكرة» reception card: message text (time / day-only / no ref), wa.me phone normalisation, no button without a
// phone, tabs + counts, «✓ اتبعت» / «مردش» / «تراجع» → RPC mark, sent-by name + time, and the wording never says the
// message was sent when WhatsApp is only opened. Hooked into reception-workspace + index.html. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const dom=new JSDOM('<body><div id="host"><section class="rfu-card" data-rfu></section><section class="rx-section"></section></div></body>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,d=w.document;
 const calls=[],toasts=[];
 let rows=[{ref:'masa:M-2',name:'سارة تجريبية',phone:'01000000000',doctor:'د. جلدية تجريبي',service:'كشف جديد',time:'10:00',booking_ref:'M-2',source:'masa',status:'pending'},
  {ref:'masa:M-3',name:'محمود تجريبي',phone:'010 0000 0000',doctor:'د. باطنة تجريبي',service:'استشارة',time:null,day_only:true,booking_ref:'M-3',source:'masa',status:'pending'},
  {ref:'cb:c1',name:'يوسف تجريبي',phone:'',doctor:'د. أطفال تجريبي',service:'كشف أطفال',time:'12:30',booking_ref:'BK-1',source:'whatsapp',status:'sent',marked_by_name:'دينا',marked_time:'11:20'},
  {ref:'cb:c2',name:'هالة تجريبية',phone:'+20 100 000 0000',doctor:'د. أطفال تجريبي',service:'استشارة',time:'13:00',booking_ref:null,source:'whatsapp',status:'no_answer',marked_by_name:'دينا',marked_time:'11:25'}];
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDDb={client:{rpc:async(fn,a)=>{calls.push([fn,JSON.parse(JSON.stringify(a))]);if(a.p_action==='list')return {data:{day:'2026-11-22',rows,counts:{pending:2,sent:1,no_answer:1,all:4}}};return {data:{ok:true}};}}};
 w.eval(fs.readFileSync('assets/js/reception-reminders.js','utf8'));
 const T=w.SSMPDReminders._t;
 // message text — owner-approved wording
 assert.equal(T.dayLabel('2026-11-22'),'الأحد 22/11');
 assert.equal(T.message(rows[0],'2026-11-22'),'أهلاً سارة 👋\nتذكير من Swnw للعيادات التخصصية بموعدك:\nمع: د. جلدية تجريبي\nالموعد: الأحد 22/11 الساعة 10:00\nرقم الحجز: M-2\nنتشرف بزيارتك. لو مش هتقدر تيجي ابعتلنا هنا نغيّر الميعاد.');
 assert.equal(T.message(rows[1],'2026-11-22'),'أهلاً محمود 👋\nتذكير من Swnw للعيادات التخصصية بموعدك:\nمع: د. باطنة تجريبي\nالموعد: الأحد 22/11 — بدون ساعة محددة\nرقم الحجز: M-3\nنتشرف بزيارتك. لو مش هتقدر تيجي ابعتلنا هنا نغيّر الميعاد.','day-only');
 assert.ok(!/رقم الحجز/.test(T.message(rows[3],'2026-11-22')),'no ref → no رقم الحجز line');
 // phone
 assert.equal(T.waPhone('01000000000'),'201000000000');assert.equal(T.waPhone('010 0000 0000'),'201000000000');
 assert.equal(T.waPhone('201000000000'),'201000000000');assert.equal(T.waPhone('+20 100 000 0000'),'201000000000');assert.equal(T.waPhone('00201000000000'),'201000000000');
 assert.equal(T.waPhone(''),'');assert.equal(T.waPhone('0236230005'),'','landline → no button');assert.equal(T.waPhone('12345'),'');
 const link=T.waLink(rows[0],'2026-11-22');assert.ok(link.startsWith('https://wa.me/201000000000?text='));
 assert.equal(decodeURIComponent(link.split('?text=')[1]),T.message(rows[0],'2026-11-22'),'text is URL-encoded');
 // card
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const ctx={host:d.getElementById('host'),workspace:'ws1',data:{workspace:{id:'ws1',mode:'live'}}};
 w.SSMPDReminders.decorate(ctx,'operations');await tick();await tick();
 const card=()=>d.querySelector('[data-rtr-card]');assert.ok(card(),'card mounted');
 assert.equal(d.querySelector('[data-rfu]').nextElementSibling,card(),'placed right after «متابعات مطلوبة»');
 assert.match(card().querySelector('h4').textContent,/تذكيرات غداً — الأحد 22\/11/);
 assert.match(card().querySelector('.rtr-count').textContent,/2 لسه · 1 اتبعت · 1 مردش/);
 assert.deepEqual([...card().querySelectorAll('.rtr-tab')].map(t=>t.textContent),['لسه ماتبعتش (2)','اتبعت (1)','مردش (1)','الكل (4)']);
 assert.deepEqual([...card().querySelectorAll('.rtr-row')].map(r=>r.dataset.ref),['masa:M-2','masa:M-3'],'default tab = لسه ماتبعتش');
 assert.equal(card().querySelector('.rtr-row .rtr-t').textContent,'10:00');
 assert.equal(card().querySelectorAll('.rtr-row .rtr-t')[1].textContent,'بدون ساعة محددة');
 assert.equal(card().querySelector('.rtr-row .rtr-tag').textContent,'ماسا');
 const wa=card().querySelector('[data-rtr="wa"]');assert.equal(wa.textContent,'افتح واتساب بالرسالة');assert.equal(wa.target,'_blank');
 // opening WhatsApp records nothing and never says «sent»
 const before=calls.length;wa.addEventListener('click',e=>e.preventDefault());wa.click();await tick();assert.equal(calls.length,before,'open = no RPC');
 assert.match(card().querySelector('.rtr-note').textContent,/بيفتح الواتساب برسالة جاهزة بس — مش بيبعت/);
 const src=fs.readFileSync('assets/js/reception-reminders.js','utf8');
 assert.ok(!/(اتبعتت|تم الإرسال|تم إرسال|اتبعت الرسالة|sent successfully)/.test(src),'no wording that claims sending');
 // mark sent
 card().querySelector('[data-rtr="sent"][data-ref="masa:M-2"]').click();await tick();await tick();await tick();
 assert.deepEqual(calls.find(c=>c[1].p_action==='mark')[1],{p_workspace:'ws1',p_action:'mark',p_payload:{ref:'masa:M-2',day:'2026-11-22',status:'sent'}});
 assert.equal(calls.at(-1)[1].p_action,'list','refresh after mark');
 card().querySelector('[data-rtr="no_answer"][data-ref="masa:M-3"]').click();await tick();await tick();await tick();
 assert.equal(calls.filter(c=>c[1].p_action==='mark').at(-1)[1].p_payload.status,'no_answer');
 // tabs: sent row shows who + when, no actions but «تراجع»; no phone → no WhatsApp button
 card().querySelector('[data-rtr-tab="sent"]').click();
 const sent=card().querySelector('.rtr-row.sent');assert.match(sent.textContent,/اتبعت ✓ — دينا 11:20/);
 assert.equal(sent.querySelector('[data-rtr="wa"]'),null);assert.equal(sent.querySelector('[data-rtr="sent"]'),null);
 sent.querySelector('[data-rtr="pending"]').click();await tick();await tick();await tick();
 assert.deepEqual(calls.filter(c=>c[1].p_action==='mark').at(-1)[1].p_payload,{ref:'cb:c1',day:'2026-11-22',status:'pending'});
 card().querySelector('[data-rtr-tab="no_answer"]').click();
 const na=card().querySelector('.rtr-row.no_answer');assert.match(na.textContent,/مردش \/ الرقم مقفول — دينا 11:25/);
 assert.ok(na.querySelector('[data-rtr="wa"]'),'+20 phone → button');assert.ok(na.querySelector('[data-rtr="sent"]'),'can still confirm sent later');
 const noPhone=T.rowHtml({...rows[0],phone:'',status:'pending'});assert.ok(!/data-rtr="wa"/.test(noPhone),'no phone → no button');assert.match(noPhone,/مفيش رقم موبايل صالح/);
 // trial workspace / other section: no card
 const host2=d.createElement('div');w.SSMPDReminders.decorate({...ctx,host:host2,data:{workspace:{id:'t',mode:'trial'}}},'operations');assert.equal(host2.querySelector('[data-rtr-card]'),null);
 const rw=fs.readFileSync('assets/js/reception-workspace.js','utf8'),ix=fs.readFileSync('index.html','utf8');
 assert(/SSMPDReminders\.decorate\(context\(\),section\)/.test(rw),'hook');
 assert(/reception-reminders\.js\?v=/.test(ix)&&/reception-reminders\.css\?v=/.test(ix),'loaded');
 assert(ix.indexOf('reception-reminders.js')<ix.indexOf('reception-workspace.js'),'loaded before the workspace');
 console.log('PASS reception tomorrow reminders card');
})().catch(e=>{console.error(e);process.exit(1);});
