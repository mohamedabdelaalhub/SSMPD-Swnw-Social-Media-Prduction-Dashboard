// Owner 2026-11-18 «الساعات الإضافية»: request form, my requests, approval card (task expected time), monthly report with flags
// and repeaters, settings switch for «صرف الأوفر تايم». Server mocked; tests/hr-overtime-control-sql.cjs covers the rules.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const tick=ms=>new Promise(r=>setTimeout(r,ms||30));
(async()=>{
 const dom=new JSDOM('<section id="host"></section>',{url:'https://hr.test/',runScripts:'outside-only'}),w=dom.window,errors=[],calls=[];
 w.addEventListener('error',e=>errors.push(e.message));
 const data={is_hr:true,can_settings:true,settings:{pay_enabled:false,task_tolerance_pct:20,alert_minutes:30,repeat_count:3},me_person:'pm',month:'2026-10-01',
  people:[{id:'pm',name:'أنا'},{id:'p1',name:'أحمد'}],my_tasks:[{id:'t1',title:'تقرير الحسابات'}],
  mine:[{id:'q0',day:'2026-10-10',minutes:30,reason:'جرد',status:'pending'}],
  to_review:[{id:'q1',person_name:'أحمد',day:'2026-10-13',minutes:90,reason:'إنهاء تقرير',task_id:'t1',task_title:'تقرير الحسابات',task_description:'جمع إيصالات اليوم'}],
  report:[{person_id:'p1',name:'أحمد',day:'2026-10-12',scheduled_end:'2026-10-12T18:00:00Z',actual_end:'2026-10-12T20:00:00Z',close_at:'2026-10-12T19:00:00Z',recorded_min:120,capped_min:60,approved_min:0,counted_min:0,requests:[],flag:true},
          {person_id:'p1',name:'أحمد',day:'2026-10-13',scheduled_end:'2026-10-13T18:00:00Z',actual_end:'2026-10-13T19:30:00Z',close_at:null,recorded_min:90,capped_min:90,approved_min:72,counted_min:72,requests:[{status:'approved',reason:'إنهاء تقرير',task_title:'تقرير الحسابات',task_description:'جمع إيصالات اليوم',expected_minutes:60,approved_minutes:72,reviewed_by:'مدير القسم'}],flag:false}],
  repeaters:[{person_id:'p1',name:'أحمد',times:3}]};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a.p_action,a.p_payload]);if(a.p_action==='workspace')return {data:JSON.parse(JSON.stringify(data)),error:null};
  if(a.p_action==='review'&&a.p_payload.approve&&a.p_payload.expected_minutes==null)return {data:null,error:{message:'اكتب الوقت المتوقع للمهمة بالدقايق'}};return {data:{},error:null};}}};
 w.eval(fs.readFileSync('assets/js/hr-overtime.js','utf8'));
 const host=w.document.querySelector('#host');w.SSMPDHROvertime.mount(host,true);await tick(40);
 const q=s=>host.querySelector(s);
 assert(/بس لو فيه طلب اتوافق عليه/.test(q('.ot-lead').textContent));assert(/مقفول/.test(q('.ot-lead').textContent),'pay switch state shown');
 // request
 const f=q('[data-ot-form]');const E=f.elements;E.minutes.value='45';E.reason.value='استلام شحنة';E.task_id.value='t1';E.person_id.value='p1';
 f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick(40);
 const req=calls.find(c=>c[1]==='request');assert.deepEqual([req[2].minutes,req[2].reason,req[2].task_id,req[2].person_id],[45,'استلام شحنة','t1','p1']);
 assert(/مستني الموافقة/.test(q('.ot-table').textContent),'my requests listed');
 // review: task requires the expected time
 let card=q('[data-ot-item="q1"]');assert(/جمع إيصالات اليوم/.test(card.textContent),'task details shown to the approver');
 card.querySelector('[data-ot-approve]').click();await tick(40);assert(/الوقت المتوقع/.test(q('[data-ot-msg]').textContent),'server message shown');
 card=q('[data-ot-item="q1"]');card.querySelector('[data-ot-exp]').value='60';card.querySelector('[data-ot-min]').value='72';card.querySelector('[data-ot-approve]').click();await tick(40);
 assert(calls.some(c=>c[1]==='review'&&c[2].expected_minutes===60&&c[2].approved_minutes===72));
 // report
 assert(/قعدوا بعد الشيفت من غير إذن/.test(q('.ot-alert').textContent)&&/مفيش خصم أوتوماتيك/.test(q('.ot-alert').textContent));
 assert(q('tr.is-flag'),'unapproved stay highlighted');assert(/بدون إذن/.test(q('tr.is-flag').textContent));
 assert(/المعتمد 1 س 12 د/.test(host.textContent),'counted and reason / task in the details');
 // settings
 q('[data-ot-pay]').checked=true;q('[data-ot-tol]').value='20';q('[data-ot-save-settings]').click();await tick(40);
 assert(calls.some(c=>c[1]==='settings'&&c[2].pay_enabled===true&&c[2].task_tolerance_pct===20));
 // an employee without HR / team: no report, no settings
 data.is_hr=false;data.can_settings=false;data.report=[];data.repeaters=[];data.to_review=[];data.people=[{id:'pm',name:'أنا'}];
 await w.SSMPDHROvertime.reload();assert.equal(q('.ot-sum'),null);assert.equal(q('[data-ot-pay]'),null);assert.equal(q('[name=person_id]'),null,'employee asks for himself');
 assert.equal(errors.length,0,errors.join('|'));
 console.log('PASS overtime UI: request (self/team, optional task), my requests, approval with task expected time, report flags + repeaters, pay switch, employee view.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
