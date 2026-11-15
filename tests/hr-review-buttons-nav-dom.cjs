// Regression (owner report 2026-11-15): with the HR section navigation, «مراجعة قواعد الأجر والبنود» and the other
// payroll buttons that load the workspace first did nothing, because the navigation removes the payroll host.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.SSMPDAuth={currentAdmin:{id:'reviewer'}};w.SSMPDRoles={ALL:{},hasRole:()=>false,hasAnyRole:()=>true,canModuleAction:()=>true,canSeeTab:()=>true};w.SSMPDToast={show:()=>{}};
const people=[{id:'p1',full_name:'موظف اختبار',code:'EMP-T1',kind:'employee',status:'active',revision:1,leave_balance:0}];
w.SSMPDDb={client:{rpc:async(fn)=>{
  if(fn==='hr_workspace')return {data:{can_manage:true,people,documents:[],attendance:[],requests:[],accounts:[],doctor_keys:[],employee_keys:[]}};
  if(fn==='hr_payroll_workspace')return {data:{rules:[{id:'r1',person_id:'p1',status:'pending',created_by:'owner',valid_from:'2026-11-01',valid_to:'2027-10-31',late_grace:15,late_minute:0.65,absence_day:312.5,overtime_hour:39.06,guaranteed_minimum:false,note:'قواعد'}],adjustments:[],devices:[],imports:[],services:[]}};
  return {data:null};}}};
for(const f of ['workforce-prices','hr-payroll-workspace','hr-navigation'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
w.SSMPDHumanResources.render(d.querySelector('main'));await tick();
assert(!d.querySelector('[data-hr-payroll]'),'the navigation removed the payroll host');
const review=d.querySelector('[data-hr-section=reviews] [data-hrp=review]');assert(review,'review button lives in the reviews section');
review.click();await tick();await tick();
const modal=Array.from(d.querySelectorAll('.wp-modal')).find(m=>m.textContent.includes('مراجعة قواعد الأجر والبنود'));assert(modal,'the review dialog opens');assert(modal.textContent.includes('موظف اختبار'));
for(const n of Array.from(d.querySelectorAll('.wp-overlay')))n.remove();
d.querySelector('[data-hrp=adjust]').click();await tick();await tick();assert(Array.from(d.querySelectorAll('.wp-modal')).some(m=>m.textContent.includes('بند مرتب للمراجعة')),'adjustment dialog opens');
dom.window.close();console.log('PASS HR review buttons with section navigation: review and adjustment dialogs open after the payroll host is removed.');
})().catch(e=>{console.error(e);process.exit(1)});
