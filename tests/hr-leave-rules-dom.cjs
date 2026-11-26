// Leave rules on the HR screen: leave type + exception reason in the request form, rule breaks shown to the reviewer,
// and the sick-leave certificate button.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.SSMPDAuth={currentAdmin:{id:'reviewer'}};w.SSMPDRoles={ALL:{},hasRole:()=>false,hasAnyRole:()=>true,canModuleAction:()=>true,canSeeTab:()=>true};
const people=[{id:'p1',full_name:'موظفة اختبار',code:'EMP-T1',kind:'employee',status:'active',revision:1,leave_balance:16}];
const requests=[
  {id:'q1',person_id:'p1',kind:'leave',leave_type:'casual',from_date:'2026-12-03',to_date:'2026-12-03',units:1,note:'ظرف',status:'pending',created_by:'emp',rule_breaks:['casual_pace'],rule_break_labels:['تجاوز توزيع العارضة (يومين في الشهر و3 أيام في الربع)'],notice_reason:'طارئ'},
  {id:'q2',person_id:'p1',kind:'leave',leave_type:'sick',from_date:'2026-12-10',to_date:'2026-12-11',units:2,note:'برد',status:'pending',created_by:'emp',rule_breaks:[],rule_break_labels:[],certificate_due:'2026-11-18T10:00:00Z'}];
const calls=[];w.SSMPDDb={client:{rpc:async(fn,args)=>{calls.push([fn,args]);
  if(fn==='hr_workspace')return {data:{can_manage:true,owner_level:false,people,documents:[],attendance:[],requests,accounts:[],doctor_keys:[],employee_keys:[]}};
  if(fn==='hr_payroll_workspace')return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};
  return {data:null};}}};const toasts=[];w.SSMPDToast={show:m=>toasts.push(m)};
for(const f of ['workforce-prices','hr-payroll-workspace','hr-navigation'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
w.SSMPDHumanResources.render(d.querySelector('main'));await tick();
const reqs=d.querySelector('[data-hr-section=requests]');
assert.match(reqs.textContent,/إجازة عارضة/);assert.match(reqs.textContent,/خارج القواعد: تجاوز توزيع العارضة/);assert.match(reqs.textContent,/إجازة مرضية/);
// Sick-leave certificate.
const cert=reqs.querySelector('[data-wp=sick-cert][data-id=q2]');assert(cert,'certificate button on a pending sick leave');cert.click();await tick();
let f=Array.from(d.querySelectorAll('.wp-modal form')).pop();f.elements.certificate_url.value='https://drive.google.com/file/d/x/view';
f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
const c=calls.find(x=>x[0]==='hr_command'&&x[1].p_action==='sick_certificate');assert(c,'certificate sent');assert.equal(c[1].p_payload.id,'q2');
for(const n of Array.from(d.querySelectorAll('.wp-overlay')))n.remove();
// The reviewer sees the rule break before deciding.
d.querySelector('[data-hr-section=reviews] [data-wp=request-review][data-id=q1]').click();await tick();
const rm=Array.from(d.querySelectorAll('.wp-modal')).pop();assert.match(rm.textContent,/الطلب خارج القواعد/);assert.match(rm.textContent,/سبب الاستثناء: طارئ/);
for(const n of Array.from(d.querySelectorAll('.wp-overlay')))n.remove();
const pick=()=>{const s=reqs.querySelector('[name=person_for_request]');if(s&&!s.value){s.value=Array.from(s.options).find(o=>o.value).value;s.dispatchEvent(new w.Event('change',{bubbles:true}));}};
// New request: the leave type is sent; days are computed for casual leave; other kinds carry no leave type.
pick();reqs.querySelector('[data-wp=request]').click();await tick();
f=Array.from(d.querySelectorAll('.wp-modal form')).pop();assert(!f.elements.leave_type.closest('label').hidden);
assert(Array.from(f.elements.leave_type.options).some(o=>o.value==='excused'),'HR managers may record an excused absence');
f.elements.leave_type.value='casual';f.elements.from_date.value='2026-12-01';f.elements.to_date.value='2026-12-02';f.elements.units.value='1';f.elements.note.value='ظرف عائلي';
f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
let r=calls.filter(x=>x[0]==='hr_command'&&x[1].p_action==='request').pop();assert.equal(r[1].p_payload.leave_type,'casual');assert.equal(r[1].p_payload.units,'2');
for(const n of Array.from(d.querySelectorAll('.wp-overlay')))n.remove();
pick();reqs.querySelector('[data-wp=request]').click();await tick();
f=Array.from(d.querySelectorAll('.wp-modal form')).pop();f.elements.kind.value='permission';f.elements.kind.onchange();assert(f.elements.leave_type.closest('label').hidden);
f.elements.note.value='إذن ساعة';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
r=calls.filter(x=>x[0]==='hr_command'&&x[1].p_action==='request').pop();assert.equal(r[1].p_payload.kind,'permission');assert.equal(r[1].p_payload.leave_type,undefined);
dom.window.close();console.log('PASS leave rules screen: leave types and exception reason in the form, rule breaks shown to the reviewer, sick certificate attached.');
})().catch(e=>{console.error(e);process.exit(1)});
