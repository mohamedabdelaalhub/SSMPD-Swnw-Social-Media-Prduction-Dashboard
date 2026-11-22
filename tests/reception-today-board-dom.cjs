// Single reception day board (audit item 4, part 2): one board, patients by hour, chip strip with «الكل», one main button per card, finance tags, filters, search.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const past=new Date(Date.now()-40*60000).toISOString(),later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'عيادة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[{provider_id:'d1',status:'delayed',eta_minutes:15}],help_requests:[],events:[],outbox:[],appointments:[
  ap('1','أحمد متأخر','expected',{starts_at:past}),ap('2','منى جاية','expected',{booking_source:'whatsapp'}),ap('3','كريم مستني','waiting',{wait_minutes:35,visit_id:'v3'}),
  ap('4','سلمى جوه','in_service',{visit_id:'v4'}),ap('5','يوسف خلص','completed',{visit_id:'v5',patient_due:150,patient_payable_total:300,due_invoices:[{id:'inv5',invoice_no:'INV-5',due:150}]}),
  ap('6','هدى دفعت','completed',{visit_id:'v6',patient_due:0,patient_payable_total:200}),ap('7','لم يحضر','no_show')]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push(name);if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};return {data:null,error:{message:'unexpected '+name}};}}};
 let collected=null;w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:(a,id)=>{if(a==='collect-invoice'){collected=id;return true;}return false;},bookingFields:()=>'',bookingWire:()=>{}};
 for(const f of ['today-operations','today-operations-unified'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{invoices:[{id:'inv5'}]},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)];
 for(let n=0;n<200&&!q('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 assert(q('.journey-board'),'board rendered');assert.equal(calls[0],'clinic_reception_journey_hub_snapshot');
 assert.equal(w.document.querySelectorAll('[data-unified-hub]').length,0,'no second board');
 // owner 2026-11-17 redesign: patients grouped by hour (time order), one chip strip with «الكل», compact sticky top
 assert(qa('.journey-hour').length>=1&&qa('.journey-hour .journey-card').length===7,'all patients sit in hour groups');
 assert.equal(qa('.journey-chip-name')[0].textContent,'أحمد متأخر','earliest first');
 assert(qa('.journey-hour-label').every(x=>/^\d{1,2}:00 (ص|م)$/.test(x.textContent)),'hour labels like 4:00 م');
 assert.equal(qa('.journey-src').map(x=>x.textContent).join(),'واتساب','owner 2026-11-17: channel tag');
 assert.deepEqual(qa('[data-journey-filter]').map(x=>x.querySelector('span').textContent),['الكل','الحجوزات','متأخر','في الانتظار','في غرفة الكشف','أنهى الكشف','عليه فلوس'],'chip strip with the new names');
 assert(q('.journey-top [data-journey-action="new_booking"]')&&q('.journey-top .journey-tools'),'book + ⋯ in the sticky top');assert(!q('.journey-title'),'no big banner');
 for(const c of qa('.journey-card'))assert(c.querySelectorAll('.journey-card-actions > .btn').length<=1,'at most one main button per card');
 const card=id=>q('.journey-card[data-appointment="'+id+'"]'),main=id=>{const b=card(id).querySelector('.journey-card-actions > .btn');return b?b.dataset.journeyAction:undefined;};
 assert.equal(main('1'),'arrive');assert.equal(main('3'),'call');assert.equal(main('4'),'visit_complete');assert.equal(main('5'),'collect_due');assert.equal(main('6'),undefined);
 assert(card('1').querySelector('.journey-more [data-journey-action="no_show"]'),'no-show in menu');assert(card('1').querySelector('.journey-more [data-journey-v2-action="reschedule"]'),'reschedule in menu');
 assert(card('3').querySelector('.journey-more [data-journey-action="priority"]'),'priority in menu');
 assert(card('1').textContent.includes('متأخر'));assert(card('3').querySelector('.journey-wait.late'));assert(card('5').textContent.includes('عليه 150.00'));assert(card('6').textContent.includes('تم التحصيل'));assert(!host.textContent.includes('مدفوع'),'SPEC A: no «مدفوع» tag');
 // SPEC A (owner 2026-11-22): simpler «تشغيل اليوم»
 assert(/^النهارده · /.test(q('.journey-day-text').textContent)&&/نوفمبر|ديسمبر|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر/.test(q('.journey-day-text').textContent),'one Arabic date line: '+q('.journey-day-text').textContent);
 assert(!/[٠-٩]/.test(q('.journey-day-text').textContent),'English digits in the date');
 assert(q('.journey-date-nav [data-journey-day]'),'hidden date input still there');assert(!q('.journey-date-nav [data-journey-action="refresh"]'),'⟳ left the date row');
 assert(q('.journey-tools [data-journey-action="refresh"]')&&q('.journey-tools [data-journey-action="pick_day"]'),'«تحديث» + «تغيير اليوم» in ⋯');
 assert(q('.journey-docline').textContent.includes('د. سارة')&&q('.journey-docline-late').textContent==='متأخر 15 د','doctors summary line');
 assert(q('section.journey-doctors').hidden,'doctor cards collapsed by default');assert.equal(q('section.journey-doctors').getAttribute('data-doctor-pay-workspace'),'ws1','payout hook stays on the cards');
 q('[data-journey-docs-toggle]').click();assert(!q('section.journey-doctors').hidden&&q('[data-journey-docs-toggle]').textContent.includes('⌃'),'«تفاصيل» opens the cards');assert(q('.journey-doctor [data-doctor-pay="d1"]'),'payout slot inside the cards');
 q('[data-journey-docs-toggle]').click();assert(q('section.journey-doctors').hidden);
 assert.equal(qa('.journey-alert').length,1,'one alert line (delayed doctor only in the doctors line)');
 assert(q('.journey-alert').textContent.includes('كريم مستني مستني 35 دقيقة — د. سارة'));assert.equal(q('.journey-alert [data-journey-action]').dataset.journeyAction,'call');assert.equal(q('.journey-alert .btn').textContent,'نادي');
 assert(!q('.journey-action-center'),'no «يحتاج تدخل» side box');
 assert(q('.journey-rail .journey-now')&&/^الآن · /.test(q('.journey-now-label').textContent),'orange «الآن» marker');
 assert(q('.journey-card[data-appointment="1"] .journey-chip-sub.is-late').textContent==='متأخر 40 د'||/متأخر \d+ د/.test(q('.journey-card[data-appointment="1"] .journey-chip-sub').textContent),'late chip status');
 assert.equal(q('.journey-card[data-appointment="3"] .journey-chip-sub').textContent,'35 د');assert.equal(q('.journey-card[data-appointment="4"] .journey-chip-sub').textContent,'جوه');assert.equal(q('.journey-card[data-appointment="5"] .journey-chip-sub').textContent,'متبقي 150');
 assert(q('.journey-card[data-appointment="3"] .journey-chip-time'),'time on the chip');
 assert(q('.journey-card[data-appointment="3"] .journey-card-line').textContent.includes('رقم الملف F3')&&!host.textContent.includes('ملف F3 ')&&!/ · ملف /.test(host.textContent),'«رقم الملف N»');
 assert.equal(q('.journey-card[data-appointment="3"] .journey-card-detail h4'),null,'name only once');
 assert.equal(q('.journey-card[data-appointment="5"] .journey-card-actions > .btn').textContent,'حصّل 150.00 ج.م','collect main button shows the amount');
 assert(q('.journey-card[data-appointment="3"] [data-journey-action="account"]').textContent==='الحساب والخط الزمني'&&!q('[data-journey-action="timeline"]'),'one «الحساب والخط الزمني» item');
 const metric=k=>q('[data-journey-filter="'+k+'"] strong').textContent;
 assert.equal(metric('coming'),'2');assert.equal(metric('late'),'1');assert.equal(metric('waiting'),'1');assert.equal(metric('inside'),'1');assert.equal(metric('done'),'2');assert.equal(metric('due'),'1');
 assert(q('.journey-doctor-delayed').textContent.includes('15'));assert(q('[data-journey-action="new_booking"]'),'new booking for reception');
 q('[data-journey-filter="due"]').click();assert.equal(qa('.journey-card').length,1);q('[data-journey-filter="due"]').click();assert.equal(qa('.journey-card').length,7);q('[data-journey-filter="inside"]').click();assert.equal(qa('.journey-card').length,1);q('[data-journey-filter="all"]').click();assert.equal(qa('.journey-card').length,7,'«الكل» resets');
  const sx=q('[data-journey-search]');
  {const dsel=q('[data-journey-doctor]'),ssel=q('[data-journey-status]');assert(dsel&&ssel,'doctor + status filters exist');assert.deepEqual([...dsel.options].map(o=>o.textContent),['كل الأطباء','د. سارة']);assert.equal(ssel.options[0].textContent,'كل الحالات');
  sx.value='سارة';sx.dispatchEvent(new w.Event('input'));assert.equal(qa('.journey-card').length,7,'search also matches the doctor name');sx.value='';sx.dispatchEvent(new w.Event('input'));
  ssel.value='waiting';ssel.dispatchEvent(new w.Event('change'));assert.deepEqual(qa('.journey-chip-name').map(x=>x.textContent),['كريم مستني'],'status filter');
  assert.equal(q('.journey-f-all strong').textContent.trim().replace(/[^0-9]/g,''),'1','chips count the filtered set');
  ssel.value='';ssel.dispatchEvent(new w.Event('change'));assert.equal(qa('.journey-card').length,7);}
 const s=q('[data-journey-search]');s.value='0100'+'3';s.dispatchEvent(new w.Event('input'));assert.deepEqual(qa('.journey-chip-name').map(x=>x.textContent),['كريم مستني']);
 q('[data-journey-action="clear_filter"]').click();assert.equal(qa('.journey-card').length,7);
 card('5').querySelector('[data-journey-action="collect_due"]').click();assert.equal(collected,'inv5');
 assert.deepEqual(errors,[]);dom.window.close();
 console.log('PASS today board: one board, patients by hour, chip strip with «الكل», one main button per card, menu actions, late/wait/due/paid tags, 7 filters, search, collect hand-off.');
})().catch(e=>{console.error(e);process.exit(1);});
