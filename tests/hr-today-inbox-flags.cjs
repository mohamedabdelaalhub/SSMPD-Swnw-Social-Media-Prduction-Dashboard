// «محتاج متابعتك»: optional rows follow the server flags (is_hr / can_manage / can_review), not the role; a refused read
// (hr_offboarding_workspace raises «ليس لديك صلاحية» for non-HR) shows nothing and never toasts.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://t.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document,toasts=[];w.SSMPDToast={show:m=>toasts.push(m)};
const data={hr_overtime:{is_hr:false,to_review:[]},hr_shift_swaps_list:{can_manage:false,swaps:[{status:'pending_manager',created_by:'x',partner_by:'y'}]},hr_insurance_workspace:{can_manage:false,items:[{status:'stopped',notification_deadline:'2000-01-01',stop_reference:''}]}};
w.SSMPDDb={client:{rpc:async fn=>fn==='hr_offboarding_workspace'?{error:{message:'ليس لديك صلاحية'}}:{data:data[fn]}}};
w.eval(fs.readFileSync('assets/js/hr-today-inbox.js','utf8'));const host=d.createElement('section');d.querySelector('main').append(host);
await w.SSMPDHRToday.mount(host,{people:[],requests:[],attendance:[]},{me:'r1',month:'2026-11'});
assert.equal(host.querySelectorAll('[data-hrn-row]').length,0,'no rows without the server flags');assert(!host.querySelector('[data-hrn-done]').hidden);assert.deepEqual(toasts,[]);
w.SSMPDHRToday.reset();data.hr_shift_swaps_list.can_manage=true;data.hr_insurance_workspace.can_manage=true;const h2=d.createElement('section');d.querySelector('main').append(h2);
await w.SSMPDHRToday.mount(h2,{people:[],requests:[],attendance:[]},{me:'r1',month:'2026-11'});
assert.deepEqual([...h2.querySelectorAll('[data-hrn-row]')].map(n=>n.dataset.hrnRow),['swaps','insurance'],'flags on → rows');
console.log('PASS HR today inbox flags: rows gated on is_hr/can_manage/can_review, refused read is silent (no toast).');})().catch(e=>{console.error(e);process.exit(1);});
