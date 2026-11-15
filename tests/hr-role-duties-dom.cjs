// HR profile of an employee WITHOUT an account: pick the role that follows him, add recurring duties for the role holder.
// Payroll rules modal: the «حد أدنى مضمون» choice is sent with the rule and shown in the calculation.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=[];
const people=[{id:'p1',full_name:'عاملة اختبار',code:'EMP-T60',kind:'employee',status:'active',revision:1,leave_balance:0},{id:'p2',admin_id:'a2',full_name:'ممرضة اختبار',code:'EMP-T03',kind:'employee',status:'active',revision:1,leave_balance:0}];
let duty={manager_role:null,holder_id:null,holder_name:null,duties:[]};
w.SSMPDAuth={currentAdmin:{id:'mgr'}};w.SSMPDRoles={ALL:{general_manager:'مدير عام',super_admin:'سوبر أدمن'},hasRole:()=>false,canModuleAction:()=>false};let toasts=[];w.SSMPDToast={show:m=>toasts.push(m)};
w.SSMPDDb={client:{rpc:async(fn,args)=>{calls.push({fn,args});
  if(fn==='hr_workspace')return {data:{can_manage:true,people,documents:[],attendance:[],requests:[],accounts:[],doctor_keys:[],employee_keys:[]}};
  if(fn==='hr_person_duties')return {data:duty};
  if(fn==='hr_set_manager_role'){duty=Object.assign({},duty,{manager_role:args.p_role,holder_id:'a9',holder_name:'مديرة أولى'});return {data:{}};}
  if(fn==='task_list_projects')return {data:[{id:'pr1',title:'المهام الوظيفية المتكررة',can_manage:true},{id:'pr2',title:'مشروع لا أديره',can_manage:false}]};
  if(fn==='task_create_recurring_for_person'){duty=Object.assign({},duty,{duties:[{id:'r1',title:args.p_title,interval_value:1,interval_unit:args.p_interval_unit,active:true,project:'المهام الوظيفية المتكررة'}]});return {data:'t1'};}
  return {data:null};}}};
w.eval(fs.readFileSync('assets/js/workforce-prices.js','utf8'));w.SSMPDHumanResources.render(d.querySelector('main'));await tick();
// An employee WITH an account has no role section and no extra call.
d.querySelector('[data-wp=person][data-id=p2]').click();await tick();assert(!d.querySelector('[data-person-duties]'));assert(!calls.some(c=>c.fn==='hr_person_duties'));
d.querySelector('[data-wp=person][data-id=p1]').click();await tick();let box=d.querySelector('[data-person-duties]');
assert(box.textContent.includes('غير محدد'));assert(!box.querySelector('[data-duty=add]'),'duties need a role first');
box.querySelector('[data-duty=role]').click();let f=d.querySelector('.wp-modal form');f.elements.role.value='general_manager';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
assert.equal(JSON.stringify(calls.find(c=>c.fn==='hr_set_manager_role').args),JSON.stringify({p_person:'p1',p_role:'general_manager'}));
box=d.querySelector('[data-person-duties]');assert(box.textContent.includes('مدير عام'));assert(box.textContent.includes('مديرة أولى'));
box.querySelector('[data-duty=add]').click();await tick();f=d.querySelector('.wp-modal form');
assert.equal(Array.from(f.elements.project.options).map(o=>o.value).join(','),'pr1','only projects the HR user manages');
f.elements.title.value='نظافة العيادة والحمامات';f.elements.every.value='day';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
const sent=calls.find(c=>c.fn==='task_create_recurring_for_person').args;assert.equal(sent.p_person,'p1');assert.equal(sent.p_project_id,'pr1');assert.equal(sent.p_interval_unit,'day');assert.equal(sent.p_interval_value,1);
assert(d.querySelector('[data-person-duties]').textContent.includes('نظافة العيادة والحمامات'));
// Payroll: the guaranteed-minimum choice travels with the pay rule and the calculation explains the offset.
w.SSMPDWorkforceUtils=w.SSMPDWorkforceUtils||{};w.eval(fs.readFileSync('assets/js/hr-payroll-workspace.js','utf8'));
const ui=w.SSMPDWorkforceUtils;let rpcCalls=[];ui.rpc=async(fn,args)=>{rpcCalls.push({fn,args});if(fn==='hr_payroll_calculate')return {base:8000,approved_shifts:20,late_minutes:0,absent_shifts:0,overtime_hours:0,bonus:0,commission:0,allowance:0,salary_deduction:3000,pre_tax_net:5000,guaranteed_minimum:true,doctor_commission:3000,guarantee_offset:3000,scope:'نطاق'};return null;};
const host=d.createElement('div');host.innerHTML='<div class="wp"></div>';d.body.append(host);w.SSMPDHRPayroll.attach(host,{can_manage:true,people:[{id:'p1',full_name:'أخصائية',code:'EMP-T06',status:'active'}],attendance:[]},'2026-11',async()=>{});
host.querySelector('[data-hrp=rules]').click();f=d.querySelectorAll('.wp-modal form');f=f[f.length-1];assert.equal(f.elements.guaranteed_minimum.value,'false','off by default');
f.elements.guaranteed_minimum.value='true';f.elements.note.value='اتفاق الحد الأدنى';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
assert.equal(rpcCalls.find(c=>c.fn==='hr_payroll_command').args.p_payload.guaranteed_minimum,'true');
host.querySelector('[data-hrp=calculate]').click();f=d.querySelectorAll('.wp-modal form');f=f[f.length-1];f.querySelector('[data-hrp=calc-now]').click();await tick();await tick();
const out=f.querySelector('[data-calc]').textContent;assert(out.includes('حد أدنى مضمون'));assert(out.includes('3000'));
dom.window.close();console.log('PASS role duties DOM: role section only for account-less staff, role first, managed projects only, duty sent for the person; guaranteed-minimum rule sent and explained in the calculation.');
})().catch(e=>{console.error(e);process.exit(1)});
