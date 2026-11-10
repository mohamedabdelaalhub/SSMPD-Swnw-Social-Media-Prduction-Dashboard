// «مهامي الوظيفية»: role -> duty mapping, card rendering (single role, several roles as tabs, empty state), data integrity, home integration.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const src=f=>fs.readFileSync('assets/js/'+f,'utf8');
function boot(people,fail){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.SSMPDDb={client:{rpc:async(n)=>{if(fail)throw new Error('x');return {data:{people:people||[]}};}}};
 w.eval(src('roles.js'));w.eval(src('job-duties-data.js'));w.eval(src('job-duties.js'));
 return w;
}
const tick=()=>new Promise(r=>setTimeout(r,5));
const keys=(w,admin,person)=>Array.from(w.SSMPDJobDuties.resolve(admin,person));
async function show(admin,people,fail){const w=boot(people,fail),host=w.document.getElementById('root');w.SSMPDJobDuties.mount(host,admin);await tick();return {w,host};}
(async()=>{
 // data integrity: every role has the four text fields; owner's combined entry exists
 const w0=boot();const data=w0.SSMPDJobDutiesData;assert.equal(data.roles.length,12);
 for(const r of data.roles){for(const f of ['title','daily','periodic','notAuthorized','reportsTo'])assert(r[f]&&String(r[f]).length>2,r.key+'.'+f);}
 assert.equal(new Set(data.roles.map(r=>r.key)).size,12);
 const owner=data.roles.find(r=>r.key==='chairman_ceo_founder');assert.equal(owner.title,'رئيس مجلس الإدارة والرئيس التنفيذي - المؤسس');assert(/منفردًا/.test(owner.notAuthorized)&&/الأرباح/.test(owner.notAuthorized));
 // role mapping (accounts)
 assert.deepEqual(keys(w0,{id:'1',role:'accountant'}),['accountant']);
 assert.deepEqual(keys(w0,{id:'1',role:'financial_manager'}),['financial_manager']);
 assert.deepEqual(keys(w0,{id:'1',role:'reception',roles:['reception','customer_service']}),['reception','customer_service']);
 assert.deepEqual(keys(w0,{id:'1',role:'nursing'}),['nursing']);assert.deepEqual(keys(w0,{id:'1',role:'head_nursing'}),['nursing']);
 assert.deepEqual(keys(w0,{id:'1',role:'sono_doctor'}),['doctor']);
 assert.deepEqual(keys(w0,{id:'1',role:'reception',has_hr_access:true}),['hr','reception']);
 // conservative: powerful or unmapped roles alone show nothing
 for(const r of ['super_admin','general_manager','page_manager','designer','approver','contract_manager','psychology_specialist','digital_agent'])assert.deepEqual(keys(w0,{id:'1',role:r}),[],r);
 // job title / kind refinement
 assert.deepEqual(keys(w0,{id:'2',role:'super_admin',roles:['super_admin','accountant']},{job_title:'رئيس مجلس الادارة- المؤسس ',kind:'unclassified',department:'الادارة'}),['chairman_ceo_founder','accountant']);
 assert.deepEqual(keys(w0,{id:'3',role:'super_admin',roles:['super_admin','sono_doctor']},{job_title:'مدير تنفيذي - العضو المنتدب - شريك مؤسس',kind:'both'}),['founder_partner','managing_director','doctor']);
 assert.deepEqual(keys(w0,{id:'4',role:'super_admin'},{job_title:'مدير تنفيذي'}),['ceo']);
 assert.deepEqual(keys(w0,{id:'5',role:'general_manager'},{job_title:'مدير إداري',department:'الإدارة'}),[]);
 assert.deepEqual(keys(w0,{id:'6',role:'reception'},{job_title:'مسؤول الشؤون القانونية'}),['reception','legal']);
 assert.deepEqual(keys(w0,{id:'7',role:'page_manager'},{kind:'doctor'}),['doctor']);

 // render: single role (accountant) - heading, four fields, exact Arabic text from the data file, no tabs
 let r=await show({id:'a1',role:'accountant'});
 assert.equal(r.host.querySelector('.ph-duties summary h2').textContent,'مهامي الوظيفية');
 assert.equal(r.host.querySelectorAll('[role=tab]').length,0);
 assert.equal(r.host.querySelector('.ph-duty-single h3').textContent,'المحاسب');
 const txt=r.host.textContent;for(const s of ['تسجيل القيود، مطابقة الخزينة والبنوك، تجهيز كشوف الصرف','إعداد كشوف المرتبات والمخالصات والتسويات، تجهيز تقارير الإقفال','اعتماد ما أعدّه','المدير المالي'])assert(txt.includes(s),s);
 assert.equal(r.host.querySelectorAll('.ph-duty-field').length,4);
 // render: three further single roles
 for(const [role,title] of [['reception','الاستقبال'],['customer_service','خدمة العملاء'],['nursing','رئيس التمريض / التمريض'],['financial_manager','المدير المالي'],['sono_doctor','الطبيب']]){r=await show({id:'s'+role,role});assert.equal(r.host.querySelector('.ph-duty-single h3').textContent,title);}
 // multi-role: tabs, a11y wiring, keyboard (RTL), state kept across re-mount
 const multi={id:'m1',role:'reception',roles:['reception','customer_service','accountant']};
 r=await show(multi);const tabs=[...r.host.querySelectorAll('[role=tab]')];
 assert.deepEqual(tabs.map(t=>t.textContent),['المحاسب','الاستقبال','خدمة العملاء']);
 assert.equal(r.host.querySelector('[role=tablist]').getAttribute('aria-label'),'أدوارك الوظيفية');
 assert.deepEqual(tabs.map(t=>t.getAttribute('aria-selected')),['true','false','false']);assert.deepEqual(tabs.map(t=>t.tabIndex),[0,-1,-1]);
 for(const t of tabs){const p=r.host.querySelector('#'+t.getAttribute('aria-controls'));assert(p&&p.getAttribute('role')==='tabpanel'&&p.getAttribute('aria-labelledby')===t.id);}
 const vis=()=>[...r.host.querySelectorAll('[role=tabpanel]')].map(p=>!p.hidden);
 assert.deepEqual(vis(),[true,false,false]);
 tabs[0].focus();tabs[0].dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
 assert.deepEqual(vis(),[false,true,false]);assert.equal(r.w.document.activeElement,tabs[1]);assert.equal(tabs[1].getAttribute('aria-selected'),'true');
 tabs[1].dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.deepEqual(vis(),[false,false,true]);
 tabs[2].dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.deepEqual(vis(),[true,false,false]);
 tabs[1].click();assert.deepEqual(vis(),[false,true,false]);assert(r.host.querySelector('[role=tabpanel]:not([hidden])').textContent.includes('الحجوزات، تسجيل الحضور'));
 // re-mount (home reload) keeps selected tab and open state
 r.host.querySelector('details').open=true;r.host.querySelector('details').dispatchEvent(new r.w.Event('toggle'));
 r.w.SSMPDJobDuties.mount(r.host,multi);await tick();
 assert(r.host.querySelector('details').open);assert.equal(r.host.querySelector('[role=tab][aria-selected=true]').textContent,'الاستقبال');

 // HR row arrives through hr_workspace: owner (super_admin + accountant role) gets combined entry + accountant tabs
 const ownerAdmin={id:'own',role:'super_admin',roles:['super_admin','accountant']};
 r=await show(ownerAdmin,[{admin_id:'other',job_title:'مدير مالي'},{admin_id:'own',job_title:'رئيس مجلس الادارة- المؤسس ',kind:'unclassified'}]);
 assert.deepEqual([...r.host.querySelectorAll('[role=tab]')].map(t=>t.textContent),['رئيس مجلس الإدارة والرئيس التنفيذي - المؤسس','المحاسب']);
 // when the HR lookup fails, the account roles still render
 r=await show({id:'f1',role:'reception'},null,true);assert.equal(r.host.querySelector('.ph-duty-single h3').textContent,'الاستقبال');

 // empty state: neutral message, hint to contact management, never an error
 r=await show({id:'e1',role:'page_manager'},[]);
 assert(!r.host.querySelector('[role=tab]'));assert(r.host.textContent.includes('تواصل مع الإدارة'));assert(!/خطأ|error/i.test(r.host.textContent));
 r=await show({id:'e2',role:'super_admin'},[{admin_id:'e2',job_title:'مدير إداري'}]);assert(r.host.textContent.includes('تواصل مع الإدارة'));
 // while the HR row is still loading an unmapped user sees a loading status, not the empty message
 const w1=boot([]);const h=w1.document.getElementById('root');w1.SSMPDJobDuties.mount(h,{id:'e3',role:'page_manager'});assert(h.textContent.includes('جاري تحميل'));assert(!h.textContent.includes('تواصل مع الإدارة'));await tick();assert(h.textContent.includes('تواصل مع الإدارة'));
 // no HTML injection from data
 assert.equal(w0.SSMPDJobDuties._norm('الإدارة'),'الاداره');

 // home integration: personal-home.js renders the host element and mounts the card
 const dom=new JSDOM('<button id="notif-bell-btn"></button><span id="notif-badge"></span><div id="notif-panel" hidden></div><div id="root"></div>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,root=w.document.getElementById('root'),admin={id:'hm',name:'موظف',role:'reception'};
 w.SSMPDAuth={currentAdmin:admin};
 w.SSMPDDb={unsubscribe(){},setContentRating:()=>Promise.resolve(),client:{rpc:async(n)=>({data:n==='personal_home_inbox'?{notices:[],unread:0}:n==='personal_home_rating_queue'?[]:n==='hr_workspace'?{people:[]}:{tasks:{open:0,late:0,review:0,team_open:0,team_late:0,blocked:0,mine:[],reviews:[],team:[]},content:null,supplies:[],generated_at:new Date().toISOString()}})}};
 w.eval(src('roles.js'));w.eval(src('job-duties-data.js'));w.eval(src('job-duties.js'));w.eval(src('personal-home.js'));
 w.SSMPDPersonalHome.mountNotifications(admin,{open(){}});await w.SSMPDPersonalHome.render(root);await tick();await tick();
 const card=root.querySelector('[data-job-duties] .ph-duties');assert(card,'duties card inside personal home');
 assert(root.querySelector('.ph-welcome').compareDocumentPosition(card)&4);
 assert.equal(card.querySelector('.ph-duty-single h3').textContent,'الاستقبال');
 w.SSMPDPersonalHome.stop();
 console.log('PASS job duties: mapping table, 5+ single roles, multi-role tabs + keyboard, HR-row refinement, failure tolerance, empty state, home integration');
})().catch(e=>{console.error(e);process.exit(1);});
